"""Small text-normalization tests for the Qwen voice-clone service."""
import unittest

from qwen_tts_service import prepare_target_text


class QwenVoiceTextTests(unittest.TestCase):
    def test_uppercase_name_is_normalized(self):
        self.assertEqual(prepare_target_text("JARVIS, are you there?"), "JAR-viss, are you there?")

    def test_dotted_name_is_normalized(self):
        self.assertEqual(prepare_target_text("J.A.R.V.I.S. is online."), "JAR-viss is online.")

    def test_other_text_is_preserved(self):
        self.assertEqual(
            prepare_target_text("Good evening, sir. All systems are operational."),
            "Good evening, sir. All systems are operational.",
        )


if __name__ == "__main__":
    unittest.main()
