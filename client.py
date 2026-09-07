import requests
import logging

logger = logging.getLogger(__name__)

class MaskingClient:
    def __init__(self, url="http://localhost:8000", api_key="dev-only-key"):
        self.url = url.rstrip("/")
        self.session = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "X-API-Key": api_key
        })
    
    def mask(self, payload, fields):
        """Mask specified fields. Returns {payload, session_id}"""
        try:
            r = self.session.post(
                f"{self.url}/v1/mask",
                json={"payload": payload, "fields": fields}
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error(f"Masking failed: {e}")
            raise
    
    def unmask(self, payload, fields, session_id):
        """Unmask using session. Returns {payload}"""
        try:
            r = self.session.post(
                f"{self.url}/v1/unmask",
                json={"payload": payload, "fields": fields, "session_id": session_id}
            )
            r.raise_for_status()
            return r.json()
        except Exception as e:
            logger.error(f"Unmasking failed: {e}")
            raise