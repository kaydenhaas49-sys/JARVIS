# JARVIS — Local AI Assistant

JARVIS is a local-first personal AI assistant with a futuristic web dashboard, optional browser voice controls, and tools for working inside a dedicated development workspace. It connects to an OpenAI-compatible model API, so your prompts and code can stay on your own machine when you use a local model server.

## Features

- Chat with a local model through llama.cpp, LM Studio, or another OpenAI-compatible endpoint.
- Voice input and spoken responses in supported browsers, with a reactive holographic core.
- Model manager to discover compatible server models and save the selected model/endpoint locally.
- Persistent memory injected into future chats; memory requests made in chat require approval.
- Searchable local-file chat history with reopen, delete, and JSON export; reopening restores saved user/assistant text context.
- Consolidated sidebar: System Console groups system status, model configuration, and activity; Memory & archive groups AI memory, Quick Notes, and Chat History.
- Combined Kitchen / Recipe Saver panel with groceries, pantry, meal plans, timers, searchable recipes, favorites, and JSON import/export.
- Assistant data tools for recipes, Quick Notes, groceries, pantry, meal-plan entries, timers, memories, chat archives, activity, and dashboard status, connected to the same saved records shown in the UI.
- Combined Memory / Quick Notes panel: both AI memory and Quick Notes are saved to local files; Quick Notes stay separate from AI memory.
- Recipe Saver with ingredients, instructions, category/search filters, favorites, servings and cooking time, and JSON import/export compatible with the older JARVIS Kitchen `recipes.json` format.
- Live activity feed, saved as a local JSON file without copying full message text into the feed.
- Kitchen panel with grocery checklist, pantry inventory, weekly meal notes, and browser-based timers.
- Coding workspace tools for listing, reading, searching, editing files, and approval-gated developer commands.
- Built-in tools for time, system status, listing files, reading files, and searching your workspace.
- File writes and terminal commands pause for your explicit approval in the UI.
- Local-only HTTP server by default; model API credentials remain on the server.
- Python standard library backend with no required pip dependencies.

## Quick start

1. Install Python 3.10 or newer.
2. Start your OpenAI-compatible local model server.
3. Copy `.env.example` to `.env` and configure the endpoint and model name, or export the variables directly.
4. Run `python3 jarvis.py`.
5. Open http://127.0.0.1:8765.

The default endpoint is `http://127.0.0.1:11434`, using Ollama's native `ollama serve` API. JARVIS discovers models via `/api/tags` and chats via `/api/chat` (no `/v1` required). For llama.cpp or LM Studio, enter the documented OpenAI-compatible endpoint, usually ending in `/v1`.

JARVIS creates ~/JARVIS-workspace for files it can browse and edit. Persistent application data is saved as ordinary files under ~/.local/share/jarvis/ (or the directory set by JARVIS_DATA_DIR): recipes.json, notes.json, kitchen.json, chat-history.json, activity.json, memory.json, settings.json, and system-memory.md. dashboard-index.json tracks one-time migration state. Existing browser-local data from older versions is imported once and then removed from browser storage. Older dashboard-data.json files are read as a migration source and left in place as a backup; ongoing writes go to the separate JSON files. Chat archives retain the latest 25 conversations and up to 40 messages per conversation. File tools are deliberately scoped to the workspace, while JARVIS's internal dashboard tools maintain the app's own data files. Terminal actions and workspace file writes require you to approve the exact action in the dashboard.

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

The dashboard server binds to loopback by default and does not expose an endpoint for arbitrary shell commands without review. The assistant can use read-only workspace tools automatically. Writing files and running allowlisted developer commands requires a clear, per-action approval. File paths are resolved and restricted to the workspace. Do not expose this server to the public internet.

## Tests

Run `python3 -m unittest discover -s tests -v`.

## Current scope

JARVIS is a practical, extensible foundation—not a magical always-on operating-system replacement. Browser voice recognition depends on browser support and permissions. A compatible model server must be running for AI chat; non-AI status endpoints work independently.
