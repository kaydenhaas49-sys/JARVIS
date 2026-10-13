/* JARVIS holographic sphere backdrop, inspired by lcars-reference/static/screensaver.js.
   It renders a static frame while idle and animates only during active assistant states. */
(function () {
  "use strict";
  if (!document.body || document.getElementById("jarvis-orb-canvas")) return;

  var canvas = document.createElement("canvas");
  canvas.id = "jarvis-orb-canvas";
  canvas.setAttribute("aria-hidden", "true");
  var ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;
  document.body.insertBefore(canvas, document.body.firstChild);

  var width = 0;
  var height = 0;
  var dpr = 1;
  var raf = 0;
  var frameTimer = 0;
  var reducedMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  var colors = {
    orange: "255,159,67",
    gold: "255,209,102",
    lilac: "200,162,255",
    blue: "133,170,255",
    cyan: "120,228,238",
    green: "121,224,176",
    red: "255,65,92",
    steel: "177,203,229",
    white: "243,255,255"
  };
  var assistantState = "idle";
  window.addEventListener("jarvis:state", function (event) {
    var next = event && event.detail && event.detail.state;
    if (["idle", "listening", "thinking", "speaking", "error"].includes(next)) {
      assistantState = next;
      canvas.dataset.state = next;
      if (assistantState === "idle") stop();
      else start();
    }
  });

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.35);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(performance.now());
  }

  function drawBackgroundGrid(time) {
    var spacing = width < 700 ? 62 : 74;
    var shiftX = (time * 0.003) % spacing;
    var shiftY = (time * 0.0018) % spacing;
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(133,170,255,0.035)";
    for (var x = -spacing + shiftX; x < width + spacing; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (var y = -spacing + shiftY; y < height + spacing; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,159,67,0.08)";
    for (var px = -spacing + shiftX; px < width + spacing; px += spacing) {
      for (var py = -spacing + shiftY; py < height + spacing; py += spacing) {
        ctx.beginPath(); ctx.arc(px, py, 1, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawOrbitalRing(x, y, rx, ry, angle, color, alpha, tickCount, phase) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(" + color + ",1)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (tickCount) {
      for (var i = 0; i < tickCount; i++) {
        var a = (i / tickCount) * Math.PI * 2 + (phase || 0);
        var px = Math.cos(a) * rx;
        var py = Math.sin(a) * ry;
        var nx = Math.cos(a) / rx;
        var ny = Math.sin(a) / ry;
        var n = Math.sqrt(nx * nx + ny * ny) || 1;
        var len = i % 5 === 0 ? 9 : 4;
        ctx.globalAlpha = alpha * (i % 5 === 0 ? 1 : .52);
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + nx / n * len, py + ny / n * len);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawEnergyArc(x, y, rx, ry, rotation, start, end, color, lineWidth, alpha, glow) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(" + color + ",1)";
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(" + color + ",.9)";
    ctx.shadowBlur = glow;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, start, end);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Bright terminals make each arc feel like an active energy circuit.
    [start, end].forEach(function (angle, index) {
      var px = Math.cos(angle) * rx;
      var py = Math.sin(angle) * ry;
      ctx.globalAlpha = alpha * (index === 0 ? .9 : .58);
      ctx.fillStyle = "rgba(" + color + ",1)";
      ctx.beginPath();
      ctx.arc(px, py, lineWidth * (index === 0 ? 1.7 : 1.1), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  // A cleaner reactor globe: broad glass shell, three precise orbital tracks,
  // restrained scan details, and a bright contained core instead of dense noise.
  function drawSphere(x, y, r, time) {
    var active = assistantState !== "idle";
    var pulseBoost = assistantState === "thinking" ? .05 :
      assistantState === "speaking" ? .035 :
      assistantState === "listening" ? .025 :
      assistantState === "error" ? .012 : 0;
    var spinBoost = assistantState === "thinking" ? 1.7 :
      assistantState === "speaking" ? 1.25 :
      assistantState === "listening" ? .7 :
      assistantState === "error" ? .6 : 1;
    var stateColor = assistantState === "listening" ? colors.green :
      assistantState === "speaking" ? colors.gold :
      assistantState === "error" ? colors.red :
      assistantState === "thinking" ? colors.lilac : colors.cyan;
    var pulse = .985 + Math.sin(time * .0011) * .015 + pulseBoost * (.65 + Math.sin(time * .002) * .35);
    var spin = time * .00015 * spinBoost;
    var orbitX = x + Math.sin(time * .0002) * r * .025;
    var orbitY = y + Math.cos(time * .00017) * r * .018;
    var globeR = r * .59 * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    var halo = ctx.createRadialGradient(orbitX, orbitY, globeR * .2, orbitX, orbitY, r * 1.7);
    halo.addColorStop(0, "rgba(" + colors.cyan + ",.18)");
    halo.addColorStop(.28, "rgba(" + colors.blue + ",.12)");
    halo.addColorStop(.56, "rgba(" + colors.lilac + ",.045)");
    halo.addColorStop(1, "rgba(" + colors.cyan + ",0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, r * 1.7, 0, Math.PI * 2);
    ctx.fill();

    // Three orbital tracks keep the silhouette readable and deliberate.
    drawOrbitalRing(orbitX, orbitY, r * 1.25, r * .32, -.42 + spin * .65,
      stateColor, .43, 56, spin * .65);
    drawOrbitalRing(orbitX, orbitY, r * 1.08, r * .62, .82 - spin * .42,
      colors.lilac, .27, 40, -spin * .5);
    drawOrbitalRing(orbitX, orbitY, r * 1.48, r * .15, .18 + spin * .32,
      colors.orange, .3, 64, spin * .55);

    drawEnergyArc(orbitX, orbitY, r * 1.25, r * .32, -.42 + spin * .65,
      .18 + spin * 1.6, 1.18 + spin * 1.6, stateColor, 2, .88, 13);
    drawEnergyArc(orbitX, orbitY, r * 1.08, r * .62, .82 - spin * .42,
      3.12 - spin * 1.2, 4.03 - spin * 1.2, colors.lilac, 1.7, .58, 9);
    drawEnergyArc(orbitX, orbitY, r * 1.48, r * .15, .18 + spin * .32,
      3.38 + spin * 1.1, 4.08 + spin * 1.1, colors.orange, 2.1, .66, 12);

    // Glass shell with a stronger, clean edge and a cool highlight.
    var sphereGradient = ctx.createRadialGradient(
      orbitX - globeR * .36, orbitY - globeR * .4, globeR * .025,
      orbitX, orbitY, globeR * 1.14
    );
    sphereGradient.addColorStop(0, "rgba(" + colors.white + ",.86)");
    sphereGradient.addColorStop(.09, "rgba(" + colors.cyan + ",.58)");
    sphereGradient.addColorStop(.28, "rgba(" + colors.blue + ",.35)");
    sphereGradient.addColorStop(.62, "rgba(22,45,82,.25)");
    sphereGradient.addColorStop(1, "rgba(4,9,22,.025)");
    ctx.globalAlpha = .94;
    ctx.fillStyle = sphereGradient;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.clip();

    for (var meridian = -4; meridian <= 4; meridian++) {
      var widthFactor = Math.max(.07, Math.abs(Math.cos(meridian * .31 + spin * 1.8)));
      ctx.globalAlpha = meridian % 2 === 0 ? .31 : .17;
      ctx.strokeStyle = meridian % 3 === 0
        ? "rgba(" + colors.lilac + ",.95)" : "rgba(" + colors.cyan + ",.95)";
      ctx.lineWidth = meridian % 3 === 0 ? .9 : .65;
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY, globeR * widthFactor, globeR, spin + meridian * .018, 0, Math.PI * 2);
      ctx.stroke();
    }

    for (var lat = -3; lat <= 3; lat++) {
      var yOffset = (lat / 4) * globeR;
      var wide = Math.sqrt(Math.max(0, globeR * globeR - yOffset * yOffset));
      ctx.globalAlpha = lat === 0 ? .48 : .22;
      ctx.strokeStyle = lat === 0 ? "rgba(" + stateColor + ",1)" : "rgba(" + colors.blue + ",1)";
      ctx.lineWidth = lat === 0 ? 1.1 : .65;
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY + yOffset, wide, Math.max(1.1, globeR * .045), spin * .12, 0, Math.PI * 2);
      ctx.stroke();
    }

    // A thin scan band and a handful of points give the globe detail without clutter.
    var scanY = orbitY + Math.sin(time * .0006) * globeR * .34;
    var scanGlow = ctx.createLinearGradient(orbitX, scanY - 9, orbitX, scanY + 9);
    scanGlow.addColorStop(0, "rgba(" + stateColor + ",0)");
    scanGlow.addColorStop(.5, "rgba(" + stateColor + ",.32)");
    scanGlow.addColorStop(1, "rgba(" + stateColor + ",0)");
    ctx.fillStyle = scanGlow;
    ctx.fillRect(orbitX - globeR, scanY - 9, globeR * 2, 18);

    for (var spark = 0; spark < 14; spark++) {
      var sparkAngle = spark * 2.399 + spin * (spark % 2 ? 1.1 : -.8);
      var sparkRadius = globeR * (.22 + ((spark * 5) % 11) / 16);
      var sx = orbitX + Math.cos(sparkAngle) * sparkRadius;
      var sy = orbitY + Math.sin(sparkAngle * 1.13) * sparkRadius * .82;
      var sparkAlpha = active ? .42 + (Math.sin(time * .0014 + spark * 1.3) + 1) * .2 : .55;
      ctx.globalAlpha = sparkAlpha;
      ctx.fillStyle = spark % 5 === 0
        ? "rgba(" + colors.gold + ",1)" : "rgba(" + colors.white + ",1)";
      ctx.beginPath();
      ctx.arc(sx, sy, spark % 5 === 0 ? 1.7 : 1.05, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Rim lighting and a faint secondary glass edge.
    ctx.globalAlpha = .68;
    ctx.strokeStyle = "rgba(" + stateColor + ",.94)";
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = .18;
    ctx.strokeStyle = "rgba(" + colors.lilac + ",.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(orbitX + globeR * .03, orbitY - globeR * .022, globeR * 1.022, 0, Math.PI * 2);
    ctx.stroke();

    // Small, bright reactor core with two fine circuit loops.
    var coreR = r * (.105 + Math.sin(time * .0014) * .006 + pulseBoost * .12);
    var coreHalo = ctx.createRadialGradient(orbitX, orbitY, coreR * .12, orbitX, orbitY, coreR * 4.2);
    coreHalo.addColorStop(0, "rgba(255,255,255,.88)");
    coreHalo.addColorStop(.2, "rgba(" + colors.cyan + ",.5)");
    coreHalo.addColorStop(.5, "rgba(" + stateColor + ",.18)");
    coreHalo.addColorStop(1, "rgba(" + stateColor + ",0)");
    ctx.globalAlpha = .95;
    ctx.fillStyle = coreHalo;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, coreR * 4.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(orbitX, orbitY);
    ctx.rotate(spin * 5);
    ctx.strokeStyle = "rgba(" + colors.gold + ",.78)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, coreR * 2.15, coreR * .76, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(Math.PI / 2.8);
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.84)";
    ctx.lineWidth = .9;
    ctx.beginPath();
    ctx.ellipse(0, 0, coreR * 1.72, coreR * .58, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    var core = ctx.createRadialGradient(
      orbitX - coreR * .22, orbitY - coreR * .24, 0, orbitX, orbitY, coreR * 1.24
    );
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(.24, "rgba(" + colors.white + ",.98)");
    core.addColorStop(.58, "rgba(" + colors.cyan + ",.86)");
    core.addColorStop(1, "rgba(" + stateColor + ",0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, coreR * 1.24, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Satellite points stay sparse, with short trails rather than another dense ring.
    for (var node = 0; node < 10; node++) {
      var angle = time * .00017 + node * Math.PI * .2;
      var rx = r * 1.43;
      var ry = r * .37;
      var px = orbitX + Math.cos(angle) * rx;
      var py = orbitY + Math.sin(angle) * ry;
      var tx = orbitX + Math.cos(angle - .08) * rx;
      var ty = orbitY + Math.sin(angle - .08) * ry;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = active ? .25 + (Math.sin(time * .001 + node) + 1) * .13 : .42;
      ctx.strokeStyle = node % 3 === 0
        ? "rgba(" + colors.orange + ",1)" : "rgba(" + colors.cyan + ",1)";
      ctx.lineWidth = node % 3 === 0 ? 1.5 : .8;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = node % 3 === 0
        ? "rgba(" + colors.gold + ",1)" : "rgba(" + colors.white + ",1)";
      ctx.beginPath();
      ctx.arc(px, py, node % 3 === 0 ? 2.1 : 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Symmetrical registration marks anchor the instrument to the centre.
    ctx.save();
    ctx.globalAlpha = .3;
    ctx.strokeStyle = "rgba(" + stateColor + ",.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(orbitX - r * 1.78, orbitY);
    ctx.lineTo(orbitX - r * 1.59, orbitY);
    ctx.moveTo(orbitX + r * 1.59, orbitY);
    ctx.lineTo(orbitX + r * 1.78, orbitY);
    ctx.stroke();
    ctx.fillStyle = "rgba(" + stateColor + ",1)";
    ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.letterSpacing = "1.3px";
    ctx.textAlign = "center";
    var stateLabels = {
      idle: "NEURAL CORE",
      listening: "LISTENING",
      thinking: "PROCESSING",
      speaking: "VOICE OUTPUT",
      error: "ATTENTION"
    };
    ctx.fillText("J.A.R.V.I.S  /  " + stateLabels[assistantState], orbitX, orbitY + r * .98);
    ctx.restore();
  }

  function render(time) {
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    // Use a carefully composed, repeatable frame while idle rather than freezing
    // at a random point in the previous animation.
    var animationTime = assistantState === "idle" ? 0 : (reducedMotion ? time * .42 : time);
    drawBackgroundGrid(animationTime);

    // Anchor the orb to the main conversation display, not the whole window.
    var viewport = document.getElementById("conversationViewport");
    var bounds = viewport ? viewport.getBoundingClientRect() : null;
    var mobile = width < 700;
    var x = bounds ? bounds.left + bounds.width * .5 : width * .62;
    var y = bounds ? bounds.top + bounds.height * .49 : height * .49;
    var displayWidth = bounds && bounds.width ? bounds.width : width;
    var displayHeight = bounds && bounds.height ? bounds.height : height;
    var r = Math.min(displayWidth * .34, displayHeight * .42);
    r = Math.max(mobile ? 70 : 100, Math.min(r, 430));

    // Strong presence on the idle screen; fade back under conversation text.
    var chatLog = document.getElementById("chatLog");
    var hasConversation = !!(chatLog && chatLog.children.length);
    var active = assistantState !== "idle";
    canvas.style.opacity = hasConversation
      ? (active ? (mobile ? ".28" : ".4") : (mobile ? ".18" : ".23"))
      : (mobile ? ".78" : ".92");
    drawSphere(x, y, r, animationTime);
  }

  function tick(time) {
    raf = 0;
    if (document.hidden || assistantState === "idle") return;
    render(time);
    // Redraw at most 24 FPS while active (12 FPS for reduced motion) rather than every frame.
    frameTimer = window.setTimeout(function () {
      frameTimer = 0;
      start();
    }, reducedMotion ? 1000 / 12 : 1000 / 24);
  }

  function start() {
    if (!raf && !frameTimer && !document.hidden && assistantState !== "idle") {
      raf = window.requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    if (frameTimer) window.clearTimeout(frameTimer);
    raf = 0;
    frameTimer = 0;
    // Freeze the current visual instead of keeping a full-screen canvas loop alive.
    if (!document.hidden) render(performance.now());
  }

  // Chat mutations need one static redraw while idle. During active animation,
  // the next throttled frame will incorporate any new message content.
  var observedChatLog = document.getElementById("chatLog");
  if (observedChatLog && window.MutationObserver) {
    var chatObserver = new MutationObserver(function () {
      if (assistantState === "idle" && !document.hidden) render(performance.now());
    });
    chatObserver.observe(observedChatLog, { childList: true, subtree: true });
  }

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (raf) window.cancelAnimationFrame(raf);
      if (frameTimer) window.clearTimeout(frameTimer);
      raf = 0;
      frameTimer = 0;
    } else {
      render(performance.now());
      start();
    }
  });
  if (window.matchMedia) {
    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener("change", function (event) {
        reducedMotion = event.matches;
        // The next active frame will use the updated reduced-motion frame cap.
        if (assistantState !== "idle") {
          if (frameTimer) window.clearTimeout(frameTimer);
          frameTimer = 0;
          start();
        }
      });
    }
  }
  resize();
  start();
})();