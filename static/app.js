(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    chatLog: $("#chatLog"), welcome: $("#welcomePanel"), input: $("#messageInput"),
    send: $("#sendBtn"), mic: $("#micBtn"), typing: $("#typingRow"),
    connectionPill: $("#connectionPill"), connectionLabel: $("#connectionLabel"),
    workspacePath: $("#workspacePath"), testModel: $("#testModelBtn"),
    voiceOutput: $("#voiceOutputBtn"), toastRegion: $("#toastRegion"),
    sidebar: $("#sidebar"), mobileScrim: $("#mobileScrim"),
  };

  const sessionKey = "jarvis-session-v1";
  const makeId = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replaceAll("-", "")
    : String(Date.now()) + Math.random().toString(16).slice(2);
  let sessionId = sessionStorage.getItem(sessionKey) || makeId();
  sessionStorage.setItem(sessionKey, sessionId);
  let busy = false;
  let listening = false;
  let voiceReplies = false;
  let recognition = null;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function renderMarkdown(value) {
    const fence = String.fromCharCode(96).repeat(3);
    const fenceRegex = new RegExp(fence + "([\\w+-]*)\\n?([\\s\\S]*?)" + fence, "g");
    const codeBlocks = [];
    const held = String(value ?? "").replace(fenceRegex, (_, language, code) => {
      const slot = "JARVIS_CODE_" + codeBlocks.length + "_END";
      codeBlocks.push('<pre class="code-block"><div class="code-head"><span>' +
        escapeHtml(language || "CODE") + '</span><button class="copy-code" type="button">Copy</button></div><code>' +
        escapeHtml(code.replace(/\n$/, "")) + "</code></pre>");
      return slot;
    });
    let html = escapeHtml(held);
    const tick = String.fromCharCode(96);
    html = html.replace(new RegExp(tick + "([^" + tick + "]+)" + tick, "g"), '<code class="inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
    html = html.replace(/^### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^## (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^# (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^\s*[-*] (.+)$/gm, '<span class="md-list-item">• $1</span>');
    html = html.replace(/\n/g, "<br>");
    html = html.replace(/JARVIS_CODE_(\d+)_END/g, (_, index) => codeBlocks[Number(index)] || "");
    return html;
  }

  function scrollToBottom() {
    const viewport = $("#conversationViewport");
    requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
  }

  function showToast(message, kind) {
    const toast = document.createElement("div");
    toast.className = "toast" + (kind ? " toast-" + kind : "");
    const dot = document.createElement("span");
    dot.className = "toast-dot";
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(dot, text);
    elements.toastRegion.appendChild(toast);
    window.setTimeout(() => toast.classList.add("toast-visible"), 10);
    window.setTimeout(() => {
      toast.classList.remove("toast-visible");
      window.setTimeout(() => toast.remove(), 220);
    }, 3600);
  }

  function setBusy(value) {
    busy = value;
    elements.send.disabled = value;
    elements.input.disabled = value;
    elements.typing.classList.toggle("hidden", !value);
    elements.send.classList.toggle("loading", value);
    if (!value) {
      elements.input.disabled = false;
      elements.input.focus();
    }
  }

  function renderMessage(role, content) {
    elements.welcome.classList.add("hidden");
    const row = document.createElement("article");
    row.className = "message-row message-" + role;
    const avatar = document.createElement("div");
    avatar.className = "message-avatar " + (role === "user" ? "user-avatar" : "assistant-avatar");
    avatar.textContent = role === "user" ? "Y" : "J";
    const body = document.createElement("div");
    body.className = "message-body";
    const head = document.createElement("div");
    head.className = "message-head";
    const name = document.createElement("span");
    name.className = "message-name";
    name.textContent = role === "user" ? "YOU" : "JARVIS";
    const time = document.createElement("time");
    time.className = "message-time";
    time.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    head.append(name, time);
    const contentNode = document.createElement("div");
    contentNode.className = "message-content";
    contentNode.innerHTML = role === "assistant" ? renderMarkdown(content) : escapeHtml(content).replace(/\n/g, "<br>");
    body.append(head, contentNode);
    row.append(avatar, body);
    elements.chatLog.appendChild(row);
    scrollToBottom();
    return row;
  }

  function renderPendingAction(action) {
    const card = document.createElement("section");
    card.className = "action-card";
    card.dataset.pendingId = action.id;
    const head = document.createElement("div");
    head.className = "action-card-head";
    const icon = document.createElement("span");
    icon.className = "action-alert-icon";
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 21 20H3L12 3Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 9v4m0 3h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    const titleWrap = document.createElement("div");
    titleWrap.className = "action-title-wrap";
    const title = document.createElement("strong");
    title.textContent = action.title || "Approval required";
    const summary = document.createElement("span");
    summary.textContent = action.summary || "Review this action before it runs.";
    titleWrap.append(title, summary);
    const tag = document.createElement("span");
    tag.className = "approval-tag";
    tag.textContent = "WAITING";
    head.append(icon, titleWrap, tag);
    card.appendChild(head);

    const details = document.createElement("div");
    details.className = "action-details";
    if (action.tool === "run_command") {
      const label = document.createElement("div");
      label.className = "action-detail-label";
      label.textContent = "COMMAND · " + (action.details?.cwd || ".");
      const command = document.createElement("pre");
      command.className = "action-command";
      command.textContent = action.details?.command || action.summary || "";
      details.append(label, command);
    } else {
      const label = document.createElement("div");
      label.className = "action-detail-label";
      label.textContent = "DESTINATION · " + (action.details?.path || "");
      const meta = document.createElement("div");
      meta.className = "action-file-meta";
      meta.textContent = (action.details?.exists ? "Existing file will be replaced" : "New file") +
        " · " + (action.details?.bytes ?? 0).toLocaleString() + " bytes";
      details.append(label, meta);
      if (action.preview !== undefined) {
        const preview = document.createElement("pre");
        preview.className = "action-preview";
        preview.textContent = action.preview + (action.preview_truncated ? "\n… preview shortened" : "");
        details.appendChild(preview);
      }
    }
    card.appendChild(details);

    const safety = document.createElement("div");
    safety.className = "action-safety-note";
    safety.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.6 2.8 7.9 7 10 4.2-2.1 7-5.4 7-10V6l-7-3Z" stroke="currentColor" stroke-width="1.5"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg><span>Nothing happens unless you approve this exact action.</span>';
    card.appendChild(safety);

    const buttons = document.createElement("div");
    buttons.className = "action-buttons";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.className = "action-reject";
    reject.textContent = "Reject";
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "action-approve";
    approve.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4 4L19 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> Approve action';
    reject.addEventListener("click", () => decideAction(action.id, false, card));
    approve.addEventListener("click", () => decideAction(action.id, true, card));
    buttons.append(reject, approve);
    card.appendChild(buttons);
    elements.chatLog.appendChild(card);
    scrollToBottom();
  }

  async function decideAction(pendingId, approved, card) {
    if (busy) return;
    card.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    const stateLabel = document.createElement("div");
    stateLabel.className = "action-processing";
    stateLabel.textContent = approved ? "Executing approved action…" : "Recording rejection…";
    card.appendChild(stateLabel);
    setBusy(true);
    try {
      const result = await apiPost("/api/approve", {
        session_id: sessionId, pending_id: pendingId, approved: approved,
      });
      card.classList.add("action-complete");
      stateLabel.textContent = approved ? "Action reviewed and processed." : "Action rejected.";
      if (result.reply) {
        renderMessage("assistant", result.reply);
        speak(result.reply);
      }
      if (result.pending_action) renderPendingAction(result.pending_action);
    } catch (error) {
      stateLabel.textContent = "Could not complete: " + error.message;
      showToast(error.message, "error");
      card.querySelectorAll("button").forEach((button) => { button.disabled = false; });
    } finally {
      setBusy(false);
    }
  }

  async function apiPost(url, payload) {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    let data;
    try { data = await response.json(); } catch (_) { data = {}; }
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ").");
    return data;
  }

  async function sendMessage(textOverride) {
    if (busy) return;
    const text = String(textOverride ?? elements.input.value).trim();
    if (!text) return;
    renderMessage("user", text);
    elements.input.value = "";
    resizeInput();
    setBusy(true);
    try {
      const result = await apiPost("/api/chat", { session_id: sessionId, message: text });
      if (result.session_id) {
        sessionId = result.session_id;
        sessionStorage.setItem(sessionKey, sessionId);
      }
      renderMessage("assistant", result.reply || "I’m here.");
      speak(result.reply || "");
      if (result.pending_action) renderPendingAction(result.pending_action);
    } catch (error) {
      renderMessage("assistant", "I couldn’t complete that request.\n\n" + error.message +
        "\n\nCheck that your local model server is running and that JARVIS_BASE_URL and JARVIS_MODEL match its settings.");
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = Math.min(elements.input.scrollHeight, 170) + "px";
  }

  function newChat() {
    if (busy) return;
    sessionId = makeId();
    sessionStorage.setItem(sessionKey, sessionId);
    elements.chatLog.replaceChildren();
    elements.welcome.classList.remove("hidden");
    elements.input.value = "";
    resizeInput();
    elements.input.focus();
    closeSidebar();
  }

  function speak(text) {
    if (!voiceReplies || !("speechSynthesis" in window) || !text) return;
    window.speechSynthesis.cancel();
    const fence = String.fromCharCode(96).repeat(3);
    const clean = String(text).replace(new RegExp(fence + "[\\s\\S]*?" + fence, "g"), " code block omitted ")
      .replace(/[*_#>]/g, "").slice(0, 3_500);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.02;
    utterance.pitch = 0.94;
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoiceReplies() {
    voiceReplies = !voiceReplies;
    elements.voiceOutput.setAttribute("aria-pressed", String(voiceReplies));
    elements.voiceOutput.classList.toggle("active", voiceReplies);
    elements.voiceOutput.querySelector("span").textContent = voiceReplies ? "Voice on" : "Voice off";
    if (!voiceReplies && "speechSynthesis" in window) window.speechSynthesis.cancel();
    showToast(voiceReplies ? "Spoken replies enabled." : "Spoken replies disabled.");
  }

  function toggleMicrophone() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      showToast("Voice input isn't available in this browser. Try Chromium-based browser support.", "error");
      return;
    }
    if (listening && recognition) {
      recognition.stop();
      return;
    }
    recognition = new Recognition();
    recognition.lang = "en-CA";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      listening = true;
      elements.mic.classList.add("listening");
      elements.mic.setAttribute("aria-label", "Stop voice input");
      showToast("Listening…");
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) sendMessage(transcript);
    };
    recognition.onerror = (event) => {
      showToast("Voice input: " + (event.error || "recognition failed") + ".", "error");
    };
    recognition.onend = () => {
      listening = false;
      elements.mic.classList.remove("listening");
      elements.mic.setAttribute("aria-label", "Use voice input");
    };
    try { recognition.start(); } catch (_) { showToast("Voice input could not start.", "error"); }
  }

  async function testModel() {
    const label = elements.connectionLabel;
    label.textContent = "TESTING LINK";
    elements.connectionPill.classList.remove("connected", "disconnected");
    elements.testModel.classList.add("spinning");
    try {
      const response = await fetch("/api/ping", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || "Model endpoint did not respond.");
      elements.connectionPill.classList.add("connected");
      label.textContent = "MODEL ONLINE";
      showToast("Model endpoint answered successfully.", "success");
    } catch (error) {
      elements.connectionPill.classList.add("disconnected");
      label.textContent = "MODEL OFFLINE";
      showToast(error.message || "Model connection failed.", "error");
    } finally {
      elements.testModel.classList.remove("spinning");
    }
  }

  async function loadConfig() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const config = await response.json();
      elements.workspacePath.textContent = config.workspace || "Workspace unavailable";
      elements.workspacePath.title = config.workspace || "";
      elements.connectionLabel.textContent = "MODEL NOT TESTED";
    } catch (_) {
      elements.connectionLabel.textContent = "SERVER UNAVAILABLE";
      elements.connectionPill.classList.add("disconnected");
    }
  }

  function openSidebar() {
    elements.sidebar.classList.add("sidebar-open");
    elements.mobileScrim.classList.add("visible");
  }

  function closeSidebar() {
    elements.sidebar.classList.remove("sidebar-open");
    elements.mobileScrim.classList.remove("visible");
  }

  function copyCode(button) {
    const code = button.closest(".code-block")?.querySelector("code")?.textContent || "";
    if (!navigator.clipboard) {
      showToast("Clipboard access isn't available in this context.", "error");
      return;
    }
    navigator.clipboard.writeText(code).then(
      () => showToast("Code copied.", "success"),
      () => showToast("Could not copy that code block.", "error")
    );
  }

  elements.send.addEventListener("click", () => sendMessage());
  elements.input.addEventListener("input", resizeInput);
  elements.input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  $("#newChatBtn").addEventListener("click", newChat);
  $("#micBtn").addEventListener("click", toggleMicrophone);
  $("#voiceOutputBtn").addEventListener("click", toggleVoiceReplies);
  $("#testModelBtn").addEventListener("click", testModel);
  $("#systemBtn").addEventListener("click", () => sendMessage("Check my system status and summarize the basics."));
  $("#workspaceBtn").addEventListener("click", () => sendMessage("Inspect the root of my JARVIS workspace and summarize what is there."));
  $("#menuBtn").addEventListener("click", openSidebar);
  $("#mobileScrim").addEventListener("click", closeSidebar);
  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendMessage(button.dataset.prompt));
  });
  elements.chatLog.addEventListener("click", (event) => {
    const button = event.target.closest(".copy-code");
    if (button) copyCode(button);
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.input.focus();
    }
    if (event.key === "Escape") closeSidebar();
  });

  loadConfig();
  elements.input.focus({ preventScroll: true });
})();