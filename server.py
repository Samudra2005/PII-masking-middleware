"""
server.py — the SAME /v1/mask and /v1/unmask contract as api.py, but
built on Python's built-in http.server instead of FastAPI. Zero
third-party dependencies at all (not even a web framework) — use this
version if "from scratch" needs to mean that strictly. api.py (FastAPI)
is the nicer developer experience if a standard web framework is fine.

Accepts a raw JSON payload (e.g. straight from a speech-to-text app)
rather than a single flat string, plus a list of which top-level
fields actually contain freeform text that needs masking. Every other
field in the payload (confidence scores, timestamps, language codes,
etc.) passes through completely untouched.

    POST /v1/mask
      {"payload": {"transcript": "...", "confidence": 0.94},
       "fields": ["transcript"], "session_id": "optional"}
    ->
      {"payload": {"transcript": "[REDACTED_..]...", "confidence": 0.94},
       "session_id": "..."}

    POST /v1/unmask
      {"payload": {"response": "...tokens..."},
       "fields": ["response"], "session_id": "..."}
    ->
      {"payload": {"response": "...real values restored..."}}
"""

import json
import os
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from mask_pii import Vault

API_KEY = os.environ.get("MASKING_API_KEY", "dev-only-key")
SESSION_TTL_SECONDS = 30 * 60

_sessions = {}  # session_id -> (Vault, last_used_timestamp)


def _mask_payload(vault, payload, fields):
    result = dict(payload)  # shallow copy — untouched fields stay exactly as they were
    for field in fields:
        if field in result and isinstance(result[field], str):
            result[field] = vault.mask(result[field])
    return result


def _unmask_payload(vault, payload, fields):
    result = dict(payload)
    for field in fields:
        if field in result and isinstance(result[field], str):
            result[field] = vault.unmask(result[field])
    return result


def _get_vault(session_id):
    now = time.time()
    for sid, (_, ts) in list(_sessions.items()):
        if now - ts > SESSION_TTL_SECONDS:
            del _sessions[sid]

    if session_id and session_id in _sessions:
        vault, _ = _sessions[session_id]
        _sessions[session_id] = (vault, now)
        return session_id, vault

    new_id = session_id or uuid.uuid4().hex
    vault = Vault()
    _sessions[new_id] = (vault, now)
    return new_id, vault


class Handler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        # Allows a browser-based frontend (e.g. the demo UI) to call
        # this API directly. Wide open (*) is fine for local/internal
        # demo use — tighten this to a specific origin before any real
        # deployment.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key")

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        # browsers send this "preflight" request before the real POST,
        # to ask permission — this just has to say yes
        self.send_response(204)
        self._cors_headers()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")

        if self.headers.get("X-API-Key") != API_KEY:
            return self._send_json(401, {"detail": "invalid or missing API key"})

        if self.path == "/v1/mask":
            session_id, vault = _get_vault(body.get("session_id"))
            masked_payload = _mask_payload(vault, body["payload"], body["fields"])
            return self._send_json(200, {"payload": masked_payload, "session_id": session_id})

        if self.path == "/v1/unmask":
            session_id = body.get("session_id")
            if session_id not in _sessions:
                return self._send_json(404, {"detail": "unknown or expired session_id"})
            vault, _ = _sessions[session_id]
            unmasked_payload = _unmask_payload(vault, body["payload"], body["fields"])
            return self._send_json(200, {"payload": unmasked_payload})

        return self._send_json(404, {"detail": "not found"})

    def log_message(self, format, *args):
        pass  # keep the console output clean during the demo


if __name__ == "__main__":
    port = 8000
    print(f"listening on 0.0.0.0:{port} (reachable from other machines on this network)")
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()
