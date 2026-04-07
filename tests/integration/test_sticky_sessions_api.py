from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

import pytest
from sqlalchemy import text

from app.core.crypto import TokenEncryptor
from app.core.utils.time import utcnow
from app.db.models import Account, AccountStatus, StickySessionKind
from app.db.session import SessionLocal
from app.modules.accounts.repository import AccountsRepository
from app.modules.settings.repository import SettingsRepository
from app.modules.sticky_sessions.cleanup_scheduler import StickySessionCleanupScheduler

pytestmark = pytest.mark.integration


async def _create_accounts() -> list[Account]:
    encryptor = TokenEncryptor()
    accounts = [
        Account(
            id="sticky-api-a",
            chatgpt_account_id="sticky-api-a",
            email="sticky-a@example.com",
            plan_type="plus",
            access_token_encrypted=encryptor.encrypt("access-a"),
            refresh_token_encrypted=encryptor.encrypt("refresh-a"),
            id_token_encrypted=encryptor.encrypt("id-a"),
            last_refresh=utcnow(),
            status=AccountStatus.ACTIVE,
            deactivation_reason=None,
        ),
        Account(
            id="sticky-api-b",
            chatgpt_account_id="sticky-api-b",
            email="sticky-b@example.com",
            plan_type="plus",
            access_token_encrypted=encryptor.encrypt("access-b"),
            refresh_token_encrypted=encryptor.encrypt("refresh-b"),
            id_token_encrypted=encryptor.encrypt("id-b"),
            last_refresh=utcnow(),
            status=AccountStatus.ACTIVE,
            deactivation_reason=None,
        ),
    ]
    async with SessionLocal() as session:
        repo = AccountsRepository(session)
        for account in accounts:
            await repo.upsert(account)
    return accounts


async def _set_affinity_ttl(seconds: int) -> None:
    async with SessionLocal() as session:
        settings = await SettingsRepository(session).get_or_create()
        settings.openai_cache_affinity_max_age_seconds = seconds
        await session.commit()


async def _insert_sticky_session(
    *,
    key: str,
    account_id: str,
    kind: StickySessionKind,
    updated_at_offset_seconds: int,
    task_preview: str | None = None,
    task_updated_at_offset_seconds: int | None = None,
) -> None:
    timestamp = utcnow() - timedelta(seconds=updated_at_offset_seconds)
    task_timestamp = (
        utcnow() - timedelta(seconds=task_updated_at_offset_seconds)
        if task_updated_at_offset_seconds is not None
        else timestamp
    )
    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO sticky_sessions (
                    key, account_id, kind, created_at, updated_at, task_preview, task_updated_at
                )
                VALUES (
                    :key, :account_id, :kind, :timestamp, :timestamp, :task_preview, :task_updated_at
                )
                """
            ),
            {
                "key": key,
                "account_id": account_id,
                "kind": kind.value,
                "timestamp": timestamp,
                "task_preview": task_preview,
                "task_updated_at": task_timestamp if task_preview is not None else None,
            },
        )
        await session.commit()


def _write_rollout_with_user_task(
    path: Path,
    *,
    timestamp: datetime,
    task: str,
) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "response_item",
        "payload": {
            "type": "message",
            "role": "user",
            "content": [{"type": "input_text", "text": task}],
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


def _append_rollout_payload(path: Path, *, payload: dict[str, object], timestamp: datetime) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload) + "\n")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


@pytest.mark.asyncio
async def test_sticky_sessions_api_lists_metadata_and_purges_stale(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)
    await _insert_sticky_session(
        key="prompt-cache-stale",
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=600,
    )
    await _insert_sticky_session(
        key="prompt-cache-fresh",
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=10,
    )
    await _insert_sticky_session(
        key="codex-session-old",
        account_id=accounts[1].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=600,
    )

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    payload = response.json()
    entries = {entry["key"]: entry for entry in payload["entries"]}
    assert payload["total"] == 3
    assert payload["hasMore"] is False

    assert entries["prompt-cache-stale"]["kind"] == "prompt_cache"
    assert entries["prompt-cache-stale"]["accountId"] == accounts[0].id
    assert entries["prompt-cache-stale"]["displayName"] == "sticky-a@example.com"
    assert entries["prompt-cache-stale"]["isStale"] is True
    assert entries["prompt-cache-stale"]["expiresAt"] is not None
    assert entries["prompt-cache-fresh"]["displayName"] == "sticky-a@example.com"
    assert entries["prompt-cache-fresh"]["isStale"] is False
    assert entries["codex-session-old"]["kind"] == "codex_session"
    assert entries["codex-session-old"]["accountId"] == accounts[1].id
    assert entries["codex-session-old"]["displayName"] == "sticky-b@example.com"
    assert entries["codex-session-old"]["isStale"] is False
    assert entries["codex-session-old"]["expiresAt"] is None

    response = await async_client.get("/api/sticky-sessions", params={"staleOnly": "true"})
    assert response.status_code == 200
    stale_payload = response.json()
    assert [entry["key"] for entry in stale_payload["entries"]] == ["prompt-cache-stale"]
    assert stale_payload["total"] == 1
    assert stale_payload["hasMore"] is False

    response = await async_client.post("/api/sticky-sessions/purge", json={"staleOnly": True})
    assert response.status_code == 200
    assert response.json()["deletedCount"] == 1

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    remaining_keys = {entry["key"] for entry in response.json()["entries"]}
    assert remaining_keys == {"prompt-cache-fresh", "codex-session-old"}


@pytest.mark.asyncio
async def test_sticky_sessions_api_active_only_filters_codex_sessions_and_returns_task_preview(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)
    await _insert_sticky_session(
        key="codex-session-active",
        account_id=accounts[0].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=30,
        task_preview="Review websocket reconnect regression",
    )
    await _insert_sticky_session(
        key="codex-session-stale",
        account_id=accounts[1].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=3600,
        task_preview="Old task should be hidden",
    )

    response = await async_client.get(
        "/api/sticky-sessions",
        params={"kind": "codex_session", "activeOnly": "true"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    assert payload["hasMore"] is False
    assert [entry["key"] for entry in payload["entries"]] == ["codex-session-active"]
    active_entry = payload["entries"][0]
    assert active_entry["taskPreview"] == "Review websocket reconnect regression"
    assert active_entry["taskUpdatedAt"] is not None
    assert active_entry["isActive"] is True


@pytest.mark.asyncio
async def test_sticky_sessions_api_falls_back_to_local_rollout_task_preview_when_missing(async_client, monkeypatch, tmp_path):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24268"
    await _insert_sticky_session(
        key=f"{session_id}::auth:scope",
        account_id=accounts[0].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=20,
        task_preview=None,
    )

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    rollout_path = day_dir / f"rollout-{now.strftime('%Y-%m-%dT%H-%M-%S')}-{session_id}.jsonl"
    _write_rollout_with_user_task(
        rollout_path,
        timestamp=now - timedelta(seconds=10),
        task="Bridge codex MCP session task titles",
    )

    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    response = await async_client.get(
        "/api/sticky-sessions",
        params={"kind": "codex_session", "activeOnly": "true"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 1
    entry = payload["entries"][0]
    assert entry["key"] == f"{session_id}::auth:scope"
    assert entry["taskPreview"] == "Bridge codex MCP session task titles"
    assert entry["taskUpdatedAt"] is not None


@pytest.mark.asyncio
async def test_sticky_sessions_api_returns_unmapped_cli_sessions(async_client, monkeypatch):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    import app.modules.sticky_sessions.service as sticky_service_module

    monkeypatch.setattr(
        sticky_service_module,
        "build_snapshot_index",
        lambda: SimpleNamespace(
            snapshots_by_account_id={accounts[0].id: ["mapped-snapshot"]},
            active_snapshot_name="mapped-snapshot",
        ),
    )
    monkeypatch.setattr(
        sticky_service_module,
        "resolve_snapshot_names_for_account",
        lambda *, snapshot_index, account_id, chatgpt_account_id, email: snapshot_index.snapshots_by_account_id.get(
            account_id,
            [],
        ),
    )
    monkeypatch.setattr(
        sticky_service_module,
        "read_live_codex_process_session_counts_by_snapshot",
        lambda: {"mapped-snapshot": 1, "edixai": 3},
    )
    monkeypatch.setattr(
        sticky_service_module,
        "read_runtime_live_session_counts_by_snapshot",
        lambda: {"edixai": 2},
    )

    response = await async_client.get("/api/sticky-sessions", params={"kind": "codex_session", "activeOnly": "true"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["entries"] == []
    assert payload["unmappedCliSessions"] == [
        {
            "snapshotName": "edixai",
            "processSessionCount": 3,
            "runtimeSessionCount": 2,
            "totalSessionCount": 3,
            "reason": "No account matched this snapshot.",
        }
    ]


@pytest.mark.asyncio
async def test_sticky_sessions_api_rejects_non_stale_purge_requests(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)
    await _insert_sticky_session(
        key="prompt-cache-stale",
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=600,
    )
    await _insert_sticky_session(
        key="codex-session-old",
        account_id=accounts[1].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=600,
    )

    response = await async_client.post("/api/sticky-sessions/purge", json={"staleOnly": False})
    assert response.status_code == 422

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    payload = response.json()
    assert payload["stalePromptCacheCount"] == 1
    assert {entry["key"] for entry in payload["entries"]} == {"prompt-cache-stale", "codex-session-old"}


@pytest.mark.asyncio
async def test_sticky_sessions_api_counts_hidden_stale_rows_and_deletes_by_kind(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    for index in range(101):
        await _insert_sticky_session(
            key=f"fresh-session-{index:03d}",
            account_id=accounts[index % len(accounts)].id,
            kind=StickySessionKind.STICKY_THREAD,
            updated_at_offset_seconds=index + 1,
        )

    await _insert_sticky_session(
        key="shared-key",
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=600,
    )
    await _insert_sticky_session(
        key="shared-key",
        account_id=accounts[1].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=5,
    )

    response = await async_client.get("/api/sticky-sessions", params={"limit": "10", "offset": "0"})
    assert response.status_code == 200
    payload = response.json()

    assert payload["stalePromptCacheCount"] == 1
    assert payload["total"] == 103
    assert payload["hasMore"] is True
    assert len(payload["entries"]) == 10
    assert not any(entry["key"] == "shared-key" and entry["kind"] == "prompt_cache" for entry in payload["entries"])
    assert any(entry["key"] == "shared-key" and entry["kind"] == "codex_session" for entry in payload["entries"])

    response = await async_client.get(
        "/api/sticky-sessions", params={"staleOnly": "true", "limit": "10", "offset": "0"}
    )
    assert response.status_code == 200
    stale_payload = response.json()
    assert stale_payload["stalePromptCacheCount"] == 1
    assert stale_payload["total"] == 1
    assert stale_payload["hasMore"] is False
    assert [(entry["key"], entry["kind"]) for entry in stale_payload["entries"]] == [("shared-key", "prompt_cache")]

    response = await async_client.delete("/api/sticky-sessions/prompt_cache/shared-key")
    assert response.status_code == 200

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    after_delete = response.json()
    assert after_delete["stalePromptCacheCount"] == 0
    assert after_delete["total"] == 102
    assert any(entry["key"] == "shared-key" and entry["kind"] == "codex_session" for entry in after_delete["entries"])


@pytest.mark.asyncio
async def test_sticky_sessions_api_applies_offset_before_returning_page(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    for index in range(15):
        await _insert_sticky_session(
            key=f"page-session-{index:02d}",
            account_id=accounts[index % len(accounts)].id,
            kind=StickySessionKind.STICKY_THREAD,
            updated_at_offset_seconds=index + 1,
        )

    response = await async_client.get("/api/sticky-sessions", params={"limit": "10", "offset": "10"})
    assert response.status_code == 200
    payload = response.json()

    assert payload["total"] == 15
    assert payload["hasMore"] is False
    assert len(payload["entries"]) == 5


@pytest.mark.asyncio
async def test_sticky_sessions_api_deletes_selected_identifiers(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    await _insert_sticky_session(
        key="shared-key",
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=600,
    )
    await _insert_sticky_session(
        key="shared-key",
        account_id=accounts[1].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=5,
    )
    await _insert_sticky_session(
        key="folder/session",
        account_id=accounts[0].id,
        kind=StickySessionKind.STICKY_THREAD,
        updated_at_offset_seconds=5,
    )

    response = await async_client.post(
        "/api/sticky-sessions/delete",
        json={
            "sessions": [
                {"key": "shared-key", "kind": "prompt_cache"},
                {"key": "folder/session", "kind": "sticky_thread"},
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["deletedCount"] == 2

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    remaining = {(entry["key"], entry["kind"]) for entry in response.json()["entries"]}
    assert remaining == {("shared-key", "codex_session")}


@pytest.mark.asyncio
async def test_sticky_sessions_api_deletes_slash_containing_keys(async_client):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)
    sticky_key = "folder/session"

    await _insert_sticky_session(
        key=sticky_key,
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=10,
    )

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    assert any(entry["key"] == sticky_key for entry in response.json()["entries"])

    response = await async_client.delete(f"/api/sticky-sessions/prompt_cache/{quote(sticky_key, safe='')}")
    assert response.status_code == 200

    response = await async_client.get("/api/sticky-sessions")
    assert response.status_code == 200
    assert all(entry["key"] != sticky_key for entry in response.json()["entries"])


@pytest.mark.asyncio
async def test_sticky_sessions_cleanup_scheduler_removes_only_stale_prompt_cache(db_setup):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)
    await _insert_sticky_session(
        key="cleanup-stale",
        account_id=accounts[0].id,
        kind=StickySessionKind.PROMPT_CACHE,
        updated_at_offset_seconds=600,
    )
    await _insert_sticky_session(
        key="cleanup-durable",
        account_id=accounts[1].id,
        kind=StickySessionKind.STICKY_THREAD,
        updated_at_offset_seconds=600,
    )

    scheduler = StickySessionCleanupScheduler(interval_seconds=300, enabled=True)
    await scheduler._cleanup_once()

    async with SessionLocal() as session:
        remaining = {
            row[0] for row in (await session.execute(text("SELECT key FROM sticky_sessions ORDER BY key"))).fetchall()
        }

    assert remaining == {"cleanup-durable"}


@pytest.mark.asyncio
async def test_sticky_sessions_api_returns_codex_session_events(async_client, monkeypatch, tmp_path):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24268"
    session_key = f"{session_id}::auth:scope"
    await _insert_sticky_session(
        key=session_key,
        account_id=accounts[0].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=20,
        task_preview="Collect session logs",
    )

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    rollout_path = day_dir / f"rollout-{now.strftime('%Y-%m-%dT%H-%M-%S')}-{session_id}.jsonl"
    _write_rollout_with_user_task(
        rollout_path,
        timestamp=now - timedelta(seconds=20),
        task="Collect per-session watch logs",
    )
    _append_rollout_payload(
        rollout_path,
        timestamp=now - timedelta(seconds=18),
        payload={
            "timestamp": (now - timedelta(seconds=18)).isoformat().replace("+00:00", "Z"),
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "content": [
                    {
                        "type": "output_text",
                        "text": "Loaded session logs and summarized active quotas.",
                    }
                ],
            },
        },
    )
    _append_rollout_payload(
        rollout_path,
        timestamp=now - timedelta(seconds=16),
        payload={
            "timestamp": (now - timedelta(seconds=16)).isoformat().replace("+00:00", "Z"),
            "type": "response.completed",
            "response": {"id": "resp_1"},
        },
    )

    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    response = await async_client.get(
        "/api/sticky-sessions/session-events",
        params={
            "accountId": accounts[0].id,
            "sessionKey": session_key,
            "limit": "20",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["sessionKey"] == session_key
    assert payload["resolvedSessionId"] == session_id
    assert payload["sourceFile"] is not None
    events = payload["events"]
    assert len(events) == 3
    assert events[0]["kind"] == "prompt"
    assert events[0]["text"] == "Collect per-session watch logs"
    assert events[1]["kind"] == "answer"
    assert events[1]["text"] == "Loaded session logs and summarized active quotas."
    assert events[2]["kind"] == "status"


@pytest.mark.asyncio
async def test_sticky_sessions_api_session_events_404_for_wrong_account(async_client, monkeypatch, tmp_path):
    accounts = await _create_accounts()
    await _set_affinity_ttl(60)

    now = datetime.now(timezone.utc).replace(microsecond=0)
    session_id = "019d5a6a-4665-7873-9714-9efb95b24268"
    session_key = f"{session_id}::auth:scope"
    await _insert_sticky_session(
        key=session_key,
        account_id=accounts[0].id,
        kind=StickySessionKind.CODEX_SESSION,
        updated_at_offset_seconds=20,
    )

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    rollout_path = day_dir / f"rollout-{now.strftime('%Y-%m-%dT%H-%M-%S')}-{session_id}.jsonl"
    _write_rollout_with_user_task(
        rollout_path,
        timestamp=now - timedelta(seconds=20),
        task="Collect per-session watch logs",
    )

    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    response = await async_client.get(
        "/api/sticky-sessions/session-events",
        params={
            "accountId": accounts[1].id,
            "sessionKey": session_key,
            "limit": "20",
        },
    )
    assert response.status_code == 404
