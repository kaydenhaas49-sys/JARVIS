"""
Server-side speech-to-text for JARVIS.

Uses faster-whisper with a small English model. Audio can be supplied as
WAV bytes or raw 16-bit 16 kHz mono PCM; we re-encode to 16 kHz mono WAV
before passing it to the model.
"""
import io
import wave
from pathlib import Path

_MODEL = None
_MODEL_SIZE = "base.en"  # tiny.en / base.en / small.en


def _load_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL

    from faster_whisper import WhisperModel

    # Models are downloaded to ~/.cache/huggingface/hub automatically.
    # Use CPU + int8 for broad compatibility.
    model_path = _MODEL_SIZE
    _MODEL = WhisperModel(model_path, device="cpu", compute_type="int8")
    return _MODEL


def _ensure_wav_16k_mono(audio_bytes):
    """Convert incoming audio to 16 kHz mono 16-bit WAV bytes."""
    import numpy as np

    # Decode whatever container/format we received with PyAV.
    try:
        import av
        container = av.open(io.BytesIO(audio_bytes), mode="r")
        resampler = av.audio.resampler.AudioResampler(
            format="s16", layout="mono", rate=16000
        )
        out_frames = []
        for frame in container.decode(audio=0):
            for resampled in resampler.resample(frame):
                out_frames.append(resampled.to_ndarray().ravel())
        # Flush resampler.
        for resampled in resampler.resample(None):
            out_frames.append(resampled.to_ndarray().ravel())
        if out_frames:
            samples = np.concatenate(out_frames)
        else:
            samples = np.array([], dtype=np.int16)
    except Exception:
        # Fallback: treat as raw 16-bit 16 kHz mono PCM.
        samples = np.frombuffer(audio_bytes, dtype=np.int16)

    if len(samples) == 0:
        samples = np.array([], dtype=np.int16)

    # Ensure mono (PyAV already gives mono, but be safe).
    if samples.ndim > 1:
        samples = samples.mean(axis=1).astype(np.int16)

    out = io.BytesIO()
    with wave.open(out, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        wf.writeframes(samples.tobytes())

    return out.getvalue()


def transcribe(audio_bytes):
    """Transcribe WAV/PCM audio bytes and return the text."""
    if not audio_bytes:
        return ""

    wav = _ensure_wav_16k_mono(audio_bytes)
    model = _load_model()

    segments, _ = model.transcribe(
        io.BytesIO(wav),
        language="en",
        condition_on_previous_text=False,
        beam_size=5,
        best_of=5,
        temperature=0.0,
        vad_filter=True,
        compression_ratio_threshold=None,
    )

    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip())
    return text
