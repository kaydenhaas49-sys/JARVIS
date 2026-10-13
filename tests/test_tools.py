"""Unit tests for JARVIS path and command safety boundaries."""
from __future__ import annotations

import json
import urllib.error
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
    def test_native_ollama_url_does_not_require_v1(self) -> None:
        self.assertEqual(
            jarvis.normalize_model_base_url("http://127.0.0.1:11434/v1"),
            "http://127.0.0.1:11434",
        )
        self.assertTrue(jarvis.is_ollama_native_api("http://127.0.0.1:11434"))
        self.assertTrue(jarvis.is_ollama_native_api("http://localhost:11434/v1"))
        self.assertFalse(jarvis.is_ollama_native_api("http://127.0.0.1:8080/v1"))
        self.assertEqual(
            jarvis.ollama_api_url("http://127.0.0.1:11434", "tags"),
            "http://127.0.0.1:11434/api/tags",
        )

    def test_model_discovery_falls_back_to_other_local_ollama_hosts(self) -> None:
        with mock.patch("jarvis.urllib.request.urlopen") as urlopen:
            failed_response = mock.MagicMock()
            good_response = mock.MagicMock()
            good_response.__enter__.return_value.read.return_value = b'{"models":[{"name":"qwen3-coder:30b"}]}'
            urlopen.side_effect = [urllib.error.URLError("connection refused"), good_response]
            result = jarvis.available_models("http://127.0.0.1:11434")
        second_request = urlopen.call_args_list[1].args[0]
        self.assertEqual(second_request.full_url, "http://localhost:11434/api/tags")
        self.assertTrue(result["available"])
        self.assertTrue(result["auto_detected"])
        self.assertEqual(result["base_url"], "http://localhost:11434")
        self.assertEqual(result["models"][0]["id"], "qwen3-coder:30b")

    def test_old_local_openai_endpoint_falls_back_to_native_ollama(self) -> None:
        with mock.patch("jarvis.urllib.request.urlopen") as urlopen:
            good_response = mock.MagicMock()
            good_response.__enter__.return_value.read.return_value = b'{"models":[{"name":"qwen3-coder:30b"}]}'
            urlopen.side_effect = [urllib.error.URLError("no OpenAI server here"), good_response]
            result = jarvis.available_models("http://127.0.0.1:8080/v1")
        second_request = urlopen.call_args_list[1].args[0]
        self.assertEqual(second_request.full_url, "http://localhost:11434/api/tags")
        self.assertTrue(result["available"])
        self.assertTrue(result["auto_detected"])
        self.assertEqual(result["api_mode"], "ollama")

    def test_ollama_model_list_uses_native_tags_endpoint(self) -> None:
        with mock.patch("jarvis.urllib.request.urlopen") as urlopen:
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = b'{"models":[{"name":"qwen3-coder:30b"}]}'
            urlopen.return_value = response
            result = jarvis.available_models("http://127.0.0.1:11434")
        request = urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/tags")
        self.assertTrue(result["available"])
        self.assertEqual(result["models"][0]["id"], "qwen3-coder:30b")
        self.assertEqual(result["api_mode"], "ollama")

    def test_ollama_chat_uses_native_api_and_normalizes_tool_calls(self) -> None:
        fake_body = b'{"message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_current_time","arguments":{}}}]}}'
        with mock.patch.object(jarvis, "BASE_URL", "http://127.0.0.1:11434"), \
             mock.patch.object(jarvis, "MODEL", "qwen3-coder:30b"), \
             mock.patch("jarvis.urllib.request.urlopen") as urlopen:
            response = mock.MagicMock()
            response.__enter__.return_value.read.return_value = fake_body
            urlopen.return_value = response
            result = jarvis._model_request([{"role": "user", "content": "What time is it?"}])
        request = urlopen.call_args.args[0]
        sent = json.loads(request.data.decode("utf-8"))
        self.assertEqual(request.full_url, "http://127.0.0.1:11434/api/chat")
        self.assertNotIn("tool_choice", sent)
        self.assertEqual(sent["model"], "qwen3-coder:30b")
        call = result["choices"][0]["message"]["tool_calls"][0]
        self.assertEqual(call["function"]["name"], "get_current_time")
        self.assertTrue(call["id"].startswith("ollama_"))

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
