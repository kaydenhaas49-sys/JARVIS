(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const ui = {
    form: $("#composerForm"), input: $("#messageInput"), send: $("#sendBtn"),
    mic: $("#micBtn"), wake: $("#wakeWordBtn"), wakeLabel: $("#wakeWordLabel"),
    voice: $("#voiceOutputBtn"), voiceLabel: $("#voiceOutputLabel"),
    connection: $("#connectionPill"), connectionLabel: $("#connectionLabel"),
    welcome: $("#welcomePanel"), chat: $("#chatLog"), typing: $("#typingRow"),
    activity: $("#activityStatus"), activityLabel: $("#activityLabel"),
    core: $("#coreOrb"), wakeHint: $("#wakeHint"), toast: $("#toastRegion"),
    newChat: $("#newChatBtn"), composerStatus: $("#composerStatus"),
  };

  const STORAGE_KEY = "jarvis-chat-session-v1";
  const VOICE_KEY = "jarvis-chat-voice-v1";
  const newId = () => (crypto.randomUUID ? crypto.randomUUID().replaceAll("-", "") : Date.now().toString(36) + Math.random().toString(36).slice(2));
  let sessionId = sessionStorage.getItem(STORAGE_KEY) || newId();
  sessionStorage.setItem(STORAGE_KEY, sessionId);
  let transcript = [];
  let busy = false;
  let voiceReplies = sessionStorage.getItem(VOICE_KEY) !== "false";
  let recorder = null;
  let microphoneStream = null;
  let recordedChunks = [];
  let recordingTimer = null;
  let recordingStartedAt = 0;
  let wakeStatus = null;
  let wakeEnabled = false;
  let wakeEventCursor = 0;
  let wakePollReady = false;
  let wakePollBusy = false;
  let wakeEventsTimer = null;
  let wakeStatusTimer = null;
  let activeAudio = null;
  let activeAudioUrl = null;
  let speechResolver = null;
  let speechGeneration = 0;

  function createDotSphere() {
    const container = document.getElementById("dotSphere");
    if (!container) return;
    if (container._sphereFrame) window.cancelAnimationFrame(container._sphereFrame);
    container._sphereResizeObserver?.disconnect();
    container.replaceChildren();

    const canvas = document.createElement("canvas");
    canvas.className = "sphere-canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    // JARVIS's Age of Ultron form: a bright central core inside segmented,
    // independently orbiting data bands. Fibonacci points form a translucent shell.
    const count = 520;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const points = [];
    for (let i = 0; i < count; i += 1) {
      const y = 1 - 2 * ((i + 0.5) / count);
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = goldenAngle * i;
      points.push({
        x: Math.cos(angle) * ring,
        y,
        z: Math.sin(angle) * ring,
        phase: i * 2.399963229728653,
        sparkle: ((i * 37) % 101) / 100,
      });
    }

    const orbitBands = [
      { radius: 0.91, tiltX: 0.58, tiltY: -0.40, phase: 0.2, speed: 0.24, segments: 74, gapEvery: 8, width: 1.25 },
      { radius: 1.12, tiltX: -0.33, tiltY: 0.72, phase: 1.9, speed: -0.17, segments: 88, gapEvery: 9, width: 1.05 },
      { radius: 1.27, tiltX: 0.93, tiltY: 0.20, phase: 3.5, speed: 0.11, segments: 64, gapEvery: 7, width: 0.9 },
      { radius: 0.73, tiltX: -0.72, tiltY: -0.55, phase: 4.4, speed: -0.31, segments: 56, gapEvery: 8, width: 0.8 },
    ];

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let rotation = 0;
    let lastFrame = 0;
    const lightningStrikes = [];
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;

    function resizeCanvas() {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    function project(x, y, z, cx, cy, scale) {
      const perspective = 1 / (1.12 - z * 0.16);
      return {
        x: cx + x * scale * perspective,
        y: cy + y * scale * perspective,
        z,
        perspective,
      };
    }

    function orbitPoint(theta, band, nowSeconds, state, cx, cy, radius) {
      const activityMultiplier = state === "listening" ? 1.85
        : state === "thinking" ? 2.65
        : state === "speaking" ? 1.5 : 1;
      const motion = reducedMotion ? 0 : nowSeconds * band.speed * activityMultiplier;
      const angle = theta + motion + band.phase;
      const wobbleX = reducedMotion ? band.tiltX : band.tiltX + Math.sin(nowSeconds * 0.31 + band.phase) * 0.12;
      const wobbleY = reducedMotion ? band.tiltY : band.tiltY + Math.cos(nowSeconds * 0.23 + band.phase) * 0.15;
      const x0 = Math.cos(angle) * radius * band.radius;
      const y0 = Math.sin(angle) * radius * band.radius;

      const y1 = y0 * Math.cos(wobbleX);
      const z1 = y0 * Math.sin(wobbleX);
      const x2 = x0 * Math.cos(wobbleY) + z1 * Math.sin(wobbleY);
      const z2 = -x0 * Math.sin(wobbleY) + z1 * Math.cos(wobbleY);
      const roll = reducedMotion ? 0 : Math.sin(nowSeconds * 0.13 + band.phase) * 0.10;
      const x3 = x2 * Math.cos(roll) - y1 * Math.sin(roll);
      const y3 = x2 * Math.sin(roll) + y1 * Math.cos(roll);
      return project(x3, y3, z2 / Math.max(radius, 1), cx, cy, 1);
    }

    function draw(now) {
      container._sphereFrame = window.requestAnimationFrame(draw);
      if (document.hidden) return;
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016;
      lastFrame = now;
      const state = ui.core?.dataset.state || "idle";
      const speed = reducedMotion ? 0
        : state === "listening" ? 1.05
        : state === "thinking" ? 0.82
        : state === "speaking" ? 0.61 : 0.20;
      rotation += delta * speed;
      const time = now / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.36;
      const activityPulse = state === "speaking" ? (reducedMotion ? 0.025 : 0.055 + Math.sin(time * 8.2) * 0.025)
        : state === "listening" ? (reducedMotion ? 0.025 : 0.025 + Math.sin(time * 5.4) * 0.016)
        : state === "thinking" ? (reducedMotion ? 0.015 : 0.02 + Math.sin(time * 3.1) * 0.008)
        : (reducedMotion ? 0 : Math.sin(time * 1.25) * 0.007);
      const shellScale = 1 + activityPulse;
      const coreRadius = radius * 0.70;

      context.clearRect(0, 0, width, height);
      context.save();
      context.globalCompositeOperation = "lighter";

      const aura = context.createRadialGradient(cx, cy, radius * 0.06, cx, cy, radius * 1.48);
      aura.addColorStop(0, state === "listening" ? "rgba(255,193,96,.20)" : "rgba(255,174,65,.15)");
      aura.addColorStop(0.32, "rgba(247,136,42,.07)");
      aura.addColorStop(0.72, "rgba(79,165,212,.035)");
      aura.addColorStop(1, "rgba(24,78,117,0)");
      context.fillStyle = aura;
      context.beginPath();
      context.arc(cx, cy, radius * 1.48, 0, Math.PI * 2);
      context.fill();

      // A few quiet construction arcs give the hologram a technical, calibrated feel.
      context.save();
      context.translate(cx, cy);
      for (let i = 0; i < 3; i += 1) {
        const tilt = 0.21 + i * 0.19;
        context.save();
        context.rotate((reducedMotion ? 0 : time * (i % 2 ? -0.045 : 0.035)) + i * 0.94);
        context.scale(1, tilt);
        context.beginPath();
        context.arc(0, 0, radius * (1.33 + i * 0.045), 0, Math.PI * 2);
        context.strokeStyle = "rgba(111,196,226,.09)";
        context.lineWidth = 0.65;
        context.stroke();
        context.restore();
      }
      context.restore();

      // Segmented orbital data bands. Their changing plane and individual speeds
      // create the layered mechanical motion of the film's JARVIS hologram.
      for (let b = 0; b < orbitBands.length; b += 1) {
        const band = orbitBands[b];
        const step = (Math.PI * 2) / band.segments;
        const drawBandPoint = (theta) => {
          const point = orbitPoint(theta, band, time, state, cx, cy, radius);
          return {
            x: cx + (point.x - cx) * shellScale,
            y: cy + (point.y - cy) * shellScale,
            z: point.z,
            perspective: point.perspective,
          };
        };
        for (let i = 0; i < band.segments; i += 1) {
          if ((i + b * 3) % band.gapEvery === band.gapEvery - 1) continue;
          const a = i * step;
          const p1 = drawBandPoint(a);
          const p2 = drawBandPoint(a + step * 0.79);
          const depth = (p1.z + p2.z) * 0.5;
          const alpha = 0.17 + ((depth + 1) * 0.5) * 0.60;
          const isHighlight = (i + b * 7) % 13 === 0 || depth > 0.64;
          context.beginPath();
          context.moveTo(p1.x, p1.y);
          context.lineTo(p2.x, p2.y);
          context.strokeStyle = isHighlight
            ? "rgba(255,226,164," + Math.min(0.96, alpha + 0.18) + ")"
            : "rgba(255,167,81," + alpha + ")";
          context.lineWidth = band.width * (isHighlight ? 1.18 : 1);
          context.lineCap = "round";
          context.shadowColor = isHighlight ? "rgba(255,198,111,.8)" : "rgba(248,136,58,.52)";
          context.shadowBlur = isHighlight ? 5 : 2;
          context.stroke();
        }

        // Bright packets travel around the bands like data moving between layers.
        const packetCount = b === 2 ? 2 : 3;
        for (let p = 0; p < packetCount; p += 1) {
          const direction = band.speed >= 0 ? 1 : -1;
          const theta = time * band.speed * (state === "listening" ? 2.3 : state === "thinking" ? 3 : state === "speaking" ? 1.7 : 1)
            + band.phase + p * (Math.PI * 2 / packetCount) * direction;
          const point = orbitPoint(theta, band, time * 0.72, state, cx, cy, radius);
          const x = cx + (point.x - cx) * shellScale;
          const y = cy + (point.y - cy) * shellScale;
          const r = (p === 0 ? 2.2 : 1.35) * Math.max(0.7, point.perspective);
          context.beginPath();
          context.arc(x, y, r, 0, Math.PI * 2);
          context.fillStyle = p === 0 ? "rgba(255,244,210,.98)" : "rgba(255,185,97,.85)";
          context.shadowColor = "rgba(255,194,105,.98)";
          context.shadowBlur = p === 0 ? 12 : 6;
          context.fill();
          // Tiny trailing data ticks reinforce the sense of something flowing.
          for (let trail = 1; trail <= 2; trail += 1) {
            const previous = orbitPoint(theta - direction * trail * 0.055, band, time * 0.72, state, cx, cy, radius);
            context.beginPath();
            context.arc(cx + (previous.x - cx) * shellScale, cy + (previous.y - cy) * shellScale, Math.max(0.55, r * (0.55 - trail * 0.12)), 0, Math.PI * 2);
            context.fillStyle = "rgba(255,171,82," + (0.7 / trail) + ")";
            context.shadowBlur = 3;
            context.fill();
          }
        }
      }
      context.restore();

      // The spherical shell is a volume of luminous data points, not a solid ball.
      const cosY = Math.cos(rotation * 0.8);
      const sinY = Math.sin(rotation * 0.8);
      const tilt = 0.25 + (reducedMotion ? 0 : Math.sin(time * 0.34) * 0.045);
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);
      const projected = [];
      for (const point of points) {
        const rippleStrength = state === "listening" ? 0.025
          : state === "thinking" ? 0.019
          : state === "speaking" ? 0.032 : 0.008;
        const ripple = reducedMotion ? 0 : Math.sin(time * (state === "speaking" ? 7.4 : state === "listening" ? 4.8 : 1.8) + point.phase) * rippleStrength;
        const scale = (1 + ripple) * shellScale;
        const px = point.x * scale;
        const py = point.y * scale;
        const pz = point.z * scale;
        const rx = px * cosY + pz * sinY;
        const rz = -px * sinY + pz * cosY;
        const ry = py * cosX - rz * sinX;
        const depthZ = py * sinX + rz * cosX;
        const perspective = 1 / (1.12 - depthZ * 0.19);
        projected.push({
          x: cx + rx * coreRadius * perspective,
          y: cy + ry * coreRadius * perspective,
          depth: (depthZ + 1) * 0.5,
          phase: point.phase,
          sparkle: point.sparkle,
        });
      }
      projected.sort((a, b) => a.depth - b.depth);

      for (const point of projected) {
        const depth = point.depth;
        const twinkle = reducedMotion ? 0.92 : 0.76 + 0.24 * Math.sin(time * (state === "speaking" ? 8 : 2.1) + point.phase);
        const size = (0.45 + depth * 1.15 + point.sparkle * 0.26) * twinkle;
        const opacity = Math.min(0.98, (0.13 + depth * 0.82) * twinkle);
        context.globalAlpha = opacity;
        if (depth > 0.78 && point.sparkle > 0.39) {
          context.fillStyle = "#fff1cf";
          context.shadowColor = "rgba(255,197,112,.95)";
          context.shadowBlur = depth > 0.9 ? 8 : 4;
        } else {
          context.fillStyle = depth > 0.52 ? "#ffbf70" : depth > 0.22 ? "#d88748" : "#7a8b9b";
          context.shadowBlur = 0;
        }
        context.beginPath();
        context.arc(point.x, point.y, size, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      // A concentrated heart of light sits at the center of the orbital assembly.
      const corePulse = reducedMotion ? 1 : 1 + Math.sin(time * (state === "speaking" ? 8.2 : 2.1)) * (state === "speaking" ? 0.10 : 0.035);
      const heartRadius = radius * 0.105 * corePulse;
      const heartGlow = context.createRadialGradient(cx, cy, 0, cx, cy, heartRadius * 4.7);
      heartGlow.addColorStop(0, "rgba(255,250,220,.96)");
      heartGlow.addColorStop(0.14, "rgba(255,202,125,.74)");
      heartGlow.addColorStop(0.42, "rgba(255,147,68,.18)");
      heartGlow.addColorStop(1, "rgba(255,147,68,0)");
      context.fillStyle = heartGlow;
      context.beginPath();
      context.arc(cx, cy, heartRadius * 4.7, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(cx, cy, heartRadius, 0, Math.PI * 2);
      context.fillStyle = "rgba(255,244,206,.97)";
      context.shadowColor = "rgba(255,175,84,.98)";
      context.shadowBlur = 13;
      context.fill();
      context.beginPath();
      context.arc(cx, cy, heartRadius * 0.42, 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.shadowBlur = 5;
      context.fill();


      // Brief electrical discharges strike the shell when it is clicked.
      for (let s = lightningStrikes.length - 1; s >= 0; s -= 1) {
        const strike = lightningStrikes[s];
        const age = (now - strike.startedAt) / strike.duration;
        if (age >= 1) { lightningStrikes.splice(s, 1); continue; }
        const fade = Math.sin(Math.PI * Math.max(0, age));
        const dx = strike.endX - strike.startX;
        const dy = strike.endY - strike.startY;
        const length = Math.hypot(dx, dy) || 1;
        const nx = -dy / length;
        const ny = dx / length;
        const points = [{ x: strike.startX, y: strike.startY }];
        const steps = Math.max(9, Math.floor(length / 8));
        for (let i = 1; i < steps; i += 1) {
          const t = i / steps;
          const offset = (Math.random() - 0.5) * 25 * Math.sin(Math.PI * t);
          points.push({ x: strike.startX + dx * t + nx * offset, y: strike.startY + dy * t + ny * offset });
        }
        points.push({ x: strike.endX, y: strike.endY });
        context.save();
        context.globalCompositeOperation = "lighter";
        context.globalAlpha = fade;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.shadowColor = "#42baff";
        context.shadowBlur = 20;
        context.strokeStyle = "rgba(28,132,255,.9)";
        context.lineWidth = 6;
        context.beginPath();
        points.forEach((p, i) => i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
        context.stroke();
        context.shadowBlur = 8;
        context.strokeStyle = "#8eeaff";
        context.lineWidth = 1.8;
        context.stroke();
        context.strokeStyle = "#ffffff";
        context.lineWidth = 0.7;
        context.stroke();
        for (let b = 1; b <= strike.branches; b += 1) {
          const index = Math.min(points.length - 2, Math.floor(b * points.length / (strike.branches + 2)));
          const p = points[index];
          const sign = b % 2 ? 1 : -1;
          const bx = p.x + nx * sign * (10 + Math.random() * 22);
          const by = p.y + ny * sign * (10 + Math.random() * 22);
          context.beginPath();
          context.moveTo(p.x, p.y);
          context.lineTo((p.x + bx) / 2 + (Math.random() - .5) * 8, (p.y + by) / 2 + (Math.random() - .5) * 8);
          context.lineTo(bx, by);
          context.strokeStyle = "#67d9ff";
          context.lineWidth = 1;
          context.stroke();
        }
        const glow = context.createRadialGradient(strike.endX, strike.endY, 0, strike.endX, strike.endY, 30);
        glow.addColorStop(0, "rgba(255,255,255,.95)");
        glow.addColorStop(.2, "rgba(105,220,255,.8)");
        glow.addColorStop(1, "rgba(40,125,255,0)");
        context.fillStyle = glow;
        context.beginPath();
        context.arc(strike.endX, strike.endY, 30, 0, Math.PI * 2);
        context.fill();
        context.restore();
      }

      // Small cardinal markers make the projection feel instrument-built.
      context.shadowBlur = 0;
      context.lineWidth = 0.8;
      context.strokeStyle = "rgba(255,205,137,.43)";
      const markRadius = radius * 0.58;
      for (let i = 0; i < 8; i += 1) {
        const angle = i * Math.PI / 4 + (reducedMotion ? 0 : time * 0.035);
        const r1 = markRadius;
        const r2 = markRadius + (i % 2 === 0 ? 7 : 4);
        context.beginPath();
        context.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
        context.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
        context.stroke();
      }
      context.restore();
    }


    // Any click anywhere in the interface can call down an electrical strike.
    // Work out the click direction relative to the sphere, then draw the bolt on
    // the sphere canvas so the energy always arcs inward toward the hologram.
    document.addEventListener("click", (event) => {
      if (event.button !== 0 || event.detail === 0) return;
      const bounds = canvas.getBoundingClientRect();
      const x = event.clientX - bounds.left - width / 2;
      const y = event.clientY - bounds.top - height / 2;
      const angle = Math.atan2(y, x);
      const shell = Math.min(width, height) * 0.36;
      const fromOutside = shell * (1.42 + Math.random() * 0.18);
      const hitRadius = shell * (0.56 + Math.random() * 0.12);
      lightningStrikes.push({
        startedAt: performance.now(),
        duration: 520 + Math.random() * 260,
        startX: width / 2 + Math.cos(angle) * fromOutside,
        startY: height / 2 + Math.sin(angle) * fromOutside,
        endX: width / 2 + Math.cos(angle) * hitRadius,
        endY: height / 2 + Math.sin(angle) * hitRadius,
        branches: 4 + Math.floor(Math.random() * 4),
      });
      if (lightningStrikes.length > 4) lightningStrikes.shift();
      container.classList.remove("sphere-impact");
      void container.offsetWidth;
      container.classList.add("sphere-impact");
      window.setTimeout(() => container.classList.remove("sphere-impact"), 430);
    }, { passive: true });

    resizeCanvas();
    draw(performance.now());
    if (typeof ResizeObserver !== "undefined") {
      container._sphereResizeObserver = new ResizeObserver(resizeCanvas);
      container._sphereResizeObserver.observe(container);
    }
  }

  function setActivity(state, label) {
    ui.activity.dataset.state = state;
    ui.activityLabel.textContent = label;
    ui.core.dataset.state = state;
  }

  function showToast(message, kind = "") {
    const node = document.createElement("div");
    node.className = "toast" + (kind ? " " + kind : "");
    node.textContent = String(message || "");
    ui.toast.appendChild(node);
    window.setTimeout(() => node.remove(), 5200);
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function formatInline(raw) {
    let text = escapeHtml(raw);
    text = text.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, (whole, gap, href) => {
      const trimmed = href.replace(/[),.;!?]+$/g, "");
      let safe = "";
      try { const parsed = new URL(trimmed); if (parsed.protocol === "http:" || parsed.protocol === "https:") safe = parsed.href; } catch (_) {}
      if (!safe) return whole;
      return gap + '<a href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(trimmed) + "</a>" + href.slice(trimmed.length);
    });
    return text;
  }

  function formatMessage(raw) {
    const chunks = String(raw || "").split(/```([\w+#.-]*)\n([\s\S]*?)```/g);
    if (chunks.length === 1) return formatInline(chunks[0]).replace(/\n/g, "<br>");
    let html = "";
    for (let i = 0; i < chunks.length; i++) {
      if (i % 3 === 1) continue;
      if (i % 3 === 2) html += "<pre><code>" + escapeHtml(chunks[i]) + "</code></pre>";
      else html += formatInline(chunks[i]).replace(/\n/g, "<br>");
    }
    return html;
  }

  function saveTranscript() {
    try { sessionStorage.setItem("jarvis-chat-transcript-v1", JSON.stringify(transcript.slice(-60))); } catch (_) {}
  }

  function appendMessage(role, content, route = "") {
    const row = document.createElement("article");
    row.className = "message message-" + (role === "user" ? "user" : "assistant");
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = role === "user" ? "YOU" : "";
    if (role !== "user") avatar.classList.add("assistant-avatar");
    avatar.setAttribute("aria-hidden", "true");
    const body = document.createElement("div");
    body.className = "message-content";
    const meta = document.createElement("div");
    meta.className = "message-meta";
    const name = document.createElement("span");
    name.textContent = role === "user" ? "YOU" : "J.A.R.V.I.S.";
    meta.appendChild(name);
    if (route === "openclaw") {
      const routeTag = document.createElement("span");
      routeTag.className = "message-route";
      routeTag.textContent = "OPENCLAW";
      meta.appendChild(routeTag);
    }
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerHTML = formatMessage(content);
    body.append(meta, bubble);
    row.append(avatar, body);
    ui.chat.appendChild(row);
    ui.welcome.classList.add("hidden");
    ui.chat.scrollTop = ui.chat.scrollHeight;
    transcript.push({ role, content: String(content || ""), route: route || "" });
    saveTranscript();
    return row;
  }

  function restoreTranscript() {
    try {
      const saved = JSON.parse(sessionStorage.getItem("jarvis-chat-transcript-v1") || "[]");
      if (!Array.isArray(saved)) return;
      transcript = saved.filter((item) => item && ["user", "assistant"].includes(item.role) && typeof item.content === "string").slice(-60);
      for (const item of transcript) {
        const row = document.createElement("article");
        row.className = "message message-" + item.role;
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";
        avatar.textContent = item.role === "user" ? "YOU" : "";
        if (item.role !== "user") avatar.classList.add("assistant-avatar");
        avatar.setAttribute("aria-hidden", "true");
        const body = document.createElement("div");
        body.className = "message-content";
        const meta = document.createElement("div");
        meta.className = "message-meta";
        const label = document.createElement("span");
        label.textContent = item.role === "user" ? "YOU" : "J.A.R.V.I.S.";
        meta.appendChild(label);
        if (item.route === "openclaw") {
          const tag = document.createElement("span"); tag.className = "message-route"; tag.textContent = "OPENCLAW"; meta.appendChild(tag);
        }
        const bubble = document.createElement("div"); bubble.className = "message-bubble"; bubble.innerHTML = formatMessage(item.content);
        body.append(meta, bubble); row.append(avatar, body); ui.chat.appendChild(row);
      }
      if (transcript.length) ui.welcome.classList.add("hidden");
      ui.chat.scrollTop = ui.chat.scrollHeight;
    } catch (_) {}
  }

  async function getJSON(url) {
    const response = await fetch(url, { cache: "no-store" });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ").");
    return data;
  }

  async function postJSON(url, payload) {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ").");
    return data;
  }

  function renderApproval(pending) {
    const card = document.createElement("section");
    card.className = "approval-card";
    const title = document.createElement("h3");
    title.textContent = pending.title || "Review this action";
    const summary = document.createElement("p");
    summary.textContent = pending.summary || "JARVIS has proposed an action. Nothing has changed yet.";
    const warningText = pending.details?.warning;
    const warning = warningText ? document.createElement("p") : null;
    if (warning) { warning.textContent = warningText; warning.style.marginTop = "8px"; }
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const approve = document.createElement("button");
    approve.className = "approve";
    approve.type = "button";
    approve.textContent = "Approve";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = "Reject";
    actions.append(approve, reject);
    card.append(title, summary);
    if (warning) card.appendChild(warning);
    card.appendChild(actions);
    const wrapper = document.createElement("div");
    wrapper.className = "message message-assistant";
    const avatar = document.createElement("div"); avatar.className = "message-avatar"; avatar.textContent = ""; avatar.classList.add("assistant-avatar"); avatar.setAttribute("aria-hidden", "true");
    const body = document.createElement("div"); body.className = "message-content";
    body.appendChild(card); wrapper.append(avatar, body); ui.chat.appendChild(wrapper); ui.chat.scrollTop = ui.chat.scrollHeight;
    let done = false;
    async function choose(approved) {
      if (done) return;
      done = true;
      approve.disabled = true; reject.disabled = true;
      try {
        const result = await postJSON("/api/approve", { pending_id: pending.id, approved });
        if (result.reply) appendMessage("assistant", result.reply, result.routed_to === "openclaw" ? "openclaw" : "");
        if (result.pending_action) renderApproval(result.pending_action);
        if (result.reply) await speak(result.reply);
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        card.querySelectorAll("button").forEach((button) => button.disabled = true);
      }
    }
    approve.addEventListener("click", () => choose(true));
    reject.addEventListener("click", () => choose(false));
  }

  function setBusy(value) {
    busy = Boolean(value);
    ui.send.disabled = busy;
    ui.input.disabled = busy;
    ui.typing.classList.toggle("hidden", !busy);
    if (busy) setActivity("thinking", "THINKING");
    else if (!recorder) setActivity("idle", wakeEnabled ? "WAKE WORD STANDING BY" : "READY WHEN YOU ARE");
  }

  function stopSpeech() {
    speechGeneration += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const audio = activeAudio;
    activeAudio = null;
    if (audio) { audio.onended = null; audio.onerror = null; audio.pause(); audio.removeAttribute("src"); try { audio.load(); } catch (_) {} }
    if (activeAudioUrl) { URL.revokeObjectURL(activeAudioUrl); activeAudioUrl = null; }
    const resolve = speechResolver; speechResolver = null; if (resolve) resolve();
  }

  function speechText(text) {
    return String(text || "").replace(/```[\s\S]*?```/g, " code block omitted ").replace(/[*_#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 3500);
  }

  function speakBrowser(text, generation) {
    if (generation !== speechGeneration || !voiceReplies) return Promise.resolve();
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      showToast("Spoken replies are unavailable in this browser.", "error");
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => { if (finished) return; finished = true; window.clearTimeout(timer); if (speechResolver === finish) speechResolver = null; setActivity("idle", wakeEnabled ? "WAKE WORD STANDING BY" : "READY WHEN YOU ARE"); resolve(); };
      speechResolver = finish;
      const utterance = new SpeechSynthesisUtterance(text);
      const available = window.speechSynthesis.getVoices();
      utterance.voice = available.find((voice) => /^en-CA$/i.test(voice.lang)) || available.find((voice) => /^en-(GB|US)/i.test(voice.lang)) || null;
      utterance.lang = utterance.voice?.lang || "en-CA";
      utterance.rate = 1.02; utterance.pitch = .94;
      utterance.onstart = () => setActivity("speaking", "SPEAKING");
      utterance.onend = finish; utterance.onerror = finish;
      const timer = window.setTimeout(finish, 90000);
      window.speechSynthesis.speak(utterance);
    });
  }

  async function speak(text) {
    if (!voiceReplies || !text) return;
    const clean = speechText(text);
    if (!clean) return;
    stopSpeech();
    const generation = speechGeneration;
    try {
      const status = await getJSON("/api/tts/status");
      if (generation !== speechGeneration || !voiceReplies) return;
      if (status.available) {
        const response = await fetch("/api/tts/synthesize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean }),
        });
        if (response.ok) {
          const blob = await response.blob();
          if (generation !== speechGeneration || !voiceReplies) return;
          activeAudioUrl = URL.createObjectURL(blob);
          const audio = new Audio(activeAudioUrl);
          activeAudio = audio;
          const played = await new Promise((resolve) => {
            let finished = false;
            const finish = (success) => {
              if (finished) return; finished = true;
              audio.onended = null; audio.onerror = null; audio.onplay = null;
              if (activeAudio === audio) activeAudio = null;
              if (activeAudioUrl) { URL.revokeObjectURL(activeAudioUrl); activeAudioUrl = null; }
              if (speechResolver === finish) speechResolver = null;
              resolve(Boolean(success));
            };
            speechResolver = () => finish(false);
            audio.onplay = () => setActivity("speaking", "SPEAKING");
            audio.onended = () => finish(true); audio.onerror = () => finish(false);
            window.setTimeout(() => finish(false), 90000);
            audio.play().catch(() => finish(false));
          });
          if (generation !== speechGeneration || !voiceReplies) return;
          if (played) {
            setActivity("idle", wakeEnabled ? "WAKE WORD STANDING BY" : "READY WHEN YOU ARE");
            return;
          }
        }
      }
    } catch (_) {}
    if (generation !== speechGeneration || !voiceReplies) return;
    await speakBrowser(clean, generation);
  }

  async function handleResult(result) {
    const answer = String(result.reply || "I'm here.");
    appendMessage("assistant", answer, result.routed_to === "openclaw" ? "openclaw" : "");
    if (result.pending_action) renderApproval(result.pending_action);
    await speak(answer);
  }

  async function sendMessage(textOverride, options = {}) {
    const text = String(textOverride ?? ui.input.value).trim();
    if (!text || busy) return;
    ui.input.value = "";
    resizeInput();
    appendMessage("user", text);
    setBusy(true);
    stopSpeech();
    try {
      const result = await postJSON("/api/chat", { session_id: sessionId, message: text });
      if (result.session_id) sessionId = result.session_id;
      await handleResult(result);
    } catch (error) {
      appendMessage("assistant", "I couldn't complete that request.\n\n" + error.message);
      setActivity("error", "CONNECTION ERROR");
      showToast(error.message, "error");
    } finally {
      setBusy(false);
      if (options.fromWakeWord && wakeEnabled) {
        try { await postJSON("/api/voice/rearm", {}); await refreshWakeStatus(false); }
        catch (error) { showToast("Wake word could not re-arm: " + error.message, "error"); }
      }
    }
  }

  function resizeInput() {
    ui.input.style.height = "auto";
    ui.input.style.height = Math.min(ui.input.scrollHeight, 190) + "px";
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      showToast("Microphone recording isn't supported in this browser. Try a current Firefox or Chromium build.", "error");
      return;
    }
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      recordedChunks = [];
      recordingStartedAt = Date.now();
      const types = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
      const type = types.find((item) => MediaRecorder.isTypeSupported?.(item));
      recorder = type ? new MediaRecorder(microphoneStream, { mimeType: type }) : new MediaRecorder(microphoneStream);
      recorder.ondataavailable = (event) => { if (event.data?.size) recordedChunks.push(event.data); };
      recorder.onerror = () => { showToast("Microphone recording failed.", "error"); stopRecording(); };
      recorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: recorder?.mimeType || type || "audio/webm" });
        const currentRecorder = recorder;
        recorder = null;
        if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStream = null;
        if (recordingTimer) window.clearTimeout(recordingTimer);
        recordingTimer = null;
        ui.mic.classList.remove("listening");
        ui.mic.title = "Record a voice message";
        ui.mic.setAttribute("aria-label", "Start voice input");
        ui.composerStatus.textContent = "ENTER TO SEND · SHIFT + ENTER FOR NEW LINE";
        setActivity("thinking", "TRANSCRIBING");
        if (Date.now() - recordingStartedAt < 350 || blob.size < 500) {
          setActivity("idle", "READY WHEN YOU ARE"); showToast("I didn't catch enough audio. Try again.", "error"); return;
        }
        if (blob.size > 750000) {
          setActivity("idle", "READY WHEN YOU ARE"); showToast("That recording is too long. Keep it under 12 seconds.", "error"); return;
        }
        try {
          const base64 = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || "").split(",", 2)[1] || "");
            reader.onerror = () => reject(new Error("Could not read the recording."));
            reader.readAsDataURL(blob);
          });
          const result = await postJSON("/api/voice/transcribe", { audio_base64: base64, mime_type: blob.type || currentRecorder?.mimeType || "audio/webm" });
          if (!String(result.text || "").trim()) { showToast("I couldn't make out the audio. Try again a little closer to the mic.", "error"); setActivity("idle", "READY WHEN YOU ARE"); return; }
          ui.input.value = result.text; resizeInput();
          await sendMessage(result.text);
        } catch (error) {
          setActivity("idle", "READY WHEN YOU ARE"); showToast("Voice input failed: " + error.message, "error");
        }
      };
      recorder.start();
      ui.mic.classList.add("listening");
      ui.mic.title = "Stop recording and send";
      ui.mic.setAttribute("aria-label", "Stop recording and send");
      ui.composerStatus.textContent = "LISTENING — TAP MIC TO FINISH";
      setActivity("listening", "LISTENING");
      showToast("Listening… tap the microphone again to finish.");
      recordingTimer = window.setTimeout(stopRecording, 12000);
    } catch (error) {
      if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null; recorder = null;
      setActivity("error", "MICROPHONE UNAVAILABLE"); showToast("Couldn't access the microphone: " + error.message, "error");
    }
  }

  function stopRecording() {
    if (recordingTimer) window.clearTimeout(recordingTimer);
    recordingTimer = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else if (microphoneStream) { microphoneStream.getTracks().forEach((track) => track.stop()); microphoneStream = null; }
  }

  async function toggleMic() {
    if (recorder) { stopRecording(); return; }
    if (busy) { showToast("JARVIS is still working on the current reply."); return; }
    if (wakeEnabled) {
      try {
        const result = await postJSON("/api/voice/wakeword", { enabled: false });
        wakeStatus = result.status; renderWakeStatus(); syncWakePolling();
      } catch (_) {}
    }
    stopSpeech();
    await startRecording();
  }

  function renderWakeStatus() {
    if (!wakeStatus) return;
    wakeEnabled = Boolean(wakeStatus.enabled);
    const available = wakeStatus.available !== false;
    const label = wakeStatus.error ? "WAKE ERROR" : !available ? "WAKE UNAVAILABLE" : !wakeEnabled ? "WAKE OFF" : !wakeStatus.running ? "WAKE STARTING" : wakeStatus.armed ? "WAKE ON" : wakeStatus.capturing_command ? "HEARING…" : "WAKE PAUSED";
    ui.wakeLabel.textContent = label;
    ui.wake.classList.toggle("active", wakeEnabled);
    ui.wake.setAttribute("aria-pressed", String(wakeEnabled));
    ui.wake.title = wakeStatus.error || (available && wakeEnabled ? 'Listening locally for "Hey JARVIS"' : 'Enable local "Hey JARVIS" wake word');
    ui.wake.disabled = Boolean(wakeStatus.error) && !available;
    ui.wakeHint.innerHTML = wakeEnabled
      ? 'Say <b>Hey JARVIS</b>, wait for the listening cue, then speak your request.'
      : 'Type a message, use the microphone, or enable <b>Hey JARVIS</b>.';
  }

  function stopWakePolling() {
    if (wakeEventsTimer !== null) window.clearInterval(wakeEventsTimer);
    if (wakeStatusTimer !== null) window.clearInterval(wakeStatusTimer);
    wakeEventsTimer = null; wakeStatusTimer = null;
  }

  function syncWakePolling() {
    stopWakePolling();
    if (document.hidden || !wakeEnabled) return;
    wakeEventsTimer = window.setInterval(pollWakeEvents, 1000);
    wakeStatusTimer = window.setInterval(() => refreshWakeStatus(false), 5000);
  }

  async function refreshWakeStatus(initial = false) {
    try {
      wakeStatus = await getJSON("/api/voice/status");
      if (initial) {
        wakeEventCursor = Number(wakeStatus.last_event_id) || 0;
        wakePollReady = true;
        if (wakeStatus.enabled && wakeStatus.running && !wakeStatus.armed && !wakeStatus.capturing_command) {
          postJSON("/api/voice/rearm", {}).catch(() => {});
        }
      }
      renderWakeStatus();
      syncWakePolling();
    } catch (error) {
      wakeStatus = { enabled: false, armed: false, running: false, available: false, error: error.message };
      renderWakeStatus();
      if (initial) showToast("Voice service unavailable: " + error.message, "error");
    }
  }

  async function pollWakeEvents() {
    if (!wakePollReady || !wakeEnabled || document.hidden || wakePollBusy) return;
    wakePollBusy = true;
    try {
      const result = await getJSON("/api/voice/events?after=" + encodeURIComponent(wakeEventCursor));
      for (const event of result.events || []) {
        wakeEventCursor = Math.max(wakeEventCursor, Number(event.id) || 0);
        if (event.type === "wake") {
          setActivity("listening", "WAKE WORD DETECTED");
          showToast('Wake word detected. Listening for your command…');
        } else if (event.type === "command") {
          if (String(event.text || "").trim()) await sendMessage(event.text, { fromWakeWord: true });
          else {
            showToast(event.error || "I didn't catch that command. Try again.", "error");
            if (wakeEnabled) await postJSON("/api/voice/rearm", {}).catch(() => {});
            await refreshWakeStatus(false);
          }
        } else if (event.type === "error") {
          showToast(event.message || "Wake word stopped unexpectedly.", "error");
          await refreshWakeStatus(false);
        }
      }
    } catch (_) {
      // A temporary network error is safe to retry on the next poll.
    } finally { wakePollBusy = false; }
  }

  async function toggleWakeWord() {
    ui.wake.disabled = true;
    try {
      if (recorder) stopRecording();
      const result = await postJSON("/api/voice/wakeword", { enabled: !wakeEnabled });
      wakeStatus = result.status;
      renderWakeStatus();
      syncWakePolling();
      showToast(wakeEnabled ? 'Wake word enabled. Say "Hey JARVIS", then give your command.' : "Wake word disabled.");
    } catch (error) {
      await refreshWakeStatus(false);
      showToast(wakeStatus?.error || error.message, "error");
    } finally { ui.wake.disabled = false; }
  }

  async function refreshConnection() {
    try {
      await getJSON("/api/ping");
      ui.connection.dataset.state = "connected";
      ui.connectionLabel.textContent = "MODEL READY";
    } catch (_) {
      ui.connection.dataset.state = "disconnected";
      ui.connectionLabel.textContent = "MODEL OFFLINE";
    }
  }

  async function newChat() {
    if (busy) { showToast("Wait for the current request to finish."); return; }
    if (recorder) stopRecording();
    stopSpeech();
    sessionId = newId();
    sessionStorage.setItem(STORAGE_KEY, sessionId);
    transcript = [];
    sessionStorage.removeItem("jarvis-chat-transcript-v1");
    ui.chat.replaceChildren();
    ui.welcome.classList.remove("hidden");
    ui.input.value = ""; resizeInput(); ui.input.focus();
    setActivity("idle", wakeEnabled ? "WAKE WORD STANDING BY" : "READY WHEN YOU ARE");
  }

  ui.form.addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(); });
  ui.input.addEventListener("input", resizeInput);
  ui.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); }
  });
  ui.mic.addEventListener("click", () => void toggleMic());
  ui.voice.addEventListener("click", () => {
    voiceReplies = !voiceReplies;
    sessionStorage.setItem(VOICE_KEY, String(voiceReplies));
    ui.voice.classList.toggle("active", voiceReplies);
    ui.voice.setAttribute("aria-pressed", String(voiceReplies));
    ui.voiceLabel.textContent = voiceReplies ? "VOICE ON" : "VOICE OFF";
    if (!voiceReplies) stopSpeech();
  });
  ui.wake.addEventListener("click", () => void toggleWakeWord());
  ui.newChat.addEventListener("click", () => void newChat());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWakePolling();
    else void refreshWakeStatus(false);
  });
  createDotSphere();
  let sphereResizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(sphereResizeTimer);
    sphereResizeTimer = window.setTimeout(createDotSphere, 140);
  }, { passive: true });
  restoreTranscript();
  resizeInput();
  void refreshConnection();
  void refreshWakeStatus(true);
  ui.input.focus({ preventScroll: true });
})();
