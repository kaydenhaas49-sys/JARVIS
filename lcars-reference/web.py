"""
JARVIS unified web server (stdlib only, no heavy deps -> runs on Pi 2).

Serves:
  /                        -> the movie-style web UI
  /static/*                -> client assets
  /api/ask                 -> chat with the remote Ollama (tool-calling)
  /api/speak               -> local Piper JARVIS voice
  /api/health /api/state   -> connectivity + reactor state
  /api/config (GET+POST)   -> read / change Ollama host, model, voice, etc.
  /api/recipes* /api/...   -> the combined kitchen API (local + MealDB web)

Everything is JSON except audio from /api/speak and the static client.
"""

import base64
import hashlib
import json
import mimetypes
import os
import re
import socket
import ssl
import subprocess
import threading
import time
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode
from urllib.request import Request, urlopen

from server import ws_audio_server
from server import audit
from server import config as server_config
from server import events
from server.assistant import Assistant
from server.kitchen import recipes as kitchen
from server import wakeword
from server import stt
from server import tts


STATIC_DIR = Path(__file__).resolve().parent / "static"
UPLOADS_DIR = STATIC_DIR / "uploads" / "recipes"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 MB
ALLOWED_IMAGE_TYPES = {"jpeg", "png", "webp", "gif"}

ASSISTANT = None
WAKE = wakeword.WakeWord()
ws_audio_server.WAKE = WAKE
_SERVER = None
_WS_PORT = None


def pause_ear(seconds=15):
    """Ask the remote microphone node to release the ALSA device for capture."""
    try:
        ws_audio_server.pause_ear(seconds)
    except Exception:
        pass
    try:
        WAKE.flush_buffer()
    except Exception:
        pass


def ear_paused():
    return ws_audio_server.ear_paused()




def _kiosk_request(action):
    """Forward a minimize/restore command to the Pi kiosk native app."""
    url = server_config.load().get("kiosk_control_url", "").strip()
    if not url:
        return {"ok": False, "error": "kiosk_control_url not configured"}
    try:
        data = json.dumps({"action": action}).encode("utf-8")
        req = Request(
            f"{url.rstrip('/')}/{action}",
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urlopen(req, timeout=3) as resp:
            return {"ok": True, "status": resp.status, "body": resp.read().decode("utf-8", errors="replace")[:200]}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

def shutdown():
    """Stop the background server (used by the desktop app on window close)."""
    global _SERVER

    server = _SERVER
    _SERVER = None

    if server is None:
        return

    apply_wakeword(False)
    ws_audio_server.stop()

    try:
        server.shutdown()
    except Exception:
        pass

    try:
        server.server_close()
    except Exception:
        pass


def get_assistant():
    global ASSISTANT

    if ASSISTANT is None:
        ASSISTANT = Assistant(server_config.load())

    return ASSISTANT


def apply_wakeword(enabled, stream_mode=True):
    """Arm or disarm the wake-word detector to match the config flag.

    When stream_mode is True, the detector expects audio chunks from a
    remote microphone node instead of using the local sounddevice input.
    """
    if not enabled:
        WAKE.stop()
        return
    try:
        if stream_mode:
            WAKE.enable_stream_mode()
        else:
            WAKE.arm()
    except Exception as e:
        print("[wakeword] could not arm:", e)


def rearm_wake():
    """After JARVIS replies, re-arm the wake word if enabled."""
    try:
        cfg = server_config.load()
    except Exception:
        return

    if cfg.get("voice", {}).get("wake_word"):
        try:
            WAKE.arm()
        except Exception as e:
            print("[wakeword] re-arm failed:", e)


def _estimate_tts_duration(text):
    """Rough spoken duration for the given text in seconds."""
    words = len(str(text).split())
    return max(1.5, words * 0.55 + 0.7)


def _read_body(handler):
    length = int(handler.headers.get("Content-Length") or 0)

    if length <= 0:
        return {}

    data = handler.rfile.read(min(length, 1_000_000))

    try:
        value = json.loads(data.decode("utf-8"))
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        return {}


def _send_json(handler, payload, status=200):
    body = json.dumps(payload).encode("utf-8")

    handler.send_response(status)
    handler.send_header(
        "Content-Type",
        "application/json; charset=utf-8",
    )
    handler.send_header(
        "Access-Control-Allow-Origin",
        "*",
    )
    handler.send_header(
        "Content-Length",
        str(len(body)),
    )
    handler.send_header(
        "Cache-Control",
        "no-store",
    )
    handler.end_headers()

    handler.wfile.write(body)


def _send_file(handler, path):
    if not path.exists() or not path.is_file():
        _send_json(
            handler,
            {"error": "Not found"},
            status=404,
        )
        return

    mime, _ = mimetypes.guess_type(str(path))
    data = path.read_bytes()

    handler.send_response(200)
    handler.send_header(
        "Content-Type",
        mime or "application/octet-stream",
    )
    handler.send_header(
        "Content-Length",
        str(len(data)),
    )
    handler.send_header(
        "Cache-Control",
        "no-cache",
    )
    handler.end_headers()

    handler.wfile.write(data)


class Handler(BaseHTTPRequestHandler):
    server_version = "JARVIS/1.0"

    def log_message(self, fmt, *args):
        # Quiet by default.
        pass

    # ------------------------------------------------------------------
    # WebSocket audio upgrade (shared HTTP port)
    # ------------------------------------------------------------------
    WS_MAGIC = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    def _upgrade_websocket_audio(self):
        """Upgrade this request to a WebSocket and hand it to ws_audio_server."""
        headers = self.headers
        key = headers.get("Sec-WebSocket-Key")
        if not key:
            return _send_json(self, {"error": "Missing Sec-WebSocket-Key"}, status=400)

        accept = base64.b64encode(hashlib.sha1(key.encode("ascii") + self.WS_MAGIC).digest()).decode("ascii")

        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()

        # Keep the underlying TCP socket open after this handler returns;
        # otherwise BaseHTTPRequestHandler would close it and kill the
        # WebSocket audio stream.
        self.close_connection = False

        conn = self.connection
        addr = self.client_address
        ws_thread = threading.Thread(
            target=ws_audio_server.handle_connection,
            args=(conn, addr),
            daemon=True,
            name=f"jarvis-ws-audio-{addr[0]}",
        )
        ws_thread.start()
        # Block until the WebSocket thread is done so the HTTP server's
        # request loop does not try to reuse this connection.
        ws_thread.join()
        self.close_connection = True

    # ------------------------------------------------------------------
    # Routing
    # ------------------------------------------------------------------

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            return _send_file(
                self,
                STATIC_DIR / "index.html",
            )

        if path.startswith("/static/"):
            name = path[len("/static/"):]
            target = (STATIC_DIR / name).resolve()

            if str(target).startswith(
                str(STATIC_DIR.resolve())
            ):
                return _send_file(self, target)

        if path == "/api/health":
            return self.api_health()

        if path == "/api/system":
            return self.api_system()

        if path == "/api/state":
            return self.api_state()

        if path == "/api/events":
            return self.api_events()

        if path == "/api/wake_status":
            return _send_json(
                self,
                WAKE.status(),
            )

        if path == "/api/ear_control":
            return _send_json(
                self,
                {"paused": ear_paused()},
            )

        if path == "/api/config":
            return _send_json(
                self,
                server_config.public(),
            )

        if path == "/api/status":
            return _send_json(
                self,
                self._build_status(),
            )

        if path == "/api/models":
            return self.api_models()

        if path == "/api/recipes":
            return self.api_recipes(
                query
            )

        if path == "/api/web_search":
            return self.api_web_search(
                query
            )

        if path == "/api/categories":
            return _send_json(
                self,
                {
                    "categories": kitchen.categories()
                },
            )

        if path == "/api/kiosk":
            return _send_json(self, {"kiosk_control_url": server_config.public().get("kiosk_control_url", "")})

        if path == "/api/kiosk_control":
            return _send_json(self, _kiosk_request("status"))

        # WebSocket audio upgrade (Pi microphone stream) — multiplexed on the HTTP port.
        if path == "/audio":
            upgrade = self.headers.get("Upgrade", "").lower()
            if upgrade == "websocket":
                return self._upgrade_websocket_audio()
            return _send_json(self, {"error": "Use WebSocket for /audio"}, status=426)

        _send_json(
            self,
            {"error": "Not found"},
            status=404,
        )

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/ask":
            return self.api_ask()

        if path == "/api/speak":
            return self.api_speak()

        if path == "/api/audio_chunk":
            return self.api_audio_chunk()

        if path == "/api/transcribe":
            return self.api_transcribe()

        if path == "/api/tts_active":
            body = _read_body(self)
            seconds = body.get("seconds", 0)
            WAKE.set_tts_active(seconds)
            return _send_json(self, {"tts_muted": WAKE._tts_active()})

        if path == "/api/ear_pause":
            pause_ear()
            return _send_json(self, {"paused": True, "until": _EAR_PAUSE_UNTIL})

        if path == "/api/config":
            return self.api_config_post(
                _read_body(self)
            )

        if path == "/api/recipes":
            return self.api_recipe_create(
                _read_body(self)
            )

        if path == "/api/volume":
            return self.api_volume(_read_body(self))

        if path == "/api/unlock":
            return self.api_unlock(_read_body(self))

        if path == "/api/lock":
            return self.api_lock()

        if path == "/api/verify_password":
            return self.api_verify_password(_read_body(self))

        if path == "/api/kiosk":
            return _send_json(self, {"kiosk_control_url": server_config.public().get("kiosk_control_url", "")})

        if path == "/api/kiosk_control":
            body = _read_body(self)
            return _send_json(self, _kiosk_request(body.get("action", "status")))

        if path == "/api/convert":
            return self.api_convert(_read_body(self))

        if path == "/api/scale":
            return self.api_scale(_read_body(self))

        match = re.fullmatch(
            r"/api/recipes/(.+)/favorite",
            path,
        )

        if match:
            return self.api_recipe_favorite(
                match.group(1),
                _read_body(self),
            )

        match = re.fullmatch(
            r"/api/recipes/(.+)/image",
            path,
        )

        if match:
            return self.api_recipe_image(
                match.group(1),
            )

        _send_json(
            self,
            {"error": "Not found"},
            status=404,
        )

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path

        match = re.fullmatch(
            r"/api/recipes/(.+)",
            path,
        )

        if match:
            return self.api_recipe_update(
                match.group(1),
                _read_body(self),
            )

        _send_json(
            self,
            {"error": "Not found"},
            status=404,
        )

    def do_DELETE(self):
        path = urlparse(self.path).path

        match = re.fullmatch(
            r"/api/recipes/(.+)",
            path,
        )

        if match:
            from server.kitchen import store

            deleted = store.remove(
                match.group(1)
            )

            return _send_json(
                self,
                {"deleted": deleted},
            )

        _send_json(
            self,
            {"error": "Not found"},
            status=404,
        )

    def do_OPTIONS(self):
        """Handle CORS preflight requests."""
        self.send_response(204)

        self.send_header(
            "Access-Control-Allow-Origin",
            "*",
        )

        self.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, OPTIONS",
        )

        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type",
        )

        self.end_headers()

    def _read_multipart(self, boundary):
        """Minimal RFC-7578 multipart/form-data parser.

        Returns (filename, content_type, bytes) for the first file part,
        or (None, None, b"") if no valid file is found.
        """
        length = int(self.headers.get("Content-Length") or 0)

        if length <= 0 or length > MAX_IMAGE_SIZE:
            return None, None, b""

        body = self.rfile.read(length)
        delimiter = ("--" + boundary).encode("ascii")

        parts = body.split(delimiter)
        for part in parts[1:]:
            if b"\r\n\r\n" not in part:
                continue
            headers, data = part.split(b"\r\n\r\n", 1)

            # Trim trailing CRLF and final boundary marker
            data = data.rstrip(b"\r\n")
            if data.endswith(b"--"):
                data = data[:-2].rstrip(b"\r\n")

            cd_match = re.search(
                br'Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]+)")?',
                headers,
                re.IGNORECASE,
            )
            if not cd_match or not cd_match.group(2):
                continue

            ct_match = re.search(
                br'Content-Type:\s*([^\r\n]+)',
                headers,
                re.IGNORECASE,
            )
            content_type = (
                ct_match.group(1).decode("ascii").strip().lower()
                if ct_match
                else "application/octet-stream"
            )

            filename = cd_match.group(2).decode("utf-8", errors="replace")
            return filename, content_type, data

        return None, None, b""

    # ------------------------------------------------------------------
    # API handlers
    # ------------------------------------------------------------------

    def _cors(self):
        self.send_header(
            "Access-Control-Allow-Origin",
            "*",
        )

    def api_health(self):
        try:
            info = get_assistant().check_connection()

            return _send_json(
                self,
                {
                    "online": True,
                    **info,
                },
            )

        except Exception as error:
            return _send_json(
                self,
                {
                    "online": False,
                    "error": str(error),
                    "host": server_config.load()[
                        "ollama_host"
                    ],
                },
                status=503,
            )

    def api_system(self):
        """Return host stats and connection info for the top-bar display."""
        client_ip = self.client_address[0]

        # CPU temperature (Linux thermal zones)
        cpu_temp = None
        for tz_path in sorted(Path("/sys/class/thermal").glob("thermal_zone*")):
            try:
                name = (tz_path / "type").read_text().strip()
                temp = (tz_path / "temp").read_text().strip()
                if name and temp:
                    # milli-Celsius -> Celsius
                    cpu_temp = round(float(temp) / 1000.0, 1)
                    break
            except Exception:
                continue

        # CPU load average (1-min)
        try:
            load1, _, _ = os.getloadavg()
            cpu_load = round(load1, 2)
        except Exception:
            cpu_load = None

        # Uptime seconds
        try:
            uptime_sec = round(time.monotonic())
        except Exception:
            uptime_sec = None

        # Check OpenClaw Gateway reachability
        gateway_ok = False
        try:
            cfg = server_config.load()
            host = cfg.get("openclaw_host", "")
            if host:
                parsed = urlparse(host)
                gw_host = parsed.hostname or "127.0.0.1"
                gw_port = parsed.port or 18789
                with socket.create_connection((gw_host, gw_port), timeout=2):
                    gateway_ok = True
        except Exception:
            gateway_ok = False

        # Health of assistant backend
        try:
            assistant_ok = bool(get_assistant().check_connection())
        except Exception:
            assistant_ok = False

        return _send_json(
            self,
            {
                "client_ip": client_ip,
                "cpu_temp_c": cpu_temp,
                "cpu_load": cpu_load,
                "uptime_sec": uptime_sec,
                "gateway_ok": gateway_ok,
                "assistant_ok": assistant_ok,
            },
        )

    def api_state(self):
        return _send_json(
            self,
            {
                "state": get_assistant().state
            },
        )

    def api_events(self):
        """
        Server-Sent Events stream.

        Relays wake/signal events to the UI and sends
        periodic heartbeat comments.
        """

        self.send_response(200)

        self.send_header(
            "Content-Type",
            "text/event-stream; charset=utf-8",
        )

        self.send_header(
            "Cache-Control",
            "no-cache",
        )

        self.send_header(
            "Access-Control-Allow-Origin",
            "*",
        )

        self.send_header(
            "Connection",
            "keep-alive",
        )

        self.end_headers()

        self.close_connection = False

        try:
            while True:
                event = events.drain(
                    timeout=0.6
                )

                if event is None:
                    self.wfile.write(
                        b": ping\n\n"
                    )
                    self.wfile.flush()
                    continue

                payload = (
                    "data: "
                    + json.dumps(event)
                    + "\n\n"
                ).encode("utf-8")

                self.wfile.write(payload)
                self.wfile.flush()

        except (
            BrokenPipeError,
            ConnectionResetError,
            OSError,
        ):
            pass

    def api_models(self):
        try:
            models = get_assistant().client.list_models()

            return _send_json(
                self,
                {
                    "models": models
                },
            )

        except Exception as error:
            return _send_json(
                self,
                {
                    "models": [],
                    "error": str(error),
                },
            )

    def _build_status(self):
        """Lightweight kiosk status for the screensaver and top-bar."""
        cfg = {}
        try:
            cfg = server_config.load()
        except Exception:
            pass

        voice = cfg.get("voice", {})
        tw = cfg.get("training_wheels", {})

        status = {
            "online": True,
            "time": datetime.datetime.now().isoformat(timespec="seconds"),
            "wake": WAKE.status() if WAKE else {},
            "voice": {
                "speak": bool(voice.get("speak", True)),
                "wake_word": bool(voice.get("wake_word", False)),
                "continuous_listen": bool(voice.get("continuous_listen", False)),
            },
            "training_wheels": {
                "enabled": bool(tw.get("enabled", False)),
                "unlocked": bool(tw.get("unlocked", False)),
            },
        }
        return status

    def api_config_post(self, updates):
        merged = server_config.save(updates)

        get_assistant().refresh(merged)

        voice = merged.get(
            "voice",
            {},
        )

        apply_wakeword(
            bool(
                voice.get(
                    "wake_word",
                    False,
                )
            )
        )

        return _send_json(
            self,
            server_config.public(merged),
        )

    def api_audio_chunk(self):
        """
        Accept raw 16-bit 16 kHz mono PCM from a remote microphone node.

        POST body: raw PCM bytes (audio/l16 or octet-stream).
        The bytes are queued into the wake-word detector's streaming buffer.
        """
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 128000:
            return _send_json(self, {"error": "Bad chunk size"}, status=400)

        data = self.rfile.read(length)
        try:
            WAKE.feed_audio(data)
            return _send_json(self, {"ok": True, "bytes": len(data)})
        except Exception as e:
            return _send_json(self, {"error": str(e)}, status=500)

    def api_transcribe(self):
        """
        Transcribe browser-recorded audio bytes to English text.

        POST body: raw audio bytes (WAV or raw 16-bit 16 kHz mono PCM).
        Returns JSON: {"text": "hello jarvis"}
        """
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > 5 * 1024 * 1024:
            return _send_json(self, {"error": "Bad audio size"}, status=400)

        data = self.rfile.read(length)
        try:
            print(f"[stt] transcribing {len(data)} bytes")
            text = stt.transcribe(data)
            print(f"[stt] result: {text!r}")
            return _send_json(self, {"text": text})
        except Exception as e:
            print(f"[stt] error: {e}")
            return _send_json(self, {"error": str(e)}, status=500)

    # ------------------------------------------------------------------
    # TTS
    # ------------------------------------------------------------------

    def api_speak(self):
        """
        Generate J.A.R.V.I.S. speech using the local Piper voice.

        POST JSON:
            {
                "text": "Good evening. I am Jar-vis."
            }

        Returns:
            audio/wav
        """

        body = _read_body(self)

        text = str(
            body.get(
                "text",
                "",
            )
        ).strip()

        if not text:
            return _send_json(
                self,
                {
                    "error": "No text provided."
                },
                status=400,
            )

        try:
            audio = tts.synthesize(text)

            # Suppress wake-word detection while this reply plays,
            # otherwise the mic hears JARVIS and re-triggers.
            duration = _estimate_tts_duration(text)
            WAKE.set_tts_active(duration + 1.0)

            self.send_response(200)

            self.send_header(
                "Content-Type",
                "audio/wav",
            )

            self.send_header(
                "Content-Length",
                str(len(audio)),
            )

            self.send_header(
                "Cache-Control",
                "no-store",
            )

            self.send_header(
                "Access-Control-Allow-Origin",
                "*",
            )

            self.end_headers()

            self.wfile.write(audio)

        except Exception as error:
            return _send_json(
                self,
                {
                    "error": str(error)
                },
                status=500,
            )

    # ------------------------------------------------------------------
    # Chat
    # ------------------------------------------------------------------

    def api_ask(self):
        body = _read_body(self)
        client_ip = self.client_address[0]

        text = str(body.get("text", "")).strip()
        remember = bool(body.get("remember", True))

        if not text:
            return _send_json(
                self,
                {
                    "error": "No text provided.",
                    "state": get_assistant().state,
                },
                status=400,
            )

        assistant = get_assistant()
        assistant.refresh(server_config.load())

        try:
            result = assistant.ask(text, remember=remember)
            payload = result
            status = 200
            audit.log("chat", user_text=text[:500], client_ip=client_ip)
        except Exception as error:
            payload = {
                "error": str(error),
                "reply": (
                    "JARVIS lost contact with the core: "
                    + str(error)
                ),
                "state": "ERROR",
            }
            status = 500
            audit.log("chat_error", error=str(error), client_ip=client_ip)

        finally:
            rearm_wake()

        return _send_json(self, payload, status=status)

    def api_config_post(self, body):
        """Update hot-swappable config keys."""
        forbidden = {
            "openclaw_password",
            "openclaw_token",
            "training_wheels",
            "security",
        }
        filtered = {k: v for k, v in (body or {}).items() if k not in forbidden}
        if not filtered:
            return _send_json(self, {"error": "No allowed config keys provided"}, status=400)

        try:
            merged = server_config.save(filtered)
            audit.config_change(filtered, source_ip=self.client_address[0])
            return _send_json(self, server_config.public(merged))
        except Exception as exc:
            return _send_json(self, {"error": str(exc)}, status=500)

    def api_unlock(self, body):
        from server import tools as jarvis_tools
        password = (body or {}).get("password", "")
        result = jarvis_tools.execute(
            "unlock_jarvis",
            {"password": password},
            host_tools=False,
            source_ip=self.client_address[0],
        )
        return _send_json(self, {"result": result})

    def api_lock(self):
        from server import tools as jarvis_tools
        result = jarvis_tools.execute(
            "lock_jarvis",
            {},
            host_tools=False,
            source_ip=self.client_address[0],
        )
        return _send_json(self, {"result": result})

    # ------------------------------------------------------------------
    # New JARVIS features: volume, unit conversion, recipe scaling,
    # Training Wheels Protocol unlock/lock.
    # ------------------------------------------------------------------
    def api_volume(self, body):
        from server import tools as jarvis_tools
        action = (body or {}).get("action", "set")
        if action == "set":
            result = jarvis_tools.execute(
                "set_volume",
                {"level": (body or {}).get("level", 1.0)},
                host_tools=False,
            )
        elif action == "up":
            result = jarvis_tools.execute(
                "volume_up",
                {},
                host_tools=False,
            )
        elif action == "down":
            result = jarvis_tools.execute(
                "volume_down",
                {},
                host_tools=False,
            )
        elif action == "mute":
            result = jarvis_tools.execute(
                "mute_volume",
                {},
                host_tools=False,
            )
        else:
            result = "Unknown volume action."
        return _send_json(self, {"result": result})

    def api_unlock(self, body):
        from server import tools as jarvis_tools
        password = (body or {}).get("password", "")
        result = jarvis_tools.execute(
            "unlock_jarvis",
            {"password": password},
            host_tools=False,
            source_ip=self.client_address[0],
        )
        cfg = server_config.load()
        locked = cfg.get("training_wheels", {}).get("enabled", False) and \
            not cfg.get("training_wheels", {}).get("unlocked", False)
        return _send_json(self, {"result": result, "locked": locked})

    def api_lock(self):
        from server import tools as jarvis_tools
        result = jarvis_tools.execute(
            "lock_jarvis",
            {},
            host_tools=False,
            source_ip=self.client_address[0],
        )
        return _send_json(self, {"result": result, "locked": True})

    def api_verify_password(self, body):
        from server import tools as jarvis_tools
        password = (body or {}).get("password", "")
        ok = jarvis_tools.execute(
            "verify_password",
            {"password": password},
            host_tools=False,
            source_ip=self.client_address[0],
        )
        return _send_json(self, {"ok": bool(ok)})

    def api_convert(self, body):
        from server import tools as jarvis_tools
        result = jarvis_tools.execute(
            "convert_units",
            {
                "quantity": (body or {}).get("quantity"),
                "from_unit": (body or {}).get("from_unit"),
                "to_unit": (body or {}).get("to_unit"),
            },
            host_tools=False,
        )
        return _send_json(self, {"result": result})

    def api_scale(self, body):
        from server import tools as jarvis_tools
        result = jarvis_tools.execute(
            "scale_recipe",
            {
                "recipe_id": (body or {}).get("recipe_id"),
                "factor": (body or {}).get("factor", 1),
            },
            host_tools=False,
        )
        return _send_json(self, {"result": result})

    # ------------------------------------------------------------------
    # Kitchen
    # ------------------------------------------------------------------

    def api_recipes(self, query):
        q = query.get("q", [""])[0] if isinstance(query, dict) else ""
        category = query.get("cat", [""])[0] if isinstance(query, dict) else ""
        return _send_json(
            self,
            {
                "recipes": kitchen.search_local(
                    q,
                    category,
                )
            },
        )

    def api_web_search(self, query):
        q = query.get("q", [""])[0] if isinstance(query, dict) else ""
        category = query.get("cat", [""])[0] if isinstance(query, dict) else ""
        try:
            results = kitchen.web_search(
                q,
                limit=20,
            )

            if category:
                cat = category.strip().lower()
                results = [
                    r for r in results
                    if (r.get("category") or "").strip().lower() == cat
                ]

            return _send_json(
                self,
                {
                    "recipes": results
                },
            )

        except Exception as error:
            return _send_json(
                self,
                {
                    "recipes": [],
                    "error": str(error),
                },
            )

    def api_recipe_create(self, data):
        from server.kitchen import store

        record = store.add(data)

        return _send_json(
            self,
            {
                "recipe": record
            },
            status=201,
        )

    def api_recipe_update(
        self,
        recipe_id,
        data,
    ):
        from server.kitchen import store

        record = store.update(recipe_id, data)

        if record is None:
            return _send_json(
                self,
                {"error": "Recipe not found"},
                status=404,
            )

        return _send_json(
            self,
            {"recipe": record},
        )

    def api_recipe_favorite(
        self,
        recipe_id,
        data,
    ):
        from server.kitchen import store

        record = store.set_favorite(
            recipe_id,
            bool(
                data.get(
                    "favorite",
                    True,
                )
            ),
        )

        if record is None:
            return _send_json(
                self,
                {
                    "error": "Recipe not found"
                },
                status=404,
            )

        return _send_json(
            self,
            {
                "recipe": record
            },
        )


    def api_recipe_image(self, recipe_id):
        from server.kitchen import store

        content_type_header = self.headers.get("Content-Type", "")
        boundary_match = re.search(r'boundary=([^\s;]+)', content_type_header)

        if not boundary_match:
            return _send_json(
                self,
                {"error": "Missing multipart boundary."},
                status=400,
            )

        boundary = boundary_match.group(1).strip('"')
        filename, content_type, data = self._read_multipart(boundary)

        if not data:
            return _send_json(
                self,
                {"error": "No image file received."},
                status=400,
            )

        # Validate size (already bounded by read limit, but double-check).
        if len(data) > MAX_IMAGE_SIZE:
            return _send_json(
                self,
                {"error": "Image too large. Max 5 MB."},
                status=413,
            )

        # Validate image format by inspecting bytes.
        kind = imghdr.what(None, data)
        if kind not in ALLOWED_IMAGE_TYPES:
            return _send_json(
                self,
                {"error": f"Unsupported image type: {kind or 'unknown'}. Use jpeg/png/webp/gif."},
                status=415,
            )

        recipe = store.find(recipe_id)
        if recipe is None:
            return _send_json(
                self,
                {"error": "Recipe not found"},
                status=404,
            )

        # Sanitize: only allow alphanumeric IDs, no path traversal.
        safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(recipe_id))
        if not safe_id:
            return _send_json(
                self,
                {"error": "Invalid recipe ID."},
                status=400,
            )

        ext = kind if kind != "jpeg" else "jpg"
        upload_path = UPLOADS_DIR / f"{safe_id}.{ext}"
        upload_path.write_bytes(data)
        audit.file_operation("write", upload_path, size=len(data), source_ip=self.client_address[0])

        image_url = f"/static/uploads/recipes/{safe_id}.{ext}"
        updated = store.update(recipe_id, {"image": image_url})

        return _send_json(
            self,
            {"recipe": updated},
        )


def serve(host=None, port=None, use_ssl=None):
    global _SERVER

    config = server_config.load()

    host = host or config["web_host"]
    port = port or config["web_port"]

    server = ThreadingHTTPServer(
        (host, port),
        Handler,
    )

    server.daemon_threads = True
    _SERVER = server

    # Optional HTTPS (required for browser mic on non-localhost origins)
    root = Path(__file__).resolve().parent.parent
    cert = root / "cert.pem"
    key = root / "key.pem"
    if use_ssl is not False and cert.exists() and key.exists():
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=str(cert), keyfile=str(key))
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"
    else:
        scheme = "http"

    voice = config.get(
        "voice",
        {},
    )

    apply_wakeword(
        bool(
            voice.get(
                "wake_word",
                False,
            )
        )
    )

    global _WS_PORT
    # WebSocket audio is multiplexed on the same HTTP port (path /audio).
    _WS_PORT = port
    print(f"  Audio WS   :  ws://{host}:{_WS_PORT}/audio")

    print("=" * 56)
    print(
        "        J A R V I S  -  unified cloud web core"
    )
    print("=" * 56)

    print(
        f"  Web UI     :  {scheme}://localhost:{port}"
    )

    if scheme == "https":
        print(
            f"  HTTPS LAN  :  https://{host}:{port}  (cert in {root})"
        )

    print(
        f"  Ollama host:  {config['ollama_host']}"
        f"   (model: {config['model']})"
    )

    print(
        f"  Host tools :  "
        f"{'ON' if config.get('host_tools') else 'OFF'}"
    )

    print(
        "  Wake word  :  "
        f"{'HEY JARVIS (listening)' if voice.get('wake_word') else 'off'}"
    )

    print()

    print(
        "  On the same Wi-Fi you can open the UI from any device,"
    )

    print(
        "  e.g. on your phone or Galaxy Watch 5:"
    )

    print(
        f"      {scheme}://<this-pc-ip>:{port}"
    )

    print()

    print(
        "  Press Ctrl+C to shut down."
    )

    print("=" * 56)

    try:
        server.serve_forever()

    except KeyboardInterrupt:
        print(
            "\nJARVIS: Standing down."
        )

    finally:
        apply_wakeword(False)
        server.server_close()


if __name__ == "__main__":
    serve()