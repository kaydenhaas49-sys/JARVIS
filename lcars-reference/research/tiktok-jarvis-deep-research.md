# Deep Research: "TikTok JARVIS" Style Smart Home AI Builds

**Date:** 2026-08-20  
**Requested by:** User  
**Status:** Research only — no code or commands executed.

---

## 1. What People Mean by "TikTok JARVIS"

The trend is cinematic Iron Man-style AI assistants for the home. Common features:

- Wake word activation ("Hey JARVIS", "JARVIS", sometimes "Friday")
- Voice conversation powered by a large language model
- Animated, futuristic HUD / face on a screen or holographic display
- Smart home control (lights, thermostat, media, PC, garage, etc.)
- Sound effects, boot phrases, status readouts
- Often wall-mounted kiosk, desk display, or Pepper's ghost pyramid

---

## 2. Notable Projects / Creators Found

### Arthur Kerekes (@arthurkerekes on TikTok)
- Built a working AI JARVIS with memory, tools, permissions, purpose.
- Uses Claude + Codex models that cross-verify outputs.
- Runs up to 6 specialized agents in parallel for complex problems.
- Voice interface + personal knowledge graph.
- Mobile phone access.
- Source: YouTube demo "I Built My Own AI JARVIS — It Remembers Everything, Runs 6 Agents & Actually Works"

### Jasmine Plows (Raspberry Pi + ChatGPT JARVIS)
- Simple Python voice assistant on Raspberry Pi 4B.
- Stack: `speech_recognition` + `pyttsx3` + OpenAI `text-davinci-003`.
- Wake phrase: "Hey, Jarvis!"
- Works as a conversational assistant; smart home expansion left as future work.
- GitHub: `jasmineplows/jarvis`

### Dallin Stewart — "Lila" Virtual Assistant
- Python desktop assistant inspired by JARVIS.
- Features: greet, time/date, weather, open apps, Google search, YouTube, Gmail, calendar, Todoist, Wolfram Alpha, screenshots, GitHub push/pull.
- Uses `speech_recognition` and `pyttsx3`.
- GitHub: `binDebug3/VirtualAssistant`

### mattmaas — Jarvis-Assistant-for-HASS
- AI voice assistant integrating directly with Home Assistant.
- Features: auto pipeline selection, RGB lighting via OpenRGB, advanced computer interfacing.
- Wake word: "Jarvis"
- Persistent memory, research tools, code execution, multi-agent cooperation.
- GitHub: `mattmaas/Jarvis-Assistant-for-HASS`

### C33Tech — "JARVIS Over the Weekend"
- Practical Home Assistant voice assistant build.
- Hardware: Raspberry Pi + USB speakerphone.
- Uses Home Assistant's "Year of Voice" pipeline + custom wake word "Hey Jarvis".
- OpenAI integration for richer responses.
- Notes that HA's built-in voice commands are currently limited; OpenAI can't yet directly manipulate devices, so custom commands bridge the gap.
- Source: c33tech.com blog

### judahpaul16 / gpt-home
- Full-featured "ChatGPT at home" alternative to Alexa/Google.
- Built on Raspberry Pi using LiteLLM + LangGraph.
- Docker compose stack: backend (Python/FastAPI + voice), frontend (React), nginx, PostgreSQL+pgvector memory, Spotify Connect.
- Integrations: OpenAI, Spotify, Philips Hue, OpenWeatherMap, alarms, reminders, CalDAV calendar, persistent memory, display support.
- GitHub: `judahpaul16/gpt-home`

### Sidhant Pande — J.A.R.V.I.S. Holographic Intelligent System
- LLaMA 3.3 70B + real-time internet + autonomous task execution.
- Decision Making Model (DMM) maps natural language to system commands and web actions.
- Source: sidhantpande.in

### Holographic / Display Builds
- Pepper's ghost acrylic pyramid using a tablet/phone screen or projector.
- Four-pane video trick; common for sci-fi "floating" visuals.
- Can be combined with a JARVIS UI running in a browser.
- Some builds use MediaPipe hand tracking or Leap Motion for gesture control.

---

## 3. Common Technology Stack

| Layer | Common Choices |
|-------|----------------|
| Wake word | Porcupine, Snowboy, openWakeWord, Home Assistant Wyoming, custom model |
| Speech-to-text | Whisper / faster-whisper, Web Speech API, Google Speech Recognition, VOSK |
| LLM brain | GPT-4o / ChatGPT, Claude, local models via Ollama (LLaMA, Qwen, Gemma) |
| Text-to-speech | ElevenLabs, pyttsx3, Piper, Coqui, gTTS |
| Smart home bridge | Home Assistant REST/WebSocket API, MQTT, direct protocols (Kasa, WLED, ESPHome) |
| Backend | Python (FastAPI/Flask) or Node.js |
| Frontend | HTML/CSS/JS, React, Three.js/WebGL for HUD/face |
| Realtime UI updates | WebSockets |
| Hardware | Raspberry Pi 4/5, USB mic/speaker, ReSpeaker mic array, wall screen, projector |

---

## 4. Key Design Patterns Observed

1. **Brain + Face split**: a backend orchestrator handles voice/LLM/commands; a web frontend shows status/animations.
2. **Home Assistant as a stepping stone**: many serious builds keep HA as the device backplane while replacing the voice/UX layer.
3. **LLM for conversation, hard-coded mapping for control**: safest current pattern. LLM decides intent, then a rigid tool layer executes device actions so it can't hallucinate garage openings.
4. **Persistent memory**: vector store (pgvector, etc.) for remembering user facts and context.
5. **Multi-agent for hard tasks**: route research/coding/math to specialized agents.
6. **Always-on wake word**: local detection triggers cloud STT/LLM only after activation.

---

## 5. What This Means for Our JARVIS

We already have a strong foundation:
- Pi 5 display node running Chromium kiosk
- OpenClaw host serving a web UI
- Existing Home Assistant instance with real devices

To move toward the "TikTok JARVIS" feel, the logical additions are:
1. Voice input/output on the Pi (mic + speaker)
2. Wake word detection running locally
3. Animated assistant face / HUD on the kiosk screen
4. Natural-language command routing to control HA devices
5. Optional: holographic display or secondary ambient UI
6. Optional: persistent memory / knowledge graph

Recommended incremental approach:
- Phase 1: add voice + wake word + TTS to the existing kiosk, route commands to Home Assistant API.
- Phase 2: replace/augment the UI with an animated JARVIS-style HUD.
- Phase 3: selectively build native device drivers to reduce dependence on HA.
- Phase 4: add memory, multi-agent, and personalization.

---

## 6. Sources

- YouTube: Arthur Kerekes — "I Built My Own AI JARVIS"
- Medium / GitHub: jasmineplows/jarvis
- GitHub: binDebug3/VirtualAssistant (Dallin Stewart)
- GitHub: mattmaas/Jarvis-Assistant-for-HASS
- c33tech.com — "I Made Myself a JARVIS Over the Weekend"
- GitHub: judahpaul16/gpt-home
- sidhantpande.in — J.A.R.V.I.S. Holographic Intelligent System
- Raspberry Pi tutorials on multilingual conversational AI assistants and kiosk mode
- Instructables / YouTube: Pepper's ghost hologram projector builds

---

---

# Round 2 — High-Feature / "Cool" TikTok JARVIS Builds

**Date:** 2026-08-20 (continued same day)  
**Focus:** overnight studying, automated tasks, productivity agents, morning briefings, emotional voice, vision/awareness, desktop/PC control.

---

## 1. Arthur Kerekes Revisited — Agentic Layer

- JARVIS remembers personal stories, projects, preferences.
- Claude + Codex work together and cross-verify.
- Up to 6 specialized agents run in parallel for complex problems.
- Mobile phone access + personal knowledge graph.
- This is the benchmark for "does things for you, not just answers questions."

---

## 2. OpenJarvis (Stanford / Hazy Research / Scaling Intelligence)

- Open-source framework for **local-first personal AI** on your own hardware.
- Built-in Ollama support; default runs local models, cloud optional.
- Tracks energy, cost, latency, FLOPs alongside accuracy.
- Built-in presets/agents:
  - **Morning briefing** — calendar + email + news digest
  - **Research across files** — web + local docs with citations
- CLI-first but also has desktop GUI (.exe/.dmg/.AppImage/.deb/.rpm).
- Install: `curl -fsSL https://open-jarvis.github.io/OpenJarvis/install.sh | bash`
- GitHub: `open-jarvis/OpenJarvis`

This is essentially a research-grade, local-first JARVIS stack.

---

## 3. Hermes Agent (Nous Research)

- **Self-hosted, MIT licensed**, persistent AI agent.
- Runs as a daemon on your server.
- Persistent memory stored as markdown in `~/.hermes/`.
- **Automated skill creation**: when it solves a hard problem, it writes a reusable skill.
- Multi-platform gateway: Telegram, Discord, Slack, WhatsApp, Signal, CLI.
- **Built-in cron scheduler** for unattended automations.
- Parallel sub-agents, full browser automation, vision, image gen, TTS, multi-model.
- Security: local terminal, Docker sandbox, SSH remote execution.
- Direct comparison: very close to OpenClaw — wider surfaces vs. self-improving skills.

Use cases that map directly to the user's request:
- Morning briefings delivered to phone/terminal
- Overnight study/task prep
- PR review automation, monitoring alerts
- Persistent project memory across sessions

---

## 4. n8n "Jarvis" Productivity AI Agent

- Telegram as the command hub.
- OpenAI for NLU.
- Integrations via MCPs:
  - Tasks (create/complete/delete)
  - Calendar (schedule/reschedule/check availability)
  - Gmail (send/draft/fetch)
  - Google Contacts
  - Expense tracking
- Optional ElevenLabs TTS for audio notes.
- Good reference for how a command router + tools pattern can consolidate productivity tasks.

---

## 5. C33Tech / Home Assistant "Year of Voice" Build

- Raspberry Pi + USB speakerphone.
- HA wake word "Hey Jarvis" + local Whisper STT + Piper TTS.
- OpenAI enrichment for smarter responses.
- Key limitation noted: HA's built-in voice commands are still narrow; OpenAI can't directly manipulate HA devices without custom command bridges.
- This is the most realistic "weekend build" path for our existing stack.

---

## 6. Tired Dad Tech — Private Voice Assistant Stack

- Home Assistant on mini PC/Proxmox.
- Mac mini M1 for heavier local LLM.
- Raspberry Pi 4 as physical voice satellite.
- Jabra speakerphone for room-scale audio.
- openWakeWord + Wyoming satellite + Whisper + Piper — all local.
- **Architecture insight:** route commands before questions.
  - Simple commands (lights/TV) → Home Assistant.
  - Open-ended questions → Mac mini LLM → spoken back through Pi.
- Real-world tuning issues: crackly audio, false wake triggers, LLM latency.

This is the gold-standard reference for a privacy-first, distributed JARVIS voice stack.

---

## 7. Daily Briefing (ndiesslin.com)

- Containerized Python service that generates a physical "morning paper."
- Pulls weather, crypto prices, RSS.
- Adds word of the day, historical facts, daily quote, Sudoku, xkcd.
- Schedules internally using Python `schedule` library.
- Prints to a home printer via CUPS.
- Key idea: **automation that produces a tangible artifact every morning** — a great "cool factor" to add to JARVIS.

---

## 8. Emotional / Mood-Aware Voice

- Fictional JARVIS is calm, polite, articulate, British-accented, slightly witty.
- Real tools to approximate this:
  - **ElevenLabs**: custom voice clones, emotion control.
  - **Hume AI EVI/Octave**: empathic, expression-aware real-time voice.
  - **Typecast**: 700+ voices, "Smart Emotion" auto-adjusts to script context.
  - **Noiz AI**: empathetic/mood voice AI.
  - **Piper**: local, fast, but less emotional range.
- For a cinematic JARVIS, ElevenLabs or Hume give the most personality; Piper keeps it local and private.

---

## 9. Vision / Room Awareness

- Many JARVIS-inspired projects add camera/vision:
  - People recognition / personalized greetings.
  - Object detection.
  - Scene understanding (light levels, occupancy, activity).
  - Gesture control (MediaPipe, Leap Motion).
- Integrations:
  - Blue Iris (already in user's HA) could feed JARVIS.
  - Local vision models via Ollama / OpenCV / YOLO.
  - LLM vision APIs (Claude, GPT-4o, Gemini) for scene descriptions.
- Privacy note: local vision keeps footage in-house.

---

## 10. Desktop / PC Automation

Common capabilities in advanced JARVIS builds:
- Open/close applications.
- Browser automation.
- File management.
- System settings / volume / brightness.
- Push code to GitHub.
- Take screenshots.
- Read screen content (OCR / vision).
- For our JARVIS, this means the assistant could control the laptop it's installed on, not just the home.

---

## 11. Overnight / Study Automation Patterns

What "studies for you overnight" actually looks like:
- **Research agent**: reads web/pages/docs, produces summary with citations (OpenJarvis, Hermes, Perplexity-style).
- **Study scheduler**: asks about energy/available hours, builds personalized plan, emails/prints it.
- **Flashcard/quiz generation**: from PDFs/lectures/YouTube.
- **Morning briefing**: calendar + weather + tasks + news + overnight research summary.
- **Task capture**: extract to-dos from emails/messages and schedule them.
- **Spaced repetition reminders**: schedule review prompts.

Tools referenced: Taskade, ClickUp study planner, Atlas, Khanmigo, MindGrasp, StudyTok AI, Notion AI.

---

## 12. Updated Synthesis: What "TikTok Cool" Could Look Like for Our JARVIS

A build that hits the cool/viral notes while being genuinely useful:

| Feature | Cool Factor | Real Utility |
|---------|-------------|--------------|
| Always-listening wake word + cinematic HUD | High | Hands-free control |
| Animated JARVIS face / orb on kiosk | High | Visual feedback |
| Voice with emotion/personality | High | Feels alive |
| Morning briefing (calendar/weather/news/tasks) | Medium-High | Daily orientation |
| Overnight research summary | High | Saves hours |
| Smart home control via HA | Medium | Practical now |
| Desktop/PC control on laptop | Medium | Productivity boost |
| Vision / camera awareness | High | Context, security, personalization |
| Printed daily briefing | Medium-High | Tangible artifact |
| Persistent memory + skills | High | Gets better over time |
| Multi-surface reach (web, Telegram, Signal) | Medium | Reach anywhere |

---

## 13. Strategic Implication

The user wants something closer to **Arthur Kerekes / Hermes / OpenJarvis** than a simple voice light switch. That means:

- JARVIS should be an **agentic orchestrator** with memory and scheduled tasks.
- Home control becomes **one of many tools**, not the whole product.
- The voice/HUD layer is the **presentation**, but the value is the **automation layer** underneath.
- Best starting point: build the **command router + morning briefing + device control** first, then add memory, vision, and emotional voice.

---

## 14. Additional Sources (Round 2)

- YouTube: Arthur Kerekes AI JARVIS demo
- open-jarvis.github.io / arxiv.org/abs/2605.17172
- get-hermes.ai / hermes-agent.org
- n8n.io workflow #8500
- c33tech.com — "I Made Myself a JARVIS Over the Weekend"
- tireddadtech.com — "Jarvis: The Private Voice Assistant"
- ndiesslin.com — "Automating My Morning with a Custom Daily Briefing"
- Hume AI, ElevenLabs, Piper, Typecast, Noiz AI
- Reddit r/selfhosted — self-hosted LLM-native JARVIS discussions
- GitHub: haynieresearch/jarvis

---

**Next step:** synthesize this research into a concrete feature plan, then propose a phased build roadmap. No code or commands executed yet.
