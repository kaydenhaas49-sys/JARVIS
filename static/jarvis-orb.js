/* JARVIS holographic sphere backdrop, inspired by lcars-reference/static/screensaver.js.
   This is a quiet always-visible visualizer; it does not call APIs or alter app behavior. */
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

  // Abstract machine-intelligence mask: holographic blue hardware with a crimson core.
  function drawSphere(x, y, r, time) {
    var pulseBoost = assistantState === "thinking" ? .075 :
      assistantState === "speaking" ? .045 :
      assistantState === "listening" ? .035 :
      assistantState === "error" ? .02 : 0;
    var spinBoost = assistantState === "thinking" ? 2.15 :
      assistantState === "speaking" ? 1.5 :
      assistantState === "listening" ? .72 :
      assistantState === "error" ? .82 : 1;
    var stateColor = assistantState === "listening" ? colors.green :
      assistantState === "speaking" ? colors.gold :
      assistantState === "error" ? colors.red :
      assistantState === "thinking" ? colors.lilac : colors.cyan;
    var pulse = .965 + Math.sin(time * .00115) * .035 + pulseBoost * (.65 + Math.sin(time * .0024) * .35);
    var spin = time * .00018 * spinBoost;
    var orbitX = x + Math.sin(time * .00023) * r * .045;
    var orbitY = y + Math.cos(time * .00019) * r * .035;
    var globeR = r * .62 * pulse;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";

    // Wide, layered aura around the core.
    var halo = ctx.createRadialGradient(orbitX, orbitY, globeR * .12, orbitX, orbitY, r * 1.95);
    halo.addColorStop(0, "rgba(" + colors.cyan + ",.2)");
    halo.addColorStop(.23, "rgba(" + colors.blue + ",.14)");
    halo.addColorStop(.46, "rgba(" + colors.lilac + ",.065)");
    halo.addColorStop(.72, "rgba(" + colors.orange + ",.025)");
    halo.addColorStop(1, "rgba(" + colors.cyan + ",0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, r * 1.95, 0, Math.PI * 2);
    ctx.fill();

    // Layered telemetry rings with counter-rotating tick marks.
    drawOrbitalRing(orbitX, orbitY, r * 1.42, r * .32, -.48 + spin * .8, stateColor, assistantState === "idle" ? .52 : .7, 88, spin * 1.2);
    drawOrbitalRing(orbitX, orbitY, r * 1.2, r * .55, .94 - spin * .58, colors.lilac, .39, 64, -spin * 1.1);
    drawOrbitalRing(orbitX, orbitY, r * 1.62, r * .17, .19 + spin * .48, colors.orange, .52, 96, spin * 1.7);
    drawOrbitalRing(orbitX, orbitY, r * 1.05, r * .84, -.18 - spin * .38, colors.blue, .29, 44, spin * .45);
    drawOrbitalRing(orbitX, orbitY, r * 1.78, r * .24, .5 - spin * .25, colors.gold, .17, 72, -spin * .7);

    // Fast, luminous orbit segments sweep across the slower wireframe.
    drawEnergyArc(orbitX, orbitY, r * 1.42, r * .32, -.48 + spin * .8,
      .15 + spin * 2.2, 1.27 + spin * 2.2, stateColor, 2.3, assistantState === "idle" ? .88 : .98, 15);
    drawEnergyArc(orbitX, orbitY, r * 1.2, r * .55, .94 - spin * .58,
      2.75 - spin * 1.8, 4.05 - spin * 1.8, colors.lilac, 2, .68, 12);
    drawEnergyArc(orbitX, orbitY, r * 1.62, r * .17, .19 + spin * .48,
      3.15 + spin * 1.4, 4.0 + spin * 1.4, colors.orange, 2.6, .8, 17);
    drawEnergyArc(orbitX, orbitY, r * 1.05, r * .84, -.18 - spin * .38,
      4.6 - spin * 1.3, 5.25 - spin * 1.3, colors.blue, 1.8, .58, 10);

    // Fine energy rays flash at the edge of the globe.
    ctx.save();
    ctx.translate(orbitX, orbitY);
    ctx.rotate(-spin * .55);
    for (var ray = 0; ray < 56; ray++) {
      var a = ray / 56 * Math.PI * 2;
      var wave = Math.sin(ray * 2.17 + time * .0017);
      var inner = globeR * (1.015 + (ray % 4) * .008);
      var outer = globeR * (1.045 + (wave + 1) * .035 + (ray % 7 === 0 ? .055 : 0));
      ctx.globalAlpha = .1 + (wave + 1) * .09 + (ray % 7 === 0 ? .12 : 0);
      ctx.strokeStyle = ray % 9 === 0 ? "rgba(" + colors.orange + ",1)" : "rgba(" + colors.cyan + ",1)";
      ctx.lineWidth = ray % 7 === 0 ? 1.3 : .65;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.restore();

    // Glass-like globe with an animated wireframe.
    var sphereGradient = ctx.createRadialGradient(
      orbitX - globeR * .38, orbitY - globeR * .42, globeR * .025,
      orbitX, orbitY, globeR * 1.12
    );
    sphereGradient.addColorStop(0, "rgba(" + colors.white + ",.9)");
    sphereGradient.addColorStop(.08, "rgba(" + colors.cyan + ",.68)");
    sphereGradient.addColorStop(.24, "rgba(" + colors.blue + ",.42)");
    sphereGradient.addColorStop(.52, "rgba(45,80,133,.29)");
    sphereGradient.addColorStop(.8, "rgba(13,24,49,.19)");
    sphereGradient.addColorStop(1, "rgba(5,9,23,.02)");
    ctx.globalAlpha = .92;
    ctx.fillStyle = sphereGradient;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.clip();

    // Longitude arcs breathe in and out as if the shell is rotating in 3D.
    for (var meridian = -5; meridian <= 5; meridian++) {
      var widthFactor = Math.max(.045, Math.abs(Math.cos(meridian * .29 + spin * 2.4)));
      ctx.globalAlpha = meridian % 2 === 0 ? .42 : .2;
      ctx.strokeStyle = meridian % 3 === 0 ? "rgba(" + colors.lilac + ",.95)" : "rgba(" + colors.cyan + ",.95)";
      ctx.lineWidth = meridian % 3 === 0 ? 1.05 : .7;
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY, globeR * widthFactor, globeR, spin + meridian * .018, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Latitudes: split line weight gives the shell more depth.
    for (var lat = -4; lat <= 4; lat++) {
      var yOffset = (lat / 5) * globeR;
      var wide = Math.sqrt(Math.max(0, globeR * globeR - yOffset * yOffset));
      ctx.globalAlpha = lat === 0 ? .56 : .28;
      ctx.strokeStyle = lat === 0 ? "rgba(" + colors.cyan + ",1)" : "rgba(" + colors.blue + ",1)";
      ctx.lineWidth = lat === 0 ? 1.2 : .7;
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY + yOffset, wide, Math.max(1.2, globeR * .055), spin * .12, 0, Math.PI * 2);
      ctx.stroke();
    }

    // A moving scan field and subtle diagnostic grid, clipped inside the sphere.
    var scanY = orbitY + Math.sin(time * .00075) * globeR * .43;
    var scanGlow = ctx.createLinearGradient(orbitX, scanY - 11, orbitX, scanY + 11);
    scanGlow.addColorStop(0, "rgba(" + colors.cyan + ",0)");
    scanGlow.addColorStop(.5, "rgba(" + colors.cyan + ",.42)");
    scanGlow.addColorStop(1, "rgba(" + colors.cyan + ",0)");
    ctx.fillStyle = scanGlow;
    ctx.fillRect(orbitX - globeR, scanY - 11, globeR * 2, 22);

    ctx.globalAlpha = .22;
    ctx.strokeStyle = "rgba(" + colors.lilac + ",.9)";
    ctx.lineWidth = .7;
    var gridStep = Math.max(12, globeR * .18);
    for (var gx = orbitX - globeR; gx < orbitX + globeR; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(gx, orbitY - globeR);
      ctx.lineTo(gx + Math.sin(spin * 4 + gx) * globeR * .06, orbitY + globeR);
      ctx.stroke();
    }

    // Moving particle sparks on the shell (deterministic positions, no flicker noise).
    for (var spark = 0; spark < 22; spark++) {
      var sa = spark * 2.399 + spin * (spark % 2 ? 1.8 : -1.2);
      var sr = globeR * (.24 + ((spark * 7) % 13) / 18);
      var sx = orbitX + Math.cos(sa) * sr;
      var sy = orbitY + Math.sin(sa * 1.13) * sr * .84;
      var flicker = .35 + (Math.sin(time * .002 + spark * 1.7) + 1) * .25;
      ctx.globalAlpha = flicker;
      ctx.fillStyle = spark % 6 === 0 ? "rgba(" + colors.gold + ",1)" : "rgba(" + colors.white + ",1)";
      ctx.beginPath();
      ctx.arc(sx, sy, spark % 6 === 0 ? 1.8 : 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Precision outline with a faint second shell offset behind it.
    ctx.globalAlpha = .72;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.9)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = .2;
    ctx.strokeStyle = "rgba(" + colors.lilac + ",.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(orbitX + globeR * .035, orbitY - globeR * .025, globeR * 1.025, 0, Math.PI * 2);
    ctx.stroke();

    // Contained reactor core: white-hot center, amber corona, rotating circuit rings.
    var coreR = r * (.125 + Math.sin(time * .0016) * .009 + pulseBoost * .18);
    var coreHalo = ctx.createRadialGradient(orbitX, orbitY, coreR * .1, orbitX, orbitY, coreR * 3.8);
    coreHalo.addColorStop(0, "rgba(255,255,255,.9)");
    coreHalo.addColorStop(.18, "rgba(" + colors.gold + ",.68)");
    coreHalo.addColorStop(.44, "rgba(" + colors.orange + ",.27)");
    coreHalo.addColorStop(1, "rgba(" + colors.orange + ",0)");
    ctx.globalAlpha = .98;
    ctx.fillStyle = coreHalo;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, coreR * 3.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(orbitX, orbitY);
    ctx.rotate(spin * 8);
    ctx.strokeStyle = "rgba(" + colors.gold + ",.9)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, coreR * 2.25, coreR * .82, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(Math.PI / 2.7);
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.88)";
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, coreR * 1.75, coreR * .6, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    var core = ctx.createRadialGradient(orbitX - coreR * .2, orbitY - coreR * .25, 0, orbitX, orbitY, coreR * 1.25);
    core.addColorStop(0, "rgba(255,255,255,1)");
    core.addColorStop(.2, "rgba(" + colors.white + ",.98)");
    core.addColorStop(.48, "rgba(" + colors.gold + ",.96)");
    core.addColorStop(.76, "rgba(" + colors.orange + ",.64)");
    core.addColorStop(1, "rgba(" + colors.orange + ",0)");
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(orbitX, orbitY, coreR * 1.25, 0, Math.PI * 2);
    ctx.fill();

    // Leave the glass hologram clear and unobstructed.
    ctx.restore();

    // Satellites leave small tapered energy trails around the outside.
    for (var node = 0; node < 16; node++) {
      var a = time * .0002 + node * Math.PI / 8;
      var rx = r * 1.43;
      var ry = r * .39;
      var px = orbitX + Math.cos(a) * rx;
      var py = orbitY + Math.sin(a) * ry;
      var tx = orbitX + Math.cos(a - .12) * rx;
      var ty = orbitY + Math.sin(a - .12) * ry;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = .3 + (Math.sin(time * .001 + node) + 1) * .16;
      ctx.strokeStyle = node % 4 === 0 ? "rgba(" + colors.orange + ",1)" : "rgba(" + colors.cyan + ",1)";
      ctx.lineWidth = node % 4 === 0 ? 1.8 : 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.fillStyle = node % 4 === 0 ? "rgba(" + colors.gold + ",1)" : "rgba(" + colors.white + ",1)";
      ctx.beginPath();
      ctx.arc(px, py, node % 4 === 0 ? 2.4 : 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // A restrained label makes it read like an instrument, not a screen of text.
    ctx.save();
    ctx.globalAlpha = .26;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",.8)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(orbitX - r * 1.9, orbitY);
    ctx.lineTo(orbitX - r * 1.65, orbitY);
    ctx.moveTo(orbitX + r * 1.65, orbitY);
    ctx.lineTo(orbitX + r * 1.9, orbitY);
    ctx.stroke();
    ctx.fillStyle = "rgba(" + colors.cyan + ",1)";
    ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.letterSpacing = "1.2px";
    ctx.textAlign = "center";
    var stateLabels = { idle: "NEURAL CORE", listening: "LISTENING", thinking: "PROCESSING", speaking: "VOICE OUTPUT", error: "ATTENTION" };
    ctx.fillText("J.A.R.V.I.S  /  " + stateLabels[assistantState], orbitX, orbitY + r * 1.02);
    ctx.restore();
  }

  function render(time) {
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    var animationTime = reducedMotion ? time * .42 : time;
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
    if (document.hidden) return;
    render(time);
    // Reduced-motion mode still animates the core, just with a slower visual tempo.
    raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (!raf && !document.hidden) raf = window.requestAnimationFrame(tick);
  }

  // Keep the backdrop subdued beneath chat messages, including reduced-motion mode.
  var observedChatLog = document.getElementById("chatLog");
  if (observedChatLog && window.MutationObserver) {
    var chatObserver = new MutationObserver(function () { render(performance.now()); });
    chatObserver.observe(observedChatLog, { childList: true, subtree: true });
  }

  window.addEventListener("resize", resize, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else {
      start();
    }
  });
  if (window.matchMedia) {
    var motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motionQuery.addEventListener) {
      motionQuery.addEventListener("change", function (event) {
        reducedMotion = event.matches;
        // Animation continues in reduced-motion mode at a slower visual tempo.
        start();
      });
    }
  }
  resize();
  start();
})();