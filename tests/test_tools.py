"""Unit tests for JARVIS path and command safety boundaries."""
from __future__ import annotations

import tempfile
import unittest
from unittest import mock
from pathlib import Path

import jarvis


class WorkspacePathTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name) / "workspace"
        self.root.mkdir()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_resolves_relative_paths_inside_workspace(self) -> None:
        target = jarvis.resolve_workspace_path("projects/demo.py", self.root)
        self.assertEqual(target, (self.root / "projects" / "demo.py").resolve())
        self.assertTrue(target.is_relative_to(self.root))

    def test_rejects_parent_traversal(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside"):
            jarvis.resolve_workspace_path("../outside.txt", self.root)

    def test_rejects_absolute_path_outside_workspace(self) -> None:
        outside = Path(self.temporary.name) / "secret.txt"
        with self.assertRaisesRegex(ValueError, "outside"):
            jarvis.resolve_workspace_path(str(outside), self.root)

    def test_rejects_symlink_escape(self) -> None:
        outside = Path(self.temporary.name) / "outside"
        outside.mkdir()
        (self.root / "shortcut").symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "outside"):
            jarvis.resolve_workspace_path("shortcut/secret.txt", self.root)


class ModelAndMemoryTests(unittest.TestCase):
    def test_model_endpoint_requires_http_or_https_without_credentials(self) -> None:
        self.assertEqual(
            jarvis.normalize_model_base_url("http://127.0.0.1:8080/v1/"),
            "http://127.0.0.1:8080/v1",
        )
        for value in ("", "file:///tmp/model", "http://user:pass@localhost/v1", "http://localhost/v1?key=x"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    jarvis.normalize_model_base_url(value)

    def test_model_id_validation(self) -> None:
        self.assertEqual(jarvis.validate_model_id("qwen3-coder:30b"), "qwen3-coder:30b")
        with self.assertRaises(ValueError):
            jarvis.validate_model_id("")

    def test_memory_can_be_saved_deduplicated_and_deleted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.object(jarvis, "MEMORY_PATH", Path(directory) / "memory.json"):
                first = jarvis.remember_fact("I prefer short answers.")
                again = jarvis.remember_fact("I prefer short answers.")
                self.assertFalse(first["duplicate"])
                self.assertTrue(again["duplicate"])
                self.assertEqual(len(jarvis.memory_items()), 1)
                jarvis.delete_memory_fact(first["item"]["id"])
                self.assertEqual(jarvis.memory_items(), [])

    def test_memory_is_approval_gated_when_requested_by_agent(self) -> None:
        self.assertTrue(jarvis.is_approval_required("remember_fact"))


class ApprovalAndCommandTests(unittest.TestCase):
    def test_changes_require_approval(self) -> None:
        self.assertTrue(jarvis.is_approval_required("write_file"))
        self.assertTrue(jarvis.is_approval_required("run_command"))
        self.assertFalse(jarvis.is_approval_required("read_file"))
        self.assertFalse(jarvis.is_approval_required("system_status"))

    def test_simple_read_only_command_is_accepted(self) -> None:
        parts, cwd = jarvis.validate_command("git status")
        self.assertEqual(parts, ["git", "status"])
        self.assertEqual(cwd, jarvis.WORKSPACE.resolve())

    def test_unknown_or_destructive_command_is_rejected(self) -> None:
        for command in ("rm -rf .", "sudo reboot", "git push origin main", "npm install"):
            with self.subTest(command=command):
                with self.assertRaises(ValueError):
                    jarvis.validate_command(command)

    def test_shell_chaining_is_rejected(self) -> None:
        for command in ("ls; uname", "ls && pwd", "cat file | grep word", "echo hi > file"):
            with self.subTest(command=command):
                with self.assertRaises(ValueError):
                    jarvis.validate_command(command)

    def test_inline_code_execution_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Inline Python"):
            jarvis.validate_command("python3 -c 'print(123)'")
        with self.assertRaisesRegex(ValueError, "Inline JavaScript"):
            jarvis.validate_command("node -e 'console.log(123)'")

    def test_invalid_working_directory_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            jarvis.validate_command("pwd", "../")


if __name__ == "__main__":
    unittest.main()
