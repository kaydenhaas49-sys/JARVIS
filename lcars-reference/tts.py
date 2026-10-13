"""
J.A.R.V.I.S. local Piper TTS engine.

Uses the same Piper settings as the approved
reconstructed_jarvis_fixed.wav voice.
"""

import sys
import subprocess
import tempfile
import threading
import wave
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent

PIPER_MODEL = (
    BASE_DIR
    / "piper_jarvis"
    / "jarvis-high.onnx"
)

_lock = threading.Lock()

# EXACT settings used for the voice we liked.
PIPER_LENGTH_SCALE = "1.0"
PIPER_NOISE_SCALE = "0.45"
PIPER_NOISE_W_SCALE = "0.55"

# Prevent the final word from being cut off.
END_SILENCE_SECONDS = 0.15


def _prepare_text(text):
    """Make J.A.R.V.I.S. pronounce as Jar-vis."""

    text = str(text or "").strip()

    if not text:
        return ""

    text = text.replace(
        "J.A.R.V.I.S.",
        "Jar-vis",
    )

    text = text.replace(
        "J.A.R.V.I.S",
        "Jar-vis",
    )

    text = text.replace(
        "JARVIS",
        "Jar-vis",
    )

    text = text.replace(
        "Jarvis",
        "Jar-vis",
    )

    return text


def _add_end_silence(wav_bytes):
    """
    Add clean silence to the end of the Piper WAV.

    This prevents the last word from sounding chopped
    while keeping the actual voice unchanged.
    """

    with tempfile.TemporaryDirectory(
        prefix="jarvis_silence_"
    ) as temp_dir:

        temp_dir = Path(temp_dir)

        source = temp_dir / "source.wav"
        fixed = temp_dir / "fixed.wav"

        source.write_bytes(wav_bytes)

        with wave.open(str(source), "rb") as reader:

            params = reader.getparams()
            frames = reader.readframes(
                reader.getnframes()
            )

        silence_frames = int(
            params.framerate *
            END_SILENCE_SECONDS
        )

        silence = b"\x00" * (
            silence_frames *
            params.nchannels *
            params.sampwidth
        )

        with wave.open(str(fixed), "wb") as writer:

            writer.setparams(params)

            writer.writeframes(
                frames + silence
            )

        return fixed.read_bytes()


def _synthesize_piper_cli(text):
    """Try piper via the command-line `piper` binary."""

    with tempfile.TemporaryDirectory(
        prefix="jarvis_tts_"
    ) as temp_dir:

        output_wav = Path(temp_dir) / "jarvis.wav"

        command = [
            "piper",
            "--model",
            str(PIPER_MODEL),
            "--output_file",
            str(output_wav),
            "--length-scale",
            PIPER_LENGTH_SCALE,
            "--noise-scale",
            PIPER_NOISE_SCALE,
            "--noise-w-scale",
            PIPER_NOISE_W_SCALE,
        ]

        result = subprocess.run(
            command,
            input=text,
            text=True,
            capture_output=True,
            timeout=120,
        )

        if result.returncode != 0:
            raise RuntimeError(
                result.stderr.strip()
                or result.stdout.strip()
                or "Piper CLI failed."
            )

        if not output_wav.exists():
            raise RuntimeError(
                "Piper CLI completed but did not create audio."
            )

        return output_wav.read_bytes()


def _synthesize_piper_module(text):
    """Fallback: try importing piper_tts / piper.sample_synthesizer."""

    try:
        from piper.voice import PiperVoice
        from piper.config import SynthesisConfig
    except ImportError:
        try:
            from piper import PiperVoice
            from piper.config import SynthesisConfig
        except ImportError:
            raise RuntimeError(
                "Piper python module not installed. "
                "Install `pip install piper-tts` or add `piper` to PATH."
            )

    import wave

    with tempfile.TemporaryDirectory(
        prefix="jarvis_tts_"
    ) as temp_dir:

        output_wav = Path(temp_dir) / "jarvis.wav"
        config_path = Path(str(PIPER_MODEL) + ".json")

        voice = PiperVoice.load(
            str(PIPER_MODEL),
            config_path=str(config_path) if config_path.exists() else None,
        )

        syn_config = SynthesisConfig(
            length_scale=float(PIPER_LENGTH_SCALE),
            noise_scale=float(PIPER_NOISE_SCALE),
            noise_w_scale=float(PIPER_NOISE_W_SCALE),
        )

        with wave.open(str(output_wav), "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(voice.config.sample_rate)
            for audio_bytes in voice.synthesize(text, syn_config):
                writer.writeframes(audio_bytes)

        return output_wav.read_bytes()


def synthesize(text):
    """
    Generate J.A.R.V.I.S. speech using Piper.

    Uses the approved voice settings:

        length-scale  1.0
        noise-scale   0.45
        noise-w-scale 0.55

    Adds 0.35 seconds of silence at the end.
    """

    text = _prepare_text(text)

    if not text:
        raise ValueError(
            "No text supplied for TTS."
        )

    if not PIPER_MODEL.exists():
        raise FileNotFoundError(
            f"JARVIS Piper model not found: "
            f"{PIPER_MODEL}"
        )

    with _lock:

        last_error = None

        # Prefer the CLI if installed globally.
        if _piper_cli_available():
            try:
                raw_audio = _synthesize_piper_cli(text)
            except Exception as exc:
                last_error = exc
                raw_audio = None

        else:
            raw_audio = None

        # Fallback to the Python module.
        if raw_audio is None:
            try:
                raw_audio = _synthesize_piper_module(text)
            except Exception as exc:
                last_error = exc
                raw_audio = None

        if raw_audio is None:
            raise RuntimeError(
                f"TTS synthesis failed: {last_error}"
            )

        return _add_end_silence(raw_audio)


def _piper_cli_available():
    """True when the `piper` binary is on PATH."""

    return subprocess.run(
        ["which", "piper"],
        capture_output=True,
    ).returncode == 0


def available():
    """Return True when the Piper model exists."""

    return PIPER_MODEL.exists()