"""Local Piper speech synthesis for JARVIS.

The model and its JSON sidecar are kept in lcars-reference/ so the existing
voice artifact remains easy to identify. Speech stays on this machine.
"""
from __future__ import annotations

import importlib.util
import io
import json
import logging
import os
import re
import threading
import urllib.error
import urllib.request
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


QWEN_TTS_URL = os.environ.get("JARVIS_QWEN_TTS_URL", "http://127.0.0.1:8766").rstrip("/")


def _qwen_service_status(timeout: float = 0.35) -> dict[str, Any] | None:
    """Return local Qwen sidecar health, or None if it is not running."""
    try:
        request = urllib.request.Request(QWEN_TTS_URL + "/health", headers={"Accept": "application/json"})
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read(16_384).decode("utf-8"))
        return data if isinstance(data, dict) and data.get("available") is True else None
    except (OSError, urllib.error.URLError, TimeoutError, ValueError, UnicodeDecodeError):
        return None


def status() -> dict[str, Any]:
    model_ready, model_message = _model_state()
    piper_ready = _piper_installed()
    qwen_ready = _qwen_service_status() is not None
    available = qwen_ready or bool(model_ready and piper_ready)
    if qwen_ready:
        message = "Qwen3-TTS voice cloning is active; Piper remains available as the fallback."
        voice = "Qwen3-TTS JARVIS voice clone"
    elif model_ready and piper_ready:
        message = "Qwen voice service is not running; using the bundled Piper JARVIS voice."
        voice = "JARVIS High (Piper ONNX)"
    elif not piper_ready:
        message = "Qwen voice service is not running and Piper is not installed. Start the Qwen launcher or install optional voice packages."
        voice = "Unavailable"
    else:
        message = model_message
        voice = "JARVIS High (Piper ONNX)"
    return {
        "available": available,
        "model_ready": model_ready,
        "piper_installed": piper_ready,
        "qwen_available": qwen_ready,
        "voice": voice,
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


def _validate_wav(audio_bytes: bytes) -> bytes:
    """Reject empty or malformed WAV output before it reaches the browser."""
    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
            channels = wav_file.getnchannels()
            sample_width = wav_file.getsampwidth()
            sample_rate = wav_file.getframerate()
            frame_count = wav_file.getnframes()
            if channels < 1 or sample_width not in {1, 2, 3, 4} or sample_rate < 8_000 or frame_count < 1:
                raise RuntimeError("Piper returned an empty or invalid WAV stream.")
            if not wav_file.readframes(1):
                raise RuntimeError("Piper returned a WAV file with no audio frames.")
    except (wave.Error, EOFError, OSError) as exc:
        raise RuntimeError("Piper returned an invalid WAV file that browsers cannot decode.") from exc
    return audio_bytes


def _synthesize_with_qwen(text: str, timeout: float = 240.0) -> bytes:
    request = urllib.request.Request(
        QWEN_TTS_URL + "/synthesize",
        data=json.dumps({"text": text}, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "audio/wav"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            audio_bytes = response.read(32_000_000)
            if not audio_bytes:
                raise RuntimeError("Qwen returned an empty audio response.")
            return _validate_wav(audio_bytes)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RuntimeError("Qwen voice service is unavailable or could not finish synthesis.") from exc


def _synthesize_with_piper(clean_text: str) -> bytes:
    model_ready, message = _model_state()
    if not model_ready:
        raise RuntimeError(message)
    if not _piper_installed():
        raise RuntimeError("Piper is not installed. Start the Qwen voice launcher or install optional voice packages.")

    global _VOICE
    try:
        from piper import PiperVoice
        try:
            from piper import SynthesisConfig
        except ImportError:
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
            return _validate_wav(output.getvalue())
        except Exception as exc:
            raise RuntimeError(f"Local Piper synthesis failed: {exc}") from exc


def synthesize_wav(text: str) -> bytes:
    """Prefer Qwen voice cloning and keep Piper available as an automatic fallback."""
    clean_text = _prepare_text(text)
    if _qwen_service_status() is not None:
        try:
            return _synthesize_with_qwen(clean_text)
        except Exception as exc:
            logging.warning("Qwen speech failed; falling back to Piper: %s", exc)
    return _synthesize_with_piper(clean_text)
