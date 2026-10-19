# JARVIS — Personal AI Chatbot

JARVIS is a focused, local-first chatbot with a voice interface. This branch intentionally has **no System Console, app launcher, kitchen, memory/archive pages, workspace dashboard, or settings screens**. The interface is just the conversation, microphone input, spoken replies, and optional local “Hey JARVIS” wake word.

The chatbot can keep everyday conversation with its configured local model and automatically hand clear, advanced engineering or multi-step project tasks to a separately configured OpenClaw agent.

## What it does

- Text chat with an OpenAI-compatible local model server (Ollama, llama.cpp, LM Studio, or a compatible endpoint).
- Spoken answers using the local JARVIS voice service when available, with browser speech synthesis as a fallback.
- Click-to-record voice input, transcribed locally by the optional voice dependencies.
- Optional local “Hey JARVIS” wake detection; it captures a command, sends it through the chat, speaks the answer, and re-arms the wake detector.
- Automatic handoff for substantial code changes, repository work, integrations, migrations, and deep research when OpenClaw is configured.
- Casual chat, quick questions, and simple requests stay with JARVIS. Say “keep this local” to prevent automatic delegation for a request.
- Text-only chat history in the current browser tab. Starting a new chat clears the visible conversation.

Images and attachments are intentionally not part of this minimal interface. The existing backend's chat and approval safeguards remain available for supported tool actions; approvals appear inline inside the conversation.

## Quick start

1. Install Python 3.10 or newer.
2. Start your local model server.
3. Configure the **.env** file from **.env.example** for that model server and model name.
4. Install the optional voice dependencies if you want local speech recognition and the wake word.
5. Run JARVIS and open **http://127.0.0.1:8765**.

For the Qwen voice launcher, use:

\`\`\`bash
cd ~/JARVIS
./run_jarvis_qwen.sh
\`\`\`

For the standard server:

\`\`\`bash
cd ~/JARVIS
python3 jarvis.py
\`\`\`

## Voice setup

The microphone button records a short message; click it again to finish recording and send it. Browser microphone permission is required.

Local transcription and wake-word support use the optional voice dependencies. On Linux, install the system PortAudio library first, then install the optional project dependencies into the Python environment used to run JARVIS:

\`\`\`bash
cd ~/JARVIS
python3 -m venv .venv
.venv/bin/pip install -e ".[voice]"
.venv/bin/pip install --no-deps "openwakeword>=0.6.0"
.venv/bin/python jarvis.py
\`\`\`

The separate **--no-deps** install avoids pulling the upstream Linux **tflite-runtime** dependency, which may not provide a compatible wheel. Wake-word model assets are downloaded on first use and therefore need internet access once. After setup, speech detection and transcription run locally; microphone audio is not stored by JARVIS.

Spoken replies use the bundled Piper JARVIS voice when its model and optional runtime package are available. If local synthesis is not available, JARVIS tries the browser's built-in speech engine.

## OpenClaw handoff

OpenClaw is optional. The chat-only interface deliberately has no settings page: if an OpenClaw connection is already saved under **~/.local/share/jarvis/**, automatic handoff can use it. The connection is kept out of the visible chatbot UI and must be configured out-of-band on a trusted private network. The handoff sends the current request plus a limited excerpt of recent user/assistant messages, not system instructions or tool output. Image-dependent requests stay with JARVIS because the handoff is text-only.

OpenClaw runs with the tools and permissions set on its own server. Only connect a server you trust.

## Network safety

JARVIS listens on **127.0.0.1** by default. Remote access is opt-in and requires Basic authentication with a strong password. For LAN testing, bind to a trusted private interface and use a firewall; do not port-forward JARVIS to the public internet. Basic authentication does not encrypt plain HTTP.

## Data and configuration

Model endpoint, model name, and API key are configured outside the chat UI using **.env**. Local application data remains under **~/.local/share/jarvis/** (or **JARVIS_DATA_DIR**). This branch does not expose data-management or system-setting screens in the browser.
