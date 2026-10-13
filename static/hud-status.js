/* Event-driven HUD status mirrors existing JARVIS UI state; deliberately no polling timer. */
(() => {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const states = {
    idle: {
      core: "AWAITING COMMAND",
      assistant: "STANDBY",
      footer: "STANDBY"
    },
    listening: {
      core: "VOICE CHANNEL ACTIVE",
      assistant: "LISTENING",
      footer: "LISTENING"
    },
    thinking: {
      core: "PROCESSING REQUEST",
      assistant: "PROCESSING",
      footer: "PROCESSING"
    },
    speaking: {
      core: "GENERATING RESPONSE",
      assistant: "SPEAKING",
      footer: "SPEAKING"
    },
    error: {
      core: "ATTENTION REQUIRED",
      assistant: "ATTENTION",
      footer: "ATTENTION"
    }
  };

  function setReadout(id, text, state) {
    const element = byId(id);
    if (!element) return;
    element.textContent = text;
    if (state) element.dataset.state = state;
  }

  function setAssistantState(value) {
    const state = Object.prototype.hasOwnProperty.call(states, value) ? value : "idle";
    const labels = states[state];
    document.documentElement.dataset.jarvisState = state;
    setReadout("hudCoreStatus", labels.core, state);
    setReadout("hudAssistantState", labels.assistant, state);
    const footer = byId("hudFooterStatus");
    if (footer) {
      footer.textContent = labels.footer;
      footer.dataset.state = state;
    }
  }

  function updateModelLink() {
    const pill = byId("connectionPill");
    const sourceLabel = byId("connectionLabel");
    if (!pill) return;
    const label = sourceLabel ? sourceLabel.textContent.trim().toUpperCase() : "";
    if (pill.classList.contains("connected") || label.includes("CONNECTED")) {
      setReadout("hudModelState", "LINK ONLINE", "online");
    } else if (pill.classList.contains("disconnected") ||
               /DISCONNECTED|OFFLINE|UNAVAILABLE|FAILED|ERROR/.test(label)) {
      setReadout("hudModelState", "LINK OFFLINE", "offline");
    } else if (label.includes("NOT TESTED")) {
      setReadout("hudModelState", "LINK UNTESTED", "untested");
    } else {
      setReadout("hudModelState", "CHECKING LINK", "checking");
    }
  }

  function isEnabled(id) {
    const element = byId(id);
    return !!element && (
      element.getAttribute("aria-pressed") === "true" ||
      element.classList.contains("active")
    );
  }

  function updateVoiceChannels() {
    const wake = isEnabled("wakeWordBtn");
    const speech = isEnabled("voiceOutputBtn");
    const state = wake || speech ? "enabled" : "disabled";
    setReadout(
      "hudVoiceState",
      "WAKE " + (wake ? "ON" : "OFF") + " / SPEECH " + (speech ? "ON" : "OFF"),
      state
    );
  }

  function observe(element, callback) {
    if (!element || !window.MutationObserver) return;
    const observer = new MutationObserver(callback);
    observer.observe(element, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  window.addEventListener("jarvis:state", (event) => {
    setAssistantState(event && event.detail && event.detail.state);
  });

  observe(byId("connectionPill"), updateModelLink);
  observe(byId("wakeWordBtn"), updateVoiceChannels);
  observe(byId("voiceOutputBtn"), updateVoiceChannels);

  setAssistantState("idle");
  updateModelLink();
  updateVoiceChannels();
})();
