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
    white: "243,255,255"
  };

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

  function drawSphere(x, y, r, time) {
    var pulse = .96 + Math.sin(time * .0011) * .035;
    var spin = time * .00011;
    var orbitX = x + Math.sin(time * .00023) * r * .055;
    var orbitY = y + Math.cos(time * .00019) * r * .045;

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    var halo = ctx.createRadialGradient(orbitX, orbitY, r * .08, orbitX, orbitY, r * 1.75);
    halo.addColorStop(0, "rgba(" + colors.cyan + ",0.17)");
    halo.addColorStop(.28, "rgba(" + colors.blue + ",0.10)");
    halo.addColorStop(.58, "rgba(" + colors.lilac + ",0.055)");
    halo.addColorStop(1, "rgba(" + colors.cyan + ",0)");
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(orbitX, orbitY, r * 1.75, 0, Math.PI * 2); ctx.fill();

    drawOrbitalRing(orbitX, orbitY, r * 1.42, r * .31, -.48 + spin * .8, colors.cyan, .42, 76, spin * 1.2);
    drawOrbitalRing(orbitX, orbitY, r * 1.2, r * .53, .94 - spin * .58, colors.lilac, .34, 56, -spin);
    drawOrbitalRing(orbitX, orbitY, r * 1.58, r * .17, .19 + spin * .48, colors.orange, .48, 92, spin * 1.7);
    drawOrbitalRing(orbitX, orbitY, r * 1.05, r * .83, -.18 - spin * .38, colors.blue, .23, 40, spin * .45);

    // The glowing globe itself, with animated longitude and latitude lines.
    var globeR = r * .57 * pulse;
    var sphereGradient = ctx.createRadialGradient(orbitX - globeR * .36, orbitY - globeR * .36, globeR * .025, orbitX, orbitY, globeR * 1.1);
    sphereGradient.addColorStop(0, "rgba(" + colors.white + ",0.76)");
    sphereGradient.addColorStop(.09, "rgba(" + colors.cyan + ",0.50)");
    sphereGradient.addColorStop(.38, "rgba(" + colors.blue + ",0.25)");
    sphereGradient.addColorStop(.72, "rgba(28,49,85,0.19)");
    sphereGradient.addColorStop(1, "rgba(9,13,28,0.015)");
    ctx.globalAlpha = .82;
    ctx.fillStyle = sphereGradient;
    ctx.beginPath(); ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.beginPath(); ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2); ctx.clip();
    ctx.globalAlpha = .4;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",0.65)";
    ctx.lineWidth = 1;
    for (var meridian = -3; meridian <= 3; meridian++) {
      var widthFactor = Math.max(.08, Math.abs(Math.cos(meridian * .36 + spin * 2)));
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY, globeR * widthFactor, globeR, spin + meridian * .025, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (var lat = -3; lat <= 3; lat++) {
      var yOffset = (lat / 4) * globeR;
      var wide = Math.sqrt(Math.max(0, globeR * globeR - yOffset * yOffset));
      ctx.beginPath();
      ctx.ellipse(orbitX, orbitY + yOffset, wide, Math.max(1.3, globeR * .075), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.globalAlpha = .85;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",0.52)";
    ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.arc(orbitX, orbitY, globeR, 0, Math.PI * 2); ctx.stroke();

    // Bright core gives the sphere a recognizable JARVIS-style energy source.
    var coreR = r * (.105 + Math.sin(time * .0016) * .008);
    var core = ctx.createRadialGradient(orbitX - coreR * .2, orbitY - coreR * .25, 0, orbitX, orbitY, coreR * 1.9);
    core.addColorStop(0, "rgba(255,255,255,0.96)");
    core.addColorStop(.22, "rgba(" + colors.gold + ",0.92)");
    core.addColorStop(.55, "rgba(" + colors.orange + ",0.54)");
    core.addColorStop(1, "rgba(" + colors.orange + ",0)");
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(orbitX, orbitY, coreR * 1.9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Small stable telemetry nodes travel around the outer orbit.
    for (var node = 0; node < 8; node++) {
      var a = time * .00016 + node * Math.PI / 4;
      var px = orbitX + Math.cos(a) * r * 1.32;
      var py = orbitY + Math.sin(a) * r * .38;
      ctx.save();
      ctx.globalAlpha = .36 + (Math.sin(time * .001 + node) + 1) * .14;
      ctx.fillStyle = node % 3 === 0 ? "rgba(" + colors.orange + ",1)" : "rgba(" + colors.cyan + ",1)";
      ctx.beginPath(); ctx.arc(px, py, node % 3 === 0 ? 2 : 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = .19;
    ctx.strokeStyle = "rgba(" + colors.cyan + ",1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(orbitX - r * 1.9, orbitY);
    ctx.lineTo(orbitX - r * 1.55, orbitY);
    ctx.moveTo(orbitX + r * 1.55, orbitY);
    ctx.lineTo(orbitX + r * 1.9, orbitY);
    ctx.stroke();
    ctx.fillStyle = "rgba(" + colors.cyan + ",1)";
    ctx.font = "700 8px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.letterSpacing = "1.2px";
    ctx.fillText("J.A.R.V.I.S  /  NEURAL CORE", orbitX - r * 1.9, orbitY + r * 1.48);
    ctx.fillText("CORE ACTIVE", orbitX + r * .92, orbitY - r * 1.27);
    ctx.restore();
  }

  function render(time) {
    if (!ctx || !width || !height) return;
    ctx.clearRect(0, 0, width, height);
    drawBackgroundGrid(time);
    var mobile = width < 700;
    var x = width * (mobile ? .63 : .675);
    var y = height * .49;
    var r = Math.min(width, height) * (mobile ? .225 : .205);
    r = Math.max(82, Math.min(r, 285));
    drawSphere(x, y, r, time);
  }

  function tick(time) {
    raf = 0;
    if (document.hidden) return;
    render(time);
    if (!reducedMotion) raf = window.requestAnimationFrame(tick);
  }

  function start() {
    if (reducedMotion) {
      render(performance.now());
      return;
    }
    if (!raf && !document.hidden) raf = window.requestAnimationFrame(tick);
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
        if (reducedMotion && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
          render(performance.now());
        } else {
          start();
        }
      });
    }
  }
  resize();
  start();
})();