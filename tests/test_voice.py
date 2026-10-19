"""Tests for local speech transcription speed and wake-word debouncing."""
from __future__ import annotations

import time
import unittest
from collections import deque
from types import SimpleNamespace
from unittest import mock

import voice


class WakeWordGateTests(unittest.TestCase):
    def test_wake_requires_three_consecutive_above_threshold_frames(self):
        recent = deque(maxlen=voice._WAKE_CONFIRM_FRAMES)
        self.assertFalse(voice._wake_score_confirmed(0.9, recent))
        self.assertFalse(voice._wake_score_confirmed(0.9, recent))
        self.assertTrue(voice._wake_score_confirmed(0.9, recent))

    def test_below_threshold_resets_wake_confirmation(self):
        recent = deque(maxlen=voice._WAKE_CONFIRM_FRAMES)
        self.assertFalse(voice._wake_score_confirmed(0.9, recent))
        self.assertFalse(voice._wake_score_confirmed(0.9, recent))
        self.assertFalse(voice._wake_score_confirmed(0.1, recent))
        self.assertFalse(voice._wake_score_confirmed(0.9, recent))
        self.assertFalse(voice._wake_score_confirmed(0.9, recent))
        self.assertTrue(voice._wake_score_confirmed(0.9, recent))

    def test_rearm_adds_a_settle_period_and_arms_when_ready(self):
        manager = voice.WakeWordManager()
        manager.enabled = True
        manager.running = True
        manager.capturing_command = False
        before = time.monotonic()
        result = manager.rearm()
        self.assertTrue(result["armed"])
        self.assertGreaterEqual(
            manager._ignore_wake_until,
            before + voice._WAKE_REARM_COOLDOWN_SECONDS,
        )

    def test_rearm_does_not_arm_during_command_capture(self):
        manager = voice.WakeWordManager()
        manager.enabled = True
        manager.running = True
        manager.capturing_command = True
        manager.armed = False
        result = manager.rearm()
        self.assertFalse(result["armed"])
        self.assertEqual(manager._ignore_wake_until, 0.0)


class TranscriptionSettingsTests(unittest.TestCase):
    def test_transcription_uses_single_beam_and_short_local_model_setting(self):
        model = mock.MagicMock()
        model.transcribe.return_value = (iter([SimpleNamespace(text=" hello")]), None)
        fake_module = SimpleNamespace(WhisperModel=mock.Mock(return_value=model))
        prior_model = voice._STT_MODEL
        try:
            voice._STT_MODEL = None
            with mock.patch.dict("sys.modules", {"faster_whisper": fake_module}):
                result = voice.transcribe_audio_bytes(b"test-audio", ".wav")
            self.assertEqual(result, "hello")
            fake_module.WhisperModel.assert_called_once_with(
                voice.STT_MODEL_NAME, device="cpu", compute_type="int8"
            )
            kwargs = model.transcribe.call_args.kwargs
            self.assertEqual(kwargs["beam_size"], 1)
            self.assertEqual(kwargs["best_of"], 1)
        finally:
            voice._STT_MODEL = prior_model


if __name__ == "__main__":
    unittest.main()
