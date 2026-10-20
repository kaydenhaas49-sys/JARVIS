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
    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) return;

    const compact = window.matchMedia?.("(max-width: 740px)")?.matches || false;
    const shellCount = compact ? 1320 : 1880;
    const innerCount = compact ? 300 : 520;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const points = [];
    for (let i = 0; i < shellCount + innerCount; i += 1) {
      const shell = i < shellCount;
      const index = shell ? i : i - shellCount;
      const count = shell ? shellCount : innerCount;
      const y = 1 - 2 * ((index + 0.5) / count);
      const ring = Math.sqrt(Math.max(0, 1 - y * y));
      const angle = goldenAngle * index + (shell ? 0 : 0.31);
      const pointRadius = shell ? 0.91 + (((index * 17) % 23) / 100) : 0.24 + (((index * 29) % 71) / 100) * 0.58;
      points.push({
        x: Math.cos(angle) * ring * pointRadius,
        y: y * pointRadius,
        z: Math.sin(angle) * ring * pointRadius,
        phase: index * 2.399963229728653 + (shell ? 0 : 1.7),
        sparkle: ((index * 37) % 101) / 100,
        shell,
      });
    }

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let rotation = 0;
    let lastFrame = 0;
    let energy = 0;
    let visible = !document.hidden;
    const motionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let reducedMotion = Boolean(motionQuery?.matches);

    function resizeCanvas() {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, compact ? 1.5 : 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = width + "px";
      canvas.style.height = height + "px";
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      if (reducedMotion) draw(performance.now(), true);
    }

    function draw(now, staticFrame = false) {
      if (!visible || document.hidden) return;
      if (!reducedMotion && !staticFrame) {
        container._sphereFrame = window.requestAnimationFrame(draw);
      }
      const delta = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016;
      lastFrame = now;
      const state = ui.core?.dataset.state || "idle";
      const targetEnergy = state === "listening" ? 1 : state === "thinking" ? 0.68 : state === "speaking" ? 0.82 : state === "error" ? 0.36 : 0;
      energy += (targetEnergy - energy) * (1 - Math.exp(-delta * 2.6));
      const time = now / 1000;
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) * 0.395;
      const motion = reducedMotion ? 0 : 1;
      const spinRate = state === "thinking" ? 0.52 : state === "listening" ? 0.3 : state === "speaking" ? 0.2 : 0.105;
      rotation += delta * spinRate * motion;
      const breath = 1 + motion * (0.008 * Math.sin(time * 1.05) + energy * 0.012 * Math.sin(time * (state === "speaking" ? 5.2 : 2.7)));
      context.clearRect(0, 0, width, height);

      const glow = context.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.48);
      glow.addColorStop(0, "rgba(73,210,242," + (0.11 + energy * 0.1) + ")");
      glow.addColorStop(0.43, "rgba(35,153,209,.075)");
      glow.addColorStop(0.72, "rgba(28,107,169,.035)");
      glow.addColorStop(1, "rgba(17,68,117,0)");
      context.fillStyle = glow;
      context.beginPath();
      context.arc(cx, cy, radius * 1.48, 0, Math.PI * 2);
      context.fill();

      context.save();
      context.translate(cx, cy);
      context.globalCompositeOperation = "screen";
      for (let i = 0; i < 4; i += 1) {
        context.save();
        context.rotate(rotation * (i % 2 ? -0.19 : 0.14) + i * 0.83);
        context.scale(1, 0.2 + (i % 3) * 0.075);
        context.beginPath();
        context.ellipse(0, 0, radius * (1.01 + i * 0.025), 0, 0, 0, Math.PI * 2);
        context.strokeStyle = i === 0
          ? "rgba(171,245,255," + (0.14 + energy * 0.12) + ")"
          : "rgba(83,194,232," + (0.045 + energy * 0.035) + ")";
        context.lineWidth = i === 0 ? 0.9 : 0.65;
        context.stroke();
        context.restore();
      }
      context.restore();

      const cosY = Math.cos(rotation);
      const sinY = Math.sin(rotation);
      const tilt = 0.2 + Math.sin(time * 0.31) * 0.055 * motion;
      const cosX = Math.cos(tilt);
      const sinX = Math.sin(tilt);
      const projected = [];
      for (const point of points) {
        const waveRate = state === "listening" ? 4.1 : state === "thinking" ? 2.5 : state === "speaking" ? 5.3 : 1.3;
        const wave = Math.sin(time * waveRate - point.phase * 0.22);
        const ripple = motion * (point.shell
          ? (0.006 + energy * 0.016) * wave
          : (0.012 + energy * 0.023) * Math.sin(time * 1.6 + point.phase));
        const scale = (1 + ripple) * breath;
        const px = point.x * scale;
        const py = point.y * scale;
        const pz = point.z * scale;
        const rx = px * cosY + pz * sinY;
        const rz = -px * sinY + pz * cosY;
        const ry = py * cosX - rz * sinX;
        const depthZ = py * sinX + rz * cosX;
        const perspective = 1 / (1.1 - depthZ * 0.22);
        projected.push({
          x: cx + rx * radius * perspective,
          y: cy + ry * radius * perspective,
          depth: (depthZ + 1) * 0.5,
          phase: point.phase,
          sparkle: point.sparkle,
          shell: point.shell,
        });
      }
      projected.sort((a, b) => a.depth - b.depth);

      context.globalCompositeOperation = "screen";
      for (const point of projected) {
        const depth = point.depth;
        const front = Math.max(0, (depth - 0.12) / 0.88);
        const interior = point.shell ? 1 : 0.58;
        const pulse = reducedMotion ? 0 : Math.sin(time * (state === "speaking" ? 7 : state === "listening" ? 4.2 : 1.8) + point.phase) * energy;
        const twinkle = 0.76 + point.sparkle * 0.18 + pulse * 0.07;
        const size = (point.shell ? 0.48 + front * 1.35 : 0.35 + front * 0.72) * (1 + energy * 0.17) * twinkle;
        const opacity = Math.min(0.9, (point.shell ? 0.09 + front * 0.68 : 0.045 + front * 0.34) * interior * (1 + energy * 0.28));
        context.globalAlpha = opacity;
        context.fillStyle = point.sparkle > 0.93 && front > 0.65
          ? "#efffff"
          : front > 0.72 ? "#9ceeff" : front > 0.36 ? "#59c9ec" : "#347ca9";
        context.beginPath();
        context.arc(point.x, point.y, size, 0, Math.PI * 2);
        context.fill();
        if (point.sparkle > 0.985 && front > 0.77) {
          context.globalAlpha = opacity * 0.34;
          context.beginPath();
          context.arc(point.x, point.y, size * 3.2, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
      context.globalCompositeOperation = "source-over";

      const highlight = context.createRadialGradient(cx - radius * 0.34, cy - radius * 0.42, radius * 0.02, cx - radius * 0.13, cy - radius * 0.08, radius * 1.05);
      highlight.addColorStop(0, "rgba(226,254,255,.105)");
      highlight.addColorStop(0.28, "rgba(141,232,250,.055)");
      highlight.addColorStop(0.7, "rgba(65,177,219,.018)");
      highlight.addColorStop(1, "rgba(14,45,75,0)");
      context.fillStyle = highlight;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();

      const limb = context.createRadialGradient(cx + radius * 0.22, cy + radius * 0.3, radius * 0.36, cx, cy, radius * 1.08);
      limb.addColorStop(0, "rgba(0,0,0,0)");
      limb.addColorStop(0.68, "rgba(1,10,22,.045)");
      limb.addColorStop(1, "rgba(2,13,27,.34)");
      context.fillStyle = limb;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
    }

    function onVisibilityChange() {
      visible = !document.hidden;
      if (visible && !reducedMotion) {
        lastFrame = 0;
        container._sphereFrame = window.requestAnimationFrame(draw);
      } else if (!visible && container._sphereFrame) {
        window.cancelAnimationFrame(container._sphereFrame);
      } else if (visible) {
        draw(performance.now(), true);
      }
    }

    function onMotionPreferenceChange(event) {
      reducedMotion = event.matches;
      if (container._sphereFrame) window.cancelAnimationFrame(container._sphereFrame);
      if (reducedMotion) draw(performance.now(), true);
      else if (visible) {
        lastFrame = 0;
        container._sphereFrame = window.requestAnimationFrame(draw);
      }
    }

    resizeCanvas();
    if (reducedMotion) draw(performance.now(), true);
    else container._sphereFrame = window.requestAnimationFrame(draw);
    container._sphereVisibilityHandler = onVisibilityChange;
    container._sphereMotionHandler = onMotionPreferenceChange;
    document.addEventListener("visibilitychange", onVisibilityChange);
    motionQuery?.addEventListener?.("change", onMotionPreferenceChange);
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
