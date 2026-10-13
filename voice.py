"""Optional, local voice input and wake-word support for JARVIS.

Voice is opt-in. Microphone audio is processed on this machine and is never saved
as an audio file; short clips are placed in a temporary file only while Whisper
decodes them, then removed.
"""
from __future__ import annotations

import importlib.util
import io
import os
import re
import tempfile
import threading
import time
import wave
from collections import deque
from pathlib import Path
from typing import Any, Callable


MAX_AUDIO_BYTES = 750_000
STT_MODEL_NAME = os.environ.get("JARVIS_STT_MODEL", "base.en")
_WAKE_MODEL_NAME = "hey_jarvis"
_WAKE_THRESHOLD = 0.55
_SAMPLE_RATE = 16_000
_BLOCK_SAMPLES = 1_280  # 80 ms
_STT_MODEL: Any = None
_STT_MODEL_LOCK = threading.Lock()
_STT_INFERENCE_LOCK = threading.Lock()


def missing_voice_packages(*, include_wakeword: bool = False) -> list[str]:
    """Return missing optional imports without importing or downloading models."""
    required = ["faster_whisper"]
    if include_wakeword:
        required.extend(["numpy", "sounddevice", "openwakeword"])
    missing = []
    for name in required:
        try:
            if importlib.util.find_spec(name) is None:
                missing.append(name)
        except (ImportError, ValueError, ModuleNotFoundError):
            missing.append(name)
    return missing


def transcribe_audio_bytes(audio_bytes: bytes, suffix: str = ".webm") -> str:
    """Transcribe a short browser recording using a local faster-whisper model."""
    if not isinstance(audio_bytes, bytes) or not audio_bytes:
        raise ValueError("No voice audio was received.")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise ValueError("That recording is too large. Keep voice clips under 12 seconds.")
    suffix = suffix if suffix in {".webm", ".ogg", ".mp4", ".wav", ".m4a"} else ".webm"

    global _STT_MODEL
    try:
        from faster_whisper import WhisperModel
    except ImportError as exc:
        raise RuntimeError(
            "Local speech recognition is not installed. From the JARVIS folder run: "
            "python -m pip install -e '.[voice]'"
        ) from exc

    # A temporary file gives PyAV a real container and extension to decode.
    temporary_path = None
    try:
        with tempfile.NamedTemporaryFile(prefix="jarvis-voice-", suffix=suffix, delete=False) as temporary:
            temporary.write(audio_bytes)
            temporary_path = Path(temporary.name)

        with _STT_INFERENCE_LOCK:
            with _STT_MODEL_LOCK:
                if _STT_MODEL is None:
                    _STT_MODEL = WhisperModel(STT_MODEL_NAME, device="cpu", compute_type="int8")
                model = _STT_MODEL
            segments, _ = model.transcribe(
                str(temporary_path),
                language="en",
                condition_on_previous_text=False,
                beam_size=3,
                best_of=1,
                temperature=0.0,
                vad_filter=True,
            )
            text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
        return text.strip()[:4_000]
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"Local speech recognition failed: {exc}") from exc
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass


def transcribe_pcm_bytes(pcm_bytes: bytes) -> str:
    """Wrap mono 16 kHz signed 16-bit PCM from the wake-word microphone as WAV."""
    if not pcm_bytes:
        return ""
    out = io.BytesIO()
    with wave.open(out, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(_SAMPLE_RATE)
        audio.writeframes(pcm_bytes[: MAX_AUDIO_BYTES * 2])
    return transcribe_audio_bytes(out.getvalue(), ".wav")


def _strip_wake_phrase(text: str) -> str:
    text = str(text or "").strip()
    text = re.sub(r"^(?:hey|hay|hi|hello|ok|okay)\s+jarvis\b[\s,.;:-]*", "", text, flags=re.I)
    return text.strip()


class WakeWordManager:
    """Local one-shot 'Hey JARVIS' detector, armed only with explicit user opt-in."""

    def __init__(self, transcribe_pcm: Callable[[bytes], str] = transcribe_pcm_bytes) -> None:
        self._transcribe_pcm = transcribe_pcm
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._events: deque[dict[str, Any]] = deque(maxlen=40)
        self._next_event_id = 1
        self.enabled = False
        self.armed = False
        self.running = False
        self.capturing_command = False
        self.last_score = 0.0
        self.last_error: str | None = None
        self.triggered = 0
        self.last_detection = 0.0

    def _publish(self, event_type: str, **data: Any) -> dict[str, Any]:
        with self._lock:
            event = {
                "id": self._next_event_id,
                "type": event_type,
                "at": time.time(),
                **data,
            }
            self._next_event_id += 1
            self._events.append(event)
            return event

    def events_since(self, after: int = 0) -> dict[str, Any]:
        try:
            cursor = max(0, int(after))
        except (TypeError, ValueError, OverflowError):
            cursor = 0
        with self._lock:
            rows = [event for event in self._events if event["id"] > cursor]
            latest = self._next_event_id - 1
        return {"ok": True, "events": rows, "last_event_id": latest}

    def status(self) -> dict[str, Any]:
        missing = missing_voice_packages(include_wakeword=True)
        with self._lock:
            return {
                "enabled": self.enabled,
                "armed": self.armed,
                "running": self.running,
                "capturing_command": self.capturing_command,
                "available": not missing,
                "missing_packages": missing,
                "model": _WAKE_MODEL_NAME,
                "threshold": _WAKE_THRESHOLD,
                "triggered": self.triggered,
                "last_score": round(float(self.last_score), 3),
                "error": self.last_error,
                "last_event_id": self._next_event_id - 1,
            }

    def enable(self) -> dict[str, Any]:
        missing = missing_voice_packages(include_wakeword=True)
        if missing:
            with self._lock:
                self.enabled = False
                self.armed = False
                self.last_error = (
                    "Wake-word support needs the optional packages. From the JARVIS folder run: "
                    "python -m pip install -e '.[voice]' && "
                    "python -m pip install --no-deps 'openwakeword>=0.6.0'"
                )
            return self.status()

        with self._lock:
            self.enabled = True
            self.armed = True
            self.last_error = None
            if self._thread is None or not self._thread.is_alive():
                self._stop.clear()
                self._thread = threading.Thread(
                    target=self._run, daemon=True, name="jarvis-wakeword"
                )
                self._thread.start()
        return self.status()

    def disable(self) -> dict[str, Any]:
        with self._lock:
            self.enabled = False
            self.armed = False
            self._stop.set()
            thread = self._thread
        if thread and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=2.0)
        return self.status()

    def rearm(self) -> dict[str, Any]:
        with self._lock:
            if self.enabled and self.running and not self.capturing_command:
                self.last_error = None
                self.armed = True
        return self.status()

    def _run(self) -> None:
        try:
            import numpy as np
            import openwakeword
            import openwakeword.utils
            import sounddevice as sd
            from openwakeword.model import Model

            # The public hey_jarvis model is downloaded on first opt-in and then
            # cached locally by openWakeWord.
            openwakeword.utils.download_models(model_names=[_WAKE_MODEL_NAME])
            model = Model(
                wakeword_models=[_WAKE_MODEL_NAME],
                inference_framework="onnx",
            )
            with self._lock:
                self.running = True
                self.last_error = None
            self._publish("status", message="Wake-word model ready.")

            while not self._stop.is_set():
                with self._lock:
                    enabled, armed = self.enabled, self.armed
                if not enabled:
                    break
                if not armed:
                    # Do not retain or inspect audio between commands. Closing the
                    # stream below releases the microphone while waiting to re-arm.
                    time.sleep(0.08)
                    continue

                device = sd.query_devices(kind="input")
                input_rate = int(round(float(device.get("default_samplerate") or _SAMPLE_RATE)))
                input_rate = max(8_000, min(input_rate, 192_000))
                input_block_samples = max(1, int(round(input_rate * _BLOCK_SAMPLES / _SAMPLE_RATE)))

                # Re-open the microphone only while armed. When a wake is detected,
                # the short command is captured and transcribed, then this context
                # closes; the mic remains released until the UI re-arms after reply.
                with sd.InputStream(
                    samplerate=input_rate,
                    channels=1,
                    dtype="int16",
                    blocksize=input_block_samples,
                    device=None,
                ) as stream:
                    while not self._stop.is_set():
                        with self._lock:
                            enabled, armed = self.enabled, self.armed
                        if not enabled or not armed:
                            break

                        audio, _ = stream.read(input_block_samples)
                        source = np.asarray(audio, dtype=np.int16).reshape(-1)
                        samples = self._resample(source, input_rate, np)
                        if samples.size != _BLOCK_SAMPLES:
                            continue
                        rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
                        if rms < 60:
                            continue
                        scores = model.predict(samples)
                        score = float(scores.get(_WAKE_MODEL_NAME, max(scores.values(), default=0.0)))
                        self.last_score = score
                        now = time.monotonic()
                        if score < _WAKE_THRESHOLD or now - self.last_detection < 2.5:
                            continue

                        self.last_detection = now
                        with self._lock:
                            self.armed = False
                            self.capturing_command = True
                            self.triggered += 1
                        self._publish("wake", score=round(score, 3))
                        try:
                            pcm = self._capture_command(stream, np, input_rate, input_block_samples)
                            text = _strip_wake_phrase(self._transcribe_pcm(pcm)) if pcm else ""
                            if text:
                                self._publish("command", text=text)
                            else:
                                self._publish("command", text="", error="No clear command was detected. Try again.")
                        except Exception as exc:
                            self._publish("command", text="", error=f"Voice transcription failed: {exc}")
                        finally:
                            with self._lock:
                                self.capturing_command = False
                        break
        except Exception as exc:
            with self._lock:
                self.last_error = str(exc)[:600]
                self.enabled = False
                self.armed = False
            self._publish("error", message=self.last_error)
        finally:
            with self._lock:
                self.running = False
                self.capturing_command = False
                if not self.enabled:
                    self.armed = False

    @staticmethod
    def _resample(samples: Any, input_rate: int, np: Any) -> Any:
        """Resample one ~80 ms int16 mic block to OpenWakeWord's 16 kHz format."""
        samples = np.asarray(samples, dtype=np.int16).reshape(-1)
        if input_rate == _SAMPLE_RATE and samples.size == _BLOCK_SAMPLES:
            return samples
        if not samples.size or input_rate <= 0:
            return np.array([], dtype=np.int16)
        target_size = int(round(samples.size * _SAMPLE_RATE / input_rate))
        if target_size <= 0:
            return np.array([], dtype=np.int16)
        old_axis = np.arange(samples.size, dtype=np.float64)
        new_axis = np.linspace(0, samples.size - 1, target_size, dtype=np.float64)
        return np.interp(new_axis, old_axis, samples.astype(np.float32)).astype(np.int16)

    def _capture_command(self, stream: Any, np: Any, input_rate: int, input_block_samples: int) -> bytes:
        """Capture a short command after the wake phrase; stop at silence or a hard cap."""
        chunks: list[bytes] = []
        discard_samples = int(0.18 * _SAMPLE_RATE)
        discarded = 0
        silent_samples = 0
        voice_seen = False
        captured_samples = 0
        quiet_after_wake_samples = 0
        maximum_samples = 8 * _SAMPLE_RATE
        silence_limit = int(1.0 * _SAMPLE_RATE)

        while captured_samples < maximum_samples and not self._stop.is_set():
            audio, _ = stream.read(input_block_samples)
            source = np.asarray(audio, dtype=np.int16).reshape(-1)
            samples = self._resample(source, input_rate, np)
            if samples.size == 0:
                continue
            if discarded < discard_samples:
                skip = min(samples.size, discard_samples - discarded)
                samples = samples[skip:]
                discarded += skip
                if samples.size == 0:
                    continue

            rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
            if rms >= 180:
                voice_seen = True
                silent_samples = 0
            else:
                silent_samples += samples.size
                quiet_after_wake_samples += samples.size
            chunks.append(samples.tobytes())
            captured_samples += samples.size

            # Give the user a few seconds to start talking, but never leave the
            # follow-up capture running indefinitely after a wake-word event.
            if not voice_seen and quiet_after_wake_samples >= int(2.5 * _SAMPLE_RATE):
                break
            if voice_seen and silent_samples >= silence_limit:
                break

        pcm = b"".join(chunks)
        return pcm if voice_seen and len(pcm) >= _SAMPLE_RATE * 2 else b""
