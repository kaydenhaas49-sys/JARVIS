"use strict";

(function () {
  // ============================================================
  // JARVIS Web Client - movie UI
  // ============================================================
  var $ = function (id) { return document.getElementById(id); };
  var speechRec = null;
  var synth = null;
  var state = "READY";
  var jarvisVolume = 1.0;
  var jarvisMuted = false;

  // Kiosk mode: the page is rendered inside the native JARVIS Pi app.
  // In this mode browser APIs such as getUserMedia/WebAudio are not used;
  // microphone, TTS, and minimize/restore are handled by the native host.
  var IS_KIOSK = !!(window.JARVIS_KIOSK ||
    (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jarvisSpeak));

  // ------------------------------------------------------------
  // Volume control (browser-side)
  // ------------------------------------------------------------
  function applyVolume(audio) {
    if (!audio) return;
    audio.volume = jarvisMuted ? 0 : jarvisVolume;
  }

  function setVolume(level) {
    jarvisVolume = Math.max(0, Math.min(1, parseFloat(level) || 0));
    jarvisMuted = false;
    updateVolumeDisplay();
  }

  function adjustVolume(delta) {
    setVolume(jarvisVolume + (parseFloat(delta) || 0));
  }

  function toggleMute() {
    jarvisMuted = !jarvisMuted;
    updateVolumeDisplay();
  }

  function updateVolumeDisplay() {
    var vol = $("volReadout");
    var bar = $("volBar");
    var icon = $("volIcon");
    if (vol) vol.textContent = (jarvisMuted ? "MUTED" : Math.round(jarvisVolume * 100) + "%");
    if (bar) bar.style.width = Math.round(jarvisVolume * 100) + "%";
    if (icon) icon.textContent = jarvisMuted ? "🔇" : (jarvisVolume === 0 ? "🔈" : (jarvisVolume < 0.5 ? "🔉" : "🔊"));
  }
  window.setVolume = setVolume;
  window.adjustVolume = adjustVolume;
  window.toggleMute = toggleMute;

  function klog(msg) {
    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jarvisDebug) {
      window.webkit.messageHandlers.jarvisDebug.postMessage(String(msg));
    }
  }

  // ------------------------------------------------------------
  // API helper
  // ------------------------------------------------------------
  function api(url, opts) {
    opts = opts || {};
    opts.headers = opts.headers || {};
    if (!opts.skipJson) {
      opts.headers["Content-Type"] = opts.headers["Content-Type"] || "application/json";
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; });
    });
  }
  window.api = api;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // In-memory runtime config (mirrors server config.json)
  var cfg = { ollama_host: "", model: "", web_port: 8000, host_tools: false, voice: { speak: true, continuous_listen: false, wake_word: false }, max_reply_chars: 300, screensaver: { enabled: true, timeout_seconds: 60 } };
  function cfgGet(path) {
    var parts = path.split(".");
    var cur = cfg;
    for (var i = 0; i < parts.length; i++) { cur = cur[parts[i]]; }
    return cur;
  }

  function stripMarkdown(text) {
    if (!text) return text;
    return text
      .replace(/```[\s\S]*?```/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*/g, "")
      .replace(/__/g, "")
      .trim();
  }

  // ------------------------------------------------------------
  // TTS (native kiosk bridge if available, otherwise web audio)
  // ------------------------------------------------------------
  function speak(text) {
    if (!text) return Promise.resolve();
    if (!cfgGet("voice.speak")) return Promise.resolve();
    text = stripMarkdown(text);

    // In kiosk mode we MUST use the native bridge; browser audio is blocked.
    if (IS_KIOSK) {
      if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jarvisSpeak) {
        klog("SPEAK native kiosk: " + text.slice(0, 40));
        window.webkit.messageHandlers.jarvisSpeak.postMessage(JSON.stringify({text: text, volume: jarvisVolume, muted: jarvisMuted}));
        return Promise.resolve();
      }
      klog("SPEAK kiosk but no native bridge");
      return Promise.resolve();
    }

    if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jarvisSpeak) {
      klog("SPEAK native: vol=" + jarvisVolume + " muted=" + jarvisMuted + " text=" + text.slice(0, 40));
      try {
        window.webkit.messageHandlers.jarvisSpeak.postMessage(JSON.stringify({text: text, volume: jarvisVolume, muted: jarvisMuted}));
      } catch (e) {
        klog("native speak post failed: " + e);
      }
      return Promise.resolve();
    }
    klog("SPEAK web audio fallback");
    if (!text) return Promise.resolve();
    console.log("SPEAK called:", text.slice(0, 40));
    klog("SPEAK web path: " + text.slice(0, 40));
    return fetch("/api/speak", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text: text})
    })
    .then(function (r) {
      console.log("SPEAK response status", r.status);
      if (!r.ok) throw new Error("TTS request failed: " + r.status);
      return r.arrayBuffer();
    })
    .then(function (buf) {
      console.log("SPEAK audio bytes", buf ? buf.byteLength : 0);
      if (!buf || buf.byteLength < 100) throw new Error("TTS audio was empty");
      return new Promise(function (resolve, reject) {
        var blob = new Blob([buf], {type: "audio/wav"});
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        applyVolume(audio);
        var ttsDuration = 0;
        try {
          ttsDuration = buf.byteLength / (16000 * 1 * 2) + 0.5;
        } catch (e) {}
        function notifyTtsActive(seconds) {
          try {
            fetch("/api/tts_active", {
              method: "POST",
              headers: {"Content-Type": "application/json"},
              body: JSON.stringify({seconds: seconds})
            }).catch(function (err) { console.warn("tts_active notify failed:", err); });
          } catch (e) { console.warn("tts_active notify error:", e); }
        }
        audio.onloadedmetadata = function () {
          if (audio.duration && isFinite(audio.duration)) {
            ttsDuration = audio.duration + 0.5;
          }
        };
        audio.onended = function () {
          URL.revokeObjectURL(url);
          console.log("JARVIS TTS playback ended");
          notifyTtsActive(0);
          resolve();
        };
        audio.onerror = function (e) {
          URL.revokeObjectURL(url);
          notifyTtsActive(0);
          var errDetail = (audio.error ? (audio.error.code + ": " + audio.error.message) : "") + " " + (e ? JSON.stringify(e) : "");
          console.warn("JARVIS TTS audio error:", e, audio.error, errDetail);
          addMsg("jarvis", "[TTS audio error: " + errDetail + "]");
          reject(new Error("TTS playback error: " + errDetail));
        };
        audio.play().then(function () {
          console.log("JARVIS TTS playback started");
          notifyTtsActive(Math.max(ttsDuration, 1));
        }).catch(function (e) {
          URL.revokeObjectURL(url);
          console.warn("JARVIS TTS playback failed:", e);
          var errMsg = (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e));
          addMsg("jarvis", "[TTS playback failed: " + errMsg + "]");
          reject(e);
        });
      });
    })
    .catch(function (err) {
      console.warn("JARVIS TTS failed:", err);
      addMsg("jarvis", "[voice error: " + (err.message || err) + "]");
      throw err;
    });
  }
  window.speak = speak;

  // ------------------------------------------------------------
  // Navigation
  // ------------------------------------------------------------
  function setView(name) {
    var views = { "assistant": 1, "kitchen": 1, "settings": 1 };
    if (!views[name]) return;
    var all = document.querySelectorAll(".view");
    for (var i = 0; i < all.length; i++) all[i].classList.remove("active");
    var target = $("view-" + name);
    if (target) target.classList.add("active");
    var navs = document.querySelectorAll(".rail-nav");
    for (i = 0; i < navs.length; i++) {
      navs[i].classList.toggle("active", navs[i].getAttribute("data-view") === name);
    }
    if (name === "kitchen") loadKitchen();
    if (name === "settings") loadSettings();
  }

  // ------------------------------------------------------------
  // Microphone
  // ------------------------------------------------------------
  function updateMicReadout(status, detail) {
    detail = detail || "";
    var readout = $("micPermReadout");
    var tile = $("tileMic");
    var tileVal = $("valMic");
    if (IS_KIOSK) {
      if (readout) {
        readout.className = "perm-readout granted";
        readout.textContent = "NATIVE KIOSK AUDIO";
      }
      if (tile && tileVal) {
        tile.classList.add("on");
        tileVal.textContent = "NATIVE";
      }
      return;
    }
    if (readout) {
      readout.className = "perm-readout " + (status || "unknown");
      readout.textContent = status.toUpperCase() + (detail ? " — " + detail : "");
    }
    if (tile && tileVal) {
      tile.classList.remove("on", "error");
      if (status === "granted") tile.classList.add("on");
      else if (status === "denied" || status === "unsupported") tile.classList.add("error");
      tileVal.textContent = status.toUpperCase();
    }
  }

  function requestMicPermission() {
    if (IS_KIOSK) {
      addMsg("jarvis", "Kiosk mode uses the native microphone pipeline.");
      updateMicReadout("granted", "Native kiosk audio");
      return Promise.resolve(true);
    }
    var api = navigator.mediaDevices;
    if (!api) {
      updateMicReadout("unsupported", "Browser API missing");
      return Promise.reject(new Error("getUserMedia not available"));
    }
    updateMicReadout("prompt", "Waiting for browser prompt...");
    return api.getUserMedia({ audio: true, video: false }).then(function (stream) {
      var track = stream.getAudioTracks()[0];
      updateMicReadout("granted", track ? track.label : "Microphone active");
    }).catch(function (err) {
      updateMicReadout("denied", err.message);
      return Promise.reject(err);
    });
  }

  // ------------------------------------------------------------
  // Health + reactor state
  // ------------------------------------------------------------
  function setReactor(stateName) {
    state = stateName || "READY";
    var top = $("topStatus");
    if (!top) return;
    if (state === "ERROR") top.textContent = "CORE ERROR";
    else if (state === "EXECUTING") top.textContent = "PROCESSING";
    else if (state === "THINKING") top.textContent = "THINKING";
    else top.textContent = "CORE ONLINE";
  }

  function checkHealth() {
    return api("/api/health").then(function (d) {
      var top = $("topStatus");
      if (top) top.textContent = d.online ? "CORE ONLINE" : "CORE OFFLINE";
    }).catch(function () { });
  }

  function updateSystemInfo() {
    return api("/api/system").then(function (d) {
      if (!d) return;
      var parts = [];
      if (d.cpu_temp_c != null) parts.push("CPU " + d.cpu_temp_c + "°C");
      if (d.cpu_load != null) parts.push("LOAD " + d.cpu_load);
      if (d.client_ip) parts.push("NODE " + d.client_ip);
      parts.push("GW " + (d.gateway_ok ? "OK" : "DOWN"));
      parts.push("CORE " + (d.assistant_ok ? "OK" : "DOWN"));
      var el = $("sysInfo");
      if (el) el.textContent = parts.join(" · ");
    }).catch(function () { });
  }

  function loadConfig() {
    return api("/api/config").then(function (d) {
      if (!d) return d;
      cfg.ollama_host = d.ollama_host || cfg.ollama_host;
      cfg.model = d.model || cfg.model;
      cfg.web_port = d.web_port || 8000;
      cfg.host_tools = !!d.host_tools;
      cfg.voice = d.voice || cfg.voice;
      cfg.training_wheels = d.training_wheels || cfg.training_wheels;
      cfg.max_reply_chars = d.max_reply_chars || cfg.max_reply_chars || 300;
      cfg.screensaver = d.screensaver || cfg.screensaver || { enabled: true, timeout_seconds: 60 };
      updateTrainingWheelsState();
      updateMinimizeButton();
      if ($("cfgHost")) $("cfgHost").value = cfg.ollama_host;
    });
  }

  // ------------------------------------------------------------
  // Chat
  // ------------------------------------------------------------
  function scrollToBottom() {
    var chat = $("chat");
    if (!chat) return;
    chat.scrollTop = chat.scrollHeight;
  }

  function addMsg(speaker, text, toolNotes) {
    var chat = $("chat");
    if (!chat) return;
    var m = el("div", "msg " + (speaker === "user" ? "user" : "jarvis"));
    m.appendChild(el("div", "who", speaker === "user" ? "YOU" : "J A R V I S"));
    var t = el("div", "text", text);
    m.appendChild(t);
    if (toolNotes && toolNotes.length) m.appendChild(el("span", "tool-note", "⇢ used tool: " + toolNotes.join(", ")));
    chat.appendChild(m);
    for (var i = 0; i < 5; i++) {
      (function (delay) { setTimeout(scrollToBottom, delay); })(10 + i * 50);
    }
    return t;
  }

  var busy = false;
  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true;
    setReactor("THINKING");
    addMsg("user", text);
    $("input").value = "";
    api("/api/ask", { method: "POST", body: JSON.stringify({ text: text, remember: true }) })
      .then(function (d) {
        if (d.error) { setReactor("ERROR"); addMsg("jarvis", d.reply || d.error); }
        else {
          var displayText = d.full_reply || d.reply;
          addMsg("jarvis", displayText, d.tool_notes);
          if (cfgGet("voice.speak")) speak(d.reply);
          setReactor(d.state || "READY");
        }
      })
      .catch(function (e) { setReactor("ERROR"); addMsg("jarvis", "Core connection failed: " + e.message); })
      .finally(function () { busy = false; });
  }

  var recognizer = null;
  var listening = false;
  var audioCtx = null;
  var audioSource = null;
  var audioProc = null;
  var audioStream = null;
  var recordedSamples = [];
  var recordStopTimer = null;
  var lastRecordingInfo = null;
  var micLog = [];
  window.lastRecordingInfo = function () { return lastRecordingInfo; };
  window._jarvisMicLog = micLog;

  function micLogPush(msg) {
    var line = Date.now() + " " + msg;
    micLog.push(line);
    console.log(msg);
    if (micLog.length > 50) micLog.shift();
  }

  function floatTo16BitPCM(input) {
    var output = new Int16Array(input.length);
    for (var i = 0; i < input.length; i++) {
      var s = Math.max(-1, Math.min(1, input[i]));
      output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output;
  }

  function writeString(view, offset, string) {
    for (var i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function encodeWAV(samples, sampleRate) {
    var buffer = new ArrayBuffer(44 + samples.length * 2);
    var view = new DataView(buffer);
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, samples.length * 2, true);
    for (var i = 0; i < samples.length; i++) {
      view.setInt16(44 + i * 2, samples[i], true);
    }
    return buffer;
  }

  function startListening() {
    if (listening) return;

    if (IS_KIOSK) {
      addMsg("jarvis", "In kiosk mode, say \"Hey JARVIS\" or use the native voice button.");
      return;
    }

    // Ask the host to pause the remote ear so the browser can open the mic.
    fetch("/api/ear_pause", { method: "POST" }).catch(function () {});
    var micApi = navigator.mediaDevices;
    if (!micApi) {
      addMsg("jarvis", "Speech capture isn't supported by this browser.");
      return;
    }
    listening = true;
    recordedSamples = [];
    var micBtn = $("micBtn");
    if (micBtn) { micBtn.classList.add("active"); micBtn.textContent = "◉"; }
    var rd = $("wakeReadout");
    if (rd) { rd.textContent = "AUDIO INPUT · RECORDING"; rd.classList.add("active"); }
    micLogPush("JARVIS command recording starting");

    micApi.getUserMedia({ audio: true, video: false })
      .then(function (stream) {
        audioStream = stream;
        var tracks = stream.getAudioTracks();
        micLogPush("mic stream opened tracks=" + tracks.length + " label=" + (tracks[0] && tracks[0].label));
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
          throw new Error("AudioContext not available");
        }
        audioCtx = new AudioContext({ sampleRate: 16000 });
        window._jarvisAudioCtx = audioCtx;
        micLogPush("AudioContext created state=" + audioCtx.state);
        audioCtx.resume().then(function () {
          micLogPush("AudioContext resumed state=" + audioCtx.state);
        }).catch(function (e) {
          micLogPush("AudioContext resume failed: " + (e.message || e));
        });
        audioSource = audioCtx.createMediaStreamSource(stream);
        audioProc = audioCtx.createScriptProcessor(4096, 1, 1);
        audioProc.onaudioprocess = function (e) {
          var data = e.inputBuffer.getChannelData(0);
          recordedSamples.push(new Float32Array(data));
          micLogPush("onaudioprocess chunk=" + data.length + " total=" + recordedSamples.length);
        };
        audioSource.connect(audioProc);
        audioProc.connect(audioCtx.destination);
        micLogPush("Web Audio recorder connected");
        // Auto-stop after 5 seconds of command capture.
        recordStopTimer = setTimeout(function () {
          micLogPush("auto-stopping command recording");
          stopListening();
        }, 5000);
      })
      .catch(function (err) {
        micLogPush("getUserMedia failed: " + (err.name || err.message));
        addMsg("jarvis", "Microphone access failed: " + (err.name || err.message));
        stopListening();
      });
  }

  function stopListening() {
    listening = false;
    if (recordStopTimer) { clearTimeout(recordStopTimer); recordStopTimer = null; }
    if (audioProc) {
      try { audioProc.disconnect(); } catch (e) {}
      audioProc.onaudioprocess = null;
      audioProc = null;
    }
    if (audioSource) {
      try { audioSource.disconnect(); } catch (e) {}
      audioSource = null;
    }
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
    }
    if (audioStream) {
      audioStream.getTracks().forEach(function (t) { t.stop(); });
      audioStream = null;
    }

    // Build WAV from recorded float samples.
    var total = 0;
    for (var i = 0; i < recordedSamples.length; i++) total += recordedSamples[i].length;
    var flat = new Float32Array(total);
    var off = 0;
    for (i = 0; i < recordedSamples.length; i++) {
      flat.set(recordedSamples[i], off);
      off += recordedSamples[i].length;
    }
    var pcm = floatTo16BitPCM(flat);
    var wav = encodeWAV(pcm, 16000);
    var blob = new Blob([wav], { type: "audio/wav" });
    lastRecordingInfo = { size: blob.size, type: blob.type, samples: total };
    console.log("JARVIS command recording stopped, blob size", blob.size, "samples", total);
    if (blob.size > 46) {
      sendAudioForTranscription(blob);
    } else {
      addMsg("jarvis", "I didn't catch that. Please try again.");
    }
    recordedSamples = [];

    var micBtn = $("micBtn");
    if (micBtn) { micBtn.classList.remove("active"); micBtn.textContent = "🎙"; }
    var rd = $("wakeReadout");
    var armed = cfgGet("voice.wake_word");
    if (rd) { rd.textContent = "WAKE WORD · " + (armed ? "ARMED" : "OFF"); rd.classList.toggle("active", armed); }
  }

  function sendAudioForTranscription(blob) {
    var rd = $("wakeReadout");
    if (rd) rd.textContent = "AUDIO INPUT · TRANSCRIBING…";
    console.log("JARVIS sending audio for transcription, size", blob.size);
    fetch("/api/transcribe", { method: "POST", body: blob })
      .then(function (r) { console.log("transcribe status", r.status); return r.json(); })
      .then(function (d) {
        var text = (d.text || "").trim();
        console.log("JARVIS transcribed:", text);
        if (text) {
          if (rd) rd.textContent = "AUDIO INPUT · " + text;
          send(text);
        } else {
          if (rd) rd.textContent = "AUDIO INPUT · NO SPEECH DETECTED";
          addMsg("jarvis", "I didn't catch that. Please try again.");
        }
      })
      .catch(function (e) {
        console.warn("Transcription failed:", e);
        if (rd) rd.textContent = "AUDIO INPUT · ERROR";
        addMsg("jarvis", "Transcription failed: " + e.message);
      });
  }

  // ------------------------------------------------------------
  // Wake word UI
  // ------------------------------------------------------------
  function setWakeWord(on) {
    api("/api/config", { method: "POST", body: JSON.stringify({ voice: { wake_word: !!on } }) })
      .then(function (d) { cfg.voice = d.voice || cfg.voice; setWakeToggle(); updateWakeStatus(); })
      .catch(function () { setWakeToggle(); });
  }

  function setWakeToggle() {
    if ($("wakeToggle")) $("wakeToggle").checked = !!cfgGet("voice.wake_word");
  }

  function updateWakeStatus() {
    var s = $("wakeStatus");
    var rd = $("wakeReadout");
    var armed = cfgGet("voice.wake_word");
    if (rd) { rd.textContent = "WAKE WORD · " + (armed ? "ARMED" : "OFF"); rd.classList.toggle("active", armed); }
    if (!s) return;
    api("/api/wake_status").then(function (d) {
      if (!d.available) s.textContent = "Wake word unavailable";
      else if (d.enabled && d.armed) s.textContent = "WAKE ARMED · fired " + (d.triggered || 0) + "x";
      else if (d.enabled) s.textContent = "Listening…";
      else if (d.error) s.textContent = "Wake word error: " + d.error;
      else s.textContent = "WAKE OFF";
    }).catch(function () { s.textContent = "WAKE OFF"; });
  }

  function dismissScreensaver() {
    if (window.jarvisScreensaver && window.jarvisScreensaver.isActive()) {
      console.log("[screensaver] wake event dismissed screensaver");
      window.jarvisScreensaver.hide();
    }
    resetScreensaverTimer();
  }

  function onWake(d) {
    setReactor("EXECUTING");
    addMsg("jarvis", "Wake word detected — awaiting command.");
    console.log("JARVIS onWake event", d);
    var rd = $("wakeReadout");
    if (rd) { rd.textContent = "WAKE WORD · DETECTED"; rd.classList.add("active"); }
    var inp = $("input");
    if (inp) { inp.focus(); inp.placeholder = "Say or type your command..."; }
    updateWakeStatus();
    dismissScreensaver();
    // Spoken greeting removed: it triggers TTS echo suppression and overlaps
    // with the user's command. Visual feedback is shown above.
  }

  function onCommand(d) {
    console.log("JARVIS command event", d);
    var rd = $("wakeReadout");
    if (d.error === "tts_active") {
      console.log("[wakeword] ignoring command captured during JARVIS speech (echo)");
      if (rd) rd.textContent = "WAKE WORD · ECHO IGNORED";
      setReactor("READY");
      updateWakeStatus();
      return;
    }
    var text = (d.text || "").trim();
    if (d.error || !text) {
      if (rd) rd.textContent = "AUDIO INPUT · NO SPEECH DETECTED";
      addMsg("jarvis", "I didn't catch that. Please try again.");
      setReactor("READY");
      updateWakeStatus();
      return;
    }
    if (rd) rd.textContent = "AUDIO INPUT · " + text;
    send(text);
  }

  function onVolume(d) {
    if (!d || !d.action) return;
    if (d.action === "set" && typeof d.level === "number") {
      setVolume(d.level);
    } else if (d.action === "up") {
      adjustVolume(d.delta || 0.1);
    } else if (d.action === "down") {
      adjustVolume(-(d.delta || 0.1));
    } else if (d.action === "mute") {
      toggleMute();
    }
  }

  function updateTrainingWheelsState() {
    var tw = cfg.training_wheels || {};
    var locked = tw.enabled && tw.locked;
    var badge = $("twBadge");
    var readout = $("twReadout");
    if (badge) {
      badge.style.display = tw.enabled ? "inline-flex" : "none";
      badge.classList.toggle("locked", locked);
      badge.classList.toggle("unlocked", !locked);
      badge.title = locked ? "Training Wheels Protocol active" : "Training Wheels Protocol unlocked";
      badge.textContent = locked ? "🛡️ TRAINING WHEELS" : "🔓 FULL ACCESS";
    }
    if (readout) {
      readout.className = "perm-readout " + (locked ? "locked" : "unlocked");
      readout.textContent = !tw.enabled ? "DISABLED" : (locked ? "LOCKED" : "UNLOCKED");
    }
  }

  var _micLastHeard = Date.now();
  function updateMicBadge(rms, armed) {
    var badge = $("micBadge");
    if (!badge) return;
    if (rms >= 50) {
      _micLastHeard = Date.now();
      badge.style.display = "inline-flex";
      badge.className = "mic-badge active";
      badge.textContent = "🎤 LIVE";
      badge.title = "Microphone receiving audio (RMS " + Math.round(rms) + ")";
    } else if (Date.now() - _micLastHeard > 3000) {
      badge.style.display = "inline-flex";
      badge.className = "mic-badge muted";
      badge.textContent = armed ? "🎤 NO AUDIO" : "🎤 STANDBY";
      badge.title = armed
        ? "No microphone audio detected. Check headset mute switch / mic position."
        : "Wake word disabled; microphone not required.";
    }
  }

  function pollWakeStatus() {
    api("/api/wake_status").then(function (d) {
      if (!d) return;
      updateMicBadge(d.last_rms || 0, d.armed);
    }).catch(function () { /* ignore */ });
  }

  function unlockJarvis(password) {
    return api("/api/unlock", {
      method: "POST",
      body: JSON.stringify({password: password || ""})
    }).then(function (d) {
      if (d.locked) {
        addMsg("jarvis", "Training Wheels Protocol still active. Incorrect password?");
      } else {
        cfg.training_wheels = cfg.training_wheels || {};
        cfg.training_wheels.locked = false;
        updateTrainingWheelsState();
        addMsg("jarvis", "Training Wheels Protocol disengaged. Full access restored.");
      }
    }).catch(function (err) {
      addMsg("jarvis", "Unlock request failed: " + (err.message || err));
    });
  }

  function lockJarvis() {
    return api("/api/lock", {
      method: "POST"
    }).then(function (d) {
      cfg.training_wheels = cfg.training_wheels || {};
      cfg.training_wheels.locked = true;
      updateTrainingWheelsState();
      addMsg("jarvis", "Training Wheels Protocol engaged. Restricted mode active.");
    }).catch(function (err) {
      addMsg("jarvis", "Lock request failed: " + (err.message || err));
    });
  }

  // ------------------------------------------------------------
  // Minimize / restore (kiosk fullscreen toggle)
  // ------------------------------------------------------------
  function updateMinimizeButton() {
    var btn = $("minimizeBtn");
    if (!btn) return;
    btn.style.display = "inline-flex";
  }

  function minimizeJarvis() {
    return api("/api/kiosk_control", {
      method: "POST",
      body: JSON.stringify({action: "minimize"})
    }).then(function (d) {
      if (!d.ok) {
        console.warn("[kiosk] minimize failed:", d.error);
      }
    }).catch(function (err) {
      console.warn("[kiosk] minimize request failed:", err);
    });
  }
  window.minimizeJarvis = minimizeJarvis;

  function restoreJarvis() {
    return api("/api/kiosk_control", {
      method: "POST",
      body: JSON.stringify({action: "restore"})
    }).then(function (d) {
      if (!d.ok) {
        console.warn("[kiosk] restore failed:", d.error);
      }
    }).catch(function (err) {
      console.warn("[kiosk] restore request failed:", err);
    });
  }
  window.restoreJarvis = restoreJarvis;

  window.unlockJarvis = unlockJarvis;
  window.lockJarvis = lockJarvis;

  function connectEvents() {
    if (typeof EventSource === "undefined") return;
    var es = new EventSource("/api/events");
    es.onmessage = function (ev) {
      var d; try { d = JSON.parse(ev.data); } catch (e) { return; }
      if (d.type === "wake") onWake(d);
      if (d.type === "command") onCommand(d);
      if (d.type === "volume") onVolume(d);
    };
  }

  // ------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------
  function wire() {
    $("sendBtn").addEventListener("click", function () { send($("input").value); });
    $("input").addEventListener("keydown", function (e) { if (e.key === "Enter") send($("input").value); });
    $("micBtn").addEventListener("click", function () { startListening(); });
    $("wakeToggle").addEventListener("change", function () { setWakeWord(this.checked); });
    var i, navs = document.querySelectorAll(".rail-nav");
    for (i = 0; i < navs.length; i++) {
      navs[i].addEventListener("click", function () { setView(this.getAttribute("data-view")); });
    }
    var chips = document.querySelectorAll(".filter-chip");
    for (i = 0; i < chips.length; i++) {
      chips[i].addEventListener("click", function () {
        for (var j = 0; j < chips.length; j++) chips[j].classList.remove("active");
        this.classList.add("active");
        loadKitchen(currentKitchenMode.web);
      });
    }
    $("recipeSearch").addEventListener("keydown", function (e) { if (e.key === "Enter") loadKitchen(currentKitchenMode.web); });
    $("webBtn").addEventListener("click", function () { loadKitchen(true); });
    $("localBtn").addEventListener("click", function () { loadKitchen(false); });
    $("createBtn").addEventListener("click", function () { });
    $("recipeModalClose").addEventListener("click", closeRecipeDetail);
    $("recipeModal").addEventListener("click", function (e) { if (e.target === $("recipeModal")) closeRecipeDetail(); });
    $("detailScale1").addEventListener("click", function () { applyScale(1); });
    $("detailScale2").addEventListener("click", function () { applyScale(2); });
    $("detailScaleHalf").addEventListener("click", function () { applyScale(0.5); });
    $("detailFav").addEventListener("click", function () { if (detailRecipe) toggleFavorite(detailRecipe.id, !detailRecipe.favorite); });
    $("saveCfg").addEventListener("click", saveSettings);
    $("testTTS").addEventListener("click", testTTS);
    $("testWake").addEventListener("click", testWake);
    $("requestMicBtn").addEventListener("click", requestMicPermission);
    $("volUpBtn").addEventListener("click", function () { adjustVolume(0.1); });
    $("volDownBtn").addEventListener("click", function () { adjustVolume(-0.1); });
    $("volMuteBtn").addEventListener("click", toggleMute);
    $("unlockBtn").addEventListener("click", function () { unlockJarvis($("twPassword").value); });
    $("lockBtn").addEventListener("click", lockJarvis);
    $("minimizeBtn").addEventListener("click", minimizeJarvis);
    $("restoreBtn").addEventListener("click", restoreJarvis);
  }

  // ------------------------------------------------------------
  // Kitchen / Nutrition
  // ------------------------------------------------------------
  var currentKitchenMode = { web: false };
  var currentRecipes = [];
  var detailRecipe = null;

  function getActiveCategory() {
    var active = document.querySelector(".filter-chip.active");
    return active ? (active.getAttribute("data-cat") || "") : "";
  }

  function loadKitchen(web) {
    currentKitchenMode.web = !!web;
    var query = $("recipeSearch").value.trim();
    var category = getActiveCategory();
    $("webBtn").classList.toggle("active", !!web);
    $("localBtn").classList.toggle("active", !web);
    $("statSource").textContent = web ? "WEB" : "LOCAL";
    var url = web ? "/api/web_search" : "/api/recipes";
    var params = ["q=" + encodeURIComponent(query || "")];
    if (category) params.push("cat=" + encodeURIComponent(category));
    api(url + "?" + params.join("&")).then(function (d) {
      var list = d.recipes || [];
      currentRecipes = list;
      $("statCount").textContent = list.length;
      $("statFav").textContent = list.filter(function (r) { return r.favorite; }).length;
      var cats = {};
      list.forEach(function (r) { if (r.category) cats[r.category] = 1; });
      $("statCat").textContent = Object.keys(cats).length;
      $("recipeList").innerHTML = "";
      if (!list.length) {
        $("recipeList").appendChild(el("div", "empty", "NO RECIPES FOUND"));
        return;
      }
      for (var i = 0; i < list.length; i++) {
        $("recipeList").appendChild(renderRecipeCard(list[i]));
      }
    }).catch(function () { });
  }

  function renderRecipeCard(r) {
    var card = document.createElement("div");
    card.className = "card";
    card.dataset.id = r.id;

    var imgWrap = document.createElement("div");
    imgWrap.style.width = "100%";
    imgWrap.style.height = "150px";
    imgWrap.style.background = "#050505";
    imgWrap.style.overflow = "hidden";
    if (r.image) {
      var img = document.createElement("img");
      img.src = r.image;
      img.alt = r.name;
      img.onerror = function () { this.style.display = "none"; };
      imgWrap.appendChild(img);
    }
    card.appendChild(imgWrap);

    var body = el("div", "card-body");
    var tag = el("div", "tag", (r.category || "RECIPE").toUpperCase());
    var title = el("h3", "", (r.name || "Untitled").toUpperCase());
    var desc = el("div", "desc", r.description || summaryText(r));
    var badges = el("div", "badge-row");
    if (r.favorite) badges.appendChild(el("span", "badge fav", "★ FAV"));
    if (currentKitchenMode.web) badges.appendChild(el("span", "badge web", "WEB"));
    if (r.ingredients && r.ingredients.length) badges.appendChild(el("span", "badge", r.ingredients.length + " INGREDIENTS"));
    if (r.instructions && r.instructions.length) badges.appendChild(el("span", "badge", r.instructions.length + " STEPS"));
    body.appendChild(tag);
    body.appendChild(title);
    body.appendChild(desc);
    body.appendChild(badges);
    card.appendChild(body);

    var footer = el("div", "card-footer");
    var openBtn = el("button", "lcars-btn primary", "OPEN");
    openBtn.addEventListener("click", function (e) { e.stopPropagation(); openRecipeDetail(r.id); });
    var favBtn = el("button", "lcars-btn fav" + (r.favorite ? " active" : ""), r.favorite ? "★" : "☆");
    favBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleFavorite(r.id, !r.favorite); });
    footer.appendChild(openBtn);
    footer.appendChild(favBtn);
    card.appendChild(footer);

    card.addEventListener("click", function () { openRecipeDetail(r.id); });
    return card;
  }

  function summaryText(r) {
    var parts = [];
    if (r.ingredients && r.ingredients.length) parts.push(r.ingredients.length + " ingredients");
    if (r.instructions && r.instructions.length) parts.push(r.instructions.length + " steps");
    if (!parts.length) return "Tap to view details.";
    return parts.join(" · ");
  }

  function openRecipeDetail(id) {
    detailRecipe = currentRecipes.find(function (r) { return r.id === id; });
    if (!detailRecipe) return;
    $("detailName").textContent = (detailRecipe.name || "RECIPE").toUpperCase();
    $("detailDesc").textContent = detailRecipe.description || summaryText(detailRecipe);
    var meta = $("detailMeta");
    meta.innerHTML = "";
    if (detailRecipe.category) meta.appendChild(el("span", "detail-tag", detailRecipe.category.toUpperCase()));
    if (detailRecipe.favorite) meta.appendChild(el("span", "detail-tag fav", "★ FAVORITE"));

    var img = $("detailImg");
    if (detailRecipe.image) {
      img.src = detailRecipe.image;
      img.style.display = "block";
      img.onerror = function () { img.style.display = "none"; };
    } else {
      img.style.display = "none";
    }

    var ingList = $("detailIngredients");
    ingList.innerHTML = "";
    if (detailRecipe.ingredients && detailRecipe.ingredients.length) {
      detailRecipe.ingredients.forEach(function (item) {
        ingList.appendChild(el("li", "", item));
      });
    } else {
      ingList.appendChild(el("li", "", "No ingredients recorded."));
    }

    var stepList = $("detailInstructions");
    stepList.innerHTML = "";
    if (detailRecipe.instructions && detailRecipe.instructions.length) {
      detailRecipe.instructions.forEach(function (step) {
        stepList.appendChild(el("li", "", step));
      });
    } else {
      stepList.appendChild(el("li", "", "No instructions recorded."));
    }

    $("detailFav").textContent = detailRecipe.favorite ? "★ UNFAVORITE" : "☆ FAVORITE";
    $("detailFav").classList.toggle("active", !!detailRecipe.favorite);
    $("recipeModal").classList.add("show");
    $("recipeModal").setAttribute("aria-hidden", "false");
  }

  function closeRecipeDetail() {
    $("recipeModal").classList.remove("show");
    $("recipeModal").setAttribute("aria-hidden", "true");
    detailRecipe = null;
  }

  function toggleFavorite(id, fav) {
    api("/api/recipes/" + id + "/favorite", { method: "POST", body: JSON.stringify({ favorite: !!fav }) })
      .then(function () { loadKitchen(currentKitchenMode.web); if (detailRecipe && detailRecipe.id === id) openRecipeDetail(id); })
      .catch(function () { });
  }

  function applyScale(factor) {
    if (!detailRecipe) return;
    api("/api/scale", { method: "POST", body: JSON.stringify({ recipe_id: detailRecipe.id, factor: factor }) })
      .then(function (d) {
        var lines = (d.result || "").split("\n");
        var ingList = $("detailIngredients");
        ingList.innerHTML = "";
        lines.slice(1).forEach(function (line) {
          if (line.trim()) ingList.appendChild(el("li", "", line.replace(/^- /, "")));
        });
      })
      .catch(function () { });
  }
  // ------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------
  function loadSettings() {
    $("cfgHost").value = cfg.ollama_host;
    $("cfgModel").value = cfg.model;
    $("cfgHostTools").checked = !!cfg.host_tools;
    $("cfgSpeak").checked = !!cfgGet("voice.speak");
    $("cfgListen").checked = !!cfgGet("voice.wake_word");
    $("cfgMaxReply").value = cfg.max_reply_chars || 300;
    setWakeToggle();
    refreshSettingsTiles();
  }

  function refreshSettingsTiles() {
    var core = $("tileCore"); var coreVal = $("valCore");
    var top = $("topStatus");
    var online = top && top.textContent.indexOf("ONLINE") !== -1;
    if (core && coreVal) { core.classList.toggle("on", online); core.classList.toggle("error", !online); coreVal.textContent = online ? "ONLINE" : "OFFLINE"; }
    var model = $("tileModel"); var modelVal = $("valModel");
    if (model && modelVal) { model.classList.toggle("on", !!cfg.model); modelVal.textContent = (cfg.model || "-").toUpperCase(); }
    var tts = $("tileTTS"); var ttsVal = $("valTTS");
    var ttsOn = !!cfgGet("voice.speak");
    if (tts && ttsVal) { tts.classList.toggle("on", ttsOn); ttsVal.textContent = ttsOn ? "ON" : "OFF"; }
    var wake = $("tileWake"); var wakeVal = $("valWake");
    var wakeOn = !!cfgGet("voice.wake_word");
    if (wake && wakeVal) { wake.classList.toggle("on", wakeOn); wakeVal.textContent = wakeOn ? "ARMED" : "STANDBY"; }
  }

  function saveSettings() {
    var payload = {
      ollama_host: $("cfgHost").value.trim(),
      model: $("cfgModel").value.trim(),
      host_tools: $("cfgHostTools").checked,
      voice: { speak: $("cfgSpeak").checked, wake_word: $("cfgListen").checked },
      max_reply_chars: parseInt($("cfgMaxReply").value, 10) || 300,
    };
    api("/api/config", { method: "POST", body: JSON.stringify(payload) }).then(function (d) {
      $("cfgStatus").textContent = "Saved -> " + d.ollama_host + " (model: " + d.model + ")";
      cfg.ollama_host = d.ollama_host; cfg.model = d.model; cfg.host_tools = !!d.host_tools;
      cfg.voice = d.voice || cfg.voice;
      cfg.max_reply_chars = d.max_reply_chars || 300;
      setWakeToggle();
      updateWakeStatus();
      checkHealth();
      refreshSettingsTiles();
    }).catch(function () { $("cfgStatus").textContent = "Save failed."; });
  }

  function testTTS() { speak("JARVIS text to speech is operational."); }
  function testWake() {
    api("/api/wake_status").then(function (d) {
      var s = $("cfgStatus");
      if (!s) return;
      if (!d.available) s.textContent = "Wake word not available.";
      else if (d.armed) s.textContent = "Wake word armed. Say Hey JARVIS.";
      else if (d.enabled) s.textContent = "Wake word enabled but busy.";
      else s.textContent = "Wake word disabled. Toggle it on.";
    }).catch(function () { $("cfgStatus").textContent = "Wake status check failed."; });
  }

  function buildBottomNav() {
    var bar = $("bottomnav");
    bar.innerHTML = "";
    ["assistant", "kitchen", "settings"].forEach(function (v) {
      var b = el("button", "rail-nav" + (v === "assistant" ? " active" : ""), v.toUpperCase());
      b.setAttribute("data-view", v);
      b.addEventListener("click", function () { setView(v); });
      bar.appendChild(b);
    });
  }

  // ------------------------------------------------------------
  // Init
  // ------------------------------------------------------------
  function init() {
    buildBottomNav();
    wire();
    connectEvents();

    // In kiosk mode the native Python app owns mic/TTS/minimize.
    // Hide browser-only UI so the page doesn't behave like a restricted tab.
    if (IS_KIOSK) {
      var micCard = $("requestMicBtn");
      if (micCard) {
        var card = micCard.closest(".config-card");
        if (card) card.style.display = "none";
      }
      var micBtn = $("micBtn");
      if (micBtn) {
        micBtn.title = "Voice input is handled by the native JARVIS app";
        micBtn.classList.add("kiosk-native");
      }
      klog("KIOSK MODE: native bridges active");
      updateMicReadout("granted", "Native kiosk audio");
    }

    loadConfig().then(function () {
      checkHealth();
      updateSystemInfo();
      setWakeToggle();
      updateWakeStatus();
      pollWakeStatus();
      setInterval(pollWakeStatus, 3000);
      startScreensaverIdleTimer();
    });
    addMsg("jarvis", "Core online. What do you need?");
    if (cfgGet("voice.speak")) speak("JARVIS online and ready.");
  }
  window.init = init;
  window.startListening = startListening;
  window.stopListening = stopListening;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  // ------------------------------------------------------------
  // Idle screensaver
  // ------------------------------------------------------------
  var idleTimer = null;
  var idleTimeoutMs = 60000;

  function showScreensaver() {
    console.log("[screensaver] idle timeout reached, showing");
    if (window.jarvisScreensaver && !window.jarvisScreensaver.isActive()) {
      window.jarvisScreensaver.show();
    }
  }

  function resetScreensaverTimer() {
    if (window.jarvisScreensaver && window.jarvisScreensaver.isActive()) {
      console.log("[screensaver] activity detected, hiding");
      window.jarvisScreensaver.hide();
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(showScreensaver, idleTimeoutMs);
  }

  function startScreensaverIdleTimer() {
    var ssaver = cfg.screensaver || {};
    console.log("[screensaver] init enabled=" + ssaver.enabled + " timeout=" + (ssaver.timeout_seconds || 60));
    if (!ssaver.enabled) return;
    idleTimeoutMs = Math.max(5000, (ssaver.timeout_seconds || 60) * 1000);

    var events = ["mousedown", "mousemove", "touchstart", "touchmove", "keydown", "wheel"];
    events.forEach(function (e) {
      document.addEventListener(e, resetScreensaverTimer, { passive: true });
    });

    // Tap/click on the screensaver itself hides it
    var overlay = $("screensaver");
    if (overlay) {
      overlay.addEventListener("click", function () {
        console.log("[screensaver] overlay clicked, hiding");
        if (window.jarvisScreensaver) window.jarvisScreensaver.hide();
        resetScreensaverTimer();
      });
      overlay.addEventListener("touchstart", function () {
        console.log("[screensaver] overlay touched, hiding");
        if (window.jarvisScreensaver) window.jarvisScreensaver.hide();
        resetScreensaverTimer();
      }, { passive: true });
    }

    resetScreensaverTimer();
  }
})();
klog("APPJS LOADED bridge=" + (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.jarvisSpeak ? "yes" : "no") + " voiceSpeak=" + cfgGet("voice.speak"));

