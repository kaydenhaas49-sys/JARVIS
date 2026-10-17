"""Local Piper speech synthesis for JARVIS.

The model and its JSON sidecar are kept in lcars-reference/ so the existing
voice artifact remains easy to identify. Speech stays on this machine.
"""
from __future__ import annotations

import importlib.util
import io
import json
import os
import re
import threading
import wave
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent
MODEL_PATH = Path(os.environ.get(
    "JARVIS_TTS_MODEL", str(APP_DIR / "lcars-reference" / "jarvis-high.onnx")
)).expanduser().resolve()
CONFIG_PATH = Path(str(MODEL_PATH) + ".json")
_MAX_TEXT_CHARS = 3_500
_LOCK = threading.Lock()
_VOICE: Any = None


def _piper_installed() -> bool:
    try:
        return importlib.util.find_spec("piper") is not None
    except (ImportError, ValueError, ModuleNotFoundError):
        return False


def _model_state() -> tuple[bool, str]:
    if not MODEL_PATH.is_file():
        return False, "The JARVIS ONNX voice model is missing."
    try:
        with MODEL_PATH.open("rb") as handle:
            header = handle.read(128)
        size = MODEL_PATH.stat().st_size
    except OSError:
        return False, "The JARVIS ONNX voice model cannot be read."
    if header.startswith(b"version https://git-lfs.github.com/spec/v1"):
        return False, "The voice model is still a Git LFS pointer. Run git lfs pull in the JARVIS folder."
    if size < 1_000_000:
        return False, "The ONNX model file looks incomplete."
    if not CONFIG_PATH.is_file():
        return False, "The voice model matching .onnx.json configuration is missing."
    try:
        config = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        sample_rate = int(config.get("audio", {}).get("sample_rate", 0))
        if sample_rate <= 0:
            raise ValueError("invalid sample rate")
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError):
        return False, "The voice model JSON configuration is invalid."
    return True, ""


def status() -> dict[str, Any]:
    model_ready, model_message = _model_state()
    piper_ready = _piper_installed()
    if not piper_ready:
        message = "Piper is not installed. From the JARVIS folder, run the optional voice install command from the README."
    else:
        message = model_message
    return {
        "available": bool(model_ready and piper_ready),
        "model_ready": model_ready,
        "piper_installed": piper_ready,
        "voice": "JARVIS High (Piper ONNX)",
        "message": message,
        "local": True,
    }


def _prepare_text(text: str) -> str:
    text = str(text or "").strip()
    text = re.sub(r"\x60{3}[\s\S]*?\x60{3}", " code block omitted ", text)
    text = re.sub(r"\bJ\.A\.R\.V\.I\.S\.?\b", "Jar-vis", text, flags=re.IGNORECASE)
    text = re.sub(r"\bJARVIS\b", "Jar-vis", text, flags=re.IGNORECASE)
    text = re.sub(r"[*_#>]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        raise ValueError("No text supplied for speech.")
    if len(text) > _MAX_TEXT_CHARS:
        raise ValueError("Speech text is too long (maximum 3,500 characters).")
    return text


def synthesize_wav(text: str) -> bytes:
    """Generate a WAV file using the local ONNX voice model."""
    clean_text = _prepare_text(text)
    model_ready, message = _model_state()
    if not model_ready:
        raise RuntimeError(message)
    if not _piper_installed():
        raise RuntimeError("Piper is not installed. From the JARVIS folder, run the optional voice install command from the README.")

    global _VOICE
    try:
        from piper import PiperVoice
        from piper.config import SynthesisConfig
    except ImportError as exc:
        raise RuntimeError("Piper could not be imported. Reinstall the optional voice packages.") from exc

    with _LOCK:
        try:
            if _VOICE is None:
                _VOICE = PiperVoice.load(str(MODEL_PATH), config_path=str(CONFIG_PATH))
            output = io.BytesIO()
            settings = SynthesisConfig(length_scale=1.0, noise_scale=0.45, noise_w_scale=0.55)
            with wave.open(output, "wb") as wav_file:
                _VOICE.synthesize_wav(clean_text, wav_file, syn_config=settings)
            return output.getvalue()
        except Exception as exc:
            raise RuntimeError(f"Local Piper synthesis failed: {exc}") from exc
