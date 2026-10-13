#!/usr/bin/env python3
"""
JARVIS Ear - remote microphone forwarder for the Pi kiosk.

Captures audio from the local ALSA headset mic and POSTs 16-bit 16 kHz
mono PCM chunks to the JARVIS host's /api/audio_chunk endpoint.

The host runs openwakeword and fires a wake event to the web UI.
When the host detects the wake phrase it tells us to pause capture so
that the browser can open the same microphone for command recording.
"""
import subprocess
import sys
import time
import urllib.request
import ssl

HOST = "https://192.168.103.240:8000"
ENDPOINT = f"{HOST}/api/audio_chunk"
CONTROL_ENDPOINT = f"{HOST}/api/ear_control"
CHUNK_FRAMES = 1280          # 80 ms at 16 kHz
CHUNK_BYTES = CHUNK_FRAMES * 2
RATE = 16000
CHANNELS = 1
FORMAT = "S16_LE"
DEVICE = "default"  # PipeWire ALSA plugin allows sharing with browser
PAUSE_POLL_INTERVAL = 0.25   # seconds


def make_ctx():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


SSL_CTX = make_ctx()


def post_chunk(data):
    req = urllib.request.Request(
        ENDPOINT,
        data=data,
        method="POST",
        headers={"Content-Type": "application/octet-stream"},
    )
    try:
        with urllib.request.urlopen(req, context=SSL_CTX, timeout=5) as resp:
            return resp.status
    except Exception as exc:
        print(f"[ear] chunk send failed: {exc}", file=sys.stderr)
        return None


def is_paused():
    try:
        print("[ear] fetching control", file=sys.stderr, flush=True)
        with urllib.request.urlopen(CONTROL_ENDPOINT, context=SSL_CTX, timeout=2) as resp:
            data = resp.read().decode("utf-8")
            print("[ear] control raw:", data[:100], file=sys.stderr, flush=True)
            import json
            return json.loads(data).get("paused", False)
    except Exception as exc:
        print("[ear] control fetch failed:", exc, file=sys.stderr, flush=True)
        return False


def start_arecord():
    cmd = [
        "arecord",
        "-D", DEVICE,
        "-f", FORMAT,
        "-r", str(RATE),
        "-c", str(CHANNELS),
        "-t", "raw",
    ]
    print("[ear] Starting capture:", " ".join(cmd))
    return subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def read_exact(proc, n):
    """Read exactly n bytes from the arecord stdout, handling partial reads."""
    buf = b""
    while len(buf) < n:
        chunk = proc.stdout.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


def main():
    proc = None
    paused = False

    try:
        while True:
            host_paused = is_paused()

            if host_paused and not paused:
                print("[ear] Host requested pause; releasing microphone")
                if proc:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2)
                    except Exception:
                        proc.kill()
                    proc = None
                paused = True

            if paused and not host_paused:
                print("[ear] Host resumed; re-opening microphone")
                paused = False

            if paused:
                time.sleep(PAUSE_POLL_INTERVAL)
                continue

            if proc is None or proc.poll() is not None:
                proc = start_arecord()
                time.sleep(0.2)  # let arecord settle

            print("[ear] reading chunk", file=sys.stderr, flush=True)
            chunk = read_exact(proc, CHUNK_BYTES)
            print("[ear] got chunk bytes:", len(chunk) if chunk else None, file=sys.stderr, flush=True)
            if chunk is None:
                err = b""
                try:
                    err = proc.stderr.read1(4096)
                except Exception:
                    pass
                if err:
                    print("[ear] arecord stderr:", err.decode("utf-8", errors="replace"), file=sys.stderr)
                time.sleep(0.1)
                if proc.poll() is not None:
                    print(f"[ear] arecord exited with {proc.returncode}; restarting", file=sys.stderr)
                    proc = None
                continue

            print("[ear] posting chunk", file=sys.stderr, flush=True)
            status = post_chunk(chunk)
            print("[ear] host status:", status, file=sys.stderr, flush=True)
            if status and status != 200:
                print(f"[ear] host returned {status}", file=sys.stderr)

    except KeyboardInterrupt:
        print("[ear] Stopping...")
    finally:
        if proc:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except Exception:
                proc.kill()


if __name__ == "__main__":
    main()
