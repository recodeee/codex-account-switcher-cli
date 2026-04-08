from __future__ import annotations

import hashlib
import json
import os
from datetime import timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

from pydantic import ValidationError

from app.core.exceptions import DashboardBadRequestError, DashboardConflictError, DashboardNotFoundError
from app.core.utils.time import to_utc_naive, utcnow
from app.modules.handoffs.schemas import (
    RuntimeHandoffCheckpoint,
    RuntimeHandoffCreateRequest,
    RuntimeHandoffEntry,
    RuntimeHandoffResumeRequest,
    RuntimeHandoffStatus,
)
from app.tools.codex_auth_multi_runtime import build_runtime_paths, resolve_accounts_dir

_DEFAULT_HANDOFF_TTL_HOURS = 72
_MAX_LIST_LIMIT = 200


class RuntimeHandoffService:
    def __init__(
        self,
        *,
        handoffs_dir: Path | None = None,
    ) -> None:
        self._handoffs_dir = (handoffs_dir or _resolve_handoffs_dir()).resolve()

    def list_handoffs(
        self,
        *,
        status: RuntimeHandoffStatus | None = None,
        source_snapshot: str | None = None,
        limit: int = 100,
    ) -> list[RuntimeHandoffEntry]:
        normalized_limit = max(1, min(limit, _MAX_LIST_LIMIT))
        entries = [self._normalize_entry_status(entry) for entry in self._load_all_entries()]
        if status is not None:
            entries = [entry for entry in entries if entry.status == status]
        if source_snapshot:
            snapshot = source_snapshot.strip().lower()
            entries = [entry for entry in entries if entry.source_snapshot.strip().lower() == snapshot]
        entries.sort(key=lambda entry: entry.created_at, reverse=True)
        return entries[:normalized_limit]

    def create_handoff(self, payload: RuntimeHandoffCreateRequest) -> RuntimeHandoffEntry:
        source_snapshot = payload.source_snapshot.strip()
        self._ensure_snapshot_exists(snapshot_name=source_snapshot)

        now = utcnow()
        ttl_hours = payload.ttl_hours if payload.ttl_hours is not None else _resolve_handoff_ttl_hours()
        expires_at = to_utc_naive(now + timedelta(hours=ttl_hours))
        checkpoint = payload.checkpoint
        checksum = _checkpoint_checksum(checkpoint)

        entry = RuntimeHandoffEntry(
            id=str(uuid4()),
            schema_version=1,
            status=RuntimeHandoffStatus.READY,
            source_runtime=payload.source_runtime.strip(),
            source_snapshot=source_snapshot,
            source_session_id=payload.source_session_id,
            expected_target_snapshot=payload.expected_target_snapshot,
            target_runtime=None,
            target_snapshot=None,
            created_at=to_utc_naive(now),
            expires_at=expires_at,
            resumed_at=None,
            aborted_at=None,
            resume_count=0,
            checksum=checksum,
            checkpoint=checkpoint,
        )
        self._write_entry(entry)
        return entry

    def abort_handoff(self, handoff_id: str) -> RuntimeHandoffEntry:
        entry = self._get_entry(handoff_id)
        if entry.status in (RuntimeHandoffStatus.RESUMED, RuntimeHandoffStatus.ABORTED):
            return entry

        updated = entry.model_copy(
            update={
                "status": RuntimeHandoffStatus.ABORTED,
                "aborted_at": to_utc_naive(utcnow()),
            }
        )
        self._write_entry(updated)
        return updated

    def resume_handoff(
        self,
        handoff_id: str,
        payload: RuntimeHandoffResumeRequest,
    ) -> tuple[RuntimeHandoffEntry, str]:
        entry = self._normalize_entry_status(self._get_entry(handoff_id))
        if entry.status != RuntimeHandoffStatus.READY:
            raise DashboardConflictError("Handoff is not resumable.", code="runtime_handoff_not_resumable")

        expected = (entry.expected_target_snapshot or "").strip()
        actual = payload.target_snapshot.strip()
        if expected and expected != actual and not payload.override_mismatch:
            raise DashboardBadRequestError(
                "Target snapshot does not match expected handoff snapshot.",
                code="runtime_handoff_snapshot_mismatch",
            )

        self._ensure_snapshot_exists(snapshot_name=actual)
        build_runtime_paths(payload.target_runtime.strip())

        updated = entry.model_copy(
            update={
                "status": RuntimeHandoffStatus.RESUMED,
                "target_runtime": payload.target_runtime.strip(),
                "target_snapshot": actual,
                "resumed_at": to_utc_naive(utcnow()),
                "resume_count": entry.resume_count + 1,
            }
        )
        self._write_entry(updated)
        return updated, _build_resume_prompt(updated)

    def _normalize_entry_status(self, entry: RuntimeHandoffEntry) -> RuntimeHandoffEntry:
        if entry.status != RuntimeHandoffStatus.READY:
            return entry
        if to_utc_naive(utcnow()) <= to_utc_naive(entry.expires_at):
            return entry
        updated = entry.model_copy(update={"status": RuntimeHandoffStatus.EXPIRED})
        self._write_entry(updated)
        return updated

    def _load_all_entries(self) -> list[RuntimeHandoffEntry]:
        if not self._handoffs_dir.exists():
            return []
        entries: list[RuntimeHandoffEntry] = []
        for path in sorted(self._handoffs_dir.glob("*.json"), key=_safe_mtime, reverse=True):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                entries.append(RuntimeHandoffEntry.model_validate(payload))
            except (OSError, json.JSONDecodeError, ValidationError):
                continue
        return entries

    def _get_entry(self, handoff_id: str) -> RuntimeHandoffEntry:
        path = self._path_for_id(handoff_id)
        if not path.exists() or not path.is_file():
            raise DashboardNotFoundError("Runtime handoff not found.", code="runtime_handoff_not_found")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise DashboardBadRequestError(
                "Runtime handoff payload is unreadable.",
                code="runtime_handoff_unreadable",
            ) from exc
        try:
            return RuntimeHandoffEntry.model_validate(payload)
        except ValidationError as exc:
            raise DashboardBadRequestError(
                "Runtime handoff payload is invalid.",
                code="runtime_handoff_invalid_payload",
            ) from exc

    def _write_entry(self, entry: RuntimeHandoffEntry) -> None:
        self._handoffs_dir.mkdir(parents=True, exist_ok=True)
        path = self._path_for_id(entry.id)
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(entry.model_dump(mode="json", by_alias=True), indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        tmp_path.replace(path)

    def _path_for_id(self, handoff_id: str) -> Path:
        return self._handoffs_dir / f"{handoff_id}.json"

    def _ensure_snapshot_exists(self, *, snapshot_name: str) -> None:
        normalized = snapshot_name.strip().replace(".json", "")
        if not normalized:
            raise DashboardBadRequestError(
                "Snapshot name is required.",
                code="runtime_handoff_snapshot_required",
            )
        accounts_dir = resolve_accounts_dir(None)
        snapshot_path = accounts_dir / f"{normalized}.json"
        if snapshot_path.exists() and snapshot_path.is_file():
            return
        raise DashboardBadRequestError(
            f"Snapshot {normalized!r} was not found in {accounts_dir}.",
            code="runtime_handoff_snapshot_missing",
        )


def _resolve_handoffs_dir() -> Path:
    raw = os.environ.get("CODEX_HANDOFFS_DIR")
    if raw and raw.strip():
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".codex" / "handoffs").resolve()


def _resolve_handoff_ttl_hours() -> int:
    raw = os.environ.get("CODEX_HANDOFF_TTL_HOURS")
    if not raw:
        return _DEFAULT_HANDOFF_TTL_HOURS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_HANDOFF_TTL_HOURS
    if value <= 0:
        return _DEFAULT_HANDOFF_TTL_HOURS
    return min(value, 24 * 14)


def _checkpoint_checksum(checkpoint: RuntimeHandoffCheckpoint) -> str:
    payload: dict[str, Any] = checkpoint.model_dump(mode="json", by_alias=True)
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _build_resume_prompt(entry: RuntimeHandoffEntry) -> str:
    checkpoint = entry.checkpoint
    lines = [
        "Continue this previously handed-off task.",
        f"Handoff id: {entry.id}",
        f"Source runtime/snapshot: {entry.source_runtime} / {entry.source_snapshot}",
        f"Created at: {entry.created_at.isoformat()}Z",
        "",
        f"Goal: {checkpoint.goal}",
    ]
    if checkpoint.done:
        lines.append("Done:")
        lines.extend(f"- {item}" for item in checkpoint.done)
    if checkpoint.next:
        lines.append("Next:")
        lines.extend(f"- {item}" for item in checkpoint.next)
    if checkpoint.blockers:
        lines.append("Blockers:")
        lines.extend(f"- {item}" for item in checkpoint.blockers)
    if checkpoint.files_touched:
        lines.append("Files touched:")
        lines.extend(f"- {item}" for item in checkpoint.files_touched)
    if checkpoint.commands_run:
        lines.append("Commands run:")
        lines.extend(f"- {item}" for item in checkpoint.commands_run)
    if checkpoint.evidence_refs:
        lines.append("Evidence refs:")
        lines.extend(f"- {item}" for item in checkpoint.evidence_refs)
    lines.extend(
        [
            "",
            "Treat this handoff artifact as source-of-truth; verify current repo state before applying further edits.",
        ]
    )
    return "\n".join(lines)


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0

