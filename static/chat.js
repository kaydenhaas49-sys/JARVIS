    text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
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
    avatar.textContent = role === "user" ? "YOU" : "J";
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
        avatar.textContent = item.role === "user" ? "YOU" : "J";
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
    const avatar = document.createElement("div"); avatar.className = "message-avatar"; avatar.textContent = "J"; avatar.setAttribute("aria-hidden", "true");
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
  restoreTranscript();
  resizeInput();
  void refreshConnection();
  void refreshWakeStatus(true);
  ui.input.focus({ preventScroll: true });
})();
