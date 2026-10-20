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
  let microphoneAudioContext = null;
  let microphoneAnalyser = null;
  let microphoneSource = null;
  let microphoneMeterFrame = 0;
  let microphoneWaveData = null;
  let microphoneEnergy = 0;
  let orbPointerTargetX = 0;
  let orbPointerTargetY = 0;
  let orbPointerX = 0;
  let orbPointerY = 0;
  let orbPulseTimer = 0;


  function initHudParticles() {
    const canvas = document.getElementById("hudBackdrop");
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
    const particleCount = window.innerWidth < 700 ? 34 : 66;
    const particles = Array.from({ length: particleCount }, (_, index) => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.012,
      vy: (Math.random() - 0.5) * 0.012,
      radius: 0.35 + Math.random() * 1.1,
      phase: index * 1.618 + Math.random() * 6,
      bright: Math.random() > 0.78,
    }));
    let width = 1;
    let height = 1;
    let dpr = 1;
    let lastFrame = 0;
    let frameId = 0;
    let mouseX = 0.5;
    let mouseY = 0.5;
    let pointerActive = false;

    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(performance.now(), true);
    }

    function paint(now, force = false) {
      if (!force && reducedMotion && lastFrame) return;
      if (!force && !reducedMotion && now - lastFrame < 31) return;
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016;
      lastFrame = now;
      ctx.clearRect(0, 0, width, height);
      const activity = document.body.dataset.activity || "idle";
      const tint = activity === "listening" ? [255, 196, 107] :
        activity === "speaking" ? [97, 255, 207] :
        activity === "thinking" ? [128, 170, 255] :
        activity === "error" ? [255, 125, 135] : [91, 210, 237];
      const px = pointerActive ? (mouseX - 0.5) * 18 : 0;
      const py = pointerActive ? (mouseY - 0.5) * 14 : 0;
      for (const p of particles) {
        if (!reducedMotion && !document.hidden) {
          p.x += p.vx * delta * 20;
          p.y += p.vy * delta * 20;
          if (p.x < -0.02) p.x = 1.02;
          if (p.x > 1.02) p.x = -0.02;
          if (p.y < -0.02) p.y = 1.02;
          if (p.y > 1.02) p.y = -0.02;
        }
        p.sx = p.x * width + px * p.y;
        p.sy = p.y * height + py * p.x;
      }

      const maxDistance = Math.min(160, width * 0.14);
      for (let i = 0; i < particles.length; i += 1) {
        const a = particles[i];
        for (let j = i + 1; j < particles.length; j += 1) {
          const b = particles[j];
          const dx = a.sx - b.sx;
          const dy = a.sy - b.sy;
          const distance = Math.sqrt(dx * dx + dy * dy);
          if (distance >= maxDistance) continue;
          const alpha = (1 - distance / maxDistance) * (activity === "idle" ? 0.13 : 0.22);
          ctx.strokeStyle = "rgba(" + tint.join(",") + "," + alpha.toFixed(3) + ")";
          ctx.lineWidth = 0.55;
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();
        }
      }
      for (const p of particles) {
        const twinkle = reducedMotion ? 0.6 : 0.42 + 0.58 * (0.5 + 0.5 * Math.sin(now * 0.0012 + p.phase));
        const radius = p.radius * (p.bright ? 1.55 : 1);
        ctx.beginPath();
        ctx.fillStyle = "rgba(" + tint.join(",") + "," + (twinkle * (p.bright ? 0.76 : 0.32)).toFixed(3) + ")";
        ctx.arc(p.sx, p.sy, radius, 0, Math.PI * 2);
        ctx.fill();
        if (p.bright) {
          ctx.beginPath();
          ctx.fillStyle = "rgba(" + tint.join(",") + "," + (twinkle * 0.055).toFixed(3) + ")";
          ctx.arc(p.sx, p.sy, radius * 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    function tick(now) {
      if (document.hidden) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }
      paint(now);
      if (!reducedMotion) frameId = window.requestAnimationFrame(tick);
    }

    canvas._cleanupHudParticles = () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
    };
    function onPointerMove(event) {
      mouseX = event.clientX / Math.max(1, width);
      mouseY = event.clientY / Math.max(1, height);
      pointerActive = true;
    }
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    resize();
    if (!reducedMotion) frameId = window.requestAnimationFrame(tick);
  }

  function createDotSphere(containerId = "dotSphere", pointCount = 820, stateElementId = "coreOrb") {
    const container = document.getElementById(containerId);
    const stateElement = document.getElementById(stateElementId);
    if (!container) return;
    if (container._sphereFrame) window.cancelAnimationFrame(container._sphereFrame);
    container.replaceChildren();

    const canvas = document.createElement("canvas");
    canvas.className = "sphere-canvas";
    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;

    const count = pointCount;
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

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let rotation = 0;
    let lastFrame = 0;
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

    function draw(now) {
      container._sphereFrame = window.requestAnimationFrame(draw);
      if (document.hidden) return;
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016;
      lastFrame = now;
      const state = stateElement?.dataset.state || "idle";
      if (containerId === "dotSphere") {
        const pointerEase = Math.min(1, delta * 6);
        orbPointerX += (orbPointerTargetX - orbPointerX) * pointerEase;
        orbPointerY += (orbPointerTargetY - orbPointerY) * pointerEase;
      }
      const micBoost = state === "listening" ? microphoneEnergy : 0;
      const speed = reducedMotion ? 0 : (state === "listening" ? 1.05 : state === "thinking" ? 0.86 : state === "speaking" ? 0.42 : 0.22) + micBoost * 0.72;
      rotation += delta * speed;
      const time = now / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.455;
      const breath = reducedMotion ? 1 : 1 + (state === "speaking" ? Math.sin(time * 3.4) * 0.035 : state === "listening" ? Math.sin(time * 6.5) * (0.014 + micBoost * 0.075) : Math.sin(time * 1.3) * 0.008);
      context.clearRect(0, 0, width, height);

      const aura = context.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius * 1.22);
      aura.addColorStop(0, state === "listening" ? "rgba(87,226,255," + (0.15 + micBoost * 0.29).toFixed(3) + ")" : "rgba(59,176,225,.105)");
      aura.addColorStop(0.56, "rgba(39,128,203,.045)");
      aura.addColorStop(1, "rgba(26,90,154,0)");
      context.fillStyle = aura;
      context.beginPath();
      context.arc(cx, cy, radius * 1.22, 0, Math.PI * 2);
      context.fill();

      // Fine orbital lines sit behind the particle shell, like a faint magnetic field.
      context.save();
      context.translate(cx, cy);
      for (let i = 0; i < 3; i += 1) {
        context.save();
        context.rotate(rotation * (i % 2 ? -0.38 : 0.27) + i * 1.04);
        context.scale(1, 0.23 + i * 0.075);
        context.beginPath();
        context.arc(0, 0, radius * (1.04 + i * 0.035), 0, Math.PI * 2);
        context.strokeStyle = i === 0 ? "rgba(123,225,247,.15)" : "rgba(105,159,231,.075)";
        context.lineWidth = i === 0 ? 0.85 : 0.65;
        context.stroke();
        context.restore();
      }
      context.restore();

      const cosY = Math.cos(rotation + orbPointerX * 0.28);
      const sinY = Math.sin(rotation + orbPointerX * 0.28);
      const tilt = 0.24 + Math.sin(time * 0.38) * 0.06 + orbPointerY * 0.17;
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);
      const projected = [];
      for (const point of points) {
        const rippleStrength = state === "listening" ? 0.036 + micBoost * 0.052 : state === "thinking" ? 0.027 : state === "speaking" ? 0.022 : 0.009;
        const ripple = reducedMotion ? 0 : Math.sin(time * (state === "listening" ? 5.6 : 2.1) + point.phase) * rippleStrength;
        const scale = (1 + ripple) * breath;
        const px = point.x * scale;
        const py = point.y * scale;
        const pz = point.z * scale;
        const rx = px * cosY + pz * sinY;
        const rz = -px * sinY + pz * cosY;
        const ry = py * cosX - rz * sinX;
        const depthZ = py * sinX + rz * cosX;
        const perspective = 1 / (1.12 - depthZ * 0.19);
        projected.push({
          x: cx + rx * radius * perspective,
          y: cy + ry * radius * perspective,
          depth: (depthZ + 1) * 0.5,
          phase: point.phase,
          sparkle: point.sparkle,
        });
      }
      projected.sort((a, b) => a.depth - b.depth);

      for (const point of projected) {
        const depth = point.depth;
        const twinkle = reducedMotion ? 0.9 : 0.78 + 0.22 * Math.sin(time * (state === "speaking" ? 5.1 : 2.2) + point.phase);
        const size = (0.55 + depth * 1.75 + point.sparkle * 0.35) * twinkle;
        const opacity = Math.min(1, (0.14 + depth * 0.78) * twinkle);
        context.globalAlpha = opacity;
        if (depth > 0.77 && point.sparkle > 0.42) {
          context.fillStyle = "#e9fdff";
          context.shadowColor = state === "listening" ? "rgba(112,240,255,.95)" : "rgba(91,216,245,.72)";
          context.shadowBlur = depth > 0.9 ? 9 : 5;
        } else {
          context.fillStyle = depth > 0.52 ? "#83eaf7" : depth > 0.22 ? "#568fc5" : "#496fa9";
          context.shadowBlur = 0;
        }
        context.beginPath();
        context.arc(point.x, point.y, size, 0, Math.PI * 2);
        context.fill();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      // A soft highlight on the upper edge gives the sphere a glassy, dimensional finish.
      const highlight = context.createRadialGradient(cx - radius * 0.35, cy - radius * 0.46, 0, cx - radius * 0.18, cy - radius * 0.12, radius * 1.05);
      highlight.addColorStop(0, "rgba(204,251,255,.07)");
      highlight.addColorStop(0.36, "rgba(106,213,245,.025)");
      highlight.addColorStop(1, "rgba(106,213,245,0)");
      context.fillStyle = highlight;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
    }

    resizeCanvas();
    draw(performance.now());
    if (typeof ResizeObserver !== "undefined") {
      container._sphereResizeObserver?.disconnect();
      container._sphereResizeObserver = new ResizeObserver(resizeCanvas);
      container._sphereResizeObserver.observe(container);
    }
  }

  function setActivity(state, label) {
    ui.activity.dataset.state = state;
    ui.activityLabel.textContent = label;
    ui.core.dataset.state = state;
    document.body.dataset.activity = state;
  }

  function pulseOrb(kind = "incoming") {
    if (!ui.core) return;
    window.clearTimeout(orbPulseTimer);
    ui.core.dataset.pulse = "idle";
    // Restart the CSS pulse even when two message events happen close together.
    void ui.core.offsetWidth;
    ui.core.dataset.pulse = kind;
    document.body.dataset.orbPulse = kind;
    orbPulseTimer = window.setTimeout(() => {
      ui.core.dataset.pulse = "idle";
      document.body.dataset.orbPulse = "idle";
    }, kind === "outgoing" ? 760 : 1120);
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
    document.body.dataset.conversation = "active";
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
      if (transcript.length) {
        ui.welcome.classList.add("hidden");
        document.body.dataset.conversation = "active";
      }
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
      utterance.onstart = () => { setActivity("speaking", "SPEAKING"); pulseOrb("voice"); };
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
            audio.onplay = () => { setActivity("speaking", "SPEAKING"); pulseOrb("voice"); };
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
    pulseOrb("incoming");
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
    updateComposerReactivity();
    appendMessage("user", text);
    pulseOrb("outgoing");
    setBusy(true);
    stopSpeech();
    try {
      const result = await postJSON("/api/chat", { session_id: sessionId, message: text });
      if (result.session_id) sessionId = result.session_id;
      await handleResult(result);
    } catch (error) {
      appendMessage("assistant", "I couldn't complete that request.\n\n" + error.message);
      setActivity("error", "CONNECTION ERROR");
      pulseOrb("error");
      showToast(error.message, "error");
    } finally {
      setBusy(false);
      if (options.fromWakeWord && wakeEnabled) {
        try { await postJSON("/api/voice/rearm", {}); await refreshWakeStatus(false); }
        catch (error) { showToast("Wake word could not re-arm: " + error.message, "error"); }
      }
    }
  }

  function updateComposerReactivity() {
    const hasText = Boolean(ui.input.value.trim());
    const energy = Math.min(1, ui.input.value.length / 180);
    document.body.dataset.composing = hasText ? "on" : "off";
    document.body.style.setProperty("--compose-energy", energy.toFixed(3));
    document.body.style.setProperty("--compose-aura-opacity", (0.68 + energy * 0.32).toFixed(3));
    document.body.style.setProperty("--compose-scale", (1 + energy * 0.035).toFixed(3));
    ui.send.classList.toggle("has-message", hasText);
    ui.form.dataset.inputState = hasText ? "ready" : "empty";
  }

  function stopMicVisualization() {
    if (microphoneMeterFrame) window.cancelAnimationFrame(microphoneMeterFrame);
    microphoneMeterFrame = 0;
    if (microphoneSource) { try { microphoneSource.disconnect(); } catch (_) {} }
    microphoneSource = null;
    microphoneAnalyser = null;
    microphoneWaveData = null;
    const context = microphoneAudioContext;
    microphoneAudioContext = null;
    if (context && context.state !== "closed") context.close().catch(() => {});
    microphoneEnergy = 0;
    document.body.dataset.mic = "off";
    document.body.style.setProperty("--mic-energy", "0");
  }

  function startMicVisualization(stream) {
    stopMicVisualization();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      microphoneAudioContext = new AudioContextClass();
      microphoneAnalyser = microphoneAudioContext.createAnalyser();
      microphoneAnalyser.fftSize = 256;
      microphoneAnalyser.smoothingTimeConstant = 0.68;
      microphoneSource = microphoneAudioContext.createMediaStreamSource(stream);
      microphoneSource.connect(microphoneAnalyser);
      microphoneWaveData = new Uint8Array(microphoneAnalyser.fftSize);
      document.body.dataset.mic = "on";
      microphoneAudioContext.resume().catch(() => {});

      const measure = () => {
        if (!microphoneAnalyser || !microphoneWaveData) return;
        microphoneAnalyser.getByteTimeDomainData(microphoneWaveData);
        let sumSquares = 0;
        for (let i = 0; i < microphoneWaveData.length; i += 1) {
          const sample = (microphoneWaveData[i] - 128) / 128;
          sumSquares += sample * sample;
        }
        const rms = Math.sqrt(sumSquares / microphoneWaveData.length);
        const target = Math.max(0, Math.min(1, (rms - 0.012) * 4.6));
        microphoneEnergy += (target - microphoneEnergy) * (target > microphoneEnergy ? 0.42 : 0.18);
        document.body.style.setProperty("--mic-energy", microphoneEnergy.toFixed(3));
        microphoneMeterFrame = window.requestAnimationFrame(measure);
      };
      microphoneMeterFrame = window.requestAnimationFrame(measure);
    } catch (_) {
      stopMicVisualization();
    }
  }

  function wireReactiveInteractions() {
    function aimOrb(event) {
      if (event.pointerType === "touch") return;
      orbPointerTargetX = Math.max(-1, Math.min(1, (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2));
      orbPointerTargetY = Math.max(-1, Math.min(1, (event.clientY / Math.max(1, window.innerHeight) - 0.5) * 2));
      ui.core.dataset.pointer = "active";
      ui.core.style.setProperty("--orb-tilt-x", (orbPointerTargetX * 5.5).toFixed(2) + "deg");
      ui.core.style.setProperty("--orb-tilt-y", (-orbPointerTargetY * 5.5).toFixed(2) + "deg");
    }
    function resetOrbAim() {
      orbPointerTargetX = 0;
      orbPointerTargetY = 0;
      ui.core.dataset.pointer = "idle";
      ui.core.style.setProperty("--orb-tilt-x", "0deg");
      ui.core.style.setProperty("--orb-tilt-y", "0deg");
    }
    // The orb is pointer-transparent so chat controls always win; track pointer movement globally.
    window.addEventListener("pointermove", aimOrb, { passive: true });
    document.addEventListener("mouseleave", resetOrbAim);
    window.addEventListener("blur", resetOrbAim);
    ui.input.addEventListener("focus", () => { document.body.dataset.composerFocus = "on"; });
    ui.input.addEventListener("blur", () => { document.body.dataset.composerFocus = "off"; });
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
      startMicVisualization(microphoneStream);
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
        stopMicVisualization();
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
          ui.input.value = result.text; resizeInput(); updateComposerReactivity();
          await sendMessage(result.text);
        } catch (error) {
          setActivity("idle", "READY WHEN YOU ARE"); showToast("Voice input failed: " + error.message, "error");
        }
      };
      recorder.start();
      pulseOrb("voice");
      ui.mic.classList.add("listening");
      ui.mic.title = "Stop recording and send";
      ui.mic.setAttribute("aria-label", "Stop recording and send");
      ui.composerStatus.textContent = "LISTENING — TAP MIC TO FINISH";
      setActivity("listening", "LISTENING");
      showToast("Listening… tap the microphone again to finish.");
      recordingTimer = window.setTimeout(stopRecording, 12000);
    } catch (error) {
      stopMicVisualization();
      if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null; recorder = null;
      setActivity("error", "MICROPHONE UNAVAILABLE"); showToast("Couldn't access the microphone: " + error.message, "error");
    }
  }

  function stopRecording() {
    if (recordingTimer) window.clearTimeout(recordingTimer);
    recordingTimer = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    else {
      stopMicVisualization();
      if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
    }
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
    document.body.dataset.wake = wakeEnabled ? "on" : "off";
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
          pulseOrb("wake");
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
      document.body.dataset.connection = "connected";
      ui.connectionLabel.textContent = "ONLINE";
    } catch (_) {
      ui.connection.dataset.state = "disconnected";
      document.body.dataset.connection = "disconnected";
      ui.connectionLabel.textContent = "OFFLINE";
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
    document.body.dataset.conversation = "welcome";
    ui.input.value = ""; resizeInput(); updateComposerReactivity(); ui.input.focus();
    setActivity("idle", wakeEnabled ? "WAKE WORD STANDING BY" : "READY WHEN YOU ARE");
  }

  ui.form.addEventListener("submit", (event) => { event.preventDefault(); void sendMessage(); });
  ui.input.addEventListener("input", () => { resizeInput(); updateComposerReactivity(); });
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
    document.body.dataset.voice = voiceReplies ? "on" : "off";
    if (!voiceReplies) stopSpeech();
  });
  ui.wake.addEventListener("click", () => void toggleWakeWord());
  ui.newChat.addEventListener("click", () => void newChat());
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopWakePolling();
    else void refreshWakeStatus(false);
  });
  initHudParticles();
  createDotSphere();
  wireReactiveInteractions();
  let sphereResizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(sphereResizeTimer);
    sphereResizeTimer = window.setTimeout(() => {
      createDotSphere();
    }, 140);
  }, { passive: true });
  restoreTranscript();
  resizeInput();
  updateComposerReactivity();
  document.body.dataset.voice = voiceReplies ? "on" : "off";
  ui.voice.classList.toggle("active", voiceReplies);
  ui.voice.setAttribute("aria-pressed", String(voiceReplies));
  ui.voiceLabel.textContent = voiceReplies ? "VOICE ON" : "VOICE OFF";
  void refreshConnection();
  void refreshWakeStatus(true);
  ui.input.focus({ preventScroll: true });
})();
