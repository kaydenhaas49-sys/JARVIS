"""The chatbot-only frontend exposes chat, microphone, spoken replies, and wake word only."""
from __future__ import annotations

import unittest
from html.parser import HTMLParser
from pathlib import Path


class ChatOnlyParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag, attrs) -> None:
        self.tags.append((tag, dict(attrs)))


class ChatOnlyInterfaceTests(unittest.TestCase):
    def setUp(self) -> None:
        root = Path(__file__).resolve().parents[1]
        self.html = (root / "static" / "index.html").read_text(encoding="utf-8")
        self.css = (root / "static" / "chat.css").read_text(encoding="utf-8")
        self.js = (root / "static" / "chat.js").read_text(encoding="utf-8")
        parser = ChatOnlyParser()
        parser.feed(self.html)
        self.by_id = {attrs.get("id"): (tag, attrs) for tag, attrs in parser.tags if attrs.get("id")}

    def test_chat_and_voice_controls_exist(self) -> None:
        for element_id in ("composerForm", "messageInput", "sendBtn", "micBtn", "wakeWordBtn",
                           "voiceOutputBtn", "chatLog", "typingRow", "newChatBtn"):
            with self.subTest(element_id=element_id):
                self.assertIn(element_id, self.by_id)
        self.assertEqual(self.by_id["composerForm"][0], "form")
        self.assertEqual(self.by_id["messageInput"][0], "textarea")
        self.assertEqual(self.by_id["wakeWordBtn"][0], "button")
        self.assertEqual(self.by_id["voiceOutputBtn"][0], "button")

    def test_no_system_console_or_workspace_navigation_is_exposed(self) -> None:
        for forbidden in ("System Console", "systemBtn", "appsBtn", "kitchenBtn", "memoryBtn",
                          "codingBtn", "workspacePath", "utilityPanel", "sidebar"):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden.casefold(), self.html.casefold())

    def test_only_the_minimal_chat_frontend_is_loaded(self) -> None:
        self.assertIn('href="/chat.css?v=5"', self.html)
        self.assertIn('src="/chat.js?v=5"', self.html)
        for legacy_asset in ('src="/app.js', 'src="/advanced-tools.js', 'src="/hud-status.js',
                             'src="/jarvis-orb.js'):
            with self.subTest(legacy_asset=legacy_asset):
                self.assertNotIn(legacy_asset, self.html)

    def test_welcome_brand_is_a_3d_dot_sphere_not_a_lettermark(self) -> None:
        self.assertIn('id="dotSphere"', self.html)
        self.assertNotIn('<span>J</span>', self.html)
        self.assertNotIn('<span class="typing-orb" aria-hidden="true">J</span>', self.html)
        self.assertIn('.sphere-canvas', self.css)
        self.assertIn("const count = 520", self.js)
        self.assertIn("const orbitBands = [", self.js)
        self.assertIn("function orbitPoint(", self.js)
        self.assertIn("A concentrated heart of light", self.js)
        self.assertIn('createRadialGradient', self.js)
        self.assertIn('function createDotSphere()', self.js)
        self.assertNotIn('textContent = "J"', self.js)

    def test_voice_only_interface_keeps_accessible_labels(self) -> None:
        self.assertIn('aria-label="Start voice input"', self.html)
        self.assertIn('title="Toggle spoken replies"', self.html)
        self.assertIn('aria-label="Chat with JARVIS"', self.html)


if __name__ == "__main__":
    unittest.main()
