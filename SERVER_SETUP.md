# JARVIS Next — Server setup

This guide is for the trimmed feature/jarvis-next-lean-server-20261025 branch. It keeps the chatbot, local voice code, optional Piper voice assets, tests, and OpenClaw handoff docs while excluding the old LCARS reference application and unused full-dashboard assets.

## Get this branch

For a new checkout, run:

    git clone --branch feature/jarvis-next-lean-server-20261025 --single-branch https://github.com/kaydenhaas49-sys/JARVIS.git JARVIS-next
    cd JARVIS-next
    git lfs pull

If you already have a Git checkout, run git fetch origin feature/jarvis-next-lean-server-20261025 and inspect your worktree before switching branches. If you transferred source using WinSCP, compare it with the branch before replacing any files. Do not copy the laptop's .venv or secret .env file.

## Python environment

Python 3.10 or newer is required. From the project directory:

    python3 --version
    python3 -m venv .venv
    .venv/bin/python -m pip install -e .

The basic chat backend uses the Python standard library. Optional local microphone transcription and wake-word dependencies are not required just to run text chat. Install the .[voice] extra only when this server will actually use local voice input; follow README.md for the separate openWakeWord install.

## Model configuration

Only copy .env.example if no .env already exists. Configure a model that is installed on this server:

    cp .env.example .env
    nano .env
    chmod 600 .env

Set JARVIS_HOST=127.0.0.1 and JARVIS_PORT=8765. For Ollama's native API use JARVIS_BASE_URL=http://127.0.0.1:11434; for an OpenAI-compatible server use its actual base URL ending in /v1. Set JARVIS_MODEL to the exact model identifier advertised by that server. Do not assume the laptop's localhost is the same as the server's localhost.

Do not bind to 0.0.0.0 or a public address unless you deliberately configure strong JARVIS authentication and a private firewall. Prefer private Tailscale access or an SSH tunnel for remote access.

## Run and verify

Start in a foreground terminal first:

    .venv/bin/python -u jarvis.py

In a second terminal, check:

    curl -fsS http://127.0.0.1:8765/api/health
    curl -fsS http://127.0.0.1:8765/api/ping

Then test chat:

    curl -sS --max-time 150 -X POST http://127.0.0.1:8765/api/chat -H 'Content-Type: application/json' -d '{"session_id":"jarvis-test","message":"Reply with exactly JARVIS_OK. Do not call tools."}'

The JARVIS API expects session_id and message and returns a reply. It does not accept OpenAI's chat-completions payload at this endpoint. Use a persistent terminal session or user service when you need JARVIS to keep running after disconnecting.

## Piper voice assets

The Piper ONNX model is tracked with Git LFS under voice-assets/. Run git lfs pull after cloning. If the model is still a small text pointer, Git LFS has not downloaded the real model. JARVIS falls back to browser speech if local Piper is unavailable.

## Qwen and OpenClaw

Qwen TTS is optional. Do not install it until standard JARVIS chat works. See README.md for Qwen prerequisites and OPENCLAW_SETUP.md for the private Gateway handoff configuration. Never expose the OpenClaw gateway or JARVIS port to the public internet.
