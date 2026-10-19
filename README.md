# JARVIS — Local AI Assistant

JARVIS is a local-first personal AI assistant with a futuristic web dashboard, optional browser voice controls, and tools for working inside a dedicated development workspace. It connects to an OpenAI-compatible model API, so your prompts and code can stay on your own machine when you use a local model server.

## Features

- Chat with a local model through llama.cpp, LM Studio, or another OpenAI-compatible endpoint.
- Hands-free voice conversations: local speech-to-text detects pauses, JARVIS answers aloud, then resumes listening; click the mic again to stop. Browser speech recognition is used only as a fallback when local recording is unavailable.
- Spoken replies use the bundled JARVIS High Piper ONNX voice locally when the model and optional Piper package are available, with browser speech as a fallback. Microphone speech-to-text is also processed locally; microphone audio is not saved.
- Opt-in local "Hey JARVIS" wake word with one-shot command capture, automatic re-arming after the answer, and a visible on/off indicator.
- Voice input and wake-word processing can run on-device with the optional voice dependencies; microphone audio is not stored.
- Model manager to discover compatible server models and save the selected model/endpoint locally.
- Persistent memory injected into future chats, with review, edit, save, and delete controls; memory requests made in chat require approval.
- Searchable local-file chat history with reopen, delete, and JSON export; reopening restores saved user/assistant text context.
- Consolidated sidebar: System Console includes live CPU/RAM/disk and supported NVIDIA telemetry, model configuration, saved routines, and activity; Memory & archive groups editable AI memory, Quick Notes, and Chat History.
- Saved routines: built-in Gaming prep, Start coding, and Daily briefing templates plus custom reusable prompts. Routines use the regular approval-gated tools when an action would change files, run a command, or launch an app.
- Combined Kitchen / Recipe Saver panel with groceries, pantry, meal plans, timers, searchable recipes, favorites, and JSON import/export.
- Assistant data tools for recipes, Quick Notes, groceries, pantry, meal-plan entries, timers, memories, chat archives, activity, and dashboard status, connected to the same saved records shown in the UI.
- Combined Memory / Quick Notes panel: both AI memory and Quick Notes are saved to local files; Quick Notes stay separate from AI memory.
- Recipe Saver with ingredients, instructions, category/search filters, favorites, servings and cooking time, and JSON import/export compatible with the older JARVIS Kitchen `recipes.json` format.
- Live activity feed, saved as a local JSON file without copying full message text into the feed.
- Kitchen panel with grocery checklist, pantry inventory, weekly meal notes, and browser-based timers.
- Code review cards show unified file diffs before Accept/Reject. Accepted workspace writes receive exact recovery backups, with per-file Undo in Code Review.
- Drag/drop text and code files (read locally into the prompt) plus PNG/JPEG/WebP/GIF images for vision-capable endpoints. Attachments are size-limited and not uploaded to a separate storage service.
- Knowledge Vault: ranked local workspace search with exact file paths and line numbers, plus an action to ask JARVIS using those source excerpts.
- Project profiles and task checklists stored locally, scoped to existing folders inside the JARVIS workspace.
- Local model benchmark for up to three endpoint models, showing wall time and generated-token rate when server metrics are available.
- Ctrl/Cmd+K command palette for fast navigation. A tiny draggable voice-only sphere stays inside the JARVIS browser tab and toggles hands-free voice mode.
- Coding workspace tools for listing, reading, searching, editing files, and approval-gated developer commands.
- Desktop app launcher for installed Linux apps, including Firefox, terminals, Steam, Discord, Blender and creative tools; app launches are allowlisted and approval-gated.
- Built-in tools for time, system status, listing files, reading files, and searching your workspace.
- File writes and terminal commands pause for your explicit approval in the UI. Proposed file writes show a unified diff; accepted writes back up prior bytes and can be undone in Code Review.
- Local-only HTTP server by default; model API credentials remain on the server.
- Python standard library backend with no required pip dependencies; local voice features are an optional extra.

## Quick start

1. Install Python 3.10 or newer.
2. Start your OpenAI-compatible local model server.
3. Copy `.env.example` to `.env` and configure the endpoint and model name, or export the variables directly.
4. Run `python3 jarvis.py`.
5. Open http://127.0.0.1:8765.

The default endpoint is `http://127.0.0.1:11434`, using Ollama's native `ollama serve` API. JARVIS discovers models via `/api/tags` and chats via `/api/chat` (no `/v1` required). For llama.cpp or LM Studio, enter the documented OpenAI-compatible endpoint, usually ending in `/v1`.

JARVIS creates ~/JARVIS-workspace for files it can browse and edit. Persistent application data is saved as ordinary files under ~/.local/share/jarvis/ (or the directory set by JARVIS_DATA_DIR): recipes.json, notes.json, kitchen.json, chat-history.json, activity.json, memory.json, routines.json, projects.json, code-backups.json, settings.json, and system-memory.md. Exact file recovery bytes live under code-backups/. dashboard-index.json tracks one-time migration state. Existing browser-local data from older versions is imported once and then removed from browser storage. Older dashboard-data.json files are read as a migration source and left in place as a backup; ongoing writes go to the separate JSON files. Chat archives retain the latest 25 conversations and up to 40 messages per conversation. File tools are deliberately scoped to the workspace, while JARVIS's internal dashboard tools maintain the app's own data files. Terminal actions and workspace file writes require you to approve the exact action in the dashboard.

## Optional OpenClaw integration

To connect JARVIS to a separate OpenClaw server over private Tailscale, use the guided setup in [OPENCLAW_SETUP.md](OPENCLAW_SETUP.md). The server-side helper is `scripts/setup-openclaw-tailnet.sh`; it asks before making changes and backs up the existing OpenClaw config. OpenClaw credentials are entered in JARVIS's System Console and stored locally, not in this repository. This integration is optional and does not replace the configured JARVIS model or voice.

## Optional local voice setup

Voice input and the "Hey JARVIS" wake word use local speech recognition and local audio detection. Install the optional packages in a project virtual environment (on Linux, also ensure the system PortAudio library is installed):

```bash
cd ~/JARVIS
python3 -m venv .venv
.venv/bin/pip install -e ".[voice]"
.venv/bin/pip install --no-deps "openwakeword>=0.6.0"
.venv/bin/python jarvis.py
```

The separate `--no-deps` install is intentional: JARVIS uses openWakeWord's ONNX backend, but upstream currently declares `tflite-runtime` unconditionally on Linux, and that package has no compatible wheel for newer Python versions. JARVIS installs the ONNX runtime dependencies explicitly instead. Tap the mic button once to start hands-free conversation. JARVIS listens locally for your speech, detects a pause, transcribes the turn, speaks its reply using lcars-reference/jarvis-high.onnx when Piper is available, and resumes listening. Spoken replies fall back to the browser voice if Piper or the model is unavailable. Tap the mic again to stop. If silence detection is unavailable, a turn is capped at 12 seconds. The first transcription downloads the selected Whisper model. The local Piper ONNX voice is bundled through Git LFS; make sure git lfs pull has downloaded its actual model bytes. Install the .[voice] extra in the same virtual environment used to run JARVIS to enable Piper TTS. The wake-word model is downloaded the first time you turn on the visible **Wake on** control. These one-time model downloads need internet access; microphone audio is processed locally and is not saved. Keep this server bound to loopback unless you intentionally configure otherwise.

## Qwen JARVIS voice (optional)

JARVIS can use Qwen3-TTS voice cloning as its preferred local speech engine, with the bundled Piper JARVIS voice as a fallback. Qwen runs in the separate environment where its PyTorch dependencies are installed.

Requirements:
- Qwen installed in `~/qwen-tts-test/.venv` (the environment used by the Qwen demo).
- The reference recording at `~/jarvis-reference.wav`, with transcript: `Good evening. All systems are operational. Shall I proceed, sir?`.

Stop the standalone Qwen demo first (press Ctrl+C in its terminal) so it releases GPU memory. Then stop the normal JARVIS server and run:

```bash
cd ~/JARVIS
git pull
git lfs pull
chmod +x run_jarvis_qwen.sh
./run_jarvis_qwen.sh
```

The launcher starts a loopback-only Qwen service on `127.0.0.1:8766`, waits for the model and reference prompt to load, then starts JARVIS. Ctrl+C stops both. Logs are saved at `~/.local/share/jarvis/qwen-tts.log`. If Qwen fails during an individual synthesis, JARVIS falls back to Piper. To change the reference recording, set `JARVIS_QWEN_REFERENCE_AUDIO` and `JARVIS_QWEN_REFERENCE_TEXT` before launching.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `JARVIS_HOST` | `127.0.0.1` | Bind address. Keep local unless you understand the security implications. |
| `JARVIS_PORT` | `8765` | Dashboard server port. |
| `JARVIS_BASE_URL` | `http://127.0.0.1:8080/v1` | OpenAI-compatible API base URL. |
| `JARVIS_MODEL` | `local-model` | Model identifier accepted by your server. |
| `JARVIS_API_KEY` | empty | Optional API key for compatible servers. Never put it in frontend code. |
| `JARVIS_WORKSPACE` | `~/JARVIS-workspace` | The directory exposed to JARVIS file tools. |

## Safety model

The dashboard server binds to loopback by default and does not expose an endpoint for arbitrary shell commands without review. The assistant can use read-only workspace tools automatically. Writing files, running allowlisted developer commands, and launching allowlisted desktop apps requires a clear, per-action approval. File paths are resolved and restricted to the workspace. Do not expose this server to the public internet.

## Tests

Run `python3 -m unittest discover -s tests -v`.

## Current scope

JARVIS is a practical, extensible foundation—not a magical always-on-operating-system replacement. Browser voice recognition depends on browser support and permissions. A compatible model server must be running for AI chat; non-AI status endpoints work independently.
