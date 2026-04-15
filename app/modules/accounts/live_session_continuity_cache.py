from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from app.core.config.settings import get_settings
from app.modules.accounts.schemas import AccountCodexAuthStatus, AccountSessionTaskPreview

if TYPE_CHECKING:
    from collections.abc import Iterable

try:
    from redis.asyncio import Redis, from_url
    from redis.exceptions import RedisError
except Exception:  # pragma: no cover - optional dependency import guard
    Redis = None  # type: ignore[assignment]
    from_url = None  # type: ignore[assignment]

    class RedisError(Exception):
        pass


logger = logging.getLogger(__name__)

_STATUS_ONLY_TASK_PREVIEW_RE = re.compile(
    r"(?i)^(?:task\s+)?(?:is\s+)?(?:already\s+)?(?:done|complete(?:d)?|finished)(?:\s+already)?[.!]?$"
)
_WARNING_TASK_PREVIEW_RE = re.compile(r"(?i)^warning\b")
_TASK_PREVIEW_MAX_LENGTH = 1200


@dataclass(frozen=True, slots=True)
class LiveSessionContinuitySignal:
    account_id: str
    snapshot_name: str | None
    codex_live_session_count: int
    codex_tracked_session_count: int
    has_live_session: bool
    task_preview: str | None


class LiveSessionContinuityCache:
    def __init__(
        self,
        *,
        redis_url: str | None,
        key_prefix: str,
        ttl_seconds: int,
        socket_timeout_seconds: float,
        file_path: Path | None,
    ) -> None:
        self._redis_url = (redis_url or "").strip() or None
        self._key_prefix = key_prefix.strip() or "codex-lb:dashboard-session-continuity:v1"
        self._ttl_seconds = max(1, int(ttl_seconds))
        self._socket_timeout_seconds = max(0.05, float(socket_timeout_seconds))
        self._file_path = file_path.expanduser() if file_path is not None else None
        self._client: Redis | None = None
        self._client_lock = asyncio.Lock()
        self._file_lock = asyncio.Lock()
        self._missing_dependency_logged = False

    async def load(self, account_ids: Iterable[str]) -> dict[str, LiveSessionContinuitySignal]:
        unique_account_ids = [account_id for account_id in dict.fromkeys(account_ids) if account_id]
        if not unique_account_ids:
            return {}

        client = await self._get_client()
        if client is None:
            return await self._load_from_file(unique_account_ids)

        keys = [self._build_key(account_id) for account_id in unique_account_ids]
        try:
            raw_values = await client.mget(keys)
        except RedisError:
            await self._on_client_error("Failed to read dashboard session continuity cache")
            return await self._load_from_file(unique_account_ids)

        recovered: dict[str, LiveSessionContinuitySignal] = {}
        for account_id, raw_value in zip(unique_account_ids, raw_values, strict=False):
            if not isinstance(raw_value, str) or not raw_value:
                continue
            signal = _decode_signal(raw_value)
            if signal is None:
                continue
            recovered[account_id] = signal
        return recovered

    async def store(self, signals: Iterable[LiveSessionContinuitySignal]) -> None:
        prepared = [signal for signal in signals if signal.account_id]
        if not prepared:
            return

        client = await self._get_client()
        if client is None:
            await self._store_to_file(prepared)
            return

        try:
            pipeline = client.pipeline(transaction=False)
            for signal in prepared:
                pipeline.set(
                    self._build_key(signal.account_id),
                    _encode_signal(signal),
                    ex=self._ttl_seconds,
                )
            await pipeline.execute()
        except RedisError:
            await self._on_client_error("Failed to store dashboard session continuity cache")
            await self._store_to_file(prepared)

    async def close(self) -> None:
        async with self._client_lock:
            client = self._client
            self._client = None
        await _close_redis_client(client)

    async def _get_client(self) -> Redis | None:
        if not self._redis_url:
            return None
        if Redis is None or from_url is None:
            if not self._missing_dependency_logged:
                logger.warning(
                    "dashboard_session_continuity_cache_dependency_missing",
                    extra={"dependency": "redis"},
                )
                self._missing_dependency_logged = True
            return None
        if self._client is not None:
            return self._client

        async with self._client_lock:
            if self._client is not None:
                return self._client
            self._client = from_url(
                self._redis_url,
                decode_responses=True,
                socket_connect_timeout=self._socket_timeout_seconds,
                socket_timeout=self._socket_timeout_seconds,
                health_check_interval=30,
                retry_on_timeout=True,
            )
            return self._client

    async def _on_client_error(self, message: str) -> None:
        logger.warning(message, exc_info=True)
        async with self._client_lock:
            client = self._client
            self._client = None
        await _close_redis_client(client)

    def _build_key(self, account_id: str) -> str:
        return f"{self._key_prefix}:{account_id}"

    async def _load_from_file(self, account_ids: list[str]) -> dict[str, LiveSessionContinuitySignal]:
        if self._file_path is None:
            return {}

        async with self._file_lock:
            payloads = self._read_file_payloads()
            if not payloads:
                return {}

            now_utc = datetime.now(timezone.utc)
            recovered: dict[str, LiveSessionContinuitySignal] = {}
            changed = False

            for account_id in account_ids:
                raw_payload = payloads.get(account_id)
                payload = _coerce_signal_payload(raw_payload)
                if payload is None:
                    if account_id in payloads:
                        payloads.pop(account_id, None)
                        changed = True
                    continue
                if not _is_payload_fresh(payload=payload, ttl_seconds=self._ttl_seconds, now_utc=now_utc):
                    payloads.pop(account_id, None)
                    changed = True
                    continue
                signal = _decode_signal_payload(payload)
                if signal is None:
                    payloads.pop(account_id, None)
                    changed = True
                    continue
                recovered[account_id] = signal

            if changed:
                self._write_file_payloads(payloads)
            return recovered

    async def _store_to_file(self, signals: list[LiveSessionContinuitySignal]) -> None:
        if self._file_path is None:
            return

        async with self._file_lock:
            payloads = self._read_file_payloads()
            now_utc = datetime.now(timezone.utc)

            # Keep the on-disk cache compact by pruning stale entries whenever we write.
            stale_account_ids = [
                account_id
                for account_id, raw_payload in payloads.items()
                if not _is_payload_fresh(
                    payload=_coerce_signal_payload(raw_payload),
                    ttl_seconds=self._ttl_seconds,
                    now_utc=now_utc,
                )
            ]
            for account_id in stale_account_ids:
                payloads.pop(account_id, None)

            for signal in signals:
                payloads[signal.account_id] = _encode_signal_payload(signal)

            self._write_file_payloads(payloads)

    def _read_file_payloads(self) -> dict[str, object]:
        if self._file_path is None or not self._file_path.exists():
            return {}

        try:
            raw = self._file_path.read_text(encoding="utf-8")
        except OSError:
            logger.warning("Failed to read dashboard session continuity file cache", exc_info=True)
            return {}
        if not raw.strip():
            return {}

        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Invalid dashboard session continuity file cache payload", exc_info=True)
            return {}
        if not isinstance(decoded, dict):
            return {}
        return {str(account_id): payload for account_id, payload in decoded.items()}

    def _write_file_payloads(self, payloads: dict[str, object]) -> None:
        if self._file_path is None:
            return

        try:
            self._file_path.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = self._file_path.with_name(self._file_path.name + ".tmp")
            tmp_path.write_text(
                json.dumps(payloads, separators=(",", ":"), ensure_ascii=False),
                encoding="utf-8",
            )
            tmp_path.replace(self._file_path)
        except OSError:
            logger.warning("Failed to write dashboard session continuity file cache", exc_info=True)


_cache: LiveSessionContinuityCache | None = None
_cache_config: tuple[str | None, str, int, float, Path | None] | None = None


def get_live_session_continuity_cache() -> LiveSessionContinuityCache:
    settings = get_settings()
    cache_config = (
        (settings.dashboard_session_continuity_redis_url or "").strip() or None,
        settings.dashboard_session_continuity_key_prefix,
        settings.dashboard_session_continuity_ttl_seconds,
        settings.dashboard_session_continuity_socket_timeout_seconds,
        settings.dashboard_session_continuity_file_path,
    )

    global _cache, _cache_config
    if _cache is None or _cache_config != cache_config:
        _cache = LiveSessionContinuityCache(
            redis_url=cache_config[0],
            key_prefix=cache_config[1],
            ttl_seconds=cache_config[2],
            socket_timeout_seconds=cache_config[3],
            file_path=cache_config[4],
        )
        _cache_config = cache_config

    return _cache


async def close_live_session_continuity_cache() -> None:
    global _cache, _cache_config
    if _cache is None:
        return
    await _cache.close()
    _cache = None
    _cache_config = None


async def apply_live_session_continuity(
    *,
    account_ids: list[str],
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    codex_live_session_counts_by_account: dict[str, int],
    codex_tracked_session_counts_by_account: dict[str, int],
    codex_current_task_preview_by_account: dict[str, str],
    codex_last_task_preview_by_account: dict[str, str] | None = None,
    codex_session_task_previews_by_account: dict[str, list[AccountSessionTaskPreview]] | None = None,
) -> None:
    if not account_ids:
        return

    cache = get_live_session_continuity_cache()
    signals_to_store: list[LiveSessionContinuitySignal] = []
    restore_candidates: list[str] = []

    for account_id in account_ids:
        signal = _build_signal(
            account_id=account_id,
            codex_auth_by_account=codex_auth_by_account,
            codex_live_session_counts_by_account=codex_live_session_counts_by_account,
            codex_tracked_session_counts_by_account=codex_tracked_session_counts_by_account,
            codex_current_task_preview_by_account=codex_current_task_preview_by_account,
            codex_session_task_previews_by_account=codex_session_task_previews_by_account,
        )
        if _has_session_signal(signal):
            signals_to_store.append(signal)
        else:
            restore_candidates.append(account_id)

    if restore_candidates:
        recovered_signals = await cache.load(restore_candidates)
        for account_id in restore_candidates:
            recovered = recovered_signals.get(account_id)
            if recovered is None:
                continue
            if not _snapshot_name_matches(
                recovered_snapshot_name=recovered.snapshot_name,
                current_status=codex_auth_by_account.get(account_id),
            ):
                continue

            if recovered.codex_live_session_count > codex_live_session_counts_by_account.get(account_id, 0):
                codex_live_session_counts_by_account[account_id] = recovered.codex_live_session_count
            if recovered.codex_tracked_session_count > codex_tracked_session_counts_by_account.get(account_id, 0):
                codex_tracked_session_counts_by_account[account_id] = recovered.codex_tracked_session_count

            auth_status = codex_auth_by_account.get(account_id)
            if auth_status is not None and recovered.has_live_session:
                auth_status.has_live_session = True

            existing_preview = _normalize_task_preview(codex_current_task_preview_by_account.get(account_id))
            if existing_preview is None and recovered.task_preview is not None:
                codex_current_task_preview_by_account[account_id] = recovered.task_preview
            if codex_last_task_preview_by_account is not None:
                existing_last_preview = _normalize_task_preview(codex_last_task_preview_by_account.get(account_id))
                if existing_last_preview is None and recovered.task_preview is not None:
                    codex_last_task_preview_by_account[account_id] = recovered.task_preview

            refreshed_signal = _build_signal(
                account_id=account_id,
                codex_auth_by_account=codex_auth_by_account,
                codex_live_session_counts_by_account=codex_live_session_counts_by_account,
                codex_tracked_session_counts_by_account=codex_tracked_session_counts_by_account,
                codex_current_task_preview_by_account=codex_current_task_preview_by_account,
                codex_session_task_previews_by_account=codex_session_task_previews_by_account,
            )
            if _has_session_signal(refreshed_signal):
                signals_to_store.append(refreshed_signal)

    if signals_to_store:
        deduped = list({signal.account_id: signal for signal in signals_to_store}.values())
        await cache.store(deduped)


def _build_signal(
    *,
    account_id: str,
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    codex_live_session_counts_by_account: dict[str, int],
    codex_tracked_session_counts_by_account: dict[str, int],
    codex_current_task_preview_by_account: dict[str, str],
    codex_session_task_previews_by_account: dict[str, list[AccountSessionTaskPreview]] | None,
) -> LiveSessionContinuitySignal:
    auth_status = codex_auth_by_account.get(account_id)
    live_count = max(0, int(codex_live_session_counts_by_account.get(account_id, 0)))
    tracked_count = max(0, int(codex_tracked_session_counts_by_account.get(account_id, 0)))
    task_preview = _normalize_task_preview(codex_current_task_preview_by_account.get(account_id))
    if task_preview is None and codex_session_task_previews_by_account:
        task_preview = _first_session_task_preview(codex_session_task_previews_by_account.get(account_id) or [])
    has_live_session = bool((auth_status.has_live_session if auth_status is not None else False) or live_count > 0 or tracked_count > 0)

    return LiveSessionContinuitySignal(
        account_id=account_id,
        snapshot_name=_normalize_snapshot_name(
            auth_status.expected_snapshot_name if auth_status is not None else None
        )
        or _normalize_snapshot_name(auth_status.snapshot_name if auth_status is not None else None),
        codex_live_session_count=live_count,
        codex_tracked_session_count=tracked_count,
        has_live_session=has_live_session,
        task_preview=task_preview,
    )


def _has_session_signal(signal: LiveSessionContinuitySignal) -> bool:
    return (
        signal.codex_live_session_count > 0
        or signal.codex_tracked_session_count > 0
        or signal.has_live_session
        or signal.task_preview is not None
    )


def _snapshot_name_matches(
    *,
    recovered_snapshot_name: str | None,
    current_status: AccountCodexAuthStatus | None,
) -> bool:
    if recovered_snapshot_name is None:
        return True
    if current_status is None:
        return True

    current_snapshot_name = _normalize_snapshot_name(current_status.expected_snapshot_name) or _normalize_snapshot_name(
        current_status.snapshot_name
    )
    if current_snapshot_name is None:
        return True
    return current_snapshot_name == recovered_snapshot_name


def _first_session_task_preview(session_previews: list[AccountSessionTaskPreview]) -> str | None:
    for preview in session_previews:
        normalized = _normalize_task_preview(preview.task_preview)
        if normalized is not None:
            return normalized
    return None


def _normalize_task_preview(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if _WARNING_TASK_PREVIEW_RE.match(normalized):
        return None
    if _STATUS_ONLY_TASK_PREVIEW_RE.match(normalized):
        return None
    if len(normalized) > _TASK_PREVIEW_MAX_LENGTH:
        return normalized[:_TASK_PREVIEW_MAX_LENGTH].rstrip()
    return normalized


def _normalize_snapshot_name(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def _encode_signal(signal: LiveSessionContinuitySignal) -> str:
    payload = _encode_signal_payload(signal)
    return json.dumps(payload, separators=(",", ":"))


def _encode_signal_payload(signal: LiveSessionContinuitySignal) -> dict[str, object]:
    return {
        "account_id": signal.account_id,
        "snapshot_name": signal.snapshot_name,
        "codex_live_session_count": max(0, int(signal.codex_live_session_count)),
        "codex_tracked_session_count": max(0, int(signal.codex_tracked_session_count)),
        "has_live_session": bool(signal.has_live_session),
        "task_preview": _normalize_task_preview(signal.task_preview),
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }


def _decode_signal(raw: str) -> LiveSessionContinuitySignal | None:
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None
    return _decode_signal_payload(payload)


def _coerce_signal_payload(raw_payload: object) -> dict[str, object] | None:
    if isinstance(raw_payload, dict):
        return raw_payload
    if isinstance(raw_payload, str):
        try:
            decoded = json.loads(raw_payload)
        except json.JSONDecodeError:
            return None
        if isinstance(decoded, dict):
            return decoded
    return None


def _decode_signal_payload(payload: dict[str, object]) -> LiveSessionContinuitySignal | None:
    if not isinstance(payload, dict):
        return None

    account_id = payload.get("account_id")
    if not isinstance(account_id, str) or not account_id.strip():
        return None

    snapshot_name_raw = payload.get("snapshot_name")
    snapshot_name = snapshot_name_raw if isinstance(snapshot_name_raw, str) else None
    task_preview_raw = payload.get("task_preview")
    task_preview = task_preview_raw if isinstance(task_preview_raw, str) else None

    return LiveSessionContinuitySignal(
        account_id=account_id,
        snapshot_name=_normalize_snapshot_name(snapshot_name),
        codex_live_session_count=_safe_int(payload.get("codex_live_session_count")),
        codex_tracked_session_count=_safe_int(payload.get("codex_tracked_session_count")),
        has_live_session=bool(payload.get("has_live_session")),
        task_preview=_normalize_task_preview(task_preview),
    )


def _is_payload_fresh(
    *,
    payload: dict[str, object] | None,
    ttl_seconds: int,
    now_utc: datetime,
) -> bool:
    if payload is None:
        return False
    recorded_at = _parse_payload_recorded_at(payload.get("recorded_at"))
    if recorded_at is None:
        return False
    max_age = max(1, int(ttl_seconds))
    age_seconds = (now_utc - recorded_at).total_seconds()
    return age_seconds <= max_age


def _parse_payload_recorded_at(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_int(value: object) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(0, value)
    if isinstance(value, float):
        return max(0, int(value))
    if isinstance(value, str):
        try:
            return max(0, int(float(value)))
        except ValueError:
            return 0
    return 0


async def _close_redis_client(client: Redis | None) -> None:
    if client is None:
        return
    try:
        close_method = getattr(client, "aclose", None)
        if callable(close_method):
            await close_method()
            return
        close_method = getattr(client, "close", None)
        if callable(close_method):
            maybe_awaitable = close_method()
            if asyncio.iscoroutine(maybe_awaitable):
                await maybe_awaitable
    except Exception:
        logger.debug("Failed to close dashboard session continuity redis client", exc_info=True)
