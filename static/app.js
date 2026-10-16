(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const elements = {
    chatLog: $("#chatLog"), welcome: $("#welcomePanel"), input: $("#messageInput"),
    send: $("#sendBtn"), mic: $("#micBtn"), wakeWord: $("#wakeWordBtn"), typing: $("#typingRow"),
    connectionPill: $("#connectionPill"), connectionLabel: $("#connectionLabel"),
    workspacePath: $("#workspacePath"), testModel: $("#testModelBtn"),
    voiceOutput: $("#voiceOutputBtn"), toastRegion: $("#toastRegion"),
    sidebar: $("#sidebar"), mobileScrim: $("#mobileScrim"),
    utilityPanel: $("#utilityPanel"), utilityContent: $("#utilityContent"),
    utilityTitle: $("#utilityTitle"), utilityEyebrow: $("#utilityEyebrow"),
  };

  const makeId = () => (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replaceAll("-", "")
    : String(Date.now()) + Math.random().toString(16).slice(2);
  let sessionId = makeId();
  const MAX_CHAT_HISTORY = 25;
  const MAX_ARCHIVED_MESSAGES = 40;
  const MAX_ARCHIVED_MESSAGE_CHARS = 4000;
  let chatHistory = [];
  let activeTranscript = [];
  let historySearchText = "";
  let sessionRestorePromise = null;
  let busy = false;
  let listening = false;
  let startingVoiceCapture = false;
  let voiceReplies = false;
  let handsFreeMode = false;
  let voiceActivityTimer = null;
  let handsFreeRestartTimer = null;
  let voiceAudioContext = null;
  let voiceAudioAnalyser = null;
  let voiceHasDetectedSpeech = false;
  let lastVoiceActivityAt = 0;
  let browserRecognitionPending = false;
  let savedMemoryItems = [];
  let routineItems = [];
  let recognition = null;
  let mediaRecorder = null;
  let microphoneStream = null;
  let recordedChunks = [];
  let recordingStartedAt = 0;
  let recordingStopTimer = null;
  let wakeWordEnabled = false;
  let wakeWordStatus = null;
  let wakeEventCursor = 0;
  let wakeEventsReady = false;
  let wakePollBusy = false;
  let wakeEventPollTimer = null;
  let wakeStatusPollTimer = null;
  let currentUtilityView = null;
  let activeSystemTab = "status";
  let openQuickNotesPanel = null;
  let openRecipeSaverPanel = null;
  let activityEvents = [];
  let kitchenState = { groceries: [], pantry: [], meals: {}, timers: [] };
  let latestModelList = null;
  let currentOrbState = "idle";
  let dashboardDataReady = false;
  let dashboardSyncPromise = Promise.resolve();
  let dashboardWrites = Promise.resolve();
  // Read these legacy browser keys only for the one-time migration.
  const legacyDashboardStorageKeys = {
    recipes: "jarvis-recipes-v1", notes: "jarvis-notes-v1", kitchen: "jarvis-kitchen-v1",
    chat_history: "jarvis-chat-history-v1", activity: "jarvis-activity-v1",
  };

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
      await refreshDashboardDataFromServer();
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

  async function sendMessage(textOverride, options = {}) {
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
      await dashboardSyncPromise;
      await flushDashboardWrites();
      const result = await apiPost("/api/chat", { session_id: sessionId, message: text });
      await refreshDashboardDataFromServer();
      if (result.session_id) {
        sessionId = result.session_id;
      }
      renderMessage("assistant", result.reply || "I’m here.");
      logActivity("Assistant replied", result.pending_action ? "Waiting for action approval" : "Response received", "chat");
      await speak(result.reply || "");
      if (result.pending_action) {
        logActivity("Approval requested", result.pending_action.title || "Review a proposed action", "approval");
        renderPendingAction(result.pending_action);
      }
    } catch (error) {
      renderMessage("assistant", "I couldn’t complete that request.\n\n" + error.message +
        "\n\nJARVIS is local-first and does not silently switch to a cloud model. Your saved memories, routines, and system diagnostics remain available; check that your local model server is running and that the model endpoint is correct.");
      logActivity("Request failed", error.message, "error");
      setOrbState("error");
      window.setTimeout(() => { if (currentOrbState === "error") setOrbState("idle"); }, 1800);
      showToast(error.message, "error");
    } finally {
      setBusy(false);
      if (options.fromWakeWord && wakeWordEnabled) {
        try {
          await apiPost("/api/voice/rearm", {});
          await refreshWakeWordStatus(false);
        } catch (error) {
          showToast("Wake word could not re-arm: " + error.message, "error");
        }
      }
    }
  }


  function browserDashboardBuckets() {
    const fallback = {
      recipes: [], notes: [], chat_history: [], activity: [],
      kitchen: { groceries: [], pantry: [], meals: {}, timers: [] },
    };
    const result = {};
    Object.entries(legacyDashboardStorageKeys).forEach(([bucket, key]) => {
      try { result[bucket] = JSON.parse(localStorage.getItem(key) || "null") ?? fallback[bucket]; }
      catch (_) { result[bucket] = fallback[bucket]; }
    });
    return result;
  }

  function normalizeChatHistory(stored) {
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

  function applyDashboardData(data) {
    if (!data || typeof data !== "object") return;
    chatHistory = normalizeChatHistory(data.chat_history);
    activityEvents = Array.isArray(data.activity) ? data.activity : [];
    kitchenState = data.kitchen && typeof data.kitchen === "object"
      ? data.kitchen : { groceries: [], pantry: [], meals: {}, timers: [] };
    window.dispatchEvent(new CustomEvent("jarvis:data-updated", { detail: data }));
    if (currentUtilityView === "history") renderHistoryPanel();
    if (currentUtilityView === "system" && activeSystemTab === "activity") renderActivityPanel();
    if (currentUtilityView === "kitchen") renderKitchenPanel();
  }

  async function bootstrapDashboardData() {
    try {
      const result = await apiPost("/api/app-data/bootstrap", { buckets: browserDashboardBuckets() });
      if (result.ok && result.data) {
        applyDashboardData(result.data);
        dashboardDataReady = true;
        Object.values(legacyDashboardStorageKeys).forEach((key) => {
          try { localStorage.removeItem(key); } catch (_) {}
        });
      }
    } catch (error) {
      console.warn("JARVIS local-file storage is unavailable:", error.message);
      showToast("Couldn't load local JARVIS files. Existing browser data was left untouched.", "error");
    }
  }

  function persistDashboardBucket(bucket, value) {
    if (!legacyDashboardStorageKeys[bucket]) return dashboardWrites;
    let snapshot;
    try { snapshot = JSON.parse(JSON.stringify(value)); } catch (_) { return dashboardWrites; }
    dashboardWrites = dashboardWrites.catch(() => {}).then(async () => {
      await dashboardSyncPromise;
      if (!dashboardDataReady) return;
      try { await apiPost("/api/app-data/sync", { bucket, value: snapshot }); }
      catch (error) {
        console.warn("Could not save JARVIS " + bucket + " to local files:", error.message);
        showToast("Couldn't save " + bucket.replaceAll("_", " ") + " to local files.", "error");
      }
    });
    return dashboardWrites;
  }

  async function flushDashboardWrites() {
    await dashboardWrites;
  }

  async function refreshDashboardDataFromServer() {
    try {
      await flushDashboardWrites();
      const response = await fetch("/api/app-data", { cache: "no-store" });
      const result = await response.json();
      if (response.ok && result.ok && result.data) applyDashboardData(result.data);
    } catch (error) {
      console.warn("Could not refresh JARVIS local files:", error.message);
    }
  }

  function resizeInput() {
    elements.input.style.height = "auto";
    elements.input.style.height = Math.min(elements.input.scrollHeight, 170) + "px";
  }

  function saveChatHistoryStorage() {
    persistDashboardBucket("chat_history", chatHistory);
    return true;
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
    const conversation = chatHistory.find((item) => item.id === sessionId) || chatHistory[0];
    if (conversation) restoreArchivedConversation(conversation, false);
  }

  function newChat() {
    if (busy || sessionRestorePromise) return;
    sessionId = makeId();
    activeTranscript = [];
    elements.chatLog.replaceChildren();
    elements.welcome.classList.remove("hidden");
    elements.input.value = "";
    resizeInput();
    elements.input.focus();
    closeSidebar();
  }

  function speak(text) {
    return new Promise((resolve) => {
      if (!voiceReplies || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined" || !text) {
        setOrbState("idle");
        resolve();
        return;
      }
      const synthesis = window.speechSynthesis;
      synthesis.cancel();
      const fence = String.fromCharCode(96).repeat(3);
      const clean = String(text).replace(new RegExp(fence + "[\\s\\S]*?" + fence, "g"), " code block omitted ")
        .replace(/[*_#>]/g, "").replace(/\s+/g, " ").trim().slice(0, 3_500);
      if (!clean) { resolve(); return; }
      const utterance = new SpeechSynthesisUtterance(clean);
      const voices = synthesis.getVoices();
      utterance.voice = voices.find((voice) => /^en-CA$/i.test(voice.lang)) ||
        voices.find((voice) => /^en-(US|GB)/i.test(voice.lang)) || null;
      utterance.lang = utterance.voice?.lang || "en-CA";
      utterance.rate = 1.02;
      utterance.pitch = 0.94;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        setOrbState("idle");
        resolve();
      };
      utterance.onstart = () => setOrbState("speaking");
      utterance.onend = finish;
      utterance.onerror = finish;
      synthesis.speak(utterance);
      // Resolve on cancellation too, so wake-word re-arming cannot get stuck.
      window.setTimeout(finish, 120_000);
    });
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

  function updateMicButton(isListening, label) {
    listening = isListening;
    elements.mic.classList.toggle("listening", isListening);
    elements.mic.setAttribute("aria-label", label || (isListening ? "Stop voice input" : "Use voice input"));
    elements.mic.title = label || (isListening ? "Stop voice input" : "Voice input");
  }

  function updateHandsFreeButton(capturing) {
    listening = Boolean(capturing);
    elements.mic.classList.toggle("listening", handsFreeMode);
    const label = handsFreeMode ? "Hands-free on — click mic to interrupt or stop" : (listening ? "Stop voice input" : "Use voice input");
    elements.mic.setAttribute("aria-label", label);
    elements.mic.title = label;
  }

  function clearVoiceActivityWatch() {
    if (voiceActivityTimer !== null) window.clearInterval(voiceActivityTimer);
    voiceActivityTimer = null;
    voiceAudioAnalyser = null;
    if (voiceAudioContext) {
      const context = voiceAudioContext;
      voiceAudioContext = null;
      context.close().catch(() => {});
    }
  }

  function scheduleHandsFreeCapture(delay = 650) {
    if (handsFreeRestartTimer !== null) window.clearTimeout(handsFreeRestartTimer);
    handsFreeRestartTimer = window.setTimeout(() => {
      handsFreeRestartTimer = null;
      if (!handsFreeMode || document.hidden) return;
      if (busy || listening) {
        scheduleHandsFreeCapture(400);
        return;
      }
      startRecordedVoiceInput({ handsFree: true });
    }, delay);
  }

  function startBrowserHandsFreeRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      handsFreeMode = false;
      updateMicButton(false);
      showToast("Hands-free voice needs microphone recording support or browser speech recognition.", "error");
      return;
    }
    if (!handsFreeMode || busy || recognition) return;
    try {
      const instance = new Recognition();
      recognition = instance;
      instance.lang = "en-CA";
      instance.continuous = true;
      instance.interimResults = false;
      instance.maxAlternatives = 1;
      instance.onstart = () => {
        updateHandsFreeButton(true);
        setOrbState("listening");
      };
      instance.onresult = async (event) => {
        if (browserRecognitionPending) return;
        const transcript = [];
        for (let index = event.resultIndex; index < event.results.length; index++) {
          const row = event.results[index];
          if (row?.isFinal && row[0]?.transcript) transcript.push(row[0].transcript.trim());
        }
        const text = transcript.join(" ").trim();
        if (!text) return;
        browserRecognitionPending = true;
        try {
          instance.stop();
          await sendMessage(text, { fromHandsFree: true });
        } finally {
          browserRecognitionPending = false;
          if (handsFreeMode) scheduleHandsFreeCapture(450);
        }
      };
      instance.onerror = (event) => {
        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          handsFreeMode = false;
          showToast("Microphone permission was denied. Allow microphone access and try again.", "error");
        } else if (event.error !== "no-speech" && event.error !== "aborted") {
          showToast("Hands-free speech recognition failed (" + (event.error || "unknown error") + ").", "error");
        }
      };
      instance.onend = () => {
        if (recognition === instance) recognition = null;
        updateHandsFreeButton(false);
        if (handsFreeMode && !busy && !browserRecognitionPending) scheduleHandsFreeCapture(400);
        else if (!handsFreeMode) updateMicButton(false);
      };
      instance.start();
    } catch (error) {
      recognition = null;
      handsFreeMode = false;
      updateMicButton(false);
      showToast("Could not start hands-free recognition: " + error.message, "error");
    }
  }

  async function startRecordedVoiceInput(options = {}) {
    const handsFreeCapture = Boolean(options.handsFree || handsFreeMode);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      if (handsFreeCapture) {
        startBrowserHandsFreeRecognition();
        return;
      }
      showToast("This browser can't record microphone audio. Check microphone permissions and browser support.", "error");
      return;
    }
    if (startingVoiceCapture || mediaRecorder || document.hidden) return;
    startingVoiceCapture = true;
    try {
      microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      if (handsFreeCapture && !handsFreeMode) {
        microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStream = null;
        return;
      }
      recordedChunks = [];
      recordingStartedAt = Date.now();
      voiceHasDetectedSpeech = false;
      lastVoiceActivityAt = recordingStartedAt;
      const formats = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
      const mimeType = formats.find((type) => MediaRecorder.isTypeSupported?.(type));
      mediaRecorder = mimeType ? new MediaRecorder(microphoneStream, { mimeType }) : new MediaRecorder(microphoneStream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data?.size) recordedChunks.push(event.data);
      };
      mediaRecorder.onerror = () => {
        showToast("Microphone recording failed. Check your input device and permissions.", "error");
        stopRecordedVoiceInput();
      };
      mediaRecorder.onstop = async () => {
        const blobType = mediaRecorder?.mimeType || mimeType || "audio/webm";
        const blob = new Blob(recordedChunks, { type: blobType });
        recordedChunks = [];
        if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStream = null;
        mediaRecorder = null;
        clearVoiceActivityWatch();
        if (recordingStopTimer) window.clearTimeout(recordingStopTimer);
        recordingStopTimer = null;
        if (handsFreeMode) updateHandsFreeButton(false);
        else updateMicButton(false);
        if (currentOrbState === "listening") setOrbState("idle");
        if (Date.now() - recordingStartedAt < 600 || blob.size < 2_000) {
          if (handsFreeMode) {
            showToast("I didn't catch that. Try speaking a little closer to the microphone.", "error");
            scheduleHandsFreeCapture(700);
          } else {
            showToast("I didn't get enough audio. Hold the mic for a little longer.", "error");
          }
          return;
        }
        if (blob.size > 720_000) {
          showToast("That recording is too large. Try a shorter command.", "error");
          if (handsFreeMode) scheduleHandsFreeCapture(700);
          return;
        }
        try {
          setOrbState("thinking");
          showToast(handsFreeMode ? "Transcribing your turn locally…" : "Transcribing locally…");
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(new Error("Could not read recorded audio."));
            reader.readAsDataURL(blob);
          });
          const audioBase64 = dataUrl.split(",", 2)[1];
          const result = await apiPost("/api/voice/transcribe", { audio_base64: audioBase64, mime_type: blob.type });
          if (!result.text?.trim()) {
            showToast("I couldn't make out the audio. Try speaking closer to the mic.", "error");
            setOrbState("idle");
            if (handsFreeMode) scheduleHandsFreeCapture(700);
            return;
          }
          logActivity("Voice input captured", "Transcribed locally", "voice");
          await sendMessage(result.text, { fromHandsFree: handsFreeCapture });
        } catch (error) {
          showToast("Voice input failed: " + error.message, "error");
          setOrbState("idle");
          // Stop instead of repeatedly capturing audio if local transcription is unavailable.
          if (handsFreeMode) {
            handsFreeMode = false;
            if (handsFreeRestartTimer !== null) window.clearTimeout(handsFreeRestartTimer);
            handsFreeRestartTimer = null;
            updateMicButton(false);
          }
        } finally {
          if (handsFreeMode) scheduleHandsFreeCapture(650);
        }
      };
      mediaRecorder.start();
      if (handsFreeCapture) updateHandsFreeButton(true);
      else updateMicButton(true, "Stop recording");
      setOrbState("listening");
      logActivity("Voice input started", handsFreeCapture ? "Hands-free local voice conversation is listening" : "Recording a short local voice command", "voice");
      if (handsFreeCapture) {
        try {
          const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
          if (AudioContextCtor) {
            voiceAudioContext = new AudioContextCtor();
            const source = voiceAudioContext.createMediaStreamSource(microphoneStream);
            voiceAudioAnalyser = voiceAudioContext.createAnalyser();
            voiceAudioAnalyser.fftSize = 512;
            source.connect(voiceAudioAnalyser);
            const sample = new Uint8Array(voiceAudioAnalyser.fftSize);
            voiceActivityTimer = window.setInterval(() => {
              if (!handsFreeMode || !voiceAudioAnalyser || !mediaRecorder || mediaRecorder.state !== "recording") return;
              voiceAudioAnalyser.getByteTimeDomainData(sample);
              let squareSum = 0;
              for (let i = 0; i < sample.length; i++) {
                const value = (sample[i] - 128) / 128;
                squareSum += value * value;
              }
              const rms = Math.sqrt(squareSum / sample.length);
              const now = Date.now();
              if (rms > 0.04) {
                voiceHasDetectedSpeech = true;
                lastVoiceActivityAt = now;
              } else if (voiceHasDetectedSpeech && now - lastVoiceActivityAt >= 1_250) {
                stopRecordedVoiceInput();
              }
            }, 90);
          } else {
            showToast("Automatic silence detection is unavailable; each turn will end at the 12-second limit.");
          }
        } catch (_) {
          clearVoiceActivityWatch();
          showToast("Silence detection could not start; each turn will end at the 12-second limit.");
        }
        showToast("Hands-free is on. Speak naturally; pause when you're done. Click the mic to stop.");
      } else {
        showToast("Recording… tap the mic to finish (12-second limit).");
      }
      recordingStopTimer = window.setTimeout(stopRecordedVoiceInput, 12_000);
    } catch (error) {
      clearVoiceActivityWatch();
      if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
      mediaRecorder = null;
      if (handsFreeMode) {
        showToast("Hands-free microphone error: " + error.message, "error");
        handsFreeMode = false;
      } else {
        showToast("Couldn't access the microphone: " + error.message, "error");
      }
      updateMicButton(false);
    } finally {
      startingVoiceCapture = false;
    }
  }

  function stopRecordedVoiceInput() {
    if (recordingStopTimer) window.clearTimeout(recordingStopTimer);
    recordingStopTimer = null;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
      microphoneStream = null;
      updateMicButton(false);
    }
  }

  function toggleMicrophone() {
    if (handsFreeMode && window.speechSynthesis?.speaking) {
      // A deliberate mic click interrupts the spoken reply and returns to capture.
      window.speechSynthesis.cancel();
      scheduleHandsFreeCapture(180);
      showToast("Response interrupted. Listening…");
      return;
    }
    if (handsFreeMode) {
      handsFreeMode = false;
      if (handsFreeRestartTimer !== null) window.clearTimeout(handsFreeRestartTimer);
      handsFreeRestartTimer = null;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
      if (recognition) {
        const active = recognition;
        recognition = null;
        active.onend = null;
        try { active.stop(); } catch (_) {}
      }
      if (mediaRecorder && mediaRecorder.state !== "inactive") stopRecordedVoiceInput();
      else {
        clearVoiceActivityWatch();
        if (microphoneStream) microphoneStream.getTracks().forEach((track) => track.stop());
        microphoneStream = null;
        updateMicButton(false);
      }
      showToast("Hands-free conversation stopped.");
      return;
    }
    if (listening) {
      if (recognition) recognition.stop();
      else stopRecordedVoiceInput();
      return;
    }
    handsFreeMode = true;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (!voiceReplies) {
      voiceReplies = true;
      elements.voiceOutput.setAttribute("aria-pressed", "true");
      elements.voiceOutput.classList.add("active");
      elements.voiceOutput.querySelector("span").textContent = "Voice on";
    }
    if (wakeWordEnabled) {
      apiPost("/api/voice/wakeword", { enabled: false })
        .then((result) => { wakeWordStatus = result.status; wakeWordEnabled = false; renderWakeWordButton(); syncWakeWordPolling(); })
        .catch(() => {});
    }
    if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") {
      startRecordedVoiceInput({ handsFree: true });
    } else {
      startBrowserHandsFreeRecognition();
    }
  }

  function stopWakeWordPolling() {
    if (wakeEventPollTimer !== null) {
      window.clearInterval(wakeEventPollTimer);
      wakeEventPollTimer = null;
    }
    if (wakeStatusPollTimer !== null) {
      window.clearInterval(wakeStatusPollTimer);
      wakeStatusPollTimer = null;
    }
  }

  // Avoid waking the server repeatedly while wake word is off or this tab is hidden.
  function syncWakeWordPolling() {
    stopWakeWordPolling();
    if (document.hidden || !wakeWordEnabled) return;
    wakeEventPollTimer = window.setInterval(pollWakeWordEvents, 1_000);
    wakeStatusPollTimer = window.setInterval(() => refreshWakeWordStatus(false), 5_000);
  }

  function renderWakeWordButton() {
    if (!elements.wakeWord || !wakeWordStatus) return;
    wakeWordEnabled = Boolean(wakeWordStatus.enabled);
    const label = !wakeWordEnabled ? "Wake off" : wakeWordStatus.armed ? "Wake on" :
      wakeWordStatus.capturing_command ? "Hearing…" : "Wake paused";
    const span = elements.wakeWord.querySelector("span");
    if (span) span.textContent = label;
    elements.wakeWord.classList.toggle("active", wakeWordEnabled);
    elements.wakeWord.setAttribute("aria-pressed", String(wakeWordEnabled));
    elements.wakeWord.title = wakeWordStatus.error || (wakeWordEnabled
      ? (wakeWordStatus.armed ? 'Listening locally for "Hey JARVIS"' : "Wake word enabled; waiting to re-arm")
      : 'Enable local "Hey JARVIS" wake word');
  }

  async function refreshWakeWordStatus(initial = false) {
    try {
      const response = await fetch("/api/voice/status", { cache: "no-store" });
      const status = await response.json();
      if (!response.ok) throw new Error(status.error || "Voice status unavailable.");
      wakeWordStatus = status;
      if (initial) {
        wakeEventCursor = Number(status.last_event_id) || 0;
        wakeEventsReady = true;
        if (status.enabled && status.running && !status.armed && !status.capturing_command) {
          apiPost("/api/voice/rearm", {}).catch(() => {});
        }
      }
      renderWakeWordButton();
      if (initial) syncWakeWordPolling();
    } catch (error) {
      if (initial) showToast("Voice service unavailable: " + error.message, "error");
    }
  }

  async function toggleWakeWord() {
    elements.wakeWord.disabled = true;
    try {
      const result = await apiPost("/api/voice/wakeword", { enabled: !wakeWordEnabled });
      wakeWordStatus = result.status;
      wakeWordEnabled = Boolean(result.status?.enabled);
      renderWakeWordButton();
      syncWakeWordPolling();
      showToast(wakeWordEnabled
        ? 'Wake word enabled. Say "Hey JARVIS", then give your command.'
        : "Wake word disabled; the microphone is released.");
    } catch (error) {
      await refreshWakeWordStatus(false);
      syncWakeWordPolling();
      showToast(wakeWordStatus?.error || error.message, "error");
    } finally {
      elements.wakeWord.disabled = false;
    }
  }

  async function pollWakeWordEvents() {
    if (!wakeEventsReady || !wakeWordEnabled || document.hidden || wakePollBusy) return;
    wakePollBusy = true;
    try {
      const response = await fetch("/api/voice/events?after=" + encodeURIComponent(wakeEventCursor), { cache: "no-store" });
      if (!response.ok) return;
      const result = await response.json();
      for (const event of (result.events || [])) {
        wakeEventCursor = Math.max(wakeEventCursor, Number(event.id) || 0);
        if (event.type === "wake") {
          setOrbState("listening");
          showToast('Wake word detected. Listening for your command…');
        } else if (event.type === "command") {
          if (event.text?.trim()) {
            await sendMessage(event.text, { fromWakeWord: true });
          } else {
            showToast(event.error || "I didn't catch that command. Try again.", "error");
            if (wakeWordEnabled) await apiPost("/api/voice/rearm", {}).catch(() => {});
            await refreshWakeWordStatus(false);
          }
        } else if (event.type === "error") {
          showToast(event.message || "Wake word stopped unexpectedly.", "error");
          await refreshWakeWordStatus(false);
        }
      }
    } catch (_) {
      // The server is also polled for status; a brief network error is not fatal.
    } finally {
      wakePollBusy = false;
    }
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

  window.addEventListener("jarvis:data-updated", (event) => {
    if (!event.detail?.kitchen) return;
    kitchenState = event.detail.kitchen;
    if (currentUtilityView === "kitchen") renderKitchenPanel();
  });

  function saveKitchenState() {
    persistDashboardBucket("kitchen", kitchenState);
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
    persistDashboardBucket("activity", activityEvents);
    if (currentUtilityView === "activity" || (currentUtilityView === "system" && activeSystemTab === "activity")) renderActivityPanel();
  }

  function openUtility(view) {
    if (view === "system" && currentUtilityView !== "system") activeSystemTab = "status";
    currentUtilityView = view;
    elements.utilityPanel.classList.remove("hidden");
    closeSidebar();
    renderUtility();
    logActivity("Panel opened", ({kitchen:"Kitchen",system:"System Console",models:"Model manager",memory:"Memory & archive",activity:"Activity feed",coding:"Coding agent",apps:"Desktop app launcher",history:"Memory & archive"})[view] || view, "panel");
    if (view === "models") refreshModelList(false);
    if (view === "memory") refreshMemoryPanel();
    if (view === "coding") refreshCodingPanel();
    if (view === "apps") refreshDesktopAppPanel();
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
      apps: ["DESKTOP / LAUNCHER", "Desktop app launcher"],
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
    } else if (currentUtilityView === "apps") {
      elements.utilityContent.innerHTML = '<div class="utility-loading">Scanning approved desktop apps…</div>';
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
      '<button type="button" data-system-tab="routines" class="' + (active === "routines" ? "active" : "") + '" aria-pressed="' + (active === "routines") + '">Routines</button>' +
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
    if (activeSystemTab === "routines") {
      elements.utilityContent.innerHTML = renderSystemTabs("routines") + '<div class="utility-loading">Loading saved routines…</div>';
      refreshRoutineList(false);
      return;
    }
    elements.utilityContent.innerHTML = renderSystemTabs("status") +
      '<p class="utility-intro">Live local metrics, model configuration, and recent activity. These diagnostics run on this computer; JARVIS does not send them to a cloud model.</p>' +
      '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">LIVE TELEMETRY</span><div><h3>System monitor</h3><p>CPU load, RAM, disk capacity, and supported NVIDIA GPU metrics.</p></div></div>' +
      '<div class="utility-button-row"><span class="utility-muted" id="systemMetricsUpdated">Collecting metrics…</span><button class="utility-secondary" type="button" data-utility-action="metrics-refresh">Refresh metrics</button></div>' +
      '<div class="kitchen-grid" id="systemMetrics"><div class="inline-status">Collecting local system metrics…</div></div></section>' +
      '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">LOCAL-FIRST</span><div><h3>Offline-ready controls</h3><p>Memories, routines, workspace tools, and diagnostics are stored or executed locally. Chat generation needs your configured local model server; JARVIS does not silently switch to a cloud provider.</p></div></div>' +
      '<div class="utility-button-row"><button class="utility-primary" type="button" data-system-tab="models">Check model connection</button>' +
      '<button class="utility-secondary" type="button" data-prompt="Check the local model connection and system status. Report unavailable components honestly and do not use a cloud model.">Run local diagnostics</button></div></section>';
    refreshSystemMetrics();
  }

  async function refreshSystemMetrics() {
    const container = document.getElementById("systemMetrics");
    if (!container) return;
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "System metrics unavailable.");
      if (!document.contains(container) || currentUtilityView !== "system" || activeSystemTab !== "status") return;
      const memory = data.memory && typeof data.memory === "object" ? data.memory : null;
      const workspaceDisk = data.workspace_disk && typeof data.workspace_disk === "object" ? data.workspace_disk : null;
      const rootDisk = data.root_disk && typeof data.root_disk === "object" ? data.root_disk : null;
      const gpus = Array.isArray(data.gpus) ? data.gpus : [];
      const metrics = [
        ["CPU", (data.logical_cpu_threads ?? "—") + " threads", data.cpu_load_1m == null ? "Load average unavailable" : "1-minute load " + data.cpu_load_1m],
        ["Memory", memory ? memory.used_gib + " / " + memory.total_gib + " GiB" : "Usage unavailable", memory ? memory.used_percent + "% used · " + memory.available_gib + " GiB available" : "RAM telemetry unavailable on this platform"],
        ["Workspace disk", workspaceDisk ? workspaceDisk.free_gib + " GiB free" : "Unavailable", workspaceDisk ? workspaceDisk.used_percent + "% used" : "Disk telemetry unavailable"],
        ["System disk", rootDisk ? rootDisk.free_gib + " GiB free" : "Unavailable", rootDisk ? rootDisk.used_percent + "% used" : "Disk telemetry unavailable"],
        ["CPU temperature", data.cpu_temperature_c == null ? "Unavailable" : data.cpu_temperature_c + " °C", data.cpu_temperature_c == null ? "Needs supported sensors output" : "Reported by local sensors"],
        ["GPU", gpus.length ? gpus.map((gpu) => gpu.name + (gpu.utilization_percent == null ? "" : " · " + gpu.utilization_percent + "%") + (gpu.temperature_c == null ? "" : " · " + gpu.temperature_c + " °C")).join("; ") : "No NVIDIA telemetry found", gpus.length ? gpus.map((gpu) => gpu.memory_used_mib == null || gpu.memory_total_mib == null ? "VRAM unavailable" : Math.round(gpu.memory_used_mib) + " / " + Math.round(gpu.memory_total_mib) + " MiB VRAM").join("; ") : "Works best when nvidia-smi is installed"]
      ];
      container.innerHTML = metrics.map((metric) =>
        '<article class="utility-card"><div class="utility-index">' + escapeHtml(metric[0].toUpperCase()) + '</div><h3>' + escapeHtml(metric[1]) + '</h3><p>' + escapeHtml(metric[2]) + '</p></article>'
      ).join("");
      const updated = document.getElementById("systemMetricsUpdated");
      if (updated) updated.textContent = "Updated " + new Date(data.collected_at || Date.now()).toLocaleTimeString();
    } catch (error) {
      if (document.contains(container)) container.innerHTML = '<div class="inline-status status-warn">' + escapeHtml(error.message) + '</div>';
    }
  }

  async function refreshRoutineList(showNotice = false) {
    try {
      const response = await fetch("/api/routines", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load saved routines.");
      routineItems = Array.isArray(data.items) ? data.items : [];
      if (currentUtilityView === "system" && activeSystemTab === "routines") renderRoutinePanel(data.limit || 30);
      if (showNotice) showToast("Routines refreshed.", "success");
    } catch (error) {
      if (currentUtilityView === "system" && activeSystemTab === "routines") {
        elements.utilityContent.innerHTML = renderSystemTabs("routines") + '<div class="utility-card"><p class="inline-status status-warn">' + escapeHtml(error.message) + '</p></div>';
      }
    }
  }

  function renderRoutinePanel(limit = 30) {
    const rows = routineItems.map((routine) =>
      '<article class="memory-row"><div><strong>' + escapeHtml(routine.name) + '</strong><p>' + escapeHtml(routine.prompt) + '</p><time>' + escapeHtml(routine.builtin ? "Built in" : routine.created_at || "Saved locally") + '</time></div>' +
      '<div class="routine-actions"><button class="utility-secondary" type="button" data-utility-action="routine-run" data-id="' + escapeHtml(routine.id) + '">Run</button>' +
      '<button class="utility-secondary" type="button" data-utility-action="routine-edit" data-id="' + escapeHtml(routine.id) + '">Edit</button>' +
      '<button class="mini-icon-button" type="button" data-utility-action="routine-delete" data-id="' + escapeHtml(routine.id) + '" aria-label="Delete routine">×</button></div></article>'
    ).join("");
    elements.utilityContent.innerHTML = renderSystemTabs("routines") +
      '<p class="utility-intro">Save reusable workflows. Running a routine sends its instructions to JARVIS; file writes, terminal commands, app launches, and other sensitive actions still require the normal approval step.</p>' +
      '<section class="utility-card"><form class="utility-form" data-form="routine-save">' +
      '<input type="hidden" id="routineId" name="id" value="">' +
      '<label>Routine name<input id="routineName" name="name" maxlength="60" required placeholder="Gaming prep / Start coding…"></label>' +
      '<label>Instructions<textarea id="routinePrompt" name="prompt" maxlength="4000" rows="4" required placeholder="Describe the steps JARVIS should follow. Include what it must ask you before changing."></textarea></label>' +
      '<div class="utility-button-row"><button class="utility-secondary" type="button" data-utility-action="routine-reset">Clear form</button><button class="utility-primary" type="submit">Save routine</button></div></form></section>' +
      '<section class="utility-card"><div class="utility-card-heading"><span class="utility-index">SAVED</span><div><h3>Your routines</h3><p>' + routineItems.length + ' / ' + limit + ' saved locally</p></div></div><div class="memory-list">' + (rows || '<div class="empty-state">No routines saved yet.</div>') + '</div></section>';
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

  window.setInterval(() => {
    if (currentUtilityView === "system" && activeSystemTab === "status") refreshSystemMetrics();
  }, 10_000);

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
      savedMemoryItems = Array.isArray(data.items) ? data.items : [];
      if (currentUtilityView === "memory") renderMemoryPanel(savedMemoryItems, data.limit || 100);
    } catch (error) {
      if (currentUtilityView === "memory") {
        elements.utilityContent.innerHTML = '<div class="utility-card"><p class="inline-status status-warn">' + escapeHtml(error.message) + '</p></div>';
      }
    }
  }

  function renderMemoryPanel(items, limit) {
    const rows = items.map((item) =>
      '<article class="memory-row"><div><p>' + escapeHtml(item.fact) + '</p><time>' + escapeHtml(item.updated_at || item.created_at || "Saved") + '</time></div>' +
      '<div class="routine-actions"><button class="utility-secondary" type="button" data-utility-action="memory-edit" data-id="' + escapeHtml(item.id) + '">Edit</button><button class="mini-icon-button" type="button" data-utility-action="memory-delete" data-id="' + escapeHtml(item.id) + '" aria-label="Delete memory">×</button></div></article>'
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
          '<button class="coding-action-card" type="button" data-prompt="Review the current uncommitted git changes inside my workspace. Inspect git status and the diff, check for accidental or risky changes, and summarize the exact files changed. Do not modify or commit anything."><strong>Review changes</strong><span>Inspect the working diff</span><b>↗</b></button>' +
        '</div>';
    } catch (error) {
      if (currentUtilityView === "coding") elements.utilityContent.innerHTML = '<div class="utility-card"><p class="inline-status status-warn">' + escapeHtml(error.message) + '</p></div>';
    }
  }

  async function refreshDesktopAppPanel() {
    try {
      const response = await fetch("/api/apps", { cache: "no-store" });
      const catalog = await response.json();
      if (!response.ok) throw new Error(catalog.error || "Could not load the desktop app catalog.");
      if (currentUtilityView !== "apps") return;
      const apps = Array.isArray(catalog.apps) ? catalog.apps : [];
      const cards = apps.map((app, index) => {
        const available = app.available === true;
        const status = available ? "READY" : (catalog.supported ? "NOT INSTALLED" : "LINUX ONLY");
        const prompt = "Open the " + app.name + " desktop application now. Use launch_app with application_id \"" +
          app.id + "\". This request came from the Desktop app launcher; still ask for my normal approval before starting it.";
        const button = available
          ? '<button class="desktop-app-launch" type="button" data-prompt="' + escapeHtml(prompt) + '">Request launch <span aria-hidden="true">↗</span></button>'
          : '<button class="desktop-app-launch" type="button" disabled>Unavailable</button>';
        return '<article class="desktop-app-card' + (available ? ' is-available' : ' is-unavailable') + '">' +
          '<div class="desktop-app-card-top"><span class="utility-index">' + String(index + 1).padStart(2, "0") +
          '</span><span class="desktop-app-status">' + status + '</span></div>' +
          '<h3>' + escapeHtml(app.name || "Application") + '</h3>' +
          '<p>' + escapeHtml(app.description || "Desktop application") + '</p>' + button + '</article>';
      }).join("");
      elements.utilityContent.innerHTML =
        '<p class="utility-intro">Request to open an installed desktop app without giving the AI a free-form terminal. JARVIS uses a fixed application allowlist and asks you to approve each launch.</p>' +
        '<div class="desktop-app-toolbar"><span>PLATFORM / ' + escapeHtml(catalog.platform || "UNKNOWN") +
        '</span><span>LOCAL DESKTOP ONLY</span><span>APPROVAL REQUIRED</span></div>' +
        (!catalog.supported ? '<div class="utility-card"><p class="inline-status status-warn">The desktop launcher currently supports Linux sessions only.</p></div>' : '') +
        (apps.length ? '<div class="desktop-app-grid">' + cards + '</div>' : '<div class="empty-state">No apps were found in the launcher catalog.</div>') +
        '<p class="desktop-app-footnote">You can also type a request in chat, such as <strong>“Open Firefox”</strong>. Apps marked unavailable are not on this computer\'s PATH.</p>';
    } catch (error) {
      if (currentUtilityView === "apps") {
        elements.utilityContent.innerHTML = '<div class="utility-card"><p class="inline-status status-warn">' +
          escapeHtml(error.message) + '</p></div>';
      }
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
    if (form.dataset.form === "routine-save") {
      const id = String(data.get("id") || "");
      const name = String(data.get("name") || "").trim();
      const prompt = String(data.get("prompt") || "").trim();
      apiPost("/api/routines", { action: "save", id, name, prompt })
        .then((result) => {
          logActivity("Routine saved", result.item?.name || name, "routine");
          showToast("Routine saved locally.", "success");
          refreshRoutineList(false);
        })
        .catch((error) => showToast(error.message, "error"));
    }
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
    if (action === "metrics-refresh") { refreshSystemMetrics(); return; }
    if (action === "routine-reset") {
      const form = elements.utilityContent.querySelector('form[data-form="routine-save"]');
      if (form) form.reset();
      const routineIdInput = document.getElementById("routineId");
      if (routineIdInput) routineIdInput.value = "";
      return;
    }
    if (action === "routine-edit") {
      const routine = routineItems.find((item) => item.id === id);
      if (!routine) return;
      const routineIdInput = document.getElementById("routineId");
      const routineNameInput = document.getElementById("routineName");
      const routinePromptInput = document.getElementById("routinePrompt");
      if (routineIdInput) routineIdInput.value = routine.id;
      if (routineNameInput) routineNameInput.value = routine.name;
      if (routinePromptInput) routinePromptInput.value = routine.prompt;
      routineNameInput?.focus();
      elements.utilityContent.querySelector('form[data-form="routine-save"]')?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (action === "routine-run") {
      const routine = routineItems.find((item) => item.id === id);
      if (!routine) return;
      const routinePrompt = "Run this saved JARVIS routine: " + routine.name + "\n\nInstructions:\n" + routine.prompt +
        "\n\nSafety: inspect before acting. Use the existing approval flow for every file write, terminal command, app launch, settings change, or deletion. If the model is offline or a capability is unavailable, say so clearly.";
      closeUtility();
      sendMessage(routinePrompt);
      return;
    }
    if (action === "routine-delete") {
      apiPost("/api/routines", { action: "delete", id })
        .then(() => { logActivity("Routine deleted", "", "routine"); showToast("Routine deleted.", "success"); refreshRoutineList(false); })
        .catch((error) => showToast(error.message, "error"));
      return;
    }
    if (action === "memory-edit") {
      const item = savedMemoryItems.find((row) => row.id === id);
      if (!item) return;
      const revised = window.prompt("Edit this saved memory. It will update future JARVIS chats:", item.fact);
      if (revised === null) return;
      apiPost("/api/memory/update", { id, fact: revised })
        .then((result) => { logActivity("Persistent memory edited", result.item?.fact || "", "memory"); showToast("Memory updated for future chats.", "success"); refreshMemoryPanel(); })
        .catch((error) => showToast(error.message, "error"));
      return;
    }
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
      persistDashboardBucket("activity", activityEvents);
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
  elements.wakeWord.addEventListener("click", toggleWakeWord);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopWakeWordPolling();
    } else {
      refreshWakeWordStatus(false).finally(syncWakeWordPolling);
    }
  });
  refreshWakeWordStatus(true);
  $("#testModelBtn").addEventListener("click", testModel);
  $("#systemBtn").addEventListener("click", () => openUtility("system"));
  $("#kitchenBtn").addEventListener("click", () => openUtility("kitchen"));
  $("#memoryBtn").addEventListener("click", () => openUtility("memory"));
  $("#codingBtn").addEventListener("click", () => openUtility("coding"));
  $("#appsBtn").addEventListener("click", () => openUtility("apps"));
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


  // Quick Notes are saved to notes.json, separate from AI memory.
  function initQuickNotes() {
    let notes = [];
    let editingId = null;
    let searchText = "";

    const memoryButton = document.getElementById("memoryBtn");
    if (memoryButton && memoryButton.lastElementChild) memoryButton.lastElementChild.textContent = "Memory & archive";



    function persist() {
      persistDashboardBucket("notes", notes);
      return true;
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
    window.addEventListener("jarvis:data-updated", (event) => {
      if (!Array.isArray(event.detail?.notes)) return;
      notes = event.detail.notes.filter((note) => note && typeof note.id === "string").slice(0, 100);
      if (currentUtilityView === "quick-notes") renderPanel();
    });
  }

  initQuickNotes();


  function initRecipeSaver() {
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



    function save() {
      persistDashboardBucket("recipes", recipes);
      return true;
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
    window.addEventListener("jarvis:data-updated", (event) => {
      if (!Array.isArray(event.detail?.recipes)) return;
      recipes = event.detail.recipes.map((row) => normalize(row, true)).filter(Boolean).slice(0, MAX);
      if (currentUtilityView === "recipes") renderPanel();
    });
  }
  initRecipeSaver();

  loadConfig();
  dashboardSyncPromise = bootstrapDashboardData().then(() => {
    logActivity("JARVIS ready", "Local-file assistant interface initialized", "system");
    restoreCurrentConversation();
  });
  elements.input.focus({ preventScroll: true });
})();
