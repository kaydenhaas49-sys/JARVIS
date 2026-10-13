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
    utilityPanel: $("#utilityPanel"), utilityContent: $("#utilityContent"),
    utilityTitle: $("#utilityTitle"), utilityEyebrow: $("#utilityEyebrow"),
  };

  const sessionKey = "jarvis-session-v1";
  const makeId = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replaceAll("-", "")
    : String(Date.now()) + Math.random().toString(16).slice(2);
  let sessionId = sessionStorage.getItem(sessionKey) || makeId();
  sessionStorage.setItem(sessionKey, sessionId);
  const chatHistoryKey = "jarvis-chat-history-v1";
  const MAX_CHAT_HISTORY = 25;
  const MAX_ARCHIVED_MESSAGES = 40;
  const MAX_ARCHIVED_MESSAGE_CHARS = 4000;
  let chatHistory = readChatHistory();
  let activeTranscript = [];
  let historySearchText = "";
  let sessionRestorePromise = null;
  let busy = false;
  let listening = false;
  let voiceReplies = false;
  let recognition = null;
  let currentUtilityView = null;
  let activeSystemTab = "status";
  let openQuickNotesPanel = null;
  let openRecipeSaverPanel = null;
  let activityEvents = readLocalJson("jarvis-activity-v1", []);
  let kitchenState = readLocalJson("jarvis-kitchen-v1", {
    groceries: [], pantry: [], meals: {}, timers: [],
  });
  let latestModelList = null;
  let currentOrbState = "idle";

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

  function renderMessage(role, content, options = {}) {
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
    const messageTime = Number.isFinite(Number(options.at)) ? Number(options.at) : Date.now();
    time.textContent = new Date(messageTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    head.append(name, time);
    const contentNode = document.createElement("div");
    contentNode.className = "message-content";
    contentNode.innerHTML = role === "assistant" ? renderMarkdown(content) : escapeHtml(content).replace(/\n/g, "<br>");
    body.append(head, contentNode);
    row.append(avatar, body);
    elements.chatLog.appendChild(row);
    if (options.archive !== false) {
      activeTranscript.push({ role: role === "user" ? "user" : "assistant", content: String(content ?? ""), at: Date.now() });
      persistCurrentConversation();
    }
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
    if (action.tool === "remember_fact") {
      const label = document.createElement("div");
      label.className = "action-detail-label";
      label.textContent = "PERSISTENT MEMORY";
      const fact = document.createElement("div");
      fact.className = "action-memory-fact";
      fact.textContent = action.details?.fact || action.summary || "";
      details.append(label, fact);
    } else if (action.tool === "run_command") {
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
    logActivity(approved ? "Action approved" : "Action rejected", "Reviewable action " + (approved ? "approved" : "rejected"), "approval");
    setOrbState("thinking");
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
      if (result.pending_action) {
        logActivity("Approval requested", result.pending_action.title || "Review a proposed action", "approval");
        renderPendingAction(result.pending_action);
      }
    } catch (error) {
      stateLabel.textContent = "Could not complete: " + error.message;
      logActivity("Action failed", error.message, "error");
      setOrbState("error");
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
    if (sessionRestorePromise) {
      showToast("Still restoring the saved conversation. Try sending again in a moment.");
      return;
    }
    const text = String(textOverride ?? elements.input.value).trim();
    if (!text) return;
    renderMessage("user", text);
    logActivity("Message sent", "Message submitted to JARVIS", "chat");
    setOrbState("thinking");
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
      logActivity("Assistant replied", result.pending_action ? "Waiting for action approval" : "Response received", "chat");
      speak(result.reply || "");
      if (result.pending_action) {
        logActivity("Approval requested", result.pending_action.title || "Review a proposed action", "approval");
        renderPendingAction(result.pending_action);
      }
    } catch (error) {
      renderMessage("assistant", "I couldn’t complete that request.\n\n" + error.message +
        "\n\nCheck that your local model server is running and that JARVIS_BASE_URL and JARVIS_MODEL match its settings.");
      logActivity("Request failed", error.message, "error");
      setOrbState("error");
      window.setTimeout(() => { if (currentOrbState === "error") setOrbState("idle"); }, 1800);
      showToast(error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = Math.min(elements.input.scrollHeight, 170) + "px";
  }

  function readChatHistory() {
    const stored = readLocalJson("jarvis-chat-history-v1", []);
    if (!Array.isArray(stored)) return [];
    return stored.filter((conversation) =>
      conversation && typeof conversation.id === "string" && conversation.id.length > 0 &&
      conversation.id.length <= 100 && Array.isArray(conversation.messages)
    ).map((conversation) => ({
      id: conversation.id,
      title: String(conversation.title || "Conversation").slice(0, 100),
      updatedAt: Number.isFinite(Number(conversation.updatedAt)) ? Number(conversation.updatedAt) : Date.now(),
      messages: conversation.messages.filter((message) =>
        message && (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string"
      ).slice(-MAX_ARCHIVED_MESSAGES).map((message) => ({
        role: message.role,
        content: message.content.slice(0, MAX_ARCHIVED_MESSAGE_CHARS),
        at: Number.isFinite(Number(message.at)) ? Number(message.at) : Date.now(),
      })),
    })).filter((conversation) => conversation.messages.length > 0)
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHAT_HISTORY);
  }

  function saveChatHistoryStorage() {
    try {
      localStorage.setItem(chatHistoryKey, JSON.stringify(chatHistory));
      return true;
    } catch (_) {
      chatHistory = chatHistory.slice(0, Math.max(1, Math.ceil(chatHistory.length / 2)));
      try {
        localStorage.setItem(chatHistoryKey, JSON.stringify(chatHistory));
        showToast("Older chat archives were trimmed because browser storage was nearly full.", "error");
        return true;
      } catch (_) {
        showToast("Browser storage is full; this conversation may not be saved.", "error");
        return false;
      }
    }
  }

  function persistCurrentConversation() {
    if (!activeTranscript.length) return;
    const firstUserMessage = activeTranscript.find((message) => message.role === "user");
    const title = String(firstUserMessage?.content || "New conversation").replace(/\s+/g, " ").trim().slice(0, 84) || "New conversation";
    const messages = activeTranscript.slice(-MAX_ARCHIVED_MESSAGES).map((message) => ({
      role: message.role,
      content: String(message.content || "").slice(0, MAX_ARCHIVED_MESSAGE_CHARS),
      at: Number.isFinite(Number(message.at)) ? Number(message.at) : Date.now(),
    }));
    chatHistory = [{
      id: sessionId, title, updatedAt: Date.now(), messages,
    }, ...chatHistory.filter((conversation) => conversation.id !== sessionId)]
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHAT_HISTORY);
    saveChatHistoryStorage();
  }

  function renderHistoryRows() {
    const query = historySearchText.trim().toLowerCase();
    const matching = chatHistory.filter((conversation) => {
      if (!query) return true;
      return conversation.title.toLowerCase().includes(query) ||
        conversation.messages.some((message) => message.content.toLowerCase().includes(query));
    });
    const host = document.querySelector("[data-history-results]");
    if (!host) return;
    if (!matching.length) {
      host.innerHTML = '<div class="empty-state">' + (chatHistory.length
        ? "No saved conversations match that search."
        : "No saved conversations yet. Start chatting and JARVIS will save them here.") + "</div>";
    } else {
      host.innerHTML = matching.map((conversation) => {
        const last = conversation.messages[conversation.messages.length - 1];
        const preview = String(last?.content || "").replace(/\s+/g, " ").slice(0, 130);
        const updated = new Date(conversation.updatedAt).toLocaleString();
        return '<article class="history-entry">' +
          '<div class="history-entry-copy"><strong class="history-entry-title">' + escapeHtml(conversation.title) + '</strong>' +
          '<div class="history-entry-meta">' + escapeHtml(updated) + " · " + conversation.messages.length + " saved messages</div>" +
          '<p class="history-entry-preview">' + escapeHtml(preview) + '</p></div>' +
          '<div class="history-entry-actions"><button type="button" data-utility-action="history-open" data-id="' + escapeHtml(conversation.id) + '">Open chat</button>' +
          '<button type="button" class="history-delete" data-utility-action="history-delete" data-id="' + escapeHtml(conversation.id) + '">Delete</button></div></article>';
      }).join("");
    }
    const count = document.getElementById("historyCount");
    if (count) count.textContent = matching.length + " of " + chatHistory.length + " conversations";
  }

  function renderHistoryPanel() {
    elements.utilityContent.innerHTML = renderMemoryNotesTabs("history") +
      '<div class="history-toolbar"><div><p class="history-description">Your last 25 conversations, saved only in this browser. Reopen one to continue with its saved text context.</p>' +
      '<div class="utility-muted" id="historyCount">0 conversations</div></div>' +
      '<div class="history-toolbar-actions"><button type="button" class="history-toolbar-btn" data-utility-action="history-export">Export JSON</button>' +
      '<button type="button" class="history-toolbar-btn history-delete" data-utility-action="history-clear">Clear history</button></div></div>' +
      '<label class="history-search-label" for="historySearch">SEARCH SAVED CHATS</label>' +
      '<input class="history-search" id="historySearch" type="search" data-history-search placeholder="Search titles and messages…" value="' + escapeHtml(historySearchText) + '">' +
      '<div class="history-list" data-history-results></div>';
    renderHistoryRows();
  }

  function downloadChatHistory() {
    if (!chatHistory.length) {
      showToast("There are no saved conversations to export.");
      return;
    }
    const content = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), conversations: chatHistory }, null, 2) + "\n";
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "jarvis-chat-history-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast("Chat history exported as JSON.", "success");
  }

  function deleteChatHistoryEntry(id) {
    const conversation = chatHistory.find((item) => item.id === id);
    if (!conversation || !window.confirm('Delete "' + conversation.title + '" from saved chat history?')) return;
    chatHistory = chatHistory.filter((item) => item.id !== id);
    if (id === sessionId) {
      activeTranscript = [];
      sessionId = makeId();
      sessionStorage.setItem(sessionKey, sessionId);
      elements.chatLog.replaceChildren();
      elements.welcome.classList.remove("hidden");
    }
    saveChatHistoryStorage();
    renderHistoryPanel();
    showToast("Saved conversation deleted.");
  }

  function clearChatHistory() {
    if (!window.confirm("Delete all saved conversations and start a fresh chat? This cannot be undone.")) return;
    chatHistory = [];
    activeTranscript = [];
    sessionId = makeId();
    sessionStorage.setItem(sessionKey, sessionId);
    elements.chatLog.replaceChildren();
    elements.welcome.classList.remove("hidden");
    elements.input.value = "";
    resizeInput();
    saveChatHistoryStorage();
    renderHistoryPanel();
    showToast("Chat history cleared.", "success");
  }

  function normalizedHistoryMessages(conversation) {
    return conversation.messages.slice(-MAX_ARCHIVED_MESSAGES).map((message) => {
      let content = String(message.content || "").slice(0, MAX_ARCHIVED_MESSAGE_CHARS);
      if (message.role === "assistant" && content.trim() === "I have a proposed action ready for your review. Nothing has changed yet.") {
        content = "This chat had an action awaiting approval. It was not restored for safety. Ask JARVIS to propose it again before continuing.";
      }
      return {
        role: message.role,
        content,
        at: Number.isFinite(Number(message.at)) ? Number(message.at) : Date.now(),
      };
    }).filter((message) => message.role === "user" || message.role === "assistant");
  }

  function restoreArchivedConversation(conversation, announce = true) {
    if (!conversation) return;
    persistCurrentConversation();
    sessionId = conversation.id;
    sessionStorage.setItem(sessionKey, sessionId);
    activeTranscript = normalizedHistoryMessages(conversation);
    elements.chatLog.replaceChildren();
    if (activeTranscript.length) {
      elements.welcome.classList.add("hidden");
      activeTranscript.forEach((message) => renderMessage(message.role, message.content, { archive: false, at: message.at }));
    } else {
      elements.welcome.classList.remove("hidden");
    }
    closeUtility();
    closeSidebar();
    const restoreId = sessionId;
    const task = apiPost("/api/session/restore", {
      session_id: restoreId,
      messages: activeTranscript.map((message) => ({ role: message.role, content: message.content })),
    }).then(() => {
      if (announce) showToast("Conversation restored. You can continue it.", "success");
    }).catch((error) => {
      if (announce) showToast("Transcript opened, but model context could not be restored: " + error.message, "error");
    });
    sessionRestorePromise = task;
    task.then(() => {
      if (sessionRestorePromise === task) sessionRestorePromise = null;
    });
  }

  function restoreCurrentConversation() {
    const conversation = chatHistory.find((item) => item.id === sessionId);
    if (conversation) restoreArchivedConversation(conversation, false);
  }

  function newChat() {
    if (busy || sessionRestorePromise) return;
    sessionId = makeId();
    sessionStorage.setItem(sessionKey, sessionId);
    activeTranscript = [];
    elements.chatLog.replaceChildren();
    elements.welcome.classList.remove("hidden");
    elements.input.value = "";
    resizeInput();
    elements.input.focus();
    closeSidebar();
  }

  function speak(text) {
    if (!voiceReplies || !("speechSynthesis" in window) || !text) {
      setOrbState("idle");
      return;
    }
    window.speechSynthesis.cancel();
    const fence = String.fromCharCode(96).repeat(3);
    const clean = String(text).replace(new RegExp(fence + "[\\s\\S]*?" + fence, "g"), " code block omitted ")
      .replace(/[*_#>]/g, "").slice(0, 3_500);
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.02;
    utterance.pitch = 0.94;
    utterance.onstart = () => setOrbState("speaking");
    utterance.onend = () => setOrbState("idle");
    utterance.onerror = () => setOrbState("idle");
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoiceReplies() {
    voiceReplies = !voiceReplies;
    elements.voiceOutput.setAttribute("aria-pressed", String(voiceReplies));
    elements.voiceOutput.classList.toggle("active", voiceReplies);
    elements.voiceOutput.querySelector("span").textContent = voiceReplies ? "Voice on" : "Voice off";
    if (!voiceReplies && "speechSynthesis" in window) window.speechSynthesis.cancel();
    logActivity(voiceReplies ? "Spoken replies enabled" : "Spoken replies disabled", "Browser speech synthesis setting changed", "voice");
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
      setOrbState("listening");
      logActivity("Voice input started", "Microphone is listening", "voice");
      elements.mic.classList.add("listening");
      elements.mic.setAttribute("aria-label", "Stop voice input");
      showToast("Listening…");
    };
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        logActivity("Voice input captured", "Speech recognized", "voice");
        sendMessage(transcript);
      }
    };
    recognition.onerror = (event) => {
      showToast("Voice input: " + (event.error || "recognition failed") + ".", "error");
    };
    recognition.onend = () => {
      listening = false;
      if (currentOrbState === "listening") setOrbState("idle");
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
      logActivity("Model endpoint verified", "Compatible /models endpoint responded", "model");
      showToast("Model endpoint answered successfully.", "success");
    } catch (error) {
      elements.connectionPill.classList.add("disconnected");
      label.textContent = "MODEL OFFLINE";
      logActivity("Model connection failed", error.message || "Model endpoint unavailable", "error");
      showToast(error.message || "Model connection failed.", "error");
    } finally {
      elements.testModel.classList.remove("spinning");
    }
  }

  async function loadConfig() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const config = await response.json();
      if (elements.workspacePath) {
        elements.workspacePath.textContent = config.workspace || "Workspace unavailable";
        elements.workspacePath.title = config.workspace || "";
      }
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


  const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function readLocalJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      return parsed && typeof parsed === "object" ? parsed : fallback;
    } catch (_) { return fallback; }
  }

  function saveKitchenState() {
    try { localStorage.setItem("jarvis-kitchen-v1", JSON.stringify(kitchenState)); }
    catch (_) { showToast("Browser storage is full; kitchen changes may not persist.", "error"); }
  }

  function setOrbState(state) {
    currentOrbState = state || "idle";
    window.dispatchEvent(new CustomEvent("jarvis:state", { detail: { state: currentOrbState } }));
  }

  function logActivity(title, detail, kind) {
    activityEvents.unshift({
      id: makeId(), title: String(title || "Activity"),
      detail: String(detail || ""), kind: String(kind || "system"),
      time: new Date().toISOString(),
    });
    activityEvents = activityEvents.slice(0, 50);
    try { localStorage.setItem("jarvis-activity-v1", JSON.stringify(activityEvents)); } catch (_) {}
    if (currentUtilityView === "activity" || (currentUtilityView === "system" && activeSystemTab === "activity")) renderActivityPanel();
  }

  function openUtility(view) {
    if (view === "system" && currentUtilityView !== "system") activeSystemTab = "status";
    currentUtilityView = view;
    elements.utilityPanel.classList.remove("hidden");
    closeSidebar();
    renderUtility();
    logActivity("Panel opened", ({kitchen:"Kitchen",system:"System Console",models:"Model manager",memory:"Memory & archive",activity:"Activity feed",coding:"Coding agent",history:"Memory & archive"})[view] || view, "panel");
    if (view === "models") refreshModelList(false);
    if (view === "memory") refreshMemoryPanel();
    if (view === "coding") refreshCodingPanel();
    const close = document.getElementById("utilityCloseBtn");
    if (close) close.focus({ preventScroll: true });
  }

  function closeUtility() {
    elements.utilityPanel.classList.add("hidden");
    currentUtilityView = null;
  }

  function renderUtility() {
    const config = {
      kitchen: ["KITCHEN / HOME", "Kitchen"],
      system: ["SYSTEM / CONSOLE", "System Console"],
      models: ["SYSTEM / MODELS", "Model manager"],
      memory: ["PERSONAL / STORAGE", "Memory & archive"],
      activity: ["SYSTEM / TELEMETRY", "Live activity feed"],
      coding: ["WORKSPACE / DEVELOPER TOOLS", "Coding agent"],
      history: ["PERSONAL / STORAGE", "Memory & archive"],
    };
    const selected = config[currentUtilityView] || ["JARVIS / SYSTEM", "Utility panel"];
    elements.utilityEyebrow.textContent = selected[0];
    elements.utilityTitle.textContent = selected[1];
    if (currentUtilityView === "kitchen") renderKitchenPanel();
    else if (currentUtilityView === "system") renderSystemConsole();
    else if (currentUtilityView === "models") renderModelPanel(latestModelList || {});
    else if (currentUtilityView === "memory") {
      elements.utilityContent.innerHTML = '<div class="utility-loading">Loading saved memories…</div>';
    } else if (currentUtilityView === "activity") renderActivityPanel();
    else if (currentUtilityView === "history") renderHistoryPanel();
    else if (currentUtilityView === "coding") {
      elements.utilityContent.innerHTML = '<div class="utility-loading">Checking workspace…</div>';
    }
  }


  function renderKitchenModuleTabs(active) {
    return '<nav class="utility-module-tabs" aria-label="Kitchen sections">' +
      '<button type="button" data-module-tab="kitchen" class="' + (active === "kitchen" ? "active" : "") + '" aria-pressed="' + (active === "kitchen") + '">Kitchen</button>' +
      '<button type="button" data-module-tab="recipes" class="' + (active === "recipes" ? "active" : "") + '" aria-pressed="' + (active === "recipes") + '">Recipe Saver</button></nav>';
  }

  function renderMemoryNotesTabs(active) {
    return '<nav class="utility-module-tabs" aria-label="Memory and archive sections">' +
      '<button type="button" data-module-tab="memory" class="' + (active === "memory" ? "active" : "") + '" aria-pressed="' + (active === "memory") + '">AI memory</button>' +
      '<button type="button" data-module-tab="notes" class="' + (active === "notes" ? "active" : "") + '" aria-pressed="' + (active === "notes") + '">Quick notes</button>' +
      '<button type="button" data-module-tab="history" class="' + (active === "history" ? "active" : "") + '" aria-pressed="' + (active === "history") + '">Chat history</button></nav>';
  }

  function renderSystemTabs(active) {
    return '<nav class="utility-module-tabs" aria-label="System console sections">' +
      '<button type="button" data-system-tab="status" class="' + (active === "status" ? "active" : "") + '" aria-pressed="' + (active === "status") + '">Status</button>' +
      '<button type="button" data-system-tab="models" class="' + (active === "models" ? "active" : "") + '" aria-pressed="' + (active === "models") + '">Models</button>' +
      '<button type="button" data-system-tab="activity" class="' + (active === "activity" ? "active" : "") + '" aria-pressed="' + (active === "activity") + '">Activity feed</button></nav>';
  }

  function renderSystemConsole() {
    if (activeSystemTab === "models") {
      renderModelPanel(latestModelList || {});
      refreshModelList(false);
      return;
    }
    if (activeSystemTab === "activity") {
      renderActivityPanel();
      return;
    }
    elements.utilityContent.innerHTML = renderSystemTabs("status") +
      '<p class="utility-intro">System health, model settings, and recent activity live here now. Use the tabs above to switch sections.</p>' +
      '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">STATUS</span><div><h3>JARVIS diagnostics</h3><p>Ask the assistant for a live system check, or open Models to change the active model.</p></div></div>' +
      '<div class="utility-button-row"><button class="utility-primary" type="button" data-prompt="Check my system status and summarize the basics.">Ask JARVIS for diagnostics</button>' +
      '<button class="utility-secondary" type="button" data-system-tab="models">Configure model</button></div></section>';
  }

  function renderKitchenPanel() {
    kitchenState.groceries = Array.isArray(kitchenState.groceries) ? kitchenState.groceries : [];
    kitchenState.pantry = Array.isArray(kitchenState.pantry) ? kitchenState.pantry : [];
    kitchenState.meals = kitchenState.meals && typeof kitchenState.meals === "object" ? kitchenState.meals : {};
    kitchenState.timers = Array.isArray(kitchenState.timers) ? kitchenState.timers : [];
    const groceryRows = kitchenState.groceries.map((item) =>
      '<div class="kitchen-list-row' + (item.done ? ' item-done' : '') + '">' +
        '<label class="kitchen-check"><input type="checkbox" data-action="toggle-grocery" data-id="' + escapeHtml(item.id) + '"' + (item.done ? ' checked' : '') + '><span></span></label>' +
        '<span class="kitchen-item-name">' + escapeHtml(item.text) + '</span>' +
        '<button class="mini-icon-button" type="button" data-utility-action="remove-grocery" data-id="' + escapeHtml(item.id) + '" aria-label="Remove item">×</button></div>'
    ).join("");
    const pantryRows = kitchenState.pantry.map((item) =>
      '<div class="kitchen-list-row"><span class="pantry-bullet">›</span><span class="kitchen-item-name">' + escapeHtml(item.text) + '</span>' +
      '<button class="mini-icon-button" type="button" data-utility-action="remove-pantry" data-id="' + escapeHtml(item.id) + '" aria-label="Remove item">×</button></div>'
    ).join("");
    const mealFields = weekdays.map((day) =>
      '<label class="meal-day"><span>' + day.slice(0, 3).toUpperCase() + '</span><input type="text" maxlength="180" data-meal-day="' + day + '" value="' + escapeHtml(kitchenState.meals[day] || "") + '" placeholder="Plan a meal…"></label>'
    ).join("");
    const timerRows = kitchenState.timers.slice().reverse().map((timer) =>
      '<div class="timer-row"><div class="timer-row-copy"><strong>' + escapeHtml(timer.label) + '</strong><span class="timer-remaining" data-timer-id="' + escapeHtml(timer.id) + '" data-timer-ends="' + Number(timer.endsAt || 0) + '">' + (timer.finished ? "FINISHED" : formatDuration(Math.max(0, Number(timer.endsAt || 0) - Date.now()))) + '</span></div>' +
      '<button class="mini-icon-button" type="button" data-utility-action="remove-timer" data-id="' + escapeHtml(timer.id) + '" aria-label="Remove timer">×</button></div>'
    ).join("");
    elements.utilityContent.innerHTML = renderKitchenModuleTabs("kitchen") +
      '<div class="kitchen-topline"><p>Keep the everyday stuff organized here. Your grocery list, pantry, meal plan, and timers stay in this browser.</p><span class="local-chip">LOCAL ONLY</span></div>' +
      '<div class="kitchen-grid">' +
        '<section class="utility-card kitchen-card"><div class="utility-card-heading"><span class="utility-index">01</span><div><h3>Grocery list</h3><p>' + kitchenState.groceries.filter((item) => !item.done).length + ' items to pick up</p></div></div>' +
          '<form class="inline-add-form" data-form="grocery-add"><input name="item" maxlength="180" required placeholder="Add milk, eggs, rice…" aria-label="Grocery item"><button type="submit">Add</button></form>' +
          '<div class="kitchen-list">' + (groceryRows || '<div class="empty-state">Nothing on the list yet.</div>') + '</div>' +
          '<button type="button" class="text-action" data-utility-action="clear-bought">Clear checked items</button></section>' +
        '<section class="utility-card kitchen-card"><div class="utility-card-heading"><span class="utility-index">02</span><div><h3>Pantry</h3><p>' + kitchenState.pantry.length + ' saved ingredients</p></div></div>' +
          '<form class="inline-add-form" data-form="pantry-add"><input name="item" maxlength="180" required placeholder="Add ingredients you have…" aria-label="Pantry ingredient"><button type="submit">Add</button></form>' +
          '<div class="kitchen-list">' + (pantryRows || '<div class="empty-state">Add ingredients to help with meal ideas.</div>') + '</div>' +
          '<button type="button" class="text-action" data-utility-action="meal-ideas">Suggest a meal from my pantry ↗</button></section>' +
        '<section class="utility-card meal-plan-card"><div class="utility-card-heading"><span class="utility-index">03</span><div><h3>Weekly meal plan</h3><p>Quick notes for each day</p></div></div>' +
          '<div class="meal-plan-grid">' + mealFields + '</div>' +
          '<button type="button" class="utility-primary" data-utility-action="meal-plan">Ask JARVIS to build a meal plan</button></section>' +
        '<section class="utility-card timer-card"><div class="utility-card-heading"><span class="utility-index">04</span><div><h3>Kitchen timers</h3><p>Countdowns run while this tab is open</p></div></div>' +
          '<form class="timer-form" data-form="timer-add"><label>Timer name<input name="label" maxlength="70" placeholder="Pasta / oven…" required></label><label>Minutes<input name="minutes" type="number" min="1" max="720" value="10" required></label><button type="submit">Start timer</button></form>' +
          '<div class="timer-list">' + (timerRows || '<div class="empty-state">No active timers.</div>') + '</div></section>' +
      '</div>';
  }

  function formatDuration(milliseconds) {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return (hours ? String(hours).padStart(2, "0") + ":" : "") +
      String(minutes).padStart(2, "0") + ":" + String(remainder).padStart(2, "0");
  }

  function tickKitchenTimers() {
    const now = Date.now();
    let changed = false;
    kitchenState.timers = Array.isArray(kitchenState.timers) ? kitchenState.timers : [];
    kitchenState.timers.forEach((timer) => {
      if (!timer.finished && Number(timer.endsAt) <= now) {
        timer.finished = true;
        changed = true;
        logActivity("Kitchen timer finished", timer.label, "kitchen");
        showToast(timer.label + " timer finished.", "success");
        if (voiceReplies) speak(timer.label + " timer finished.");
      }
    });
    if (changed) saveKitchenState();
    document.querySelectorAll(".timer-remaining[data-timer-ends]").forEach((node) => {
      const timer = kitchenState.timers.find((item) => item.id === node.dataset.timerId);
      if (!timer) return;
      node.textContent = timer.finished ? "FINISHED" : formatDuration(Number(node.dataset.timerEnds) - now);
      node.classList.toggle("timer-finished", !!timer.finished);
    });
  }

  function renderActivityPanel() {
    const rows = activityEvents.map((item) => {
      let time = "";
      try { time = new Date(item.time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }); } catch (_) {}
      return '<article class="activity-row"><span class="activity-mark activity-' + escapeHtml(item.kind || "system") + '"></span><div class="activity-row-body"><strong>' +
        escapeHtml(item.title) + '</strong><span>' + escapeHtml(item.detail) + '</span></div><time>' + escapeHtml(time) + '</time></article>';
    }).join("");
    elements.utilityContent.innerHTML = (currentUtilityView === "system" ? renderSystemTabs("activity") : "") +
      '<div class="utility-toolbar"><p>Recent actions from this browser session history. Messages are logged as events, not copied into this feed.</p>' +
      '<button class="text-action" type="button" data-utility-action="clear-activity">Clear feed</button></div>' +
      '<section class="utility-card activity-card"><div class="activity-feed">' + (rows || '<div class="empty-state">Activity will appear here as you use JARVIS.</div>') + '</div></section>';
  }

  function renderModelPanel(data, endpointOverride, modelOverride) {
    data = data || {};
    const endpoint = endpointOverride || data.base_url || "http://127.0.0.1:11434";
    const models = Array.isArray(data.models) ? data.models : [];
    const requestedModel = modelOverride || data.model || "";
    const model = (requestedModel === "local-model" && models.length && !models.some((item) => item.id === requestedModel))
      ? models[0].id : (requestedModel || models[0]?.id || "local-model");
    const options = models.map((item) => '<option value="' + escapeHtml(item.id) + '"></option>').join("");
    const status = data.available
      ? (models.length
        ? '<div class="inline-status status-good">' + escapeHtml(data.api_mode === "ollama" ? "Ollama connected" : "OpenAI-compatible server connected") + ' · ' + models.length + ' model' + (models.length === 1 ? "" : "s") + ' found' + (data.auto_detected ? ' · auto-detected' : '') + '</div>'
        : '<div class="inline-status status-warn">Server is reachable, but it returned no models. Check <code>ollama list</code> in a terminal, then refresh.</div>')
      : '<div class="inline-status status-warn">' + escapeHtml(data.error || "Refresh models to check the endpoint. You can still enter a model ID manually.") + '</div>';
    elements.utilityContent.innerHTML = (currentUtilityView === "system" ? renderSystemTabs("models") : "") +
      '<p class="utility-intro">Choose a model from Ollama’s native API or another OpenAI-compatible server. Your endpoint and model choice are saved locally.</p>' +
      '<section class="utility-card model-manager-card"><form class="utility-form" data-form="model-manager">' +
        '<label>API endpoint<input id="modelBaseUrl" name="base_url" type="url" maxlength="500" required value="' + escapeHtml(endpoint) + '" placeholder="http://127.0.0.1:11434"></label>' +
        '<label>Model ID<input id="modelId" name="model" list="modelOptions" maxlength="250" required value="' + escapeHtml(model) + '" placeholder="Select or type a model ID"><datalist id="modelOptions">' + options + '</datalist></label>' +
        status +
        '<div class="utility-button-row"><button class="utility-secondary" type="button" data-utility-action="model-refresh">Refresh model list</button><button class="utility-primary" type="submit">Apply model</button></div>' +
      '</form></section>' +
      '<div class="utility-note"><strong>Ollama native:</strong> use <code>http://127.0.0.1:11434</code> with no <code>/v1</code>. JARVIS uses <code>/api/tags</code> to list models and <code>/api/chat</code> to chat. For llama.cpp or LM Studio, use their documented endpoint, usually ending in <code>/v1</code>. API keys stay on the server.</div>';
  }

  function isModelPanelActive() {
    return currentUtilityView === "models" || (currentUtilityView === "system" && activeSystemTab === "models");
  }

  async function refreshModelList(showNotice) {
    if (!isModelPanelActive()) return;
    const endpointInput = document.getElementById("modelBaseUrl");
    const modelInput = document.getElementById("modelId");
    const endpoint = endpointInput?.value.trim() || latestModelList?.base_url || "";
    const model = modelInput?.value.trim() || latestModelList?.model || "";
    try {
      const query = endpoint ? "?base_url=" + encodeURIComponent(endpoint) : "";
      const response = await fetch("/api/models" + query, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load model list.");
      latestModelList = data;
      const discoveredEndpoint = data.available && data.auto_detected ? data.base_url : endpoint;
      renderModelPanel(data, discoveredEndpoint, model);
      if (showNotice) {
        const message = data.available
          ? (data.auto_detected ? data.message : (data.models.length ? "Model list refreshed." : "Connected, but no models were returned."))
          : (data.error || "Model server is offline.");
        showToast(message, data.available && data.models.length ? "success" : "error");
      }
    } catch (error) {
      latestModelList = { available: false, models: [], model, base_url: endpoint, error: error.message };
      renderModelPanel(latestModelList, endpoint, model);
      if (showNotice) showToast(error.message, "error");
    }
  }

  async function applyModelForm(form) {
    const values = new FormData(form);
    const endpoint = String(values.get("base_url") || "").trim();
    const model = String(values.get("model") || "").trim();
    try {
      const result = await apiPost("/api/model", { base_url: endpoint, model });
      latestModelList = { ...(latestModelList || {}), model: result.model, base_url: result.base_url };
      renderModelPanel(latestModelList, result.base_url, result.model);
      logActivity("Model configuration changed", result.model, "model");
      showToast("JARVIS will now use " + result.model + ".", "success");
      setOrbState("idle");
      await refreshModelList(false);
    } catch (error) {
      showToast(error.message, "error");
      setOrbState("error");
    }
  }

  async function refreshMemoryPanel() {
    try {
      const response = await fetch("/api/memory", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load saved memories.");
      if (currentUtilityView === "memory") renderMemoryPanel(data.items || [], data.limit || 100);
    } catch (error) {
      if (currentUtilityView === "memory") {
        elements.utilityContent.innerHTML = '<div class="utility-card"><p class="inline-status status-warn">' + escapeHtml(error.message) + '</p></div>';
      }
    }
  }

  function renderMemoryPanel(items, limit) {
    const rows = items.map((item) =>
      '<article class="memory-row"><div><p>' + escapeHtml(item.fact) + '</p><time>' + escapeHtml(item.created_at || "Saved") + '</time></div>' +
      '<button class="mini-icon-button" type="button" data-utility-action="memory-delete" data-id="' + escapeHtml(item.id) + '" aria-label="Delete memory">×</button></article>'
    ).join("");
    elements.utilityContent.innerHTML = renderMemoryNotesTabs("memory") +
      '<p class="utility-intro">Saved notes are stored in a private local data file and included as context in future chats. JARVIS must ask before saving a note from conversation.</p>' +
      '<section class="utility-card"><form class="memory-add-form" data-form="memory-add"><label for="memoryFact">Remember a preference or useful fact</label><textarea id="memoryFact" name="fact" maxlength="2000" rows="3" required placeholder="Example: I prefer concise answers, and my main project is Backrooms: Lost Signal."></textarea><div class="utility-button-row"><span class="utility-muted">' + items.length + ' / ' + limit + ' memories</span><button class="utility-primary" type="submit">Save memory</button></div></form></section>' +
      '<section class="utility-card memory-list-card"><div class="utility-card-heading"><span class="utility-index">01</span><div><h3>Saved memories</h3><p>Review or delete anything here</p></div></div><div class="memory-list">' + (rows || '<div class="empty-state">No memories saved yet.</div>') + '</div></section>';
  }

  async function refreshCodingPanel() {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const config = await response.json();
      if (currentUtilityView !== "coding") return;
      elements.utilityContent.innerHTML =
        '<p class="utility-intro">JARVIS can inspect files in one dedicated workspace, edit code, and run allowlisted developer commands. Every file write and terminal command requires your approval first.</p>' +
        '<section class="utility-card workspace-card"><div class="utility-card-heading"><span class="utility-index">WORKSPACE</span><div><h3>Authorized project folder</h3><p>Tools stay inside this directory.</p></div></div><code class="workspace-path">' + escapeHtml(config.workspace || "Workspace unavailable") + '</code></section>' +
        '<div class="coding-action-grid">' +
          '<button class="coding-action-card" type="button" data-prompt="Inspect my workspace and give me a concise map of the project structure and entry points."><strong>Inspect project</strong><span>Map files and main components</span><b>↗</b></button>' +
          '<button class="coding-action-card" type="button" data-prompt="Review my current project for likely bugs, security problems, and easy performance wins. Inspect files first and report findings before editing anything."><strong>Find bugs</strong><span>Audit before making changes</span><b>↗</b></button>' +
          '<button class="coding-action-card" type="button" data-prompt="Help me implement the next feature in my project. First inspect the existing architecture and propose a small, testable plan; wait for my approval before editing files."><strong>Build a feature</strong><span>Plan and test changes</span><b>↗</b></button>' +
          '<button class="coding-action-card" type="button" data-prompt="Run the existing project tests and explain any failures. Inspect the project test setup first; ask for approval before running commands."><strong>Run tests</strong><span>Check the project health</span><b>↗</b></button>' +
        '</div>';
    } catch (error) {
      if (currentUtilityView === "coding") elements.utilityContent.innerHTML = '<div class="utility-card"><p class="inline-status status-warn">' + escapeHtml(error.message) + '</p></div>';
    }
  }

  function addKitchenItem(bucket, text) {
    const value = String(text || "").trim();
    if (!value) return;
    if (!Array.isArray(kitchenState[bucket])) kitchenState[bucket] = [];
    kitchenState[bucket].push({ id: makeId(), text: value.slice(0, 180), done: false });
    saveKitchenState();
    logActivity(bucket === "groceries" ? "Grocery item added" : "Pantry ingredient added", value.slice(0, 80), "kitchen");
    renderKitchenPanel();
  }

  function handleUtilitySubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    if (form.dataset.form === "grocery-add") addKitchenItem("groceries", data.get("item"));
    if (form.dataset.form === "pantry-add") addKitchenItem("pantry", data.get("item"));
    if (form.dataset.form === "timer-add") {
      const minutes = Number(data.get("minutes"));
      const label = String(data.get("label") || "").trim();
      if (!label || !Number.isFinite(minutes) || minutes < 1 || minutes > 720) {
        showToast("Choose a timer name and 1–720 minutes.", "error");
        return;
      }
      kitchenState.timers.push({ id: makeId(), label: label.slice(0, 70), endsAt: Date.now() + minutes * 60_000, finished: false });
      saveKitchenState();
      logActivity("Kitchen timer started", label + " · " + minutes + " min", "kitchen");
      showToast(label + " timer started.", "success");
      renderKitchenPanel();
      return;
    }
    if (form.dataset.form === "memory-add") {
      apiPost("/api/memory", { fact: String(data.get("fact") || "") })
        .then((result) => {
          logActivity(result.duplicate ? "Memory already existed" : "Persistent memory saved", result.item?.fact || "", "memory");
          showToast(result.duplicate ? "That memory already exists." : "Memory saved for future chats.", "success");
          refreshMemoryPanel();
        })
        .catch((error) => showToast(error.message, "error"));
    }
    if (form.dataset.form === "model-manager") applyModelForm(form);
  }

  function handleUtilityClick(event) {
    const systemTab = event.target.closest("[data-system-tab]");
    if (systemTab && elements.utilityContent.contains(systemTab)) {
      activeSystemTab = systemTab.dataset.systemTab;
      renderUtility();
      return;
    }
    const moduleTab = event.target.closest("[data-module-tab]");
    if (moduleTab && elements.utilityContent.contains(moduleTab)) {
      const destination = moduleTab.dataset.moduleTab;
      if (destination === "kitchen" || destination === "memory" || destination === "history") openUtility(destination);
      else if (destination === "recipes" && openRecipeSaverPanel) openRecipeSaverPanel();
      else if (destination === "notes" && openQuickNotesPanel) openQuickNotesPanel();
      return;
    }
    const promptButton = event.target.closest("[data-prompt]");
    if (promptButton && elements.utilityContent.contains(promptButton)) {
      const prompt = promptButton.dataset.prompt;
      closeUtility();
      sendMessage(prompt);
      return;
    }
    const button = event.target.closest("[data-utility-action]");
    if (!button) return;
    const action = button.dataset.utilityAction;
    const id = button.dataset.id;
    if (action === "history-open") {
      const conversation = chatHistory.find((item) => item.id === id);
      if (conversation) restoreArchivedConversation(conversation, true);
      return;
    }
    if (action === "history-delete") { deleteChatHistoryEntry(id); return; }
    if (action === "history-export") { downloadChatHistory(); return; }
    if (action === "history-clear") { clearChatHistory(); return; }
    if (action === "model-refresh") { refreshModelList(true); return; }
    if (action === "meal-ideas" || action === "meal-plan") {
      const pantry = kitchenState.pantry.map((item) => item.text);
      const groceries = kitchenState.groceries.filter((item) => !item.done).map((item) => item.text);
      const meals = weekdays.map((day) => kitchenState.meals[day] ? day + ": " + kitchenState.meals[day] : "").filter(Boolean);
      const prompt = action === "meal-ideas"
        ? "Suggest two practical meals using ingredients I already have. Pantry: " + (pantry.join(", ") || "not entered") + ". Grocery list: " + (groceries.join(", ") || "empty") + ". Ask about allergies or dietary restrictions if needed; do not assume any."
        : "Build a practical 7-day meal plan with simple recipes and a grouped grocery list. My pantry: " + (pantry.join(", ") || "not entered") + ". Current grocery list: " + (groceries.join(", ") || "empty") + ". Existing meal notes: " + (meals.join("; ") || "none") + ". Ask about allergies or dietary restrictions if needed; do not assume any.";
      closeUtility();
      sendMessage(prompt);
      return;
    }
    if (action === "clear-activity") {
      activityEvents = [];
      try { localStorage.setItem("jarvis-activity-v1", "[]"); } catch (_) {}
      renderActivityPanel();
      showToast("Activity feed cleared.");
      return;
    }
    if (action === "remove-grocery" || action === "remove-pantry" || action === "clear-bought" ||
        action === "remove-timer" || action === "memory-delete") {
      if (action === "memory-delete") {
        apiPost("/api/memory/delete", { id })
          .then(() => { logActivity("Persistent memory deleted", "", "memory"); showToast("Memory deleted."); refreshMemoryPanel(); })
          .catch((error) => showToast(error.message, "error"));
        return;
      }
      if (action === "remove-grocery") kitchenState.groceries = kitchenState.groceries.filter((item) => item.id !== id);
      if (action === "remove-pantry") kitchenState.pantry = kitchenState.pantry.filter((item) => item.id !== id);
      if (action === "clear-bought") kitchenState.groceries = kitchenState.groceries.filter((item) => !item.done);
      if (action === "remove-timer") kitchenState.timers = kitchenState.timers.filter((item) => item.id !== id);
      saveKitchenState();
      logActivity("Kitchen list updated", action.replaceAll("-", " "), "kitchen");
      renderKitchenPanel();
    }
  }

  function handleUtilityChange(event) {
    const checkbox = event.target.closest('input[data-action="toggle-grocery"]');
    if (checkbox) {
      const item = kitchenState.groceries.find((row) => row.id === checkbox.dataset.id);
      if (item) {
        item.done = checkbox.checked;
        saveKitchenState();
        logActivity(item.done ? "Grocery item checked off" : "Grocery item unchecked", item.text, "kitchen");
        renderKitchenPanel();
      }
    }
  }

  function handleUtilityInput(event) {
    const historySearch = event.target.closest("[data-history-search]");
    if (historySearch) {
      historySearchText = historySearch.value;
      renderHistoryRows();
      return;
    }
    const input = event.target.closest("[data-meal-day]");
    if (!input) return;
    kitchenState.meals[input.dataset.mealDay] = input.value;
    saveKitchenState();
  }

  elements.utilityContent.addEventListener("click", handleUtilityClick);
  elements.utilityContent.addEventListener("submit", handleUtilitySubmit);
  elements.utilityContent.addEventListener("change", handleUtilityChange);
  elements.utilityContent.addEventListener("input", handleUtilityInput);
  window.setInterval(tickKitchenTimers, 1000);


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
  $("#systemBtn").addEventListener("click", () => openUtility("system"));
  $("#kitchenBtn").addEventListener("click", () => openUtility("kitchen"));
  $("#memoryBtn").addEventListener("click", () => openUtility("memory"));
  $("#codingBtn").addEventListener("click", () => openUtility("coding"));
  $("#utilityCloseBtn").addEventListener("click", closeUtility);
  $("#utilityPanel").addEventListener("click", (event) => {
    if (event.target === elements.utilityPanel) closeUtility();
  });

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
    if (event.key === "Escape") { closeSidebar(); closeUtility(); }
  });


  // Quick Notes: browser-local notes, deliberately separate from AI memory.
  function initQuickNotes() {
    let notes = [];
    let editingId = null;
    let searchText = "";
    try {
      const stored = JSON.parse(localStorage.getItem("jarvis-notes-v1") || "[]");
      if (Array.isArray(stored)) notes = stored.filter((n) => n && typeof n.id === "string").slice(0, 100);
    } catch (_) {}

    const memoryButton = document.getElementById("memoryBtn");
    if (memoryButton && memoryButton.lastElementChild) memoryButton.lastElementChild.textContent = "Memory & archive";



    function persist() {
      try {
        localStorage.setItem("jarvis-notes-v1", JSON.stringify(notes));
        return true;
      } catch (_) {
        showToast("Browser storage is full or unavailable.", "error");
        return false;
      }
    }
    function updatedLabel(note) {
      try {
        return new Date(Number(note.updatedAt || note.createdAt || Date.now())).toLocaleString([], {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        });
      } catch (_) { return "Saved"; }
    }
    function renderList() {
      const list = document.getElementById("quickNotesList");
      if (!list) return;
      const counter = document.getElementById("quickNotesCount");
      if (counter) counter.textContent = notes.length + " / 100";
      const query = searchText.trim().toLocaleLowerCase();
      const filtered = notes.slice().sort((a, b) =>
        Number(!!b.pinned) - Number(!!a.pinned) ||
        Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
      ).filter((note) => !query || (String(note.title || "") + "\n" + String(note.content || "")).toLocaleLowerCase().includes(query));
      if (!notes.length) {
        list.innerHTML = '<div class="empty-state">No notes yet. Save a reminder, idea, or reusable snippet here.</div>';
        return;
      }
      if (!filtered.length) {
        list.innerHTML = '<div class="empty-state">No notes match that search.</div>';
        return;
      }
      list.innerHTML = filtered.map((note) =>
        '<article class="quick-note' + (note.pinned ? ' pinned' : '') + '">' +
          '<div class="quick-note-heading"><div><h3>' + escapeHtml(note.title || "Untitled note") + '</h3><time>' + escapeHtml(updatedLabel(note)) + '</time></div>' +
          (note.pinned ? '<span class="quick-note-pin">PINNED</span>' : '') + '</div>' +
          '<p class="quick-note-body">' + escapeHtml(note.content || "") + '</p>' +
          '<div class="quick-note-actions">' +
            '<button class="utility-secondary" type="button" data-quick-note-action="edit" data-id="' + escapeHtml(note.id) + '">Edit</button>' +
            '<button class="utility-secondary" type="button" data-quick-note-action="pin" data-id="' + escapeHtml(note.id) + '">' + (note.pinned ? "Unpin" : "Pin") + '</button>' +
            '<button class="utility-secondary" type="button" data-quick-note-action="copy" data-id="' + escapeHtml(note.id) + '">Copy</button>' +
            '<button class="quick-note-delete" type="button" data-quick-note-action="delete" data-id="' + escapeHtml(note.id) + '">Delete</button>' +
          '</div></article>'
      ).join("");
    }
    function renderPanel() {
      const edit = notes.find((note) => note.id === editingId) || null;
      elements.utilityEyebrow.textContent = "PERSONAL / NOTES";
      elements.utilityTitle.textContent = "Quick notes";
      elements.utilityContent.innerHTML = renderMemoryNotesTabs("notes") +
        '<p class="utility-intro">Keep ideas, reminders, and reusable snippets here. Notes stay in this browser and are not automatically sent to the AI model.</p>' +
        '<div class="quick-notes-layout">' +
          '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">01</span><div><h3>' + (edit ? "Edit note" : "New note") + '</h3><p>Up to 100 notes · 5,000 characters each</p></div></div>' +
            '<form class="quick-notes-form" id="quickNotesForm" data-form="quick-notes">' +
              '<label for="quickNoteTitle">Title <span class="utility-muted">optional</span><input id="quickNoteTitle" name="title" maxlength="120" value="' + escapeHtml(edit?.title || "") + '" placeholder="A useful title"></label>' +
              '<label for="quickNoteContent">Note<textarea id="quickNoteContent" name="content" maxlength="5000" rows="9" required placeholder="Write a reminder, idea, or snippet…">' + escapeHtml(edit?.content || "") + '</textarea></label>' +
              '<div class="quick-notes-actions"><button class="utility-primary" type="submit">' + (edit ? "Save changes" : "Save note") + '</button>' +
              (edit ? '<button class="utility-secondary" type="button" data-quick-note-action="cancel">Cancel</button>' : '') + '</div>' +
            '</form></section>' +
          '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">02</span><div><h3>Your notes</h3><p>Pinned notes stay at the top</p></div></div>' +
            '<div class="quick-notes-search"><label for="quickNoteSearch">Search notes<input id="quickNoteSearch" type="search" value="' + escapeHtml(searchText) + '" placeholder="Search title or text…" data-quick-note-search></label><span class="utility-muted" id="quickNotesCount">' + notes.length + ' / 100</span></div>' +
            '<div class="quick-notes-list" id="quickNotesList"></div>' +
            '<div class="quick-notes-export"><button class="utility-secondary" type="button" data-quick-note-action="export">Export JSON</button></div>' +
          '</section></div>';
      renderList();
    }
    function openPanel() {
      currentUtilityView = "quick-notes";
      elements.utilityPanel.classList.remove("hidden");
      closeSidebar();
      renderPanel();
      logActivity("Panel opened", "Quick notes", "panel");
      document.getElementById("utilityCloseBtn")?.focus({ preventScroll: true });
    }
    async function copyNote(note) {
      const value = (note.title ? note.title + "\n\n" : "") + note.content;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(value);
        } else {
          const area = document.createElement("textarea");
          area.value = value;
          area.style.position = "fixed";
          area.style.opacity = "0";
          document.body.appendChild(area);
          area.select();
          const copied = document.execCommand("copy");
          area.remove();
          if (!copied) throw new Error("copy failed");
        }
        showToast("Note copied.", "success");
      } catch (_) {
        showToast("Could not copy this note in this browser context.", "error");
      }
    }

    openQuickNotesPanel = openPanel;
    elements.utilityContent.addEventListener("input", (event) => {
      const search = event.target.closest("[data-quick-note-search]");
      if (!search) return;
      searchText = search.value;
      renderList();
    });
    elements.utilityContent.addEventListener("submit", (event) => {
      const form = event.target.closest("#quickNotesForm");
      if (!form) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const data = new FormData(form);
      const content = String(data.get("content") || "").trim().slice(0, 5000);
      const typedTitle = String(data.get("title") || "").trim().slice(0, 120);
      if (!content) {
        showToast("Write something in the note first.", "error");
        return;
      }
      const now = Date.now();
      const title = typedTitle || content.split("\n")[0].slice(0, 120) || "Untitled note";
      if (editingId) {
        const note = notes.find((item) => item.id === editingId);
        if (!note) {
          editingId = null;
          renderPanel();
          showToast("That note could not be found.", "error");
          return;
        }
        note.title = title;
        note.content = content;
        note.updatedAt = now;
      } else {
        if (notes.length >= 100) {
          showToast("Notes are full (100). Delete an old note first.", "error");
          return;
        }
        notes.unshift({ id: makeId(), title, content, pinned: false, createdAt: now, updatedAt: now });
      }
      editingId = null;
      if (persist()) {
        logActivity("Quick note saved", title.slice(0, 80), "notes");
        showToast("Note saved.", "success");
      }
      renderPanel();
    }, true);
    elements.utilityContent.addEventListener("click", (event) => {
      const button = event.target.closest("[data-quick-note-action]");
      if (!button) return;
      const action = button.dataset.quickNoteAction;
      const id = button.dataset.id;
      if (action === "cancel") {
        editingId = null;
        renderPanel();
        return;
      }
      if (action === "edit") {
        editingId = id;
        renderPanel();
        document.getElementById("quickNoteTitle")?.focus({ preventScroll: true });
        return;
      }
      if (action === "pin") {
        const note = notes.find((item) => item.id === id);
        if (!note) return;
        note.pinned = !note.pinned;
        note.updatedAt = Date.now();
        if (persist()) logActivity(note.pinned ? "Quick note pinned" : "Quick note unpinned", note.title, "notes");
        renderPanel();
        return;
      }
      if (action === "copy") {
        const note = notes.find((item) => item.id === id);
        if (note) copyNote(note);
        return;
      }
      if (action === "delete") {
        const note = notes.find((item) => item.id === id);
        if (!note || !window.confirm("Delete this note? This cannot be undone.")) return;
        notes = notes.filter((item) => item.id !== id);
        if (editingId === id) editingId = null;
        if (persist()) logActivity("Quick note deleted", note.title, "notes");
        renderPanel();
        return;
      }
      if (action === "export") {
        const payload = notes.map((note) => ({
          title: note.title, content: note.content, pinned: !!note.pinned,
          createdAt: note.createdAt || null, updatedAt: note.updatedAt || null
        }));
        const blob = new Blob([JSON.stringify(payload, null, 2) + "\n"], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "jarvis-notes-" + new Date().toISOString().slice(0, 10) + ".json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        showToast("Notes exported as JSON.", "success");
      }
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== "jarvis-notes-v1") return;
      try {
        const value = JSON.parse(event.newValue || "[]");
        notes = Array.isArray(value) ? value.filter((n) => n && typeof n.id === "string").slice(0, 100) : [];
        if (currentUtilityView === "quick-notes") renderPanel();
      } catch (_) {}
    });
  }

  initQuickNotes();


  function initRecipeSaver() {
    const STORE = "jarvis-recipes-v1";
    const MAX = 500;
    let recipes = [];
    let editingId = "";
    let searchText = "";
    let activeCategory = "";
    let favoritesOnly = false;

    function splitLines(value) {
      const array = Array.isArray(value) ? value : String(value || "").split("\n");
      return array.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 250);
    }
    function normalize(row, keepId) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const name = String(row.name || row.title || "").trim().slice(0, 160);
      if (!name) return null;
      const minute = (value) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1440 ? Math.round(Number(value)) : 0;
      const now = Date.now();
      return {
        id: keepId && typeof row.id === "string" && row.id ? row.id : makeId(),
        name,
        category: String(row.category || "Other").trim().slice(0, 80) || "Other",
        description: String(row.description || "").trim().slice(0, 800),
        ingredients: splitLines(row.ingredients),
        instructions: splitLines(row.instructions || row.method),
        servings: String(row.servings || "").trim().slice(0, 40),
        prepMinutes: minute(row.prepMinutes || row.prep_time),
        cookMinutes: minute(row.cookMinutes || row.cook_time),
        notes: String(row.notes || "").trim().slice(0, 2000),
        source: String(row.source || "").trim().slice(0, 500),
        favorite: Boolean(row.favorite || row.is_favorite),
        createdAt: Number(row.createdAt) || now,
        updatedAt: Number(row.updatedAt) || now
      };
    }
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || "[]");
      if (Array.isArray(saved)) recipes = saved.map((row) => normalize(row, true)).filter(Boolean).slice(0, MAX);
    } catch (_) {}



    function save() {
      try { localStorage.setItem(STORE, JSON.stringify(recipes)); return true; }
      catch (_) { showToast("Browser storage is full or unavailable.", "error"); return false; }
    }
    function renderList() {
      const list = document.getElementById("recipeList");
      if (!list) return;
      const count = document.getElementById("recipeCount");
      if (count) count.textContent = recipes.length + " / " + MAX;
      const select = document.getElementById("recipeCategoryFilter");
      if (select) {
        select.innerHTML = '<option value="">All categories</option>' +
          [...new Set(recipes.map((r) => r.category))].sort().map((c) => '<option value="' + escapeHtml(c) + '">' + escapeHtml(c) + '</option>').join("");
        select.value = activeCategory;
      }
      const q = searchText.trim().toLocaleLowerCase();
      const items = recipes.slice().sort((a,b) => Number(b.favorite)-Number(a.favorite) || b.updatedAt-a.updatedAt)
        .filter((r) => (!activeCategory || r.category === activeCategory) && (!favoritesOnly || r.favorite) &&
          (!q || [r.name,r.category,r.description,r.ingredients.join(" "),r.instructions.join(" "),r.notes,r.source].join(" ").toLocaleLowerCase().includes(q)));
      if (!recipes.length) { list.innerHTML = '<div class="empty-state">No recipes saved yet. Add one here or import the recipes.json file from your older JARVIS Kitchen app.</div>'; return; }
      if (!items.length) { list.innerHTML = '<div class="empty-state">No recipes match those filters.</div>'; return; }
      list.innerHTML = items.map((r) => {
        const meta = [r.servings ? "Serves " + r.servings : "",r.prepMinutes ? "Prep " + r.prepMinutes + " min" : "",r.cookMinutes ? "Cook " + r.cookMinutes + " min" : ""].filter(Boolean);
        const ingredients = r.ingredients.length ? "<ul>" + r.ingredients.map((x) => "<li>" + escapeHtml(x) + "</li>").join("") + "</ul>" : '<p class="empty-state">No ingredients saved.</p>';
        const steps = r.instructions.length ? "<ol>" + r.instructions.map((x) => "<li>" + escapeHtml(x) + "</li>").join("") + "</ol>" : '<p class="empty-state">No instructions saved.</p>';
        let source = "";
        if (r.source) {
          let url = "";
          try { const parsed = new URL(r.source); if (parsed.protocol === "http:" || parsed.protocol === "https:") url = parsed.href; } catch (_) {}
          source = url ? '<a class="recipe-source" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">Open recipe source ↗</a>' : '<span class="recipe-source">Source: ' + escapeHtml(r.source) + "</span>";
        }
        return '<article class="recipe-card' + (r.favorite ? " is-favorite" : "") + '"><div class="recipe-card-header"><div><h3>' + escapeHtml(r.name) + '</h3><span class="recipe-category">' + escapeHtml(r.category) + '</span></div><button class="utility-secondary" type="button" data-recipe-action="favorite" data-id="' + escapeHtml(r.id) + '">' + (r.favorite ? "★" : "☆") + '</button></div>' +
          (r.description ? '<p class="recipe-description">' + escapeHtml(r.description) + "</p>" : "") +
          (meta.length ? '<div class="recipe-meta">' + meta.map((x) => "<span>" + escapeHtml(x) + "</span>").join("") + "</div>" : "") +
          '<details><summary>Ingredients & method (' + r.ingredients.length + " ingredients · " + r.instructions.length + ' steps)</summary><h4>Ingredients</h4>' + ingredients + "<h4>Instructions</h4>" + steps +
          (r.notes ? '<h4>Personal notes</h4><p class="recipe-notes">' + escapeHtml(r.notes) + "</p>" : "") + source + "</details>" +
          '<div class="recipe-card-actions"><button class="utility-secondary" type="button" data-recipe-action="edit" data-id="' + escapeHtml(r.id) + '">Edit</button><button class="utility-secondary" type="button" data-recipe-action="copy" data-id="' + escapeHtml(r.id) + '">Copy text</button><button class="recipe-delete" type="button" data-recipe-action="delete" data-id="' + escapeHtml(r.id) + '">Delete</button></div></article>';
      }).join("");
    }
    function renderPanel() {
      const r = recipes.find((item) => item.id === editingId) || null;
      elements.utilityEyebrow.textContent = "KITCHEN / RECIPE DATABASE";
      elements.utilityTitle.textContent = "Recipe Saver";
      elements.utilityContent.innerHTML = renderKitchenModuleTabs("recipes") +
        '<p class="utility-intro">Save recipes, search by ingredients, and keep a portable JSON backup. Import supports the older JARVIS Kitchen recipes.json format. Recipes stay in this browser, separate from AI memory.</p>' +
        '<div class="recipe-grid"><section class="utility-card"><div class="utility-card-heading"><span class="utility-index">01</span><div><h3>' + (r ? "Edit recipe" : "Add a recipe") + '</h3><p>Put each ingredient and step on its own line</p></div></div>' +
        '<form class="recipe-form" id="recipeForm"><label for="recipeName">Recipe name<input id="recipeName" name="name" maxlength="160" required value="' + escapeHtml(r?.name || "") + '" placeholder="Family pasta bake"></label>' +
        '<div class="recipe-pair"><label for="recipeCategory">Category<input id="recipeCategory" name="category" maxlength="80" value="' + escapeHtml(r?.category || "Other") + '" placeholder="Dinner, dessert…"></label><label for="recipeServings">Servings<input id="recipeServings" name="servings" maxlength="40" value="' + escapeHtml(r?.servings || "") + '" placeholder="4 people"></label></div>' +
        '<label for="recipeDescription">Description (optional)<input id="recipeDescription" name="description" maxlength="800" value="' + escapeHtml(r?.description || "") + '" placeholder="Short description"></label>' +
        '<div class="recipe-pair"><label for="recipePrep">Prep minutes<input id="recipePrep" name="prep" type="number" min="0" max="1440" value="' + (r?.prepMinutes || 0) + '"></label><label for="recipeCook">Cook minutes<input id="recipeCook" name="cook" type="number" min="0" max="1440" value="' + (r?.cookMinutes || 0) + '"></label></div>' +
        '<label for="recipeIngredients">Ingredients<textarea id="recipeIngredients" name="ingredients" rows="6" maxlength="12000" required placeholder="2 cups flour&#10;1 tsp salt">' + escapeHtml((r?.ingredients || []).join("\n")) + '</textarea></label>' +
        '<label for="recipeInstructions">Instructions<textarea id="recipeInstructions" name="instructions" rows="7" maxlength="16000" required placeholder="Preheat the oven…&#10;Mix the ingredients…">' + escapeHtml((r?.instructions || []).join("\n")) + '</textarea></label>' +
        '<label for="recipeNotes">Personal notes (optional)<textarea id="recipeNotes" name="notes" rows="3" maxlength="2000" placeholder="Substitutions or tips">' + escapeHtml(r?.notes || "") + '</textarea></label>' +
        '<label for="recipeSource">Source URL or credit (optional)<input id="recipeSource" name="source" maxlength="500" value="' + escapeHtml(r?.source || "") + '" placeholder="https://… or cookbook/page"></label>' +
        '<div class="recipe-buttons"><button class="utility-primary" type="submit">' + (r ? "Save changes" : "Save recipe") + '</button>' + (r ? '<button class="utility-secondary" type="button" data-recipe-action="cancel">Cancel</button>' : "") + '</div></form></section>' +
        '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">02</span><div><h3>Recipe library</h3><p>Search names, ingredients, or instructions</p></div></div>' +
        '<div class="recipe-filter"><label for="recipeSearch">Search<input id="recipeSearch" type="search" data-recipe-search value="' + escapeHtml(searchText) + '" placeholder="Find a dish or ingredient…"></label><label for="recipeCategoryFilter">Category<select id="recipeCategoryFilter" data-recipe-category><option value="">All categories</option></select></label></div>' +
        '<label class="recipe-fav-filter"><input type="checkbox" data-recipe-favorites' + (favoritesOnly ? " checked" : "") + '> Favorites only <span class="utility-muted" id="recipeCount">' + recipes.length + " / " + MAX + '</span></label><div class="recipe-list" id="recipeList"></div>' +
        '<div class="recipe-import-export"><input type="file" id="recipeImportFile" accept=".json,application/json" hidden><button class="utility-secondary" type="button" data-recipe-action="import">Import JSON</button><button class="utility-secondary" type="button" data-recipe-action="export">Export JSON</button></div></section></div>';
      renderList();
    }
    function openPanel() {
      editingId = "";
      currentUtilityView = "recipes";
      elements.utilityPanel.classList.remove("hidden");
      closeSidebar();
      renderPanel();
      logActivity("Panel opened", "Recipe Saver", "kitchen");
      document.getElementById("utilityCloseBtn")?.focus({ preventScroll: true });
    }
    function recipeText(r) {
      return [r.name,"Category: " + r.category,r.servings ? "Servings: " + r.servings : "",r.prepMinutes ? "Prep: " + r.prepMinutes + " min" : "",r.cookMinutes ? "Cook: " + r.cookMinutes + " min" : "",r.description,"","INGREDIENTS",...r.ingredients.map((x) => "- " + x),"","INSTRUCTIONS",...r.instructions.map((x,i) => (i+1) + ". " + x),r.notes ? "\nNOTES\n" + r.notes : "",r.source ? "\nSOURCE\n" + r.source : ""].filter((x) => x !== null && x !== undefined).join("\n");
    }
    async function copyRecipe(r) {
      try {
        const value = recipeText(r);
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
        else {
          const area = document.createElement("textarea"); area.value = value; area.style.position = "fixed"; area.style.opacity = "0";
          document.body.appendChild(area); area.select(); const copied = document.execCommand("copy"); area.remove(); if (!copied) throw new Error("copy failed");
        }
        showToast("Recipe copied.", "success");
      } catch (_) { showToast("Could not copy this recipe in this browser.", "error"); }
    }
    async function importFile(file) {
      if (!file) return;
      if (file.size > 5000000) { showToast("JSON file is over 5 MB.", "error"); return; }
      try {
        const payload = JSON.parse(await file.text());
        const source = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.recipes) ? payload.recipes : null);
        if (!source) throw new Error("Use a recipe array or an object containing a recipes array.");
        const incoming = source.slice(0,2000).map((x) => normalize(x,false)).filter(Boolean);
        if (!incoming.length) { showToast("No valid recipes found; each recipe needs a name.", "error"); return; }
        if (!window.confirm("Merge " + incoming.length + " recipes into your library? Existing recipes stay untouched and duplicates are skipped.")) return;
        const before = recipes;
        const keys = new Set(recipes.map((r) => (r.name + "|" + r.ingredients.join("|")).toLocaleLowerCase()));
        const added = []; let skipped = 0;
        for (const r of incoming) {
          const key = (r.name + "|" + r.ingredients.join("|")).toLocaleLowerCase();
          if (keys.has(key)) { skipped++; continue; }
          if (before.length + added.length >= MAX) break;
          keys.add(key); added.push(r);
        }
        recipes = [...added,...before];
        if (!save()) { recipes = before; renderPanel(); return; }
        editingId = "";
        logActivity("Recipes imported", added.length + " added; " + skipped + " duplicates skipped", "kitchen");
        showToast("Imported " + added.length + " recipes" + (skipped ? "; skipped " + skipped + " duplicates." : "."), "success");
        renderPanel();
      } catch (error) { showToast("Could not import JSON: " + (error instanceof SyntaxError ? "invalid JSON file." : error.message), "error"); }
    }

    openRecipeSaverPanel = openPanel;
    elements.utilityContent.addEventListener("submit", (event) => {
      const form = event.target.closest("#recipeForm");
      if (!form) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      const ingredients = splitLines(String(data.get("ingredients") || ""));
      const instructions = splitLines(String(data.get("instructions") || ""));
      if (!name || !ingredients.length || !instructions.length) { showToast("Enter a recipe name, at least one ingredient, and one instruction.", "error"); return; }
      const existing = editingId ? recipes.find((r) => r.id === editingId) : null;
      const now = Date.now();
      const minute = (v) => Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1440 ? Math.round(Number(v)) : 0;
      const updated = {
        id: existing?.id || makeId(), name: name.slice(0,160), category: String(data.get("category") || "").trim().slice(0,80) || "Other",
        description: String(data.get("description") || "").trim().slice(0,800), ingredients, instructions,
        servings: String(data.get("servings") || "").trim().slice(0,40), prepMinutes: minute(data.get("prep")), cookMinutes: minute(data.get("cook")),
        notes: String(data.get("notes") || "").trim().slice(0,2000), source: String(data.get("source") || "").trim().slice(0,500),
        favorite: Boolean(existing?.favorite), createdAt: existing?.createdAt || now, updatedAt: now
      };
      const before = recipes;
      if (existing) recipes = recipes.map((r) => r.id === existing.id ? updated : r);
      else {
        if (recipes.length >= MAX) { showToast("Recipe library is full (500). Export a backup or delete a recipe.", "error"); return; }
        recipes = [updated,...recipes];
      }
      if (!save()) { recipes = before; return; }
      editingId = "";
      logActivity(existing ? "Recipe updated" : "Recipe saved", name.slice(0,80), "kitchen");
      showToast(existing ? "Recipe updated." : "Recipe saved.", "success");
      renderPanel();
    }, true);
    elements.utilityContent.addEventListener("input", (event) => {
      const el = event.target.closest("[data-recipe-search]");
      if (el) { searchText = el.value; renderList(); }
    });
    elements.utilityContent.addEventListener("change", (event) => {
      const cat = event.target.closest("[data-recipe-category]");
      const fav = event.target.closest("[data-recipe-favorites]");
      const file = event.target.closest("#recipeImportFile");
      if (cat) { activeCategory = cat.value; renderList(); }
      if (fav) { favoritesOnly = fav.checked; renderList(); }
      if (file?.files?.[0]) { const selectedFile = file.files[0]; file.value = ""; importFile(selectedFile); }
    });
    elements.utilityContent.addEventListener("click", (event) => {
      const b = event.target.closest("[data-recipe-action]");
      if (!b) return;
      const action = b.dataset.recipeAction;
      const id = b.dataset.id;
      if (action === "import") { document.getElementById("recipeImportFile")?.click(); return; }
      if (action === "export") {
        const blob = new Blob([JSON.stringify({recipes:recipes},null,2) + "\n"],{type:"application/json"});
        const url = URL.createObjectURL(blob); const link = document.createElement("a");
        link.href=url; link.download="jarvis-recipes-"+new Date().toISOString().slice(0,10)+".json";
        document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url),0);
        showToast("Recipe backup exported.","success"); return;
      }
      if (action === "cancel") { editingId=""; renderPanel(); return; }
      const r = recipes.find((x) => x.id === id);
      if (!r) return;
      if (action === "edit") { editingId=id; renderPanel(); document.getElementById("recipeName")?.focus({preventScroll:true}); return; }
      if (action === "copy") { copyRecipe(r); return; }
      if (action === "delete" && !window.confirm('Delete "' + r.name + '" from the recipe library?')) return;
      const before = recipes;
      if (action === "favorite") recipes = recipes.map((x) => x.id === id ? {...x,favorite:!x.favorite,updatedAt:Date.now()} : x);
      if (action === "delete") { recipes = recipes.filter((x) => x.id !== id); if (editingId === id) editingId=""; }
      if (save()) {
        if (action === "favorite") logActivity(recipes.find((x) => x.id === id).favorite ? "Recipe favorited" : "Recipe unfavorited",r.name,"kitchen");
        if (action === "delete") { logActivity("Recipe deleted",r.name,"kitchen"); showToast("Recipe deleted.","success"); }
      } else recipes=before;
      renderPanel();
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== STORE) return;
      try {
        const parsed = JSON.parse(event.newValue || "[]");
        recipes = Array.isArray(parsed) ? parsed.map((r) => normalize(r,true)).filter(Boolean).slice(0,MAX) : [];
        if (currentUtilityView === "recipes") renderPanel();
      } catch (_) {}
    });
  }
  initRecipeSaver();
  restoreCurrentConversation();


  loadConfig();
  logActivity("JARVIS ready", "Local assistant interface initialized", "system");
  elements.input.focus({ preventScroll: true });
})();