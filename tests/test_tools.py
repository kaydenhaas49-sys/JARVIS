"""Unit tests for JARVIS path and command safety boundaries."""
from __future__ import annotations

import io
import json
import sys
import threading
import types
import urllib.error
import tempfile
import unittest
import wave
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import jarvis
import voice


class VoiceSupportTests(unittest.TestCase):
    def test_voice_audio_mime_types_map_to_supported_containers(self) -> None:
        for mime_type, suffix in (
            ("audio/webm;codecs=opus", ".webm"),
            ("audio/ogg;codecs=opus", ".ogg"),
            ("audio/wav", ".wav"),
            ("audio/x-wav", ".wav"),
            ("audio/mp4;codecs=mp4a.40.2", ".mp4"),
            ("audio/m4a", ".m4a"),
            ("", ".webm"),
        ):
            with self.subTest(mime_type=mime_type):
                self.assertEqual(jarvis._voice_audio_suffix(mime_type), suffix)

        for mime_type in ("text/plain", "video/webm", "audio/mpeg"):
            with self.subTest(mime_type=mime_type), self.assertRaisesRegex(ValueError, "supported audio"):
                jarvis._voice_audio_suffix(mime_type)

    def test_reenabling_a_live_wake_worker_clears_a_pending_stop(self) -> None:
        class ExistingWorker:
            def is_alive(self):
                return True

            def join(self, timeout=None):
                self.join_timeout = timeout

        manager = voice.WakeWordManager(transcribe_pcm=lambda _pcm: "ignored")
        worker = ExistingWorker()
        manager._thread = worker
        manager._stop.set()
        with mock.patch.object(voice, "missing_voice_packages", return_value=[]):
            state = manager.enable()

        self.assertTrue(state["enabled"])
        self.assertTrue(state["armed"])
        self.assertFalse(manager._stop.is_set())
        self.assertIs(manager._thread, worker)

    def test_stopped_wake_worker_clears_its_reference_before_exit(self) -> None:
        openwakeword = types.ModuleType("openwakeword")
        openwakeword.__path__ = []
        utils = types.ModuleType("openwakeword.utils")
        utils.download_models = lambda **_kwargs: None
        model_module = types.ModuleType("openwakeword.model")
        model_module.Model = lambda **_kwargs: object()
        modules = {
            "numpy": types.ModuleType("numpy"),
            "openwakeword": openwakeword,
            "openwakeword.utils": utils,
            "openwakeword.model": model_module,
            "sounddevice": types.ModuleType("sounddevice"),
        }
        manager = voice.WakeWordManager(transcribe_pcm=lambda _pcm: "ignored")
        manager._thread = threading.current_thread()
        manager._stop.set()

        with mock.patch.dict(sys.modules, modules):
            manager._run()

        self.assertIsNone(manager._thread)
        with mock.patch.object(voice, "missing_voice_packages", return_value=[]), \
             mock.patch.object(manager, "_start_worker_locked") as start_worker:
            manager.enable()
        start_worker.assert_called_once_with()

    def test_empty_or_oversized_recordings_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "No voice audio"):
            voice.transcribe_audio_bytes(b"")
        with self.assertRaisesRegex(ValueError, "too large"):
            voice.transcribe_audio_bytes(b"x" * (voice.MAX_AUDIO_BYTES + 1))

    def test_local_transcription_uses_and_removes_a_temporary_audio_file(self) -> None:
        class FakeWhisper:
            source_path = None

            def transcribe(self, path, **kwargs):
                self.source_path = Path(path)
                self.asserted_options = kwargs
                assert self.source_path.is_file()
                assert self.source_path.suffix == ".webm"
                return iter([SimpleNamespace(text=" Hello from local speech ") ]), None

        fake_model = FakeWhisper()
        fake_module = types.ModuleType("faster_whisper")
        fake_module.WhisperModel = lambda *args, **kwargs: fake_model
        with mock.patch.dict(sys.modules, {"faster_whisper": fake_module}), \
             mock.patch.object(voice, "_STT_MODEL", fake_model):
            result = voice.transcribe_audio_bytes(b"fake encoded audio", ".webm")
        self.assertEqual(result, "Hello from local speech")
        self.assertFalse(fake_model.source_path.exists())
        self.assertTrue(fake_model.asserted_options["vad_filter"])

    def test_malformed_local_audio_returns_an_error_and_removes_the_temporary_file(self) -> None:
        class FakeWhisper:
            source_path = None

            def transcribe(self, path, **_kwargs):
                self.source_path = Path(path)
                raise ValueError("container decode failed")

        fake_model = FakeWhisper()
        fake_module = types.ModuleType("faster_whisper")
        fake_module.WhisperModel = lambda *args, **kwargs: fake_model
        with mock.patch.dict(sys.modules, {"faster_whisper": fake_module}), \
             mock.patch.object(voice, "_STT_MODEL", fake_model):
            with self.assertRaisesRegex(RuntimeError, "Local speech recognition failed"):
                voice.transcribe_audio_bytes(b"malformed audio", "audio/webm")
        self.assertIsNotNone(fake_model.source_path)
        self.assertFalse(fake_model.source_path.exists())

    def test_wakeword_pcm_is_wrapped_as_mono_16khz_wav(self) -> None:
        pcm = b"\x00\x00" * 1600
        with mock.patch.object(voice, "transcribe_audio_bytes", return_value="hello") as transcribe:
            self.assertEqual(voice.transcribe_pcm_bytes(pcm), "hello")
        wav_bytes, suffix = transcribe.call_args.args
        self.assertEqual(suffix, ".wav")
        with wave.open(io.BytesIO(wav_bytes), "rb") as reader:
            self.assertEqual(reader.getframerate(), 16000)
            self.assertEqual(reader.getnchannels(), 1)
            self.assertEqual(reader.getsampwidth(), 2)
            self.assertEqual(reader.getnframes(), 1600)

    def test_wakeword_events_use_a_monotonic_cursor(self) -> None:
        manager = voice.WakeWordManager(transcribe_pcm=lambda _pcm: "ignored")
        first = manager._publish("wake", score=0.8)
        second = manager._publish("command", text="What time is it?")
        self.assertEqual([row["id"] for row in manager.events_since(0)["events"]], [first["id"], second["id"]])
        self.assertEqual(manager.events_since(first["id"])["events"], [second])
        self.assertEqual(manager.status()["last_event_id"], second["id"])

    def test_wake_phrase_is_removed_from_transcribed_command(self) -> None:
        self.assertEqual(voice._strip_wake_phrase("Hey JARVIS, what time is it?"), "what time is it?")
        self.assertEqual(voice._strip_wake_phrase("Set a five minute timer"), "Set a five minute timer")


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
        self.assertTrue(jarvis.is_approval_required("launch_app"))
        self.assertFalse(jarvis.is_approval_required("read_file"))
        self.assertFalse(jarvis.is_approval_required("system_status"))

    def test_desktop_launcher_only_accepts_known_application_ids(self) -> None:
        self.assertIn("browser_firefox", jarvis.DESKTOP_APP_CATALOG)
        for invalid in ("firefox", "firefox; rm -rf ~", "/usr/bin/firefox", ""):
            with self.subTest(application_id=invalid):
                with self.assertRaisesRegex(ValueError, "allowlist"):
                    jarvis._resolve_desktop_application(invalid)

    def test_standalone_app_open_requests_match_only_named_allowlisted_apps(self) -> None:
        for request, expected in (
            ("Open Firefox", "browser_firefox"),
            ("Please open Firefox.", "browser_firefox"),
            ("Could you open Firefox for me?", "browser_firefox"),
            ("Hey JARVIS, please launch Steam now.", "steam"),
            ("Open the System settings", "settings"),
            ("Bring up VSCodium", "code_editor"),
        ):
            with self.subTest(request=request):
                self.assertEqual(jarvis._direct_desktop_app_intent(request), expected)

        for request in (
            "What is Firefox?",
            "Open Firefox and search for my homework",
            "Open /usr/bin/firefox",
            "Start Firefox --private-window",
            "Run firefox",
            "Open an app and then delete some files",
            "Please open Firefox and Steam",
        ):
            with self.subTest(request=request):
                self.assertIsNone(jarvis._direct_desktop_app_intent(request))

    def test_direct_standalone_app_request_launches_without_model_approval(self) -> None:
        session = {"messages": [], "updated_at": 0.0}
        with mock.patch.object(jarvis, "_get_session", return_value=session), \\
             mock.patch.object(jarvis, "launch_desktop_app",
                               return_value={"ok": True, "application": "Firefox", "message": "Started Firefox."}) as launch, \\
             mock.patch.object(jarvis, "agent_turn") as agent_turn:
            result = jarvis.handle_chat({
                "session_id": "direct-open-firefox-test",
                "message": "Open Firefox",
            })

        launch.assert_called_once_with("browser_firefox")
        agent_turn.assert_not_called()
        self.assertIsNone(result["pending_action"])
        self.assertEqual(result["reply"], "Started Firefox.")
        self.assertEqual(session["messages"][0]["role"], "user")
        self.assertEqual(session["messages"][1]["role"], "assistant")

    def test_desktop_launch_uses_only_resolved_binary_without_a_shell(self) -> None:
        process = mock.Mock(pid=4242)
        with mock.patch.object(jarvis.platform, "system", return_value="Linux"), \
             mock.patch.object(jarvis.shutil, "which",
                               side_effect=lambda name: "/usr/bin/firefox" if name == "firefox" else None), \
             mock.patch.object(jarvis.subprocess, "Popen", return_value=process) as popen, \
             mock.patch.object(jarvis, "_log_dashboard_tool_action") as audit:
            result = jarvis.launch_desktop_app("browser_firefox")
        self.assertTrue(result["ok"])
        self.assertEqual(result["application"], "Firefox")
        self.assertEqual(result["pid"], 4242)
        self.assertEqual(popen.call_args.args, (["/usr/bin/firefox"],))
        self.assertFalse(popen.call_args.kwargs["shell"])
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        audit.assert_called_once_with("Desktop app launched", "Firefox")

    def test_desktop_launch_fails_cleanly_when_app_is_missing(self) -> None:
        with mock.patch.object(jarvis.platform, "system", return_value="Linux"), \
             mock.patch.object(jarvis.shutil, "which", return_value=None), \
             mock.patch.object(jarvis.subprocess, "Popen") as popen:
            with self.assertRaisesRegex(ValueError, "not installed"):
                jarvis.launch_desktop_app("browser_firefox")
        popen.assert_not_called()

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
