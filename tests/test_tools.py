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


class ChatSessionRestoreTests(unittest.TestCase):
    def test_restores_plain_chat_messages_and_clears_pending_approvals(self) -> None:
        sessions: dict[str, dict] = {}
        pending = {"approval-1": {"session_id": "chat-test", "tool_name": "write_file"}}
        with mock.patch.object(jarvis, "SESSIONS", sessions), \
             mock.patch.object(jarvis, "PENDING_ACTIONS", pending):
            result = jarvis.restore_chat_session({
                "session_id": "chat-test",
                "messages": [
                    {"role": "user", "content": "Help me write a script."},
                    {"role": "assistant", "content": "Sure, let's plan it."},
                ],
            })
        self.assertTrue(result["ok"])
        self.assertEqual(result["message_count"], 2)
        self.assertEqual([row["role"] for row in sessions["chat-test"]["messages"]], ["system", "user", "assistant"])
        self.assertNotIn("approval-1", pending)

    def test_rejects_invalid_session_ids_and_non_chat_roles(self) -> None:
        with self.assertRaises(ValueError):
            jarvis.restore_chat_session({"session_id": "../bad", "messages": [{"role": "user", "content": "Hi"}]})
        with self.assertRaisesRegex(ValueError, "roles"):
            jarvis.restore_chat_session({"session_id": "chat-test", "messages": [{"role": "tool", "content": "No"}]})

    def test_rejects_oversized_or_empty_restore_payloads(self) -> None:
        with self.assertRaisesRegex(ValueError, "1–40"):
            jarvis.restore_chat_session({"session_id": "chat-test", "messages": []})
        with self.assertRaisesRegex(ValueError, "1–4,000"):
            jarvis.restore_chat_session({"session_id": "chat-test", "messages": [{"role": "user", "content": "x" * 4001}]})
        with self.assertRaisesRegex(ValueError, "1–40"):
            jarvis.restore_chat_session({"session_id": "chat-test", "messages": [{"role": "user", "content": "Hi"}] * 41})


class DashboardDataTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.path = root / "dashboard-data.json"
        self.index_path = root / "dashboard-index.json"
        self.files = {
            "recipes": root / "recipes.json",
            "notes": root / "notes.json",
            "kitchen": root / "kitchen.json",
            "chat_history": root / "chat-history.json",
            "activity": root / "activity.json",
        }
        self.store_patcher = mock.patch.multiple(
            jarvis, APP_DATA_PATH=self.path, APP_DATA_INDEX_PATH=self.index_path, APP_DATA_FILES=self.files
        )
        self.store_patcher.start()
        self.addCleanup(self.store_patcher.stop)
        initial = {key: jarvis._normalize_dashboard_bucket(key, default)
                   for key, default in jarvis.APP_DATA_DEFAULTS.items()}
        initial["initialized"] = {key: False for key in jarvis.APP_DATA_BUCKETS}
        jarvis._write_dashboard_store(initial)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_bootstrap_migrates_once_and_later_app_writes_win(self) -> None:
        browser = {
            "recipes": [{"name": "Toast", "ingredients": ["Bread"], "instructions": ["Toast it"]}],
            "notes": [{"title": "Reminder", "content": "Buy bread"}],
            "kitchen": {"groceries": [{"text": "Milk"}], "pantry": [], "meals": {}, "timers": []},
            "chat_history": [], "activity": [],
        }
        with mock.patch.object(jarvis, "APP_DATA_PATH", self.path):
            first = jarvis.bootstrap_dashboard_data({"buckets": browser})
            jarvis.sync_dashboard_bucket({"bucket": "recipes", "value": []})
            second = jarvis.bootstrap_dashboard_data({"buckets": browser})
        self.assertEqual(first["data"]["recipes"][0]["name"], "Toast")
        self.assertEqual(second["data"]["recipes"], [])
        self.assertEqual(second["data"]["notes"][0]["title"], "Reminder")

    def test_assistant_recipe_tool_saves_into_the_same_dashboard_store(self) -> None:
        with mock.patch.object(jarvis, "APP_DATA_PATH", self.path):
            result = jarvis.manage_dashboard_data({
                "action": "add_recipe",
                "recipe": {"name": "Pancakes", "category": "Breakfast",
                           "ingredients": ["1 cup flour", "1 egg"],
                           "instructions": ["Mix ingredients", "Cook in pan"]},
            })
            data = jarvis._dashboard_data_payload()["data"]
        self.assertTrue(result["ok"])
        self.assertEqual(result["recipe"]["name"], "Pancakes")
        self.assertEqual(data["recipes"][0]["name"], "Pancakes")

    def test_assistant_can_manage_notes_and_kitchen_lists(self) -> None:
        with mock.patch.object(jarvis, "APP_DATA_PATH", self.path):
            note = jarvis.manage_dashboard_data({"action": "add_note", "note": {"title": "Reminder", "content": "Buy milk"}})
            grocery = jarvis.manage_dashboard_data({"action": "add_grocery", "text": "Milk"})
            duplicate = jarvis.manage_dashboard_data({"action": "add_grocery", "text": "milk"})
            found = jarvis.manage_dashboard_data({"action": "search_notes", "query": "milk"})
            kitchen = jarvis.manage_dashboard_data({"action": "kitchen_overview"})
        self.assertTrue(note["ok"])
        self.assertTrue(grocery["ok"])
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(found["count"], 1)
        self.assertEqual(kitchen["groceries"][0]["text"], "Milk")

    def test_recipe_requires_ingredients_and_instructions(self) -> None:
        with self.assertRaisesRegex(ValueError, "at least one ingredient"):
            jarvis.manage_dashboard_data({"action": "add_recipe", "recipe": {"name": "Empty cake"}})

    def test_dashboard_records_are_separate_local_json_files(self) -> None:
        jarvis.manage_dashboard_data({
            "action": "add_recipe",
            "recipe": {"name": "Oatmeal", "ingredients": ["Oats"], "instructions": ["Cook"]},
        })
        saved = json.loads(self.files["recipes"].read_text(encoding="utf-8"))
        self.assertEqual(saved[0]["name"], "Oatmeal")
        self.assertTrue(self.index_path.is_file())
        self.assertFalse(self.path.exists(), "new writes must not create the legacy combined store")

    def test_old_combined_store_is_migrated_to_separate_files(self) -> None:
        for path in self.files.values():
            path.unlink()
        self.index_path.unlink()
        self.path.write_text(json.dumps({
            "recipes": [{"name": "Legacy soup", "ingredients": ["Water"], "instructions": ["Boil"]}],
            "notes": [], "kitchen": {"groceries": [], "pantry": [], "meals": {}, "timers": []},
            "chat_history": [], "activity": [],
            "initialized": {key: True for key in jarvis.APP_DATA_BUCKETS},
        }), encoding="utf-8")
        result = jarvis.bootstrap_dashboard_data({"buckets": {key: jarvis.APP_DATA_DEFAULTS[key]
                                                               for key in jarvis.APP_DATA_BUCKETS}})
        self.assertEqual(result["data"]["recipes"][0]["name"], "Legacy soup")
        self.assertEqual(json.loads(self.files["recipes"].read_text(encoding="utf-8"))[0]["name"], "Legacy soup")
        self.assertTrue(self.path.exists(), "legacy data should remain as a safety backup")

    def test_system_storage_memory_is_saved_to_a_file_and_injected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            memory_path = Path(directory) / "system-memory.md"
            with mock.patch.object(jarvis, "SYSTEM_MEMORY_PATH", memory_path):
                prompt = jarvis.current_system_prompt()
            self.assertTrue(memory_path.is_file())
            self.assertIn("recipes.json", memory_path.read_text(encoding="utf-8"))
            self.assertIn("PERSISTENT STORAGE MEMORY", prompt)
            self.assertIn("must not be used as ongoing persistent storage", prompt)


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
