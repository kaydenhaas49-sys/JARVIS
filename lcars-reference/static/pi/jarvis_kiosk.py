#!/usr/bin/env python3
"""
JARVIS Pi Kiosk — GTK + WebKit2 version.

Runs a fullscreen kiosk window on Raspberry Pi OS that loads the JARVIS
web UI from the OpenClaw host. Also exposes a tiny local HTTP control server
so the web UI (via /api/kiosk_control) can ask us to minimize or restore.

Environment variables:
  JARVIS_HOST      URL of the JARVIS web server (default: http://192.168.103.240:8000)
  KIOSK_CONTROL    Local control bind (default: 127.0.0.1:18790)
  EAR_SCRIPT       Path to ear script (default: ./jarvis_ear_ws.py)
  NO_EAR           If set, do not launch the remote ear subprocess.
"""

import base64
import gi
import http.server
import json
import os
import signal
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
import wave

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GObject, GLib


DEFAULT_HOST = os.environ.get("JARVIS_HOST", "http://192.168.103.240:8000")
CONTROL_BIND = os.environ.get("KIOSK_CONTROL", "0.0.0.0:18790")
EAR_SCRIPT = os.environ.get("EAR_SCRIPT", os.path.join(os.path.dirname(__file__), "jarvis_ear_ws.py"))
NO_EAR = os.environ.get("NO_EAR", "")
DEFAULT_WS_HOST = os.environ.get("JARVIS_WS_HOST", "192.168.103.240")
DEFAULT_WS_PORT = os.environ.get("JARVIS_WS_PORT", "8000")

# Pass WebSocket audio endpoint to the ear script.
os.environ.setdefault("JARVIS_HOST", DEFAULT_WS_HOST)
os.environ.setdefault("JARVIS_WS_PORT", DEFAULT_WS_PORT)
os.environ.setdefault("JARVIS_DEVICE", "pi")


def _ssl_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


class KioskWindow:
    def __init__(self):
        self.window = Gtk.Window()
        self.window.set_title("J.A.R.V.I.S")
        self.window.connect("destroy", self.on_destroy)
        self.window.connect("key-press-event", self.on_key)
        self.window.connect("window-state-event", self.on_state_event)

        self.webview = WebKit2.WebView()
        self.webview.connect("permission-request", self.on_permission_request)
        ctx = self.webview.get_context()
        # Ignore TLS certificate errors for self-signed certs on the LAN.
        try:
            ctx.set_tls_errors_policy(WebKit2.TLSErrorsPolicy.IGNORE)
        except Exception as exc:
            print(f"[kiosk] could not set TLS ignore policy: {exc}")

        settings = self.webview.get_settings()
        for setting in (
            "enable-javascript",
            "enable-media-stream",
            "enable-webaudio",
            "enable-webgl",
        ):
            try:
                settings.set_property(setting, True)
            except Exception:
                pass

        # Allow TTS to play automatically without requiring a click first.
        for setting in ("media-playback-requires-user-gesture",):
            try:
                settings.set_property(setting, False)
            except Exception:
                pass

        # Native TTS bridge: web UI sends text, kiosk plays audio locally.
        # This bypasses WebKit autoplay restrictions in kiosk mode.
        ucm = self.webview.get_user_content_manager()
        try:
            script = WebKit2.UserScript.new(
                "window.JARVIS_KIOSK = true;",
                WebKit2.UserContentInjectedFrames.TOP_FRAME,
                WebKit2.UserScriptInjectionTime.START,
                None,
                None,
            )
            ucm.add_script(script)
            print("[kiosk] injected JARVIS_KIOSK flag", flush=True)
        except Exception as exc:
            print(f"[kiosk] could not inject kiosk flag: {exc}", flush=True)
        try:
            ucm.register_script_message_handler("jarvisSpeak")
            ucm.connect("script-message-received::jarvisSpeak", self.on_jarvis_speak)
            print("[kiosk] registered jarvisSpeak native TTS bridge", flush=True)
        except Exception as exc:
            print(f"[kiosk] could not register jarvisSpeak bridge: {exc}", flush=True)
        try:
            ucm.register_script_message_handler("jarvisDebug")
            ucm.connect("script-message-received::jarvisDebug", self.on_jarvis_debug)
            print("[kiosk] registered jarvisDebug bridge", flush=True)
        except Exception as exc:
            print(f"[kiosk] could not register jarvisDebug bridge: {exc}", flush=True)

        self.window.add(self.webview)
        self.window.fullscreen()
        self.webview.show()
        self.window.show()

        self.restore_window = None
        self.minimized = False

    def on_permission_request(self, webview, request):
        try:
            if hasattr(request, "get_permission_type"):
                pt = request.get_permission_type()
                if "audio" in pt.lower() or "video" in pt.lower() or "media" in pt.lower():
                    print(f"[kiosk] auto-granting permission: {pt}", flush=True)
                    request.allow()
                    return True
        except Exception as exc:
            print(f"[kiosk] permission check error: {exc}", flush=True)
        # Default: allow unknown permission requests in kiosk mode.
        try:
            request.allow()
            return True
        except Exception as exc:
            print(f"[kiosk] could not allow permission: {exc}", flush=True)
        return False

    def load(self, url):
        print(f"[kiosk] loading {url}")
        self.webview.load_uri(url)

    def on_destroy(self, _widget):
        Gtk.main_quit()

    def on_key(self, _widget, event):
        # F11 toggles fullscreen; Esc exits fullscreen if not locked.
        key = event.keyval
        if key == Gdk.KEY_F11:
            self.toggle_fullscreen()
        elif key == Gdk.KEY_Escape:
            self.window.unfullscreen()
        return False

    def toggle_fullscreen(self):
        if self.window.get_window() and self.window.get_window().get_state() & Gdk.WindowState.FULLSCREEN:
            self.window.unfullscreen()
        else:
            self.window.fullscreen()

    def on_state_event(self, _widget, event):
        if event.changed_mask & Gdk.WindowState.ICONIFIED:
            self.minimized = bool(event.new_window_state & Gdk.WindowState.ICONIFIED)
        return False

    def minimize(self):
        def _run():
            print("[kiosk] minimizing")
            self.window.unfullscreen()
            self.window.iconify()
            self.show_restore_pill()
        GLib.idle_add(_run)

    def restore(self):
        def _run():
            print("[kiosk] restoring")
            if self.restore_window:
                self.restore_window.hide()
            self.window.deiconify()
            self.window.present()
            self.window.fullscreen()
            self.minimized = False
        GLib.idle_add(_run)

    def show_restore_pill(self):
        if self.restore_window is None:
            self.restore_window = Gtk.Window(type=Gtk.WindowType.TOPLEVEL)
            self.restore_window.set_title("J.A.R.V.I.S")
            self.restore_window.set_decorated(False)
            self.restore_window.set_skip_taskbar_hint(True)
            self.restore_window.set_keep_above(True)
            self.restore_window.connect("button-press-event", lambda _w, _e: self.restore())
            label = Gtk.Label(label="J.A.R.V.I.S \u00b7 RESTORE")
            label.set_margin_top(8)
            label.set_margin_bottom(8)
            label.set_margin_start(16)
            label.set_margin_end(16)
            css = Gtk.CssProvider()
            css.load_from_data(b"""
                window { background: rgba(0,0,0,0.75); border-radius: 999px; }
                label { color: #ff9900; font-family: monospace; font-weight: bold; font-size: 16px; }
            """)
            style_ctx = label.get_style_context()
            style_ctx.add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            style_ctx = self.restore_window.get_style_context()
            style_ctx.add_provider(css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
            self.restore_window.add(label)
            label.show()

        # Center horizontally near top.
        screen = self.restore_window.get_screen()
        width, height = 220, 36
        x = max(0, (screen.get_width() - width) // 2)
        y = 20
        self.restore_window.set_default_size(width, height)
        self.restore_window.move(x, y)
        self.restore_window.show_all()

    # ------------------------------------------------------------------
    # Native TTS bridge: play server-generated speech locally via PipeWire.
    # WebKit blocks HTMLAudioElement autoplay in kiosk mode, so the web UI
    # sends the reply text here and we fetch + play the WAV ourselves.
    # ------------------------------------------------------------------
    def _post_json(self, url, payload):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        return urllib.request.urlopen(req, context=_ssl_ctx(), timeout=30)

    def _notify_tts_active(self, seconds):
        try:
            url = f"{DEFAULT_HOST.rstrip('/')}/api/tts_active"
            self._post_json(url, {"seconds": seconds})
        except Exception as exc:
            print(f"[kiosk] tts_active notify failed: {exc}", flush=True)

    def on_jarvis_debug(self, manager, result):
        try:
            msg = result.get_js_value().to_string()
            print(f"[kiosk] JS: {msg}", flush=True)
        except Exception as exc:
            print(f"[kiosk] jarvisDebug parse failed: {exc}", flush=True)

    def on_jarvis_speak(self, manager, result):
        try:
            s = result.get_js_value().to_string()
            msg = json.loads(s)
        except Exception as exc:
            print(f"[kiosk] jarvisSpeak parse failed: {exc}", flush=True)
            return
        print(f"[kiosk] jarvisSpeak: {msg.get('text', '')[:60]!r}", flush=True)
        self.native_speak(msg)

    def native_speak(self, msg):
        text = str(msg.get("text", "")).strip()
        if not text:
            return

        # Pre-load estimate so the wake-word TTS guard covers us while we fetch.
        estimated = max(1.5, len(text.split()) * 0.55 + 0.7)
        self._notify_tts_active(estimated + 2.0)

        def run():
            print(f"[kiosk] tts thread started for: {text[:40]!r}", flush=True)
            wav_path = None
            try:
                url = f"{DEFAULT_HOST.rstrip('/')}/api/speak"
                print(f"[kiosk] fetching TTS from {url}", flush=True)
                response = self._post_json(url, {"text": text})
                wav = response.read()
                if not wav or len(wav) < 100:
                    raise RuntimeError("empty TTS response")

                with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                    f.write(wav)
                    wav_path = f.name

                # Use actual file duration for the guard.
                try:
                    with wave.open(wav_path, "rb") as w:
                        actual = w.getnframes() / float(w.getframerate())
                except Exception:
                    actual = len(wav) / (22050 * 2)
                self._notify_tts_active(actual + 1.0)

                player = ["aplay", "-D", "default", wav_path]
                print(f"[kiosk] playing with aplay: {wav_path}", flush=True)
                subprocess.run(player, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as exc:
                print(f"[kiosk] native TTS failed: {exc}", flush=True)
            finally:
                self._notify_tts_active(0)
                if wav_path and os.path.exists(wav_path):
                    try:
                        os.unlink(wav_path)
                    except Exception:
                        pass

        threading.Thread(target=run, daemon=True).start()


class ControlHandler(http.server.BaseHTTPRequestHandler):
    kiosk = None

    def log_message(self, fmt, *args):
        pass

    def _json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/status":
            return self._json(200, {"ok": True, "minimized": self.kiosk.minimized if self.kiosk else False})
        self._json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path == "/status":
            return self._json(200, {"ok": True, "minimized": self.kiosk.minimized if self.kiosk else False})
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8")) if body else {}
        except Exception:
            data = {}

        action = data.get("action", self.path.strip("/"))

        if action in ("minimize", "/minimize"):
            if self.kiosk:
                self.kiosk.minimize()
            return self._json(200, {"ok": True, "action": "minimize"})

        if action in ("restore", "/restore"):
            if self.kiosk:
                self.kiosk.restore()
            return self._json(200, {"ok": True, "action": "restore"})

        if action in ("speak", "/speak"):
            txt = data.get("text", "hello")
            print(f"[kiosk] /speak request: {txt!r} kiosk={self.kiosk is not None}", flush=True)
            if self.kiosk:
                self.kiosk.native_speak({"text": txt, "volume": 1.0, "muted": False})
            return self._json(200, {"ok": True, "action": "speak", "text": txt, "has_kiosk": self.kiosk is not None})

        self._json(404, {"ok": False, "error": f"unknown action: {action}"})


def run_control_server(kiosk, bind):
    host, port = bind.rsplit(":", 1)
    port = int(port)
    ControlHandler.kiosk = kiosk
    class ReuseAddrTCPServer(http.server.ThreadingHTTPServer):
        allow_reuse_address = True
    server = ReuseAddrTCPServer((host, port), ControlHandler)
    print(f"[kiosk] control server listening on http://{host}:{port}")
    server.serve_forever()


def start_ear():
    if NO_EAR:
        print("[kiosk] NO_EAR set; skipping ear subprocess")
        return None
    if not os.path.exists(EAR_SCRIPT):
        print(f"[kiosk] ear script not found: {EAR_SCRIPT}")
        return None
    print(f"[kiosk] launching ear: {EAR_SCRIPT}")
    env = os.environ.copy()
    # The ear needs a bare hostname/IP, not the full web URL.
    env["JARVIS_WS_HOST"] = DEFAULT_WS_HOST
    env["JARVIS_WS_PORT"] = DEFAULT_WS_PORT
    env["JARVIS_DEVICE"] = "pi"
    proc = subprocess.Popen(
        [sys.executable, "-u", EAR_SCRIPT],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
    )

    def tail():
        for line in proc.stdout:
            print(f"[ear] {line.rstrip()}")

    threading.Thread(target=tail, daemon=True).start()
    return proc


def main():
    # Needed for keyboard events via GDK in the kiosk window.
    global Gdk
    import gi
    gi.require_version("Gdk", "3.0")
    from gi.repository import Gdk

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda _s, _f: Gtk.main_quit())

    ear = start_ear()

    kiosk = KioskWindow()

    threading.Thread(
        target=run_control_server,
        args=(kiosk, CONTROL_BIND),
        daemon=True,
    ).start()

    kiosk.load(DEFAULT_HOST)

    try:
        Gtk.main()
    finally:
        print("[kiosk] shutting down")
        if ear:
            ear.terminate()
            try:
                ear.wait(timeout=3)
            except Exception:
                ear.kill()


if __name__ == "__main__":
    main()
