"""
Minimal WebSocket audio server for Pi microphone streaming.

Implements just enough of RFC 6455 to receive binary audio frames from
a single Pi kiosk and feed them into the host wake-word detector.

Protocol:
  - Client connects to ws://host:8001/audio (no subprotocol).
  - Client sends JSON text messages for control:
      {"type": "pause"}
      {"type": "resume"}
      {"type": "hello", "device_id": "kitchen", "format": "pcm_s16le_16000_mono"}
  - Client sends binary WebSocket frames containing raw 16-bit 16 kHz mono PCM.
  - Server replies with JSON events:
      {"type": "wake"}
      {"type": "command", "text": "..."}
      {"type": "error", "message": "..."}
      {"type": "paused"}
      {"type": "resumed"}

Only one audio stream is processed at a time; a second connection closes
the previous one.

This module uses the Python stdlib only.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import threading
import time

from server import audit
from server import config as server_config
from server import events
from server import wakeword


WS_MAGIC = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

# Global state shared with the web server.
WAKE = None
_server_thread = None
_server_socket = None
_stop_event = threading.Event()
_current_conn = None
_conn_lock = threading.Lock()


def _get_header(sock, timeout=5.0):
    """Read the HTTP upgrade request headers."""
    sock.settimeout(timeout)
    data = b""
    while b"\r\n\r\n" not in data:
        try:
            chunk = sock.recv(1024)
        except socket.timeout:
            return None
        if not chunk:
            return None
        data += chunk
    return data


def _send_http(sock, status, body=b"", headers=None):
    headers = headers or {}
    lines = [f"HTTP/1.1 {status}".encode()]
    for k, v in headers.items():
        lines.append(f"{k}: {v}".encode())
    if body:
        lines.append(f"Content-Length: {len(body)}".encode())
    lines.append(b"")
    lines.append(body)
    sock.sendall(b"\r\n".join(lines))


def _handshake(sock, data):
    """Perform the WebSocket upgrade handshake."""
    lines = data.split(b"\r\n")
    key = None
    for line in lines:
        if line.lower().startswith(b"sec-websocket-key:"):
            key = line.split(b":", 1)[1].strip()
            break
    if not key:
        _send_http(sock, "400 Bad Request")
        return False
    accept = base64.b64encode(hashlib.sha1(key + WS_MAGIC).digest()).decode()
    _send_http(
        sock,
        "101 Switching Protocols",
        headers={
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Accept": accept,
        },
    )
    return True


def _encode_ws_frame(payload, opcode=0x2, mask=False):
    """Encode a single WebSocket frame (server->client, no mask)."""
    header = opcode
    length = len(payload)
    if length < 126:
        header |= length << 0
        bytes_header = struct.pack("!B", header)
    elif length < 65536:
        header |= 126 << 0
        bytes_header = struct.pack("!BH", header, length)
    else:
        header |= 127 << 0
        bytes_header = struct.pack("!BQ", header, length)
    return bytes_header + payload


def _send_json(sock, obj):
    """Send a JSON text frame to the client."""
    try:
        data = json.dumps(obj).encode("utf-8")
        sock.sendall(_encode_ws_frame(data, opcode=0x1))
    except Exception as exc:
        print(f"[ws_audio] send failed: {exc}")


def _recv_ws_frame(sock):
    """Receive one WebSocket frame. Returns (opcode, payload) or (None, None) on close/error."""
    sock.settimeout(None)
    try:
        head = sock.recv(2)
    except (ConnectionResetError, OSError):
        return None, None
    if len(head) < 2:
        return None, None

    byte1, byte2 = head
    opcode = byte1 & 0x0F
    masked = bool(byte2 & 0x80)
    length = byte2 & 0x7F

    if length == 126:
        length_data = sock.recv(2)
        if len(length_data) < 2:
            return None, None
        length = struct.unpack("!H", length_data)[0]
    elif length == 127:
        length_data = sock.recv(8)
        if len(length_data) < 8:
            return None, None
        length = struct.unpack("!Q", length_data)[0]

    mask_key = b""
    if masked:
        mask_key = sock.recv(4)
        if len(mask_key) < 4:
            return None, None

    payload = b""
    while len(payload) < length:
        chunk = sock.recv(min(8192, length - len(payload)))
        if not chunk:
            return None, None
        payload += chunk

    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))

    return opcode, payload


def handle_connection(sock, addr, handshake_done=True):
    """Handle one Pi audio WebSocket connection whose handshake is already complete.

    When used inside the main HTTP server, handshake_done=True and we jump
    straight into the WebSocket frame loop. When used by the standalone server,
    handshake_done=False and we read/perform the HTTP upgrade first.
    """
    global _current_conn

    if not handshake_done:
        data = _get_header(sock)
        if data is None or not _handshake(sock, data):
            try:
                sock.close()
            except Exception:
                pass
            return
    else:
        # When handed an already-upgraded socket by the HTTP server, ensure
        # it is in blocking mode with no timeout so WebSocket frame reads
        # behave predictably.
        try:
            sock.settimeout(None)
        except Exception:
            pass

    client_ip = addr[0]
    device_id = "unknown"

    with _conn_lock:
        if _current_conn is not None:
            try:
                _current_conn.close()
            except Exception:
                pass
        _current_conn = sock

    audit.audio_stream("connect", device_id=device_id, source_ip=client_ip)
    print(f"[ws_audio] Pi connected from {client_ip}")

    paused = False
    last_hello = 0

    try:
        while not _stop_event.is_set():
            opcode, payload = _recv_ws_frame(sock)
            if opcode is None:
                break

            # Close frame.
            if opcode == 0x8:
                break

            # Text frame = control JSON.
            if opcode == 0x1:
                try:
                    msg = json.loads(payload.decode("utf-8"))
                except Exception:
                    continue
                mtype = msg.get("type", "")
                if mtype == "hello":
                    device_id = msg.get("device_id", device_id)
                    print(f"[ws_audio] device {device_id} hello")
                elif mtype == "pause":
                    paused = True
                    pause_ear(seconds=15)
                    _send_json(sock, {"type": "paused"})
                elif mtype == "resume":
                    paused = False
                    resume_ear()
                    _send_json(sock, {"type": "resumed"})
                continue

            # Binary frame = audio PCM.
            if opcode == 0x2 and WAKE is not None and not paused:
                WAKE.feed_audio(payload)

    except Exception as exc:
        print(f"[ws_audio] connection error from {client_ip}: {exc}")
    finally:
        audit.audio_stream("disconnect", device_id=device_id, source_ip=client_ip)
        print(f"[ws_audio] Pi disconnected from {client_ip}")
        with _conn_lock:
            if _current_conn is sock:
                _current_conn = None
        try:
            sock.close()
        except Exception:
            pass


def _handle_connection(sock, addr):
    """Standalone-mode handler: read HTTP upgrade and run WebSocket loop."""
    handle_connection(sock, addr, handshake_done=False)


def pause_ear(seconds=15):
    """Signal the Pi to pause audio capture (and locally ignore host stream)."""
    global _EAR_PAUSE_UNTIL
    _EAR_PAUSE_UNTIL = time.time() + seconds
    try:
        WAKE.flush_buffer()
    except Exception:
        pass


def resume_ear():
    """Resume host-side audio acceptance."""
    global _EAR_PAUSE_UNTIL
    _EAR_PAUSE_UNTIL = 0.0


def ear_paused():
    return time.time() < _EAR_PAUSE_UNTIL


def _server_loop(host, port):
    """Accept incoming WebSocket connections until stopped."""
    global _server_socket

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind((host, port))
    server.listen(2)
    _server_socket = server
    print(f"[ws_audio] listening on ws://{host}:{port}/audio")

    server.settimeout(1.0)
    while not _stop_event.is_set():
        try:
            sock, addr = server.accept()
        except socket.timeout:
            continue
        except OSError:
            break
        t = threading.Thread(
            target=_handle_connection,
            args=(sock, addr),
            daemon=True,
            name=f"jarvis-ws-audio-{addr[0]}",
        )
        t.start()


def start(wake, host="0.0.0.0", port=None):
    """Start the WebSocket audio server in a background thread."""
    global WAKE, _server_thread, _server_socket, _stop_event, _current_conn, _EAR_PAUSE_UNTIL

    WAKE = wake
    _stop_event.clear()
    _current_conn = None

    cfg = server_config.load()
    if port is None:
        port = int(cfg.get("web_port", 8000)) + 1  # default 8001

    if _server_thread is not None and _server_thread.is_alive():
        print("[ws_audio] already running")
        return port

    _server_thread = threading.Thread(
        target=_server_loop,
        args=(host, port),
        daemon=True,
        name="jarvis-ws-audio-server",
    )
    _server_thread.start()
    return port


def stop():
    """Stop the WebSocket audio server."""
    global _server_socket, _server_thread, _current_conn

    _stop_event.set()

    with _conn_lock:
        if _current_conn is not None:
            try:
                _current_conn.close()
            except Exception:
                pass
            _current_conn = None

    if _server_socket is not None:
        try:
            _server_socket.close()
        except Exception:
            pass
        _server_socket = None

    if _server_thread is not None:
        _server_thread.join(timeout=2)
        _server_thread = None


def broadcast(obj):
    """Send a JSON message to the currently connected Pi client."""
    with _conn_lock:
        sock = _current_conn
    if sock is not None:
        _send_json(sock, obj)
