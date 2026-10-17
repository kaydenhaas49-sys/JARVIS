#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
QWEN_PYTHON="${JARVIS_QWEN_PYTHON:-$HOME/qwen-tts-test/.venv/bin/python}"
LOG_DIR="$HOME/.local/share/jarvis"
LOG_FILE="$LOG_DIR/qwen-tts.log"
QWEN_URL="${JARVIS_QWEN_TTS_URL:-http://127.0.0.1:8766}"

if [[ ! -x "$QWEN_PYTHON" ]]; then
  echo "Qwen Python environment not found: $QWEN_PYTHON"
  echo "Set JARVIS_QWEN_PYTHON to the Python executable in your qwen-tts-test environment."
  exit 1
fi
if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo "JARVIS virtual environment not found at $ROOT/.venv/bin/python."
  exit 1
fi
if [[ ! -f "${JARVIS_QWEN_REFERENCE_AUDIO:-$HOME/jarvis-reference.wav}" ]]; then
  echo "Reference recording missing. Expected $HOME/jarvis-reference.wav."
  echo "Set JARVIS_QWEN_REFERENCE_AUDIO to the recording you tested in Qwen."
  exit 1
fi
if curl -fsS "$QWEN_URL/health" >/dev/null 2>&1; then
  echo "Qwen voice service is already running at $QWEN_URL; starting JARVIS."
  exec "$ROOT/.venv/bin/python" "$ROOT/jarvis.py"
fi
if curl -fsS http://127.0.0.1:8000/ >/dev/null 2>&1; then
  echo "The Qwen demo is still running on port 8000."
  echo "Stop it with Ctrl+C first so it does not compete for GPU memory."
  exit 1
fi

mkdir -p "$LOG_DIR"
"$QWEN_PYTHON" "$ROOT/qwen_tts_service.py" >"$LOG_FILE" 2>&1 &
QWEN_PID=$!
cleanup() {
  kill "$QWEN_PID" 2>/dev/null || true
  wait "$QWEN_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Loading the Qwen voice. Startup log: $LOG_FILE"
READY=0
for _ in $(seq 1 240); do
  if ! kill -0 "$QWEN_PID" 2>/dev/null; then
    echo "Qwen failed to start. Last log lines:"
    tail -n 80 "$LOG_FILE" || true
    exit 1
  fi
  if curl -fsS "$QWEN_URL/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 1
done
if [[ "$READY" != "1" ]]; then
  echo "Qwen voice startup timed out. Last log lines:"
  tail -n 80 "$LOG_FILE" || true
  exit 1
fi

echo "Qwen voice ready. Starting JARVIS..."
"$ROOT/.venv/bin/python" "$ROOT/jarvis.py"
