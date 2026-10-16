/* JARVIS holographic sphere backdrop. Continuously animated with a balanced render budget. */
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
  var lastFrameTime = 0;
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
  var animationStart = 0;
  window.addEventListener("jarvis:state", function (event) {
    var next = event && event.detail && event.detail.state;
    if (["idle", "listening", "thinking", "speaking", "error"].includes(next)) {
      if (assistantState === "idle" && next !== "idle") animationStart = performance.now();
      assistantState = next;
      canvas.dataset.state = next;
      start();
    }
  });

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 1.1);
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
    ctx.strokeStyle = "rgba(78,208,255,0.028)";
    for (var x = -spacing + shiftX; x < width + spacing; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (var y = -spacing + shiftY; y < height + spacing; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = "rgba(80,224,255,0.055)";
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

  // Cinematic Stark-style holographic core: circular range reticles, cyan arc
  // segments, a glass globe, and precise instrument marks with very restrained glow.
  function drawSphere(x, y, r, time) {
    var active = assistantState !== "idle";
    var pulseBoost = assistantState === "thinking" ? .045 :
      assistantState === "speaking" ? .03 :
      assistantState === "listening" ? .025 :
      assistantState === "error" ? .012 : 0;
    var stateColor = assistantState === "listening" ? colors.green :
      assistantState === "speaking" ? colors.gold :
      assistantState === "error" ? colors.red :
      assistantState === "thinking" ? colors.blue : colors.cyan;
    var phase = time * (assistantState === "thinking" ? .00024 : .00013);
    var pulse = .987 + Math.sin(time * .00115) * .013 + pulseBoost * (.7 + Math.sin(time * .002) * .3);
    var orbitX = x + Math.sin(phase * .75) * r * .018;
    var orbitY = y + Math.cos(phase * .65) * r * .014;
    var globeR = r * .54 * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    var halo = ctx.createRadialGradient(orbitX, orbitY, globeR * .15, orbitX, orbitY, r * 1.65);
    halo.addColorStop(0, "rgba(" + colors.cyan + ",.17)");
    halo.addColorStop(.26, "rgba(" + colors.blue + ",.11)");
    halo.addColorStop(.58, "rgba(" + colors.cyan + ",.035)");
    halo.addColorStop(1, "rgba(" + colors.cyan + ",0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, r * 1.65, 0, Math.PI * 2);
    ctx.fill();

    // Concentric circular scopes: the main visual signature of the JARVIS HUD.
    drawOrbitalRing(orbitX, orbitY, r * 1.37, r * 1.37, phase * .18,
      colors.cyan, .24, 72, -phase * .12);
    drawOrbitalRing(orbitX, orbitY, r * 1.18, r * 1.18, -phase * .22,
      colors.blue, .27, 60, phase * .2);
    drawOrbitalRing(orbitX, orbitY, r * .91, r * .91, phase * .28,
      colors.cyan, .13, 48, -phase * .25);

    // Two tilted orbits provide depth without the clutter of a dozen rings.
    drawOrbitalRing(orbitX, orbitY, r * 1.43, r * .34, -.43 + phase * .6,
      colors.cyan, .52, 48, phase * .7);
    drawOrbitalRing(orbitX, orbitY, r * 1.27, r * .22, .78 - phase * .42,
      colors.blue, .32, 40, -phase * .8);
    drawOrbitalRing(orbitX, orbitY, r * 1.55, r * .11, .18 + phase * .3,
      colors.gold, .25, 48, phase);

    drawEnergyArc(orbitX, orbitY, r * 1.37, r * 1.37, phase * .18,
      .18 + phase * 1.2, 1.03 + phase * 1.2, colors.cyan, 2.1, .85, 12);
    drawEnergyArc(orbitX, orbitY, r * 1.18, r * 1.18, -phase * .22,
      2.9 - phase * .9, 3.72 - phase * .9, colors.blue, 1.7, .72, 9);
    drawEnergyArc(orbitX, orbitY, r * 1.43, r * .34, -.43 + phase * .6,
      3.35 + phase * 1.5, 4.18 + phase * 1.5, stateColor, 2, .78, 12);
    drawEnergyArc(orbitX, orbitY, r * 1.55, r * .11, .18 + phase * .3,
      4.65 - phase * .8, 5.25 - phase * .8, colors.gold, 1.7, .58, 8);

    // Fine radial reticle ticks, grouped into major and minor graduations.
    ctx.save();
    ctx.translate(orbitX, orbitY);
    ctx.rotate(-phase * .14);
    for (var tick = 0; tick < 96; tick++) {
      var angle = tick * Math.PI * 2 / 96;
      var major = tick % 8 === 0;
      var medium = tick % 3 === 0;
      var inner = r * 1.49;
      var outer = inner + (major ? 13 : medium ? 7 : 3.2);
      ctx.globalAlpha = major ? .62 : medium ? .3 : .15;
      ctx.strokeStyle = major ? "rgba(" + colors.cyan + ",1)" :
        "rgba(" + colors.blue + ",1)";
      ctx.lineWidth = major ? 1.15 : .65;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.restore();

    // Translucent globe with a quiet specular highlight and wireframe latitude/longitude.
    var sphereGradient = ctx.createRadialGradient(
      orbitX - globeR * .38, orbitY - globeR * .43, globeR * .02,
      orbitX, orbitY, globeR * 1.12
    );
    sphereGradient.addColorStop(0, "rgba(" + colors.white + ",.82)");
    sphereGradient.addColorStop(.08, "rgba(" + colors.cyan + ",.56)");
    sphereGradient.addColorStop(.25, "rgba(" + colors.blue + ",.31)");
    sphereGradient.addColorStop(.62, "rgba(13,53,91,.22)");
    sphereGradient.addColorStop(1, "rgba(2,12,27,.015)");
    ctx.globalAlpha = .9;
    ctx.fillStyle = sphereGradient;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.clip();

    for (var meridian = -4; meridian <= 4; meridian++) {
      var widthFactor = Math.max(.055, Math.abs(Math.cos(meridian * .28 + phase * 1.8)));
      ctx.globalAlpha = meridian % 2 === 0 ? .32 : .17;
      ctx.strokeStyle = meridian % 3 === 0
        ? "rgba(" + colors.cyan + ",.96)" : "rgba(" + colors.blue + ",.94)";
      ctx.lineWidth = meridian % 3 === 0 ? .85 : .6;
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY, globeR * widthFactor, globeR, phase + meridian * .015, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (var lat = -4; lat <= 4; lat++) {
      var yOffset = (lat / 5) * globeR;
      var wide = Math.sqrt(Math.max(0, globeR * globeR - yOffset * yOffset));
      ctx.globalAlpha = lat === 0 ? .4 : .19;
      ctx.strokeStyle = lat === 0
        ? "rgba(" + stateColor + ",.98)" : "rgba(" + colors.cyan + ",.9)";
      ctx.lineWidth = lat === 0 ? 1 : .6;
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY + yOffset, wide, Math.max(1, globeR * .04), phase * .12, 0, Math.PI * 2);
      ctx.stroke();
    }

    var scanY = orbitY + Math.sin(time * .0006) * globeR * .38;
    var scan = ctx.createLinearGradient(orbitX, scanY - 8, orbitX, scanY + 8);
    scan.addColorStop(0, "rgba(" + stateColor + ",0)");
    scan.addColorStop(.5, "rgba(" + stateColor + ",.28)");
    scan.addColorStop(1, "rgba(" + stateColor + ",0)");
    ctx.fillStyle = scan;
    ctx.fillRect(orbitX - globeR, scanY - 8, globeR * 2, 16);

    for (var point = 0; point < 18; point++) {
      var pointAngle = point * 2.399 + phase * (point % 2 ? 1.15 : -.8);
      var pointRadius = globeR * (.2 + ((point * 5) % 13) / 17);
      ctx.globalAlpha = active ? .38 + (Math.sin(time * .001 + point) + 1) * .18 : .52;
      ctx.fillStyle = point % 6 === 0
        ? "rgba(" + colors.gold + ",1)" : "rgba(" + colors.white + ",.95)";
      ctx.beginPath();
      ctx.arc(orbitX + Math.cos(pointAngle) * pointRadius,
        orbitY + Math.sin(pointAngle * 1.12) * pointRadius * .8,
        point % 6 === 0 ? 1.6 : .9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Glass rim, center reticle, and small cyan-white arc reactor.
    ctx.globalAlpha = .66;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.95)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.stroke();

    var coreR = r * (.082 + Math.sin(time * .0014) * .004 + pulseBoost * .1);
    var coreHalo = ctx.createRadialGradient(orbitX, orbitY, coreR * .08, orbitX, orbitY, coreR * 4.8);
    coreHalo.addColorStop(0, "rgba(" + colors.white + ",.88)");
    coreHalo.addColorStop(.18, "rgba(" + colors.cyan + ",.46)");
    coreHalo.addColorStop(.48, "rgba(" + stateColor + ",.15)");
    coreHalo.addColorStop(1, "rgba(" + stateColor + ",0)");
    ctx.fillStyle = coreHalo;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, coreR * 4.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(orbitX, orbitY);
    ctx.rotate(phase * 8);
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.92)";
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.ellipse(0, 0, coreR * 2.35, coreR * .82, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(Math.PI / 2.8);
    ctx.strokeStyle = "rgba(" + colors.gold + ",.83)";
    ctx.lineWidth = .85;
    ctx.beginPath();
    ctx.ellipse(0, 0, coreR * 1.72, coreR * .58, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    var core = ctx.createRadialGradient(
      orbitX - coreR * .2, orbitY - coreR * .23, 0, orbitX, orbitY, coreR * 1.25
    );
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(.28, "rgba(" + colors.white + ",.98)");
    core.addColorStop(.62, "rgba(" + colors.cyan + ",.82)");
    core.addColorStop(1, "rgba(" + stateColor + ",0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, coreR * 1.25, 0, Math.PI * 2);
    ctx.fill();

    // Minimal instrument labels and registration ticks.
    ctx.save();
    ctx.globalAlpha = .48;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.92)";
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.moveTo(orbitX - r * 1.86, orbitY); ctx.lineTo(orbitX - r * 1.72, orbitY);
    ctx.moveTo(orbitX + r * 1.72, orbitY); ctx.lineTo(orbitX + r * 1.86, orbitY);
    ctx.moveTo(orbitX, orbitY - r * 1.86); ctx.lineTo(orbitX, orbitY - r * 1.72);
    ctx.moveTo(orbitX, orbitY + r * 1.72); ctx.lineTo(orbitX, orbitY + r * 1.86);
    ctx.stroke();

    ctx.globalAlpha = .58;
    ctx.fillStyle = "rgba(" + colors.cyan + ",1)";
    ctx.font = "700 7px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.letterSpacing = "1.1px";
    ctx.fillText("N", orbitX, orbitY - r * 1.6);
    ctx.fillText("S", orbitX, orbitY + r * 1.62);
    ctx.textAlign = "left";
    ctx.fillText("E", orbitX + r * 1.58, orbitY - 5);
    ctx.textAlign = "right";
    ctx.fillText("W", orbitX - r * 1.58, orbitY - 5);
    ctx.globalAlpha = .82;
    ctx.textAlign = "center";
    var stateLabels = {
      idle: "STANDBY",
      listening: "VOICE INPUT",
      thinking: "PROCESSING",
      speaking: "VOICE OUTPUT",
      error: "ATTENTION"
    };
    ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillText("J.A.R.V.I.S.  /  " + stateLabels[assistantState], orbitX, orbitY + r * 1.95);
    ctx.restore();
    ctx.restore();
  }

  function render(time) {
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    // Use a carefully composed, repeatable frame while idle rather than freezing
    // at a random point in the previous animation.
    var elapsed = Math.max(0, time);
    var animationTime = reducedMotion ? elapsed * .42 : elapsed;
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
    if (document.hidden) {
      lastFrameTime = 0;
      return;
    }

    // Render more smoothly while keeping a predictable frame budget.
    // Reduced-motion users keep a lower 12 FPS cap.
    var frameInterval = reducedMotion ? 1000 / 12 : 1000 / 40;
    if (!lastFrameTime || time - lastFrameTime >= frameInterval) {
      lastFrameTime = time;
      render(time);
    }
    raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (!raf && !document.hidden) {
      lastFrameTime = 0;
      raf = window.requestAnimationFrame(tick);
    }
  }

  function stop() {
    if (raf) window.cancelAnimationFrame(raf);
    raf = 0;
    lastFrameTime = 0;
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
      raf = 0;
      lastFrameTime = 0;
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
        // Apply the updated frame cap without interrupting continuous animation.
        lastFrameTime = 0;
        start();
      });
    }
  }
  resize();
  start();
})();