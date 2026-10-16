"""Regression tests for project profiles, recovery, local search, and model benchmarks."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import jarvis


class WorkspaceFeatureTests(unittest.TestCase):
    def _patch_workspace(self, root: Path):
        def resolve(raw_path, workspace=None):
            base = root.resolve()
            candidate = Path(str(raw_path or "."))
            candidate = (base / candidate).resolve() if not candidate.is_absolute() else candidate.resolve()
            if candidate != base and base not in candidate.parents:
                raise ValueError("That path is outside the JARVIS workspace.")
            return candidate
        return mock.patch.object(jarvis, "WORKSPACE", root.resolve()), mock.patch.object(jarvis, "resolve_workspace_path", side_effect=resolve)

    def test_write_backup_and_undo_restore_previous_file(self):
        with tempfile.TemporaryDirectory() as workspace, tempfile.TemporaryDirectory() as data:
            root, data = Path(workspace), Path(data)
            target = root / "main.py"
            target.write_text("before\n", encoding="utf-8")
            p1, p2 = self._patch_workspace(root)
            with p1, p2, mock.patch.object(jarvis, "CODE_BACKUPS_DIR", data / "backups"), mock.patch.object(jarvis, "CODE_BACKUPS_INDEX_PATH", data / "backups.json"):
                result = jarvis.write_file("main.py", "after\n")
                self.assertTrue(result["backup_id"])
                self.assertEqual(target.read_text(encoding="utf-8"), "after\n")
                restored = jarvis.undo_code_backup(result["backup_id"])
                self.assertTrue(restored["restored"])
                self.assertEqual(target.read_text(encoding="utf-8"), "before\n")
                with self.assertRaises(ValueError):
                    jarvis.undo_code_backup(result["backup_id"])

    def test_undo_of_new_file_removes_created_file(self):
        with tempfile.TemporaryDirectory() as workspace, tempfile.TemporaryDirectory() as data:
            root, data = Path(workspace), Path(data)
            p1, p2 = self._patch_workspace(root)
            with p1, p2, mock.patch.object(jarvis, "CODE_BACKUPS_DIR", data / "backups"), mock.patch.object(jarvis, "CODE_BACKUPS_INDEX_PATH", data / "backups.json"):
                result = jarvis.write_file("nested/new.py", "pass\n")
                target = root / "nested" / "new.py"
                self.assertTrue(target.is_file())
                jarvis.undo_code_backup(result["backup_id"])
                self.assertFalse(target.exists())

    def test_project_profile_and_task_are_persisted(self):
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            (root / "game").mkdir()
            p1, p2 = self._patch_workspace(root)
            with p1, p2, mock.patch.object(jarvis, "PROJECTS_PATH", root / "projects.json"):
                result = jarvis.manage_project({"action": "save", "name": "Game", "path": "game", "description": "Prototype", "status": "active"})
                project_id = result["item"]["id"]
                task = jarvis.manage_project({"action": "task-add", "id": project_id, "title": "Add controller"})["task"]
                jarvis.manage_project({"action": "task-toggle", "id": project_id, "task_id": task["id"], "done": True})
                item = jarvis.project_items()[0]
                self.assertEqual(item["path"], "game")
                self.assertTrue(item["tasks"][0]["done"])

    def test_knowledge_search_returns_real_path_and_line_number(self):
        with tempfile.TemporaryDirectory() as workspace:
            root = Path(workspace)
            (root / "notes.md").write_text("A project profile tracks work.\nUse a code backup before editing files.\n", encoding="utf-8")
            p1, p2 = self._patch_workspace(root)
            with p1, p2:
                result = jarvis.search_knowledge("code backup")
                self.assertEqual(result["results"][0]["path"], "notes.md")
                self.assertEqual(result["results"][0]["matches"][0]["line"], 2)

    def test_model_benchmark_limits_selection_to_three(self):
        with mock.patch.object(jarvis, "_benchmark_single_model", side_effect=lambda model: {"model": model, "ok": True, "seconds": 1.0, "tokens_per_second": 12.0}):
            result = jarvis.run_model_benchmarks({"models": ["one", "two", "three", "four"]})
        self.assertEqual([row["model"] for row in result["results"]], ["one", "two", "three"])


if __name__ == "__main__":
    unittest.main()
