"""Unit tests for JARVIS path and command safety boundaries."""
from __future__ import annotations

import tempfile
import unittest
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
