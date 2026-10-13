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
  let busy = false;
  let listening = false;
  let voiceReplies = false;
  let recognition = null;
  let currentUtilityView = null;
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
    if (currentUtilityView === "activity") renderActivityPanel();
  }

  function openUtility(view) {
    currentUtilityView = view;
    elements.utilityPanel.classList.remove("hidden");
    closeSidebar();
    renderUtility();
    logActivity("Panel opened", ({kitchen:"Kitchen",models:"Model manager",memory:"Persistent memory",activity:"Activity feed",coding:"Coding agent"})[view] || view, "panel");
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
      models: ["SYSTEM / MODELS", "Model manager"],
      memory: ["SYSTEM / MEMORY", "Persistent memory"],
      activity: ["SYSTEM / TELEMETRY", "Live activity feed"],
      coding: ["WORKSPACE / DEVELOPER TOOLS", "Coding agent"],
    };
    const selected = config[currentUtilityView] || ["JARVIS / SYSTEM", "Utility panel"];
    elements.utilityEyebrow.textContent = selected[0];
    elements.utilityTitle.textContent = selected[1];
    if (currentUtilityView === "kitchen") renderKitchenPanel();
    else if (currentUtilityView === "models") renderModelPanel(latestModelList || {});
    else if (currentUtilityView === "memory") {
      elements.utilityContent.innerHTML = '<div class="utility-loading">Loading saved memories…</div>';
    } else if (currentUtilityView === "activity") renderActivityPanel();
    else if (currentUtilityView === "coding") {
      elements.utilityContent.innerHTML = '<div class="utility-loading">Checking workspace…</div>';
    }
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
    elements.utilityContent.innerHTML =
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
    elements.utilityContent.innerHTML =
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
    elements.utilityContent.innerHTML =
      '<p class="utility-intro">Choose a model from Ollama’s native API or another OpenAI-compatible server. Your endpoint and model choice are saved locally.</p>' +
      '<section class="utility-card model-manager-card"><form class="utility-form" data-form="model-manager">' +
        '<label>API endpoint<input id="modelBaseUrl" name="base_url" type="url" maxlength="500" required value="' + escapeHtml(endpoint) + '" placeholder="http://127.0.0.1:11434"></label>' +
        '<label>Model ID<input id="modelId" name="model" list="modelOptions" maxlength="250" required value="' + escapeHtml(model) + '" placeholder="Select or type a model ID"><datalist id="modelOptions">' + options + '</datalist></label>' +
        status +
        '<div class="utility-button-row"><button class="utility-secondary" type="button" data-utility-action="model-refresh">Refresh model list</button><button class="utility-primary" type="submit">Apply model</button></div>' +
      '</form></section>' +
      '<div class="utility-note"><strong>Ollama native:</strong> use <code>http://127.0.0.1:11434</code> with no <code>/v1</code>. JARVIS uses <code>/api/tags</code> to list models and <code>/api/chat</code> to chat. For llama.cpp or LM Studio, use their documented endpoint, usually ending in <code>/v1</code>. API keys stay on the server.</div>';
  }

  async function refreshModelList(showNotice) {
    if (currentUtilityView !== "models") return;
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
    elements.utilityContent.innerHTML =
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
  $("#systemBtn").addEventListener("click", () => sendMessage("Check my system status and summarize the basics."));
  $("#kitchenBtn").addEventListener("click", () => openUtility("kitchen"));
  $("#modelManagerBtn").addEventListener("click", () => openUtility("models"));
  $("#memoryBtn").addEventListener("click", () => openUtility("memory"));
  $("#activityBtn").addEventListener("click", () => openUtility("activity"));
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

  loadConfig();
  logActivity("JARVIS ready", "Local assistant interface initialized", "system");
  elements.input.focus({ preventScroll: true });
})();