"""Regression tests for JARVIS routines, editable memory, and optional telemetry."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import jarvis


class LocalPersistenceFeatureTests(unittest.TestCase):
    def test_routines_seed_save_update_and_delete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "routines.json"
            with mock.patch.object(jarvis, "ROUTINES_PATH", path):
                defaults = jarvis.routine_items()
                self.assertTrue(any(row["id"] == "routine-gaming-mode" for row in defaults))
                created = jarvis.save_routine("", "Test routine", "Check local status only.")
                routine_id = created["item"]["id"]
                self.assertEqual(created["item"]["name"], "Test routine")
                updated = jarvis.save_routine(routine_id, "Updated routine", "Inspect the workspace, but do not edit.")
                self.assertEqual(updated["item"]["id"], routine_id)
                self.assertEqual(updated["item"]["name"], "Updated routine")
                self.assertTrue(any(row["id"] == routine_id for row in jarvis.routine_items()))
                jarvis.delete_routine(routine_id)
                self.assertFalse(any(row["id"] == routine_id for row in jarvis.routine_items()))

    def test_memory_can_be_edited_and_stays_persistent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "memory.json"
            with mock.patch.object(jarvis, "MEMORY_PATH", path):
                original = jarvis.remember_fact("I prefer concise explanations.")
                memory_id = original["item"]["id"]
                updated = jarvis.update_memory_fact(memory_id, "I prefer clear explanations with examples.")
                self.assertEqual(updated["item"]["id"], memory_id)
                self.assertEqual(jarvis.memory_items()[0]["fact"], "I prefer clear explanations with examples.")

    def test_system_status_returns_optional_gpu_shape_without_nvidia_tools(self) -> None:
        with mock.patch("jarvis.shutil.which", return_value=None):
            status = jarvis.get_system_status()
        self.assertIn("logical_cpu_threads", status)
        self.assertIn("workspace_disk", status)
        self.assertIn("root_disk", status)
        self.assertEqual(status["gpus"], [])


if __name__ == "__main__":
    unittest.main()
