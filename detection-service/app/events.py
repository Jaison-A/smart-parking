"""Sends detection events to the Node backend without blocking the video loop."""
import logging
import queue
import threading
import time

import requests

log = logging.getLogger("events")


class EventClient:
    """Ordered, retrying, background HTTP sender. With no URL it just logs (CLI / dev mode)."""

    def __init__(self, base_url: str | None, api_key: str = ""):
        self.url = f"{base_url.rstrip('/')}/api/detector/events" if base_url else None
        self.headers = {"x-detector-key": api_key}
        self._queue: queue.Queue = queue.Queue(maxsize=2000)
        self._worker = threading.Thread(target=self._run, daemon=True)
        if self.url:
            self._worker.start()

    def send(self, payload: dict) -> None:
        if not self.url:
            log.info("event %s %s", payload["type"], _brief(payload))
            return
        try:
            self._queue.put_nowait(payload)
        except queue.Full:
            log.warning("event queue full - dropping %s", payload["type"])

    def close(self, timeout: float = 30.0) -> None:
        if self.url:
            self._queue.put(None)
            self._worker.join(timeout)

    # ---------------------------------------------------------------- internals
    def _run(self) -> None:
        while (payload := self._queue.get()) is not None:
            self._post(payload)

    def _post(self, payload: dict) -> None:
        for attempt in range(4):
            try:
                r = requests.post(self.url, json=payload, headers=self.headers, timeout=15)
                if r.ok:
                    return
                if 400 <= r.status_code < 500:  # our fault - retrying will not help
                    log.error("backend rejected %s: %s %s", payload["type"], r.status_code, r.text[:200])
                    return
            except requests.RequestException as exc:
                log.warning("backend unreachable (%s), retry %d", exc, attempt + 1)
            time.sleep(0.5 * 2 ** attempt)
        log.error("giving up on event %s", payload["type"])


def _brief(payload: dict) -> str:
    s = payload.get("session")
    if not s:
        return ""
    return f"plate={s['plate']} zone={s['zoneName']} duration={s['durationSeconds']}s"
