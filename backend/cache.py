# cache.py
import time
from threading import Lock

class TTLCache:
    def __init__(self, default_ttl: int = 8):
        self._store: dict = {}
        self._ttls: dict = {}
        self._lock = Lock()
        self.default_ttl = default_ttl

    def get(self, key: str):
        with self._lock:
            if key in self._store:
                if time.time() < self._ttls[key]:
                    return self._store[key]
                else:
                    del self._store[key]
                    del self._ttls[key]
        return None

    def set(self, key: str, value, ttl: int = None):
        with self._lock:
            self._store[key] = value
            self._ttls[key] = time.time() + (ttl or self.default_ttl)

    def delete(self, key: str):
        with self._lock:
            self._store.pop(key, None)
            self._ttls.pop(key, None)
