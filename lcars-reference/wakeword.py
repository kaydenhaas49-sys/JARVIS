"""
Wake-word detector ("Hey JARVIS") - strict ONE-SHOT behaviour.

Flow:
  1. Armed (idle): listens for the wake phrase.
  2. On detection: it DISARMS immediately and records the following
     ~5 seconds of audio as the spoken command.
  3. The captured command is transcribed server-side and emitted as a
     "command" event to the UI.
  4. The UI asks JARVIS and, on the server, the detector is re-armed only
     AFTER JARVIS has replied.

The remote microphone node (Pi) streams audio continuously; the browser
never needs to open the local mic.
"""
import threading
import time

from server import events


_AVAIL = None
_lastAvailCheck = 0.0

def available():
    """Check if openwakeword is importable. Retries after failures."""
    global _AVAIL, _lastAvailCheck
    now = time.time()
    if _AVAIL is True:
        return True
    if _AVAIL is False and now - _lastAvailCheck < 30:
        return False
    try:
        import openwakeword  # noqa: F401
        _AVAIL = True
    except Exception:
        _AVAIL = False
    _lastAvailCheck = now
    return _AVAIL


class WakeWord:
    WAKE_MODEL = "hey_jarvis"
    SAMPLE_RATE = 16000
    BLOCK = 1280          # 80 ms/frame at 16 kHz
    THRESHOLD = 0.55
    COOLDOWN = 4.0        # seconds to ignore a repeated fire of the same phrase
    COMMAND_SECONDS = 4.0 # maximum length of a command capture
    ENERGY_THRESHOLD = 20  # RMS; ignore very quiet blocks when scoring wake word
    SILENCE_THRESHOLD = 250  # RMS below this is considered silence during command capture
    SILENCE_PAD_SECONDS = 2.0  # keep recording for this long after voice stops
    MAX_COMMAND_SECONDS = 10.0  # hard cap so capture never hangs

    def __init__(self):
        self.armed = False        # currently listening for the wake phrase
        self.running = False      # the background thread is alive
        self._thread = None
        self._stop = threading.Event()
        self.last_detection = 0.0
        self.triggered = 0
        self.error = None
        self._stream_mode = False
        self._audio_buffer = bytearray()
        self._buf_lock = threading.Lock()
        self._model = None
        self._np = None
        self._rearm_timer = None
        self._capturing_command = False
        self._tts_active_until = 0.0
        self._last_rms = 0.0

    @property
    def last_rms(self):
        return float(self._last_rms)

    # ------------------------------------------------------------------
    # TTS echo suppression: skip inference while JARVIS is speaking
    # and for a short padding afterwards to catch room echo/reverb.
    # ------------------------------------------------------------------
    TTS_ECHO_PAD_SECONDS = 6.0

    def set_tts_active(self, seconds):
        """Mute wake-word detection for the next `seconds` plus echo padding."""
        self._tts_active_until = time.time() + max(0.0, float(seconds)) + self.TTS_ECHO_PAD_SECONDS

    def _tts_active(self):
        return time.time() < self._tts_active_until

    @staticmethod
    def _strip_wake_words(text):
        """Remove the wake phrase from the start of a transcribed command."""
        if not text:
            return text
        text = str(text).strip()
        # Common STT transcriptions of the wake phrase.
        lower = text.lower()
        prefixes = [
            "hey jarvis",
            "hay jarvis",
            "hi jarvis",
            "hello jarvis",
            "ok jarvis",
            "okay jarvis",
        ]
        for prefix in prefixes:
            if lower.startswith(prefix):
                text = text[len(prefix):].strip(",.;:- \t")
                break
        # Also strip a trailing wake phrase if the user repeated it.
        for prefix in prefixes:
            if lower.endswith(prefix):
                text = text[:-len(prefix)].strip(",.;:- \t")
                break
        return text

    # ------------------------------------------------------------------
    # Auto re-arm after wake if no command arrives
    # ------------------------------------------------------------------
    def _cancel_rearm_timer(self):
        t = self._rearm_timer
        if t:
            t.cancel()
            self._rearm_timer = None

    def _auto_rearm(self):
        """Re-arm only after command capture and TTS/echo guard are done."""
        self._rearm_timer = None
        if self.armed or self._stop.is_set():
            return

        try:
            # Enforce a minimum silence window after the last detection so the
            # tail of the wake phrase/room echo can't immediately re-trigger.
            while time.time() - self.last_detection < self.COOLDOWN and not self._stop.is_set():
                print("[wakeword] deferring re-arm until cooldown passes")
                time.sleep(0.2)

            if self._capturing_command:
                print("[wakeword] deferring re-arm until command capture completes")
                while self._capturing_command and not self._stop.is_set():
                    time.sleep(0.1)

            while self._tts_active() and not self._stop.is_set():
                print("[wakeword] deferring re-arm until TTS/echo guard clears")
                time.sleep(0.2)

            # Wait for the room to actually go quiet before listening again,
            # otherwise JARVIS's own reply echo can trigger a second wake.
            quiet_start = None
            while not self._stop.is_set():
                block = self._consume_block()
                if block is None or block.size == 0:
                    time.sleep(0.05)
                    continue
                rms = float(self._np.sqrt(self._np.mean(block.astype(self._np.float32) ** 2)))
                if rms < self.ENERGY_THRESHOLD:
                    if quiet_start is None:
                        quiet_start = time.time()
                    elif time.time() - quiet_start >= 1.0:
                        print("[wakeword] room quiet, re-arming")
                        break
                else:
                    quiet_start = None

            if self._stop.is_set():
                return

            with self._buf_lock:
                self._audio_buffer.clear()

            from server import config as server_config
            cfg = server_config.load()
            if cfg.get("voice", {}).get("wake_word"):
                print("[wakeword] auto re-arming after command window")
                self.arm()
        except Exception as e:
            print("[wakeword] auto re-arm failed:", e)

    def _schedule_auto_rearm(self, seconds=1):
        """Schedule re-arm with a short cooldown after the command ends."""
        self._cancel_rearm_timer()
        self._rearm_timer = threading.Timer(seconds, self._auto_rearm)
        self._rearm_timer.daemon = True
        self._rearm_timer.start()

    # ------------------------------------------------------------------
    # Control
    # ------------------------------------------------------------------
    def arm(self):
        """Listen for the wake phrase. Safe to call repeatedly."""
        if not available():
            self.error = "openwakeword not installed"
            return
        self.armed = True
        self.error = None
        self._cancel_rearm_timer()
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self.running = True
            self._thread = threading.Thread(target=self._run, daemon=True,
                                            name="jarvis-wakeword")
            self._thread.start()

    def disarm(self):
        """Stop listening (frees the mic)."""
        self.armed = False

    def stop(self):
        """Terminate the background thread entirely."""
        self.disarm()
        self.running = False
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
            self._thread = None

    def status(self):
        return {
            "enabled": self.running,
            "armed": self.armed,
            "available": available(),
            "model": self.WAKE_MODEL,
            "threshold": self.THRESHOLD,
            "triggered": self.triggered,
            "error": self.error,
            "stream_mode": self._stream_mode,
            "capturing_command": self._capturing_command,
            "tts_muted": self._tts_active(),
            "last_rms": self.last_rms,
        }

    # ------------------------------------------------------------------
    # Streaming audio input (from remote mic / Pi)
    # ------------------------------------------------------------------
    def enable_stream_mode(self):
        """Use externally-fed audio chunks instead of local microphone."""
        self._stream_mode = True
        self.arm()

    def feed_audio(self, pcm_bytes):
        """Feed 16-bit 16 kHz mono PCM bytes from a remote microphone."""
        if not pcm_bytes:
            return
        with self._buf_lock:
            self._audio_buffer.extend(pcm_bytes)

    def flush_buffer(self):
        """Discard any queued audio."""
        with self._buf_lock:
            self._audio_buffer.clear()

    def _consume_block(self):
        """Return one BLOCK of int16 samples (None if not enough data)."""
        with self._buf_lock:
            need = self.BLOCK * 2
            if len(self._audio_buffer) < need:
                return None
            chunk = self._audio_buffer[:need]
            del self._audio_buffer[:need]
        return self._np.frombuffer(bytes(chunk), dtype=self._np.int16)

    def _consume_up_to(self, max_bytes):
        """Return up to max_bytes of raw PCM from the buffer."""
        with self._buf_lock:
            n = min(max_bytes, len(self._audio_buffer))
            chunk = self._audio_buffer[:n]
            del self._audio_buffer[:n]
        return bytes(chunk)

    # ------------------------------------------------------------------
    # Command capture (server-side, from the same remote mic stream)
    # ------------------------------------------------------------------
    def _capture_command(self):
        """Record the user's command until they stop speaking.

        Voice-activity based capture:
          - Start immediately after wake detection.
          - Keep recording while the user is speaking.
          - When audio energy drops below SILENCE_THRESHOLD for
            SILENCE_PAD_SECONDS, stop.
          - Hard cap at MAX_COMMAND_SECONDS so a loud background noise
            can't hang the pipeline forever.
          - The first 0.25 s is discarded to remove the tail of the
            wake phrase.
        """
        self._capturing_command = True
        try:
            sample_rate = self.SAMPLE_RATE
            bytes_per_sec = sample_rate * 2  # 16-bit mono
            discard_bytes = int(0.25 * bytes_per_sec)
            silence_pad_bytes = int(self.SILENCE_PAD_SECONDS * bytes_per_sec)
            max_bytes = int(self.MAX_COMMAND_SECONDS * bytes_per_sec)

            command_audio = bytearray()
            discarded = 0
            silent_bytes = 0
            start = time.time()
            voice_seen = False

            print("[wakeword] capturing command audio (VAD)")
            if self._tts_active():
                print("[wakeword] command capture aborted: TTS still active (echo guard)")
                events.post("command", text="", error="tts_active")
                return

            while len(command_audio) < max_bytes:
                chunk = self._consume_up_to(max_bytes - len(command_audio))
                if not chunk:
                    time.sleep(0.02)
                    # Safety timeout: if nothing arrives for too long, bail.
                    if time.time() - start > self.MAX_COMMAND_SECONDS + 3:
                        break
                    continue

                # Abort if JARVIS started speaking during capture (echo/feedback).
                if self._tts_active():
                    print("[wakeword] command capture aborted mid-stream: TTS became active")
                    events.post("command", text="", error="tts_active")
                    return

                # Discard the tail of the wake phrase first.
                if discarded < discard_bytes:
                    skip = min(len(chunk), discard_bytes - discarded)
                    chunk = chunk[skip:]
                    discarded += skip
                    if not chunk:
                        continue

                # Compute RMS on int16 samples for this chunk.
                samples = self._np.frombuffer(chunk, dtype=self._np.int16)
                if samples.size == 0:
                    continue
                rms = float(self._np.sqrt(self._np.mean(samples.astype(self._np.float32) ** 2)))

                if rms >= self.SILENCE_THRESHOLD:
                    voice_seen = True
                    silent_bytes = 0
                else:
                    silent_bytes += len(chunk)

                command_audio.extend(chunk)

                # Stop once we've heard voice and then silence for the pad duration.
                if voice_seen and silent_bytes >= silence_pad_bytes:
                    print(f"[wakeword] silence detected, ending command capture")
                    break

            elapsed = time.time() - start
            print(f"[wakeword] command captured {len(command_audio)} bytes in {elapsed:.2f}s")
            if len(command_audio) < 32000:  # < 1 second
                print("[wakeword] command audio too short")
                events.post("command", text="", error="too_short")
                return

            text = self._transcribe(bytes(command_audio))
            # Strip the wake phrase if the STT model included it.
            text = self._strip_wake_words(text)
            print(f"[wakeword] command transcription: {text!r}")
            events.post("command", text=text)
        except Exception as e:
            print("[wakeword] command capture failed:", e)
            events.post("command", text="", error=str(e))
        finally:
            self._capturing_command = False
            # Re-arm after a short cooldown once command handling is done.
            self._schedule_auto_rearm(1.0)

    def _transcribe(self, pcm_bytes):
        """Transcribe raw 16-bit 16kHz mono PCM bytes to English text."""
        try:
            from server import stt
            return stt.transcribe(pcm_bytes) or ""
        except Exception as e:
            print("[wakeword] stt error:", e)
            return ""

    # ------------------------------------------------------------------
    # Detector thread
    # ------------------------------------------------------------------
    def _run(self):
        import numpy as np
        from openwakeword.model import Model

        self._np = np

        try:
            model = Model(inference_framework="onnx",
                          wakeword_models=[self.WAKE_MODEL])
            self._model = model
        except Exception as exc:
            self.error = f"wake-word model unavailable: {exc}"
            self.running = False
            self.armed = False
            return

        while not self._stop.is_set():
            if not self.armed:
                time.sleep(0.2)
                continue
            try:
                if self._stream_mode:
                    self._detect_stream(model)
                else:
                    self._detect_local(model)
            except Exception as exc:
                self.error = str(exc)
                time.sleep(1.0)

    def _detect_stream(self, model):
        """Process audio fed remotely via feed_audio()."""
        last_stats = time.time()
        max_score = 0.0
        max_rms = 0.0
        while self.armed and not self._stop.is_set():
            samples = self._consume_block()
            if samples is None:
                time.sleep(0.02)
                continue
            score = float(model.predict(samples).get(self.WAKE_MODEL, 0))
            now = time.time()
            if score > max_score:
                max_score = score
            if self._tts_active():
                continue
            rms = float(self._np.sqrt(self._np.mean(samples.astype(self._np.float32) ** 2)))
            self._last_rms = rms
            if rms > max_rms:
                max_rms = rms
            if now - last_stats > 10:
                print(f"[wakeword] 10s stats max_score={round(max_score, 3)} max_rms={round(max_rms, 1)} buffer={len(self._audio_buffer)}")
                last_stats = now
                max_score = 0.0
                max_rms = 0.0
            if rms < self.ENERGY_THRESHOLD:
                continue
            if score > 0.5:
                print(f"[wakeword] score={round(score, 3)} rms={round(rms, 1)}")
            if score > self.THRESHOLD and now - self.last_detection > self.COOLDOWN:
                self.last_detection = now
                self.armed = False
                self.triggered += 1
                print(f"[wakeword] HEY JARVIS detected (score={round(score, 3)}, rms={round(rms, 1)})")
                events.post("wake", score=round(score, 3))
                # Capture command in a background thread so the detector loop
                # can immediately go back to sleep and re-arm later.
                threading.Thread(
                    target=self._capture_command,
                    daemon=True,
                    name="jarvis-command-capture",
                ).start()
                return

    def _detect_local(self, model):
        import numpy as np
        import sounddevice as sd

        device = self._pick_input_device(sd)
        sample_rate = self.SAMPLE_RATE
        if device is not None:
            info = sd.query_devices(device)
            if info.get("default_samplerate"):
                sample_rate = int(info.get("default_samplerate"))

        block = int(sample_rate * 0.08)

        with sd.InputStream(samplerate=sample_rate, channels=1,
                            dtype="int16", blocksize=block,
                            device=device) as stream:
            while self.armed and not self._stop.is_set():
                audio, _ = stream.read(block)
                samples = np.frombuffer(audio, dtype=np.int16)
                if sample_rate != self.SAMPLE_RATE:
                    samples = self._resample(samples, sample_rate, self.SAMPLE_RATE)

                if self._tts_active():
                    continue

                score = float(model.predict(samples).get(self.WAKE_MODEL, 0))

                now = time.time()
                if score > self.THRESHOLD and now - self.last_detection > self.COOLDOWN:
                    self.last_detection = now
                    self.armed = False
                    self.triggered += 1
                    print(f"[wakeword] HEY JARVIS detected (score={round(score, 3)})")
                    try:
                        from server import web
                        web.pause_ear()
                    except Exception:
                        pass
                    self._schedule_auto_rearm()
                    events.post("wake", score=round(score, 3))
                    break

    def _pick_input_device(self, sd):
        """Return the best input device index, or None for PortAudio default."""
        try:
            default = sd.query_devices(kind="input")
            if default and default.get("max_input_channels", 0) > 0:
                return default.get("index")
        except Exception:
            pass

        for dev in sd.query_devices():
            if dev.get("max_input_channels", 0) > 0:
                if "dummy" in dev.get("name", "").lower():
                    continue
                return dev.get("index")
        return None

    def _resample(self, samples, src_rate, dst_rate):
        """Simple linear-interpolation resample to 16 kHz."""
        import numpy as np
        if src_rate == dst_rate:
            return samples
        ratio = dst_rate / src_rate
        new_len = int(len(samples) * ratio)
        indices = np.linspace(0, len(samples) - 1, new_len)
        return np.interp(indices, np.arange(len(samples)), samples).astype(np.int16)

if __name__ == "__main__":
    w = WakeWord()
    print("Say HEY JARVIS (single-shot; Ctrl+C to stop)")
    w.arm()
    try:
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        w.stop()
