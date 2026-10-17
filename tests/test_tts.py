"""Tests for local TTS readiness and WAV validation."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import jarvis_tts


class LocalTtsTests(unittest.TestCase):
    def _patched_model(self, root: Path, model_data: bytes):
        model = root / "test.onnx"
        model.write_bytes(model_data)
        config = Path(str(model) + ".json")
        config.write_text(json.dumps({"audio": {"sample_rate": 22050}}), encoding="utf-8")
        return mock.patch.multiple(jarvis_tts, MODEL_PATH=model, CONFIG_PATH=config)

    def test_lfs_pointer_is_not_treated_as_an_available_model(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self._patched_model(root, b"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n"):
                with mock.patch.object(jarvis_tts, "_piper_installed", return_value=True):
                    result = jarvis_tts.status()
            self.assertFalse(result["available"])
            self.assertFalse(result["model_ready"])
            self.assertIn("git lfs pull", result["message"])

    def test_model_and_config_ready_when_piper_is_installed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self._patched_model(root, b"ONNX" + bytes(1_100_000)):
                with mock.patch.object(jarvis_tts, "_piper_installed", return_value=True):
                    result = jarvis_tts.status()
            self.assertTrue(result["available"])
            self.assertTrue(result["model_ready"])
            self.assertTrue(result["local"])

    def test_qwen_status_endpoint_failure_reports_unavailable(self):
        with mock.patch.object(jarvis_tts.urllib.request, "urlopen", side_effect=OSError("offline")):
            self.assertIsNone(jarvis_tts._qwen_service_status())

    def test_malformed_wav_is_rejected_before_browser_playback(self):
        with self.assertRaisesRegex(RuntimeError, "invalid WAV"):
            jarvis_tts._validate_wav(b"not a wav file")

    def test_valid_wav_is_preserved(self):
        import io
        import wave

        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(22050)
            wav_file.writeframes(bytes([0, 0]) * 100)
        payload = output.getvalue()
        self.assertEqual(jarvis_tts._validate_wav(payload), payload)

    def test_empty_text_is_rejected(self):
        with self.assertRaises(ValueError):
            jarvis_tts.synthesize_wav("   ")

    def test_text_length_is_bounded_before_model_loading(self):
        with self.assertRaises(ValueError):
            jarvis_tts.synthesize_wav("a" * 3501)


if __name__ == "__main__":
    unittest.main()
