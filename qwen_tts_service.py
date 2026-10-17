#!/usr/bin/env python3
"""Loopback-only Qwen3-TTS voice-clone service for JARVIS.

Run with the separate environment that has qwen-tts installed, keeping its
PyTorch dependencies isolated from JARVIS's standard environment.
"""
from __future__ import annotations

import io
import json
import logging
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

HOST = os.environ.get("JARVIS_QWEN_HOST", "127.0.0.1")
PORT = int(os.environ.get("JARVIS_QWEN_PORT", "8766"))
MODEL_ID = os.environ.get("JARVIS_QWEN_MODEL", "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
REFERENCE_AUDIO = Path(os.environ.get("JARVIS_QWEN_REFERENCE_AUDIO", str(Path.home() / "jarvis-reference.wav"))).expanduser().resolve()
REFERENCE_TEXT = os.environ.get(
    "JARVIS_QWEN_REFERENCE_TEXT",
    "Good evening. All systems are operational. Shall I proceed, sir?",
)
MAX_TEXT_CHARS = 3500
MAX_REQUEST_BYTES = 24_000
MODEL: Any = None
VOICE_PROMPT: Any = None
GENERATION_LOCK = threading.Lock()


def load_engine() -> None:
    global MODEL, VOICE_PROMPT
    if not REFERENCE_AUDIO.is_file():
        raise FileNotFoundError(
            f"Reference recording not found: {REFERENCE_AUDIO}. Create ~/jarvis-reference.wav first."
        )
    import torch
    from qwen_tts import Qwen3TTSModel

    if not torch.cuda.is_available():
        raise RuntimeError("This Qwen voice setup expects a CUDA GPU.")
    logging.info("Loading %s; the first launch may take a minute.", MODEL_ID)
    MODEL = Qwen3TTSModel.from_pretrained(
        MODEL_ID,
        device_map="cuda:0",
        dtype=torch.bfloat16,
        # Same behavior as qwen-tts-demo --no-flash-attn.
        attn_implementation=None,
    )
    logging.info("Preparing a reusable prompt from the JARVIS reference recording.")
    VOICE_PROMPT = MODEL.create_voice_clone_prompt(
        ref_audio=str(REFERENCE_AUDIO),
        ref_text=REFERENCE_TEXT,
        x_vector_only_mode=False,
    )
    logging.info("Qwen voice engine is ready.")


def prepare_target_text(text: str) -> str:
    """Use a pronunciation-friendly spelling for the name in generated speech only."""
    clean_text = str(text or "").strip()
    # The cloned voice tends to stretch the unfamiliar proper noun "Jarvis".
    # "Jarviss" cues a familiar two-syllable English reading without adding a
    # hyphen/pause; this only affects synthesized audio, not the displayed reply.
    clean_text = re.sub(r"\bJ\s*\.\s*A\s*\.\s*R\s*\.\s*V\s*\.\s*I\s*\.\s*S\s*\.?\b", "Jarviss", clean_text, flags=re.IGNORECASE)
    clean_text = re.sub(r"\bJARVIS\b", "Jarviss", clean_text, flags=re.IGNORECASE)
    return clean_text


def make_wav(text: str) -> bytes:
    clean_text = prepare_target_text(text)
    if not clean_text:
        raise ValueError("Speech text is empty.")
    if len(clean_text) > MAX_TEXT_CHARS:
        raise ValueError("Speech text is too long (maximum 3,500 characters).")
    with GENERATION_LOCK:
        wavs, sample_rate = MODEL.generate_voice_clone(
            text=clean_text,
            language="English",
            voice_clone_prompt=VOICE_PROMPT,
        )
    if not wavs or len(wavs[0]) == 0:
        raise RuntimeError("Qwen returned no audio frames.")
    import soundfile as sf
    output = io.BytesIO()
    sf.write(output, wavs[0], sample_rate, format="WAV", subtype="PCM_16")
    result = output.getvalue()
    if not result.startswith(b"RIFF") or result[8:12] != b"WAVE":
        raise RuntimeError("Qwen did not produce a valid WAV stream.")
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = "JARVIS-Qwen/1.0"
    sys_version = ""

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            return self._json(200, {
                "available": MODEL is not None and VOICE_PROMPT is not None,
                "engine": "Qwen3-TTS voice clone",
                "local": True,
            })
        return self._json(404, {"error": "Not found."})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/synthesize":
            return self._json(404, {"error": "Not found."})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 1 or length > MAX_REQUEST_BYTES:
                raise ValueError("Request body is empty or too large.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
                raise ValueError("Speech text must be a string.")
            wav_bytes = make_wav(payload["text"])
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(wav_bytes)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(wav_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            self._json(400, {"error": str(exc)})
        except Exception as exc:
            logging.exception("Qwen synthesis failed")
            self._json(500, {"error": f"Qwen synthesis failed: {exc}"})

    def log_message(self, fmt: str, *args: Any) -> None:
        logging.info("%s - %s", self.address_string(), fmt % args)


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    load_engine()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    logging.info("Qwen voice service listening on http://%s:%s", HOST, PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logging.info("Stopping Qwen voice service.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
