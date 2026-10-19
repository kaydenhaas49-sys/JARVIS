"""Keep the primary sidebar destinations and keyboard semantics connected."""
from __future__ import annotations

import unittest
from html.parser import HTMLParser
from pathlib import Path


class SidebarParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags: list[tuple[str, dict[str, str | None]]] = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class SidebarContractTests(unittest.TestCase):
    def test_sidebar_keeps_every_existing_destination_and_exposes_navigation_state(self):
        source = (Path(__file__).resolve().parents[1] / "static" / "index.html").read_text(encoding="utf-8")
        parser = SidebarParser()
        parser.feed(source)

        by_id = {attrs.get("id"): (tag, attrs) for tag, attrs in parser.tags if attrs.get("id")}
        self.assertEqual(by_id["sidebar"][0], "aside")
        self.assertEqual(by_id["assistantBtn"][0], "button")
        self.assertEqual(by_id["assistantBtn"][1].get("aria-current"), "page")
        self.assertEqual(by_id["menuBtn"][1].get("aria-controls"), "sidebar")
        self.assertEqual(by_id["menuBtn"][1].get("aria-expanded"), "false")
        self.assertEqual(by_id["workspacePath"][0], "div")
        for element_id in ("systemBtn", "appsBtn", "kitchenBtn", "memoryBtn", "codingBtn", "newChatBtn"):
            with self.subTest(element_id=element_id):
                self.assertEqual(by_id[element_id][0], "button")

        labels = [attrs.get("aria-label") for tag, attrs in parser.tags if tag == "nav"]
        self.assertIn("Primary navigation", labels)


if __name__ == "__main__":
    unittest.main()
