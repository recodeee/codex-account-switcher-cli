from __future__ import annotations

import logging
import time

import anyio
from sqlalchemy.exc import SQLAlchemyError

from app.db.models import DashboardSettings
from app.db.session import SessionLocal
from app.modules.settings.repository import SettingsRepository

logger = logging.getLogger(__name__)


class SettingsCache:
    def __init__(self, *, ttl_seconds: float = 30.0) -> None:
        if ttl_seconds <= 0:
            raise ValueError("ttl_seconds must be positive")
        self._ttl_seconds = ttl_seconds
        self._cached_settings: DashboardSettings | None = None
        self._cached_at = 0.0
        self._lock = anyio.Lock()

    async def get(self) -> DashboardSettings:
        now = time.monotonic()
        if self._cached_settings is not None and now - self._cached_at < self._ttl_seconds:
            return self._cached_settings

        async with self._lock:
            now = time.monotonic()
            if self._cached_settings is not None and now - self._cached_at < self._ttl_seconds:
                return self._cached_settings

            try:
                async with SessionLocal() as session:
                    settings = await SettingsRepository(session).get_or_create()
            except SQLAlchemyError:
                if self._cached_settings is None:
                    raise
                logger.warning(
                    "settings_cache_refresh_failed_using_stale_settings",
                    exc_info=True,
                )
                # Keep stale settings available and throttle refresh retries.
                self._cached_at = now
                return self._cached_settings

            self._cached_settings = settings
            self._cached_at = now
            return settings

    async def invalidate(self) -> None:
        async with self._lock:
            self._cached_settings = None
            self._cached_at = 0.0


_settings_cache = SettingsCache()


def get_settings_cache() -> SettingsCache:
    return _settings_cache
