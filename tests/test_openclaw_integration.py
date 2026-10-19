"""Tests for the optional, private OpenClaw bridge."""
from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import jarvis


class OpenClawConfigurationTests(unittest.TestCase):
    def test_urls_accept_tailnet_hosts_and_normalize_api_path(self):
        self.assertEqual(
            jarvis.normalize_openclaw_base_url("http://100.100.22.4:18789"),
            "http://100.100.22.4:18789/v1",
        )
        self.assertEqual(
            jarvis.normalize_openclaw_base_url("https://server.example.ts.net/v1/"),
            "https://server.example.ts.net/v1",
        )
        self.assertEqual(
            jarvis.normalize_openclaw_base_url("http://127.0.0.1:18789"),
            "http://127.0.0.1:18789/v1",
        )

    def test_urls_reject_public_plaintext_and_embedded_secrets(self):
        for url in (
            "http://openclaw.example.com:18789",
            "http://192.168.1.25:18789",
            "https://user:password@server.example.ts.net",
            "https://server.example.ts.net/v1?token=secret",
            "https://server.example.ts.net/v2",
            "https://openclaw.example.com/v1",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                jarvis.normalize_openclaw_base_url(url)

    def test_agent_target_validation(self):
        for model in ("openclaw/default", "openclaw", "openclaw/coder", "openclaw:coder", "agent:coder"):
            with self.subTest(model=model):
                self.assertEqual(jarvis.validate_openclaw_model(model), model)
        for model in ("", "default", "gpt-4o", "openclaw/coder with spaces"):
            with self.subTest(model=model), self.assertRaises(ValueError):
                jarvis.validate_openclaw_model(model)

    def test_delegation_sends_only_the_explicit_task(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with mock.patch.object(jarvis, "OPENCLAW_CONFIG_PATH", root / "openclaw.json"), mock.patch.object(
                jarvis, "OPENCLAW_SECRET_PATH", root / "openclaw-secret.json"
            ):
                jarvis.save_openclaw_config({
                    "base_url": "https://server.example.ts.net",
                    "model": "openclaw/default",
                    "token": "private-test-token",
                })
                with mock.patch.object(
                    jarvis, "_openclaw_request",
                    return_value={"choices": [{"message": {"content": "Task completed successfully."}}]},
                ) as request:
                    result = jarvis.delegate_to_openclaw("Inspect only the project README.", session_id="test-session")

                self.assertTrue(result["ok"])
                self.assertEqual(result["answer"], "Task completed successfully.")
                self.assertEqual(result["agent"], "openclaw/default")
                args, kwargs = request.call_args
                self.assertEqual(args[0], "/chat/completions")
                self.assertEqual(kwargs["method"], "POST")
                payload = kwargs["payload"]
                self.assertEqual(payload["model"], "openclaw/default")
                self.assertEqual(len(payload["messages"]), 1)
                self.assertIn("Inspect only the project README.", payload["messages"][0]["content"])
                self.assertNotIn("private-test-token", json.dumps(payload))

    def test_delegation_requires_a_jarvis_approval(self):
        self.assertTrue(jarvis.is_approval_required("delegate_to_openclaw"))
        self.assertTrue(any(
            item.get("function", {}).get("name") == "delegate_to_openclaw"
            for item in jarvis.TOOL_SPECS
        ))

    def test_token_is_saved_separately_and_never_returned(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config_path = root / "openclaw.json"
            secret_path = root / "openclaw-secret.json"
            with mock.patch.object(jarvis, "OPENCLAW_CONFIG_PATH", config_path), mock.patch.object(
                jarvis, "OPENCLAW_SECRET_PATH", secret_path
            ):
                response = jarvis.save_openclaw_config({
                    "base_url": "http://100.100.22.4:18789",
                    "model": "openclaw/default",
                    "token": "test-token-do-not-leak",
                })
                self.assertTrue(response["configured"])
                self.assertTrue(response["token_saved"])
                self.assertNotIn("token", response)
                self.assertNotIn("test-token-do-not-leak", json.dumps(response))
                self.assertNotIn("test-token-do-not-leak", config_path.read_text(encoding="utf-8"))
                self.assertEqual(
                    json.loads(secret_path.read_text(encoding="utf-8"))["token"],
                    "test-token-do-not-leak",
                )
                self.assertEqual(os.stat(secret_path).st_mode & 0o777, 0o600)

                # A blank password keeps the existing saved secret.
                jarvis.save_openclaw_config({
                    "base_url": "https://server.example.ts.net/v1",
                    "model": "openclaw/coder",
                    "token": "",
                })
                self.assertEqual(
                    json.loads(secret_path.read_text(encoding="utf-8"))["token"],
                    "test-token-do-not-leak",
                )
                self.assertEqual(jarvis.openclaw_config_status()["model"], "openclaw/coder")

                jarvis.disconnect_openclaw()
                self.assertFalse(config_path.exists())
                self.assertFalse(secret_path.exists())
                self.assertFalse(jarvis.openclaw_config_status()["configured"])


if __name__ == "__main__":
    unittest.main()
