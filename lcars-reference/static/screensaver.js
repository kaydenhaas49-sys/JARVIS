/*
 * JARVIS idle screen saver — anti burn-in edition.
 * Everything moves: orb drifts, rings rotate and breathe, mesh scrolls,
 * status text wanders, fragments float. Nothing stays in one place.
 *
 * Info additions:
 *  - The wandering status line shows live date/time + system state.
 *  - Floating fragments mix random LCARS labels with live status words.
 *  - Subtle health state changes the status text color when there is a problem.
 */
(function () {
  var overlay = document.getElementById("screensaver");
  if (!overlay) return;

  var canvas = document.createElement("canvas");
  var ctx = canvas.getContext("2d");
  overlay.insertBefore(canvas, overlay.firstChild);

  var statusEl = document.createElement("div");
  statusEl.className = "status-line";
  overlay.appendChild(statusEl);

  var phrases = [
    "JARVIS",
    "STANDING BY",
    "SYSTEMS ONLINE",
    "LISTENING",
    "CORE ACTIVE",
    "AWAITING INPUT"
  ];

  var phraseIndex = 0;
  var lastPhraseChange = 0;

  var width, height, cx, cy;
  var rings = [];
  var fragments = [];
  var meshOffset = 0;
  var pulsePhase = 0;
  var orbitPhase = 0;
  var breathPhase = 0;

  // anti burn-in: center drifts in a slow Lissajous pattern
  var orbit = { x: 0, y: 0, ax: 0, ay: 0, bx: 0, by: 0 };

  // live data fetched from the server
  var liveStatus = {
    wake_armed: false,
    wake_enabled: false,
    tw_locked: false,
    online: true,
    fetched: false,
    problems: []
  };

  var colors = {
    orange: "#ff9900",
    blue: "#9999cc",
    purple: "#cc99cc",
    tan: "#ddbb88"
  };

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    cx = width / 2;
    cy = height / 2;
    orbit.ax = width * 0.12;
    orbit.ay = height * 0.08;
    orbit.bx = width * 0.08;
    orbit.by = height * 0.12;
    buildRings();
  }

  function buildRings() {
    rings = [];
    var base = Math.min(width, height) * 0.18;
    var ringDefs = [
      { r: base * 0.35, speed: 0.006, ticks: 24, color: colors.orange, width: 2, breath: 0.04 },
      { r: base * 0.55, speed: -0.004, ticks: 36, color: colors.blue, width: 1.5, breath: 0.06 },
      { r: base * 0.75, speed: 0.0028, ticks: 48, color: colors.purple, width: 1, breath: 0.03 },
      { r: base * 1.0, speed: -0.0018, ticks: 60, color: colors.tan, width: 1, breath: 0.05 }
    ];

    ringDefs.forEach(function (def) {
      rings.push({
        baseRadius: def.r,
        radius: def.r,
        angle: Math.random() * Math.PI * 2,
        speed: def.speed,
        ticks: def.ticks,
        color: def.color,
        lineWidth: def.width,
        breath: def.breath,
        breathPhase: Math.random() * Math.PI * 2
      });
    });
  }

  function updateDrift() {
    orbitPhase += 0.0008;
    orbit.x = Math.sin(orbitPhase * 0.7) * orbit.ax + Math.cos(orbitPhase * 1.3) * orbit.bx * 0.4;
    orbit.y = Math.cos(orbitPhase * 0.6) * orbit.ay + Math.sin(orbitPhase * 1.1) * orbit.by * 0.4;

    breathPhase += 0.015;
    rings.forEach(function (ring) {
      ring.radius = ring.baseRadius * (1 + Math.sin(breathPhase + ring.breathPhase) * ring.breath);
      ring.angle += ring.speed;
    });
  }

  function fetchStatus() {
    if (!overlay.classList.contains("active")) return;
    fetch("/api/status", { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        liveStatus.online = true;
        liveStatus.fetched = true;
        liveStatus.wake_enabled = !!(d.voice && d.voice.wake_word);
        liveStatus.wake_armed = !!(d.wake && d.wake.armed);
        liveStatus.tw_locked = !!(d.training_wheels && d.training_wheels.enabled && !d.training_wheels.unlocked);
        liveStatus.problems = [];
        if (d.wake && d.wake.error) liveStatus.problems.push("WAKE ERROR");
        if (!liveStatus.wake_enabled) liveStatus.problems.push("WAKE OFF");
      })
      .catch(function (err) {
        liveStatus.online = false;
        liveStatus.problems = ["OFFLINE"];
        console.warn("[screensaver] status fetch failed:", err);
      });
  }

  function pad(n) { return n < 10 ? "0" + n : n; }

  function formatTime(d) {
    return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
  }

  function formatDate(d) {
    var days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
    var months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    return days[d.getDay()] + " · " + months[d.getMonth()] + " " + d.getDate();
  }

  function liveFragmentChoices() {
    var list = ["0100", "JARV", "SYS", "OK", "CORE", "ONLN", "DATA"];
    if (liveStatus.fetched) {
      list.push(liveStatus.wake_armed ? "ARMED" : "STBY");
      if (liveStatus.tw_locked) list.push("TW");
      if (liveStatus.problems.length) list.push("ALERT");
    }
    return list;
  }

  function spawnFragment() {
    if (fragments.length > 10) return;
    var choices = liveFragmentChoices();
    var margin = 120;
    fragments.push({
      x: margin + Math.random() * (width - margin * 2),
      y: height + 70,
      speedY: 0.5 + Math.random() * 0.9,
      driftX: (Math.random() - 0.5) * 0.4,
      size: 9 + Math.random() * 12,
      text: choices[Math.floor(Math.random() * choices.length)],
      opacity: 0,
      color: Math.random() > 0.35 ? colors.orange : colors.tan,
      life: 0
    });
  }

  function drawMesh() {
    ctx.save();
    var spacing = 52;
    var offX = meshOffset % spacing;
    var offY = (meshOffset * 0.35) % spacing;

    ctx.strokeStyle = "rgba(42, 42, 42, 0.28)";
    ctx.lineWidth = 1;

    for (var x = -spacing + offX; x < width + spacing; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    for (var y = -spacing + offY; y < height + spacing; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255, 153, 0, 0.06)";
    for (var x = -spacing + offX; x < width + spacing; x += spacing) {
      for (var y = -spacing + offY; y < height + spacing; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawOrb(x, y) {
    var base = Math.min(width, height) * 0.16;
    var pulse = 0.82 + Math.sin(pulsePhase) * 0.18;
    var slowPulse = 0.9 + Math.sin(pulsePhase * 0.4) * 0.1;

    ctx.save();
    ctx.translate(x, y);

    // outer glow (pulsing)
    var grad = ctx.createRadialGradient(0, 0, base * 0.12, 0, 0, base * 0.7);
    grad.addColorStop(0, "rgba(255, 153, 0, 0.38)");
    grad.addColorStop(0.45, "rgba(255, 153, 0, 0.10)");
    grad.addColorStop(1, "rgba(255, 153, 0, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, base * 0.7 * slowPulse, 0, Math.PI * 2);
    ctx.fill();

    // core
    var coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, base * 0.2);
    coreGrad.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    coreGrad.addColorStop(0.35, colors.orange);
    coreGrad.addColorStop(1, "rgba(255, 153, 0, 0.25)");
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(0, 0, base * 0.18 * pulse, 0, Math.PI * 2);
    ctx.fill();

    // inner ring
    ctx.strokeStyle = "rgba(255, 153, 0, 0.65)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, base * 0.3, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawRings(x, y) {
    ctx.save();
    ctx.translate(x, y);

    rings.forEach(function (ring) {
      ctx.save();
      ctx.rotate(ring.angle);
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = ring.lineWidth;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
      ctx.stroke();

      // ticks
      ctx.globalAlpha = 0.45;
      for (var i = 0; i < ring.ticks; i++) {
        var a = (i / ring.ticks) * Math.PI * 2;
        var inner = ring.radius - 9;
        var outer = ring.radius;
        if (i % 4 === 0) outer += 7;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
        ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
        ctx.stroke();
      }

      // glowing arc segment (moves with ring rotation)
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = ring.lineWidth + 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, ring.radius + 12, 0, Math.PI * 0.5);
      ctx.stroke();

      ctx.restore();
    });

    ctx.restore();
  }

  function drawFragments() {
    fragments.forEach(function (f, i) {
      f.y -= f.speedY;
      f.x += f.driftX;
      f.life += 1;
      // fade in for the first 120 frames, then fade out; keep invisible near the bottom edge
      if (f.life < 120) {
        f.opacity = (f.life / 120) * (0.12 + Math.random() * 0.1);
      } else {
        f.opacity = Math.max(0, 0.22 - (f.life - 120) / 450);
      }
      if (f.y > height - 80) {
        f.opacity = 0;
      }

      if (f.opacity <= 0 || f.y < -40) {
        fragments.splice(i, 1);
        return;
      }

      ctx.save();
      ctx.globalAlpha = f.opacity;
      ctx.fillStyle = f.color;
      ctx.font = "600 " + f.size + "px 'Segoe UI', 'Trebuchet MS', Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    });

    if (Math.random() < 0.02) spawnFragment();
  }

  function statusSummary() {
    if (!liveStatus.fetched) return "FETCHING STATUS";
    if (liveStatus.problems.length) return "ALERT · " + liveStatus.problems.join(" · ");
    if (liveStatus.wake_armed) return "WAKE ARMED";
    if (liveStatus.wake_enabled) return "WAKE STBY";
    if (liveStatus.tw_locked) return "TRAINING WHEELS ON";
    return "SYSTEMS NOMINAL";
  }

  function nextStatusText() {
    var now = new Date();
    var timeStr = formatTime(now);
    var dateStr = formatDate(now);
    var clock = timeStr + " · " + dateStr;

    phraseIndex = (phraseIndex + 1) % (phrases.length + 1);
    // every cycle, prepend a short system phrase to the persistent clock
    if (phraseIndex === phrases.length) {
      return statusSummary() + " · " + clock;
    }
    return phrases[phraseIndex] + " · " + clock;
  }

  function updateStatus() {
    var now = Date.now();
    if (now - lastPhraseChange > 6000) {
      var text = nextStatusText();
      statusEl.textContent = text;
      lastPhraseChange = now;

      // flash alert state in red when there are problems, otherwise LCARS orange
      if (liveStatus.problems.length) {
        statusEl.classList.add("ss-alert");
      } else {
        statusEl.classList.remove("ss-alert");
      }
    }

    // anti burn-in: status text slowly drifts around bottom area, kept in-bounds
    var tx = cx + Math.sin(orbitPhase * 0.5) * (width * 0.04);
    var ty = height * 0.86 + Math.cos(orbitPhase * 0.4) * (height * 0.03);
    statusEl.style.left = tx + "px";
    statusEl.style.top = ty + "px";
    statusEl.style.transform = "translateX(-50%)";
  }

  function draw() {
    if (!overlay.classList.contains("active")) return;

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    meshOffset += 0.3;
    pulsePhase += 0.04;
    updateDrift();

    var ox = cx + orbit.x;
    var oy = cy + orbit.y;

    drawMesh();
    drawRings(ox, oy);
    drawOrb(ox, oy);
    drawFragments();
    updateStatus();

    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();

  // refresh live status every 10 seconds while the screensaver is shown
  setInterval(fetchStatus, 10000);

  // expose control API
  window.jarvisScreensaver = {
    show: function () {
      console.log("[screensaver] show overlay");
      overlay.classList.add("active");
      phraseIndex = phrases.length; // force status+clock on first show
      statusEl.textContent = nextStatusText();
      lastPhraseChange = Date.now();
      fetchStatus();
      draw();
    },
    hide: function () {
      console.log("[screensaver] hide overlay");
      overlay.classList.remove("active");
      // clear any partial fade trails
      ctx.clearRect(0, 0, width, height);
    },
    isActive: function () {
      return overlay.classList.contains("active");
    }
  };
})();
