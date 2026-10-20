import pathlib
import unittest


class DotSphereContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.script = pathlib.Path("static/chat.js").read_text(encoding="utf-8")
        cls.styles = pathlib.Path("static/chat.css").read_text(encoding="utf-8")

    def test_renderer_keeps_chat_state_hook_and_canvas(self):
        self.assertIn('getElementById("dotSphere")', self.script)
        self.assertIn('className = "sphere-canvas"', self.script)
        self.assertIn('ui.core?.dataset.state', self.script)
        self.assertIn('function setActivity(state, label)', self.script)

    def test_particle_shell_and_interior_provide_layered_depth(self):
        self.assertIn("const shellCount = compact ? 1320 : 1880;", self.script)
        self.assertIn("const innerCount = compact ? 300 : 520;", self.script)
        self.assertIn("projected.sort((a, b) => a.depth - b.depth);", self.script)
        self.assertIn("context.scale(1, 0.2 + (i % 3) * 0.075);", self.script)
        self.assertIn("context.arc(0, 0, radius * (1.01 + i * 0.025), 0, Math.PI * 2);", self.script)
        self.assertIn('context.globalCompositeOperation = "screen"', self.script)

    def test_each_assistant_state_has_its_own_motion_profile(self):
        for state in ("listening", "thinking", "speaking"):
            self.assertIn('state === "' + state + '"', self.script)
        self.assertIn("targetEnergy", self.script)
        self.assertIn('state === "idle" ? 0.105', self.script)
        self.assertIn("spinRate", self.script)

    def test_reduced_motion_and_hidden_tabs_limit_render_work(self):
        self.assertIn('(prefers-reduced-motion: reduce)', self.script)
        self.assertIn("if (!reducedMotion && !staticFrame)", self.script)
        self.assertIn('document.addEventListener("visibilitychange"', self.script)
        self.assertIn("ResizeObserver", self.script)
        self.assertIn('document.removeEventListener("visibilitychange", container._sphereVisibilityHandler)', self.script)
        self.assertIn('container._sphereMotionQuery.removeEventListener?.("change", container._sphereMotionHandler)', self.script)

    def test_sphere_uses_local_canvas_and_cyan_light(self):
        self.assertIn(".sphere-canvas", self.styles)
        self.assertIn("rgba(189,250,255", self.styles)
        self.assertIn("rgba(70,201,237", self.styles)


if __name__ == "__main__":
    unittest.main()
