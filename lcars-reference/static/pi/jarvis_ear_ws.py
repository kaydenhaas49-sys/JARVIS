#!/usr/bin/env python3
"""
JARVIS Ear WebSocket - Pi microphone forwarder (replaces jarvis_ear.py).

Captures audio from the local ALSA/USB mic and streams 16-bit 16 kHz mono
PCM chunks to the JARVIS host over a WebSocket.

The host still runs openwakeword. When the host detects the wake phrase, it
captures the following command audio from the same stream.

Environment:
  JARVIS_HOST      JARVIS web host IP/hostname (default: 192.168.103.240)
  JARVIS_WS_PORT   WebSocket audio port (default: 8001)
  EAR_DEVICE       ALSA device (default: default)
  EAR_NOSSL        Set to disable TLS warnings (legacy; WS is plain TCP)
"""
import base64
import hashlib
import json
import os
import random
import socket
import struct
import subprocess
import sys
import threading
import time

HOST = os.environ.get("JARVIS_WS_HOST") or os.environ.get("JARVIS_HOST", "192.168.103.240")
WS_PORT = int(os.environ.get("JARVIS_WS_PORT", "8000"))
DEVICE = os.environ.get("EAR_DEVICE", "default")
ENDPOINT = f"ws://{HOST}:{WS_PORT}/audio"

CHUNK_FRAMES = 1280          # 80 ms at 16 kHz
CHUNK_BYTES = CHUNK_FRAMES * 2
RATE = 16000
CHANNELS = 1
FORMAT = "S16_LE"

RECONNECT_MIN = 1.0
RECONNECT_MAX = 30.0

WS_MAGIC = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _recv_exact(sock, n):
    buf = b""
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def _encode_frame(payload, opcode=0x2):
    """Encode a client->server masked frame."""
    length = len(payload)
    # First byte: FIN=1 + opcode.  Second byte: MASK=1 + payload length.
    if length < 126:
        header_bytes = struct.pack("!BB", 0x80 | opcode, 0x80 | length)
    elif length < 65536:
        header_bytes = struct.pack("!BBH", 0x80 | opcode, 0x80 | 126, length)
    else:
        header_bytes = struct.pack("!BBQ", 0x80 | opcode, 0x80 | 127, length)

    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    return header_bytes + mask + masked


def _recv_frame(sock):
    """Receive one server->client frame. Returns (opcode, payload)."""
    head = _recv_exact(sock, 2)
    if not head:
        return None, None
    byte1, byte2 = head
    opcode = byte1 & 0x0F
    masked = bool(byte2 & 0x80)
    length = byte2 & 0x7F

    if length == 126:
        data = _recv_exact(sock, 2)
        if not data:
            return None, None
        length = struct.unpack("!H", data)[0]
    elif length == 127:
        data = _recv_exact(sock, 8)
        if not data:
            return None, None
        length = struct.unpack("!Q", data)[0]

    if masked:
        mask_key = _recv_exact(sock, 4)
        if not mask_key:
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


def _handshake(sock):
    """Perform WebSocket upgrade handshake."""
    key = base64.b64encode(os.urandom(16)).decode()
    headers = (
        f"GET /audio HTTP/1.1\r\n"
        f"Host: {HOST}:{WS_PORT}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    ).encode()
    sock.sendall(headers)

    response = b""
    while b"\r\n\r\n" not in response:
        chunk = sock.recv(1024)
        if not chunk:
            return False
        response += chunk

    if b"101" not in response.split(b"\r\n")[0]:
        print(f"[ear_ws] handshake failed: {response[:200]}")
        return False
    return True


def _send_json(sock, obj):
    data = json.dumps(obj).encode("utf-8")
    sock.sendall(_encode_frame(data, opcode=0x1))


def _start_arecord():
    cmd = [
        "arecord",
        "-D", DEVICE,
        "-f", FORMAT,
        "-r", str(RATE),
        "-c", str(CHANNELS),
        "-t", "raw",
    ]
    print("[ear_ws] arecord:", " ".join(cmd))
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def _read_exact(proc, n):
    buf = b""
    while len(buf) < n:
        chunk = proc.stdout.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def _connect():
    """Return a connected socket or None."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(5)
    try:
        sock.connect((HOST, WS_PORT))
    except Exception as exc:
        print(f"[ear_ws] connect failed: {exc}")
        sock.close()
        return None

    if not _handshake(sock):
        sock.close()
        return None

    sock.settimeout(None)
    print(f"[ear_ws] connected to {ENDPOINT}")
    _send_json(sock, {
        "type": "hello",
        "device_id": os.environ.get("JARVIS_DEVICE", "pi"),
        "format": "pcm_s16le_16000_mono",
    })
    return sock


def _drain_stderr(proc):
    """Print any arecord errors."""
    try:
        err = proc.stderr.read1(4096)
        if err:
            print("[ear_ws] arecord stderr:", err.decode("utf-8", errors="replace"))
    except Exception:
        pass


def main():
    reconnect_delay = RECONNECT_MIN

    while True:
        sock = _connect()
        if sock is None:
            print(f"[ear_ws] reconnecting in {reconnect_delay:.1f}s")
            time.sleep(reconnect_delay)
            reconnect_delay = min(reconnect_delay * 1.5 + random.random(), RECONNECT_MAX)
            continue

        reconnect_delay = RECONNECT_MIN
        proc = None
        paused = False

        try:
            proc = _start_arecord()
            time.sleep(0.2)

            while True:
                # Check for server control messages (non-blocking-ish via small timeout).
                sock.settimeout(0.05)
                try:
                    opcode, payload = _recv_frame(sock)
                except socket.timeout:
                    opcode, payload = None, None
                sock.settimeout(None)

                if opcode == 0x8:
                    print("[ear_ws] server closed connection")
                    break
                if opcode == 0x1 and payload:
                    try:
                        msg = json.loads(payload.decode("utf-8"))
                    except Exception:
                        msg = {}
                    mtype = msg.get("type", "")
                    if mtype == "pause":
                        if not paused and proc:
                            print("[ear_ws] pausing capture")
                            proc.terminate()
                            try:
                                proc.wait(timeout=2)
                            except Exception:
                                proc.kill()
                            proc = None
                            paused = True
                        continue
                    if mtype == "resume":
                        if paused:
                            print("[ear_ws] resuming capture")
                            proc = _start_arecord()
                            time.sleep(0.2)
                            paused = False
                        continue

                if paused:
                    time.sleep(0.1)
                    continue

                if proc is None or proc.poll() is not None:
                    _drain_stderr(proc)
                    print("[ear_ws] arecord died; restarting")
                    proc = _start_arecord()
                    time.sleep(0.2)
                    continue

                chunk = _read_exact(proc, CHUNK_BYTES)
                if chunk is None:
                    _drain_stderr(proc)
                    print("[ear_ws] arecord stdout closed; restarting")
                    proc = None
                    continue

                sock.sendall(_encode_frame(chunk, opcode=0x2))

        except Exception as exc:
            print(f"[ear_ws] stream error: {exc}")
        finally:
            if proc:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except Exception:
                    proc.kill()
            try:
                sock.close()
            except Exception:
                pass
            print("[ear_ws] disconnected")


if __name__ == "__main__":
    main()
