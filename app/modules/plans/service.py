from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

CHECKPOINT_RE = re.compile(r"^- \[( |x)\] \[([A-Za-z0-9._-]+)\] ([A-Z_]+) - (.*)$")
STATUS_RE = re.compile(r"^\s*-\s*\*\*Status:\*\*\s*(.+?)\s*$", flags=re.IGNORECASE | re.MULTILINE)
TITLE_RE = re.compile(r"^#\s+Plan Summary:\s*(.+?)\s*$", flags=re.IGNORECASE | re.MULTILINE)
CHECKPOINT_LOG_RE = re.compile(
    r"^- (?P<timestamp>[^|]+?) \| role=(?P<role>[A-Za-z0-9._-]+) \| id=(?P<checkpoint_id>[A-Za-z0-9._-]+) \| state=(?P<state>[A-Z_]+) \| (?P<message>.*)$"
)
MARKDOWN_HEADING_RE = re.compile(r"^#{1,6}\s+(.+?)\s*$")
FENCE_RE = re.compile(r"^\s*```[\w-]*\s*$")
ROLE_ORDER = ("planner", "architect", "critic", "executor", "writer", "verifier", "designer")
DONE_CHECKPOINT_STATES = {"DONE", "COMPLETED"}
PLAN_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
MAX_RUNTIME_EVENTS = 200
MAX_CORRELATION_WINDOW_SECONDS = 60 * 60 * 24 * 2
PROMPT_BUNDLE_FILENAMES = ("kickoff-prompts.md", "coordinator-prompt.md")


class OpenSpecPlansError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class PlanRoleProgressData:
    role: str
    total_checkpoints: int
    done_checkpoints: int


@dataclass(frozen=True, slots=True)
class PlanOverallProgressData:
    total_checkpoints: int
    done_checkpoints: int
    percent_complete: int


@dataclass(frozen=True, slots=True)
class PlanCheckpointData:
    timestamp: str
    role: str
    checkpoint_id: str
    state: str
    message: str


@dataclass(frozen=True, slots=True)
class PlanSummaryData:
    slug: str
    title: str
    status: str
    created_at: datetime
    updated_at: datetime
    summary_markdown: str
    roles: list[PlanRoleProgressData]
    overall_progress: PlanOverallProgressData
    current_checkpoint: PlanCheckpointData | None


@dataclass(frozen=True, slots=True)
class PlanRoleDetailData:
    role: str
    total_checkpoints: int
    done_checkpoints: int
    tasks_markdown: str
    checkpoints_markdown: str | None


@dataclass(frozen=True, slots=True)
class PlanDetailData:
    slug: str
    title: str
    status: str
    created_at: datetime
    updated_at: datetime
    summary_markdown: str
    checkpoints_markdown: str
    roles: list[PlanRoleDetailData]
    overall_progress: PlanOverallProgressData
    current_checkpoint: PlanCheckpointData | None
    prompt_bundles: list["PlanPromptBundleData"]


@dataclass(frozen=True, slots=True)
class PlanPromptItemData:
    id: str
    title: str
    content: str
    source_path: str


@dataclass(frozen=True, slots=True)
class PlanPromptBundleData:
    id: str
    title: str
    source_path: str
    prompts: list[PlanPromptItemData]


@dataclass(frozen=True, slots=True)
class PlanRuntimeAgentData:
    name: str
    role: str | None
    model: str | None
    status: str | None
    started_at: str | None
    updated_at: str | None
    source: str
    authoritative: bool


@dataclass(frozen=True, slots=True)
class PlanRuntimeEventData:
    ts: str
    kind: str
    message: str
    agent_name: str | None
    role: str | None
    model: str | None
    status: str | None
    source: str
    authoritative: bool


@dataclass(frozen=True, slots=True)
class PlanRuntimeErrorData:
    timestamp: str
    code: str | None
    message: str
    source: str | None
    recoverable: bool | None


@dataclass(frozen=True, slots=True)
class PlanRuntimeData:
    available: bool
    session_id: str | None
    correlation_confidence: str | None
    mode: str | None
    phase: str | None
    active: bool
    updated_at: datetime | None
    agents: list[PlanRuntimeAgentData]
    events: list[PlanRuntimeEventData]
    last_checkpoint: PlanCheckpointData | None
    last_error: PlanRuntimeErrorData | None
    can_resume: bool
    partial: bool
    stale_after_seconds: int | None
    reasons: list[str]
    unavailable_reason: str | None


@dataclass(frozen=True, slots=True)
class PlanTeamRunData:
    slug: str
    worker_count: int
    command: str
    pid: int
    launched_at: datetime
    plan_path: str
    planner_plan_path: str
    log_path: str


class OpenSpecPlansService:
    def __init__(
        self,
        plans_root: Path | None = None,
        omx_root: Path | None = None,
    ) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        if plans_root is not None:
            resolved_plans_root = plans_root.resolve()
            if resolved_plans_root.name == "plan" and resolved_plans_root.parent.name == "openspec":
                repo_root = resolved_plans_root.parent.parent
            else:
                repo_root = resolved_plans_root.parent
        self._repo_root = repo_root.resolve()
        self._plans_root = plans_root or (repo_root / "openspec" / "plan")
        self._omx_root = (omx_root or (repo_root / ".omx")).resolve()

    def list_plans(self) -> list[PlanSummaryData]:
        if not self._plans_root.exists():
            return []

        entries: list[PlanSummaryData] = []
        for plan_dir in sorted(self._plans_root.iterdir(), key=lambda item: item.name.lower()):
            if not plan_dir.is_dir():
                continue
            if plan_dir.name.startswith("."):
                continue
            summary_path = plan_dir / "summary.md"
            if not summary_path.exists():
                continue
            entries.append(self._read_plan_summary(plan_dir, summary_path))

        entries.sort(
            key=lambda entry: (entry.created_at, entry.updated_at, entry.slug.lower()),
            reverse=True,
        )
        return entries

    def get_plan(self, slug: str) -> PlanDetailData | None:
        plan_dir = self._resolve_plan_dir(slug)
        if plan_dir is None:
            return None
        if not plan_dir.exists() or not plan_dir.is_dir():
            return None

        summary_path = plan_dir / "summary.md"
        if not summary_path.exists():
            return None

        summary_markdown = self._read_markdown(summary_path)
        checkpoints_path = plan_dir / "checkpoints.md"
        checkpoints_markdown = (
            self._read_markdown(checkpoints_path)
            if checkpoints_path.exists()
            else ""
        )
        created_at = self._first_created(plan_dir)
        updated_at = self._last_updated(plan_dir)
        status = _extract_status(summary_markdown)
        title = _extract_title(summary_markdown, slug)

        roles: list[PlanRoleDetailData] = []
        for role in ROLE_ORDER:
            role_dir = plan_dir / role
            tasks_path = role_dir / "tasks.md"
            tasks_markdown = self._read_markdown(tasks_path) if tasks_path.exists() else ""
            total, done = _checkpoint_counts(tasks_markdown) if tasks_markdown else (0, 0)
            role_checkpoints_path = role_dir / "checkpoints.md"
            role_checkpoints = (
                self._read_markdown(role_checkpoints_path)
                if role_checkpoints_path.exists()
                else None
            )
            roles.append(
                PlanRoleDetailData(
                    role=role,
                    total_checkpoints=total,
                    done_checkpoints=done,
                    tasks_markdown=tasks_markdown,
                    checkpoints_markdown=role_checkpoints,
                )
            )

        return PlanDetailData(
            slug=slug,
            title=title,
            status=status,
            created_at=created_at,
            updated_at=updated_at,
            summary_markdown=summary_markdown,
            checkpoints_markdown=checkpoints_markdown,
            roles=roles,
            overall_progress=_overall_progress(
                [
                    PlanRoleProgressData(
                        role=role.role,
                        total_checkpoints=role.total_checkpoints,
                        done_checkpoints=role.done_checkpoints,
                    )
                    for role in roles
                ]
            ),
            current_checkpoint=_resolve_current_checkpoint(checkpoints_markdown),
            prompt_bundles=self._read_plan_prompt_bundles(plan_dir),
        )

    def get_plan_runtime(self, slug: str) -> PlanRuntimeData | None:
        plan_dir = self._resolve_plan_dir(slug)
        if plan_dir is None or not plan_dir.exists() or not plan_dir.is_dir():
            return None

        summary_path = plan_dir / "summary.md"
        if not summary_path.exists():
            return None

        correlation = self._resolve_runtime_session(plan_dir)
        if correlation is None:
            return PlanRuntimeData(
                available=False,
                session_id=None,
                correlation_confidence=None,
                mode=None,
                phase=None,
                active=False,
                updated_at=None,
                agents=[],
                events=[],
                last_checkpoint=None,
                last_error=None,
                can_resume=False,
                partial=False,
                stale_after_seconds=30,
                reasons=["correlation_unresolved"],
                unavailable_reason="correlation_unresolved",
            )

        session_id = correlation["session_id"]
        reasons: list[str] = list(correlation["reasons"])
        partial = bool(correlation["partial"])
        confidence = correlation["confidence"]
        session_state_path = self._omx_root / "state" / "sessions" / session_id / "ralplan-state.json"
        session_state_payload = _read_json_file(session_state_path)
        mode: str | None = None
        phase: str | None = None
        active = False
        updated_at: datetime | None = None

        if session_state_payload is None:
            reasons.append("runtime_state_missing")
            partial = True
        elif not isinstance(session_state_payload, dict):
            reasons.append("runtime_state_invalid")
            partial = True
        else:
            mode = _as_clean_string(session_state_payload.get("mode"))
            phase = _as_clean_string(session_state_payload.get("current_phase"))
            active = bool(session_state_payload.get("active", False))
            updated_at = _parse_datetime(_as_clean_string(session_state_payload.get("updated_at")))

        resume_state_path = self._omx_root / "state" / "sessions" / session_id / "ralplan-resume-state.json"
        resume_payload = _read_json_file(resume_state_path)
        last_checkpoint = _extract_last_checkpoint(resume_payload)
        last_error = _extract_last_error(resume_payload)
        can_resume = bool(_get_dict_value(resume_payload, "resumable", "canResume"))

        lifecycle_events = self._read_lifecycle_events(session_id)
        event_feed_path = self._omx_root / "state" / "sessions" / session_id / "ralplan-agent-events.jsonl"
        agent_events = self._read_agent_events(event_feed_path, session_id)
        authoritative_agent_events = [event for event in agent_events if event.authoritative]
        authoritative_agent_events_present = event_feed_path.exists() and bool(authoritative_agent_events)
        if not event_feed_path.exists():
            reasons.append("agent_events_missing")
            partial = True
        elif not authoritative_agent_events_present:
            reasons.append("agent_events_invalid")
            partial = True

        events = _dedupe_events([*authoritative_agent_events, *lifecycle_events])
        available = authoritative_agent_events_present
        unavailable_reason = None if available else "runtime_data_unavailable"
        if not available and "agent_events_missing" in reasons:
            unavailable_reason = "agent_events_missing"
        elif not available and "agent_events_invalid" in reasons:
            unavailable_reason = "agent_events_invalid"

        return PlanRuntimeData(
            available=available,
            session_id=session_id,
            correlation_confidence=confidence,
            mode=mode,
            phase=phase,
            active=active,
            updated_at=updated_at,
            agents=_derive_agents_from_events(authoritative_agent_events),
            events=events,
            last_checkpoint=last_checkpoint,
            last_error=last_error,
            can_resume=can_resume,
            partial=partial,
            stale_after_seconds=5 if active else 30,
            reasons=_unique_strings(reasons),
            unavailable_reason=unavailable_reason,
        )

    def run_plan_team(self, slug: str) -> PlanTeamRunData | None:
        plan_dir = self._resolve_plan_dir(slug)
        if plan_dir is None or not plan_dir.exists() or not plan_dir.is_dir():
            return None

        summary_path = plan_dir / "summary.md"
        if not summary_path.exists():
            return None

        planner_plan_path = plan_dir / "planner" / "plan.md"
        if not planner_plan_path.exists():
            raise OpenSpecPlansError(
                f"Planner plan file is required to launch team execution: {planner_plan_path}",
            )

        if shutil.which("omx") is None:
            raise OpenSpecPlansError("omx CLI is not available in PATH")

        detail = self.get_plan(slug)
        if detail is None:
            return None

        remaining_roles = [role for role in detail.roles if role.done_checkpoints < role.total_checkpoints]
        worker_count = max(3, min(6, len(remaining_roles) or 1))

        plan_path_display = self._display_path(plan_dir)
        planner_plan_path_display = self._display_path(planner_plan_path)
        task = (
            f"Execute OpenSpec plan {slug} from {plan_path_display} with {planner_plan_path_display} "
            "as the source of truth. Keep checkpoints updated and run final verification before shutdown."
        )
        command_argv = ["omx", "team", f"{worker_count}:executor", task]
        launched_at = datetime.now(tz=UTC)
        logs_dir = self._omx_root / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        launch_stamp = launched_at.strftime("%Y%m%dT%H%M%SZ")
        log_path = logs_dir / f"plans-run-team-{slug}-{launch_stamp}.log"

        try:
            with log_path.open("ab") as log_stream:
                process = subprocess.Popen(
                    command_argv,
                    cwd=str(self._repo_root),
                    env=os.environ.copy(),
                    stdin=subprocess.DEVNULL,
                    stdout=log_stream,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                    close_fds=True,
                )
        except OSError as exc:
            raise OpenSpecPlansError(f"Unable to start omx team for plan '{slug}'") from exc

        return PlanTeamRunData(
            slug=slug,
            worker_count=worker_count,
            command=shlex.join(command_argv),
            pid=process.pid,
            launched_at=launched_at,
            plan_path=plan_path_display,
            planner_plan_path=planner_plan_path_display,
            log_path=self._display_path(log_path),
        )

    def _resolve_runtime_session(self, plan_dir: Path) -> dict[str, Any] | None:
        plan_slug = plan_dir.name
        plan_updated_at = self._last_updated(plan_dir)

        explicit_mapping = _read_json_file(plan_dir / ".omx-session.json")
        explicit_session_id = _as_clean_string(_get_dict_value(explicit_mapping, "sessionId", "session_id"))
        if explicit_session_id:
            return {
                "session_id": explicit_session_id,
                "confidence": "high",
                "partial": False,
                "reasons": ["plan_session_mapping"],
            }

        sessions_dir = self._omx_root / "state" / "sessions"
        if not sessions_dir.exists() or not sessions_dir.is_dir():
            return None

        candidates: list[dict[str, Any]] = []
        for session_dir in sessions_dir.iterdir():
            if not session_dir.is_dir():
                continue
            state_payload = _read_json_file(session_dir / "ralplan-state.json")
            if not isinstance(state_payload, dict):
                continue
            if _references_plan_slug(state_payload, plan_slug) and bool(state_payload.get("active", False)):
                candidates.append(
                    {
                        "session_id": session_dir.name,
                        "priority": 30,
                        "updated_at": _coalesce_updated_at(
                            _as_clean_string(state_payload.get("updated_at")),
                            session_dir / "ralplan-state.json",
                        ),
                        "reason": "active_ralplan_state",
                    }
                )

            resume_payload = _read_json_file(session_dir / "ralplan-resume-state.json")
            if (
                isinstance(resume_payload, dict)
                and _as_clean_string(_get_dict_value(resume_payload, "planSlug", "plan_slug")) == plan_slug
                and _get_dict_value(resume_payload, "lastCheckpoint", "last_checkpoint") is not None
            ):
                candidates.append(
                    {
                        "session_id": session_dir.name,
                        "priority": 20,
                        "updated_at": _coalesce_updated_at(
                            _as_clean_string(_get_dict_value(resume_payload, "updatedAt", "updated_at")),
                            session_dir / "ralplan-resume-state.json",
                        ),
                        "reason": "resume_state_match",
                    }
                )

            state_updated = _coalesce_updated_at(
                _as_clean_string(state_payload.get("updated_at")),
                session_dir / "ralplan-state.json",
            )
            is_ralplan = _as_clean_string(state_payload.get("mode")) == "ralplan"
            if not is_ralplan:
                continue
            if bool(state_payload.get("active", False)):
                continue
            if abs((state_updated - plan_updated_at).total_seconds()) > MAX_CORRELATION_WINDOW_SECONDS:
                continue
            candidates.append(
                {
                    "session_id": session_dir.name,
                    "priority": 10,
                    "updated_at": state_updated,
                    "reason": "recent_completed_ralplan",
                }
            )

        if not candidates:
            return None

        candidates.sort(key=lambda item: (item["priority"], item["updated_at"]), reverse=True)
        best = candidates[0]
        ties = [
            candidate
            for candidate in candidates
            if candidate["priority"] == best["priority"] and candidate["updated_at"] == best["updated_at"]
        ]
        is_tied = len(ties) > 1
        return {
            "session_id": best["session_id"],
            "confidence": "low" if is_tied else "medium",
            "partial": is_tied,
            "reasons": [best["reason"], *(["correlation_tie"] if is_tied else [])],
        }

    def _read_lifecycle_events(self, session_id: str) -> list[PlanRuntimeEventData]:
        logs_dir = self._omx_root / "logs"
        if not logs_dir.exists() or not logs_dir.is_dir():
            return []
        events: list[PlanRuntimeEventData] = []
        for path in sorted(logs_dir.glob("omx-*.jsonl"), key=_safe_path_mtime, reverse=True):
            for payload in _iter_jsonl(path):
                if not isinstance(payload, dict):
                    continue
                if _as_clean_string(payload.get("session_id")) != session_id:
                    continue
                kind = _as_clean_string(payload.get("event"))
                ts = _as_clean_string(payload.get("timestamp") or payload.get("_ts"))
                if not kind or not ts:
                    continue
                if kind not in {"session_start", "session_end"}:
                    continue
                events.append(
                    PlanRuntimeEventData(
                        ts=ts,
                        kind=kind,
                        message="Session started" if kind == "session_start" else "Session ended",
                        agent_name=None,
                        role=None,
                        model=None,
                        status="active" if kind == "session_start" else "completed",
                        source=path.name,
                        authoritative=False,
                    )
                )
        return events[:MAX_RUNTIME_EVENTS]

    def _display_path(self, path: Path) -> str:
        try:
            return str(path.resolve().relative_to(self._repo_root))
        except ValueError:
            return str(path.resolve())

    def _read_agent_events(self, path: Path, session_id: str) -> list[PlanRuntimeEventData]:
        if not path.exists() or not path.is_file():
            return []
        events: list[PlanRuntimeEventData] = []
        for payload in _iter_jsonl(path):
            if not isinstance(payload, dict):
                continue
            required_keys = (
                "ts",
                "eventType",
                "sessionId",
                "source",
                "authoritative",
                "agentName",
                "role",
                "model",
                "status",
                "message",
            )
            if any(key not in payload for key in required_keys):
                continue
            payload_session_id = _as_clean_string(_get_dict_value(payload, "sessionId", "session_id"))
            if payload_session_id != session_id:
                continue
            ts = _as_clean_string(payload.get("ts"))
            kind = _as_clean_string(_get_dict_value(payload, "eventType", "kind"))
            if not ts or not kind:
                continue
            source = _as_clean_string(payload.get("source")) or path.name
            message = _as_clean_string(payload.get("message")) or kind.replace("_", " ")
            authoritative = payload.get("authoritative")
            if not isinstance(authoritative, bool):
                continue
            events.append(
                PlanRuntimeEventData(
                    ts=ts,
                    kind=kind,
                    message=message,
                    agent_name=_as_clean_string(_get_dict_value(payload, "agentName", "agent_name")),
                    role=_as_clean_string(payload.get("role")),
                    model=_as_clean_string(payload.get("model")),
                    status=_as_clean_string(payload.get("status")),
                    source=source,
                    authoritative=authoritative,
                )
            )
        events.sort(key=lambda item: _parse_datetime(item.ts) or datetime.min.replace(tzinfo=UTC), reverse=True)
        return events[:MAX_RUNTIME_EVENTS]

    def _resolve_plan_dir(self, slug: str) -> Path | None:
        if not PLAN_SLUG_RE.fullmatch(slug):
            return None
        if ".." in slug:
            return None

        try:
            plan_dir = (self._plans_root / slug).resolve()
            plan_dir.relative_to(self._plans_root.resolve())
        except ValueError:
            return None

        return plan_dir

    def _read_plan_summary(self, plan_dir: Path, summary_path: Path) -> PlanSummaryData:
        summary_markdown = self._read_markdown(summary_path)
        roles: list[PlanRoleProgressData] = []

        for role in ROLE_ORDER:
            tasks_path = plan_dir / role / "tasks.md"
            tasks_markdown = self._read_markdown(tasks_path) if tasks_path.exists() else ""
            total, done = _checkpoint_counts(tasks_markdown) if tasks_markdown else (0, 0)
            roles.append(
                PlanRoleProgressData(
                    role=role,
                    total_checkpoints=total,
                    done_checkpoints=done,
                )
            )

        checkpoints_path = plan_dir / "checkpoints.md"
        checkpoints_markdown = self._read_markdown(checkpoints_path) if checkpoints_path.exists() else ""

        return PlanSummaryData(
            slug=plan_dir.name,
            title=_extract_title(summary_markdown, plan_dir.name),
            status=_extract_status(summary_markdown),
            created_at=self._first_created(plan_dir),
            updated_at=self._last_updated(plan_dir),
            summary_markdown=summary_markdown,
            roles=roles,
            overall_progress=_overall_progress(roles),
            current_checkpoint=_resolve_current_checkpoint(checkpoints_markdown),
        )

    @staticmethod
    def _read_markdown(path: Path) -> str:
        try:
            return path.read_text(encoding="utf-8")
        except OSError as exc:
            raise OpenSpecPlansError(f"Failed to read {path}") from exc

    def _read_plan_prompt_bundles(self, plan_dir: Path) -> list[PlanPromptBundleData]:
        bundles: list[PlanPromptBundleData] = []
        for filename in PROMPT_BUNDLE_FILENAMES:
            bundle_path = plan_dir / filename
            if not bundle_path.exists() or not bundle_path.is_file():
                continue
            markdown = self._read_markdown(bundle_path)
            prompts = _parse_prompt_items_from_markdown(markdown, source_path=filename)
            if not prompts:
                continue
            bundle_title = _extract_first_heading(markdown) or _humanize_slug(bundle_path.stem)
            bundles.append(
                PlanPromptBundleData(
                    id=bundle_path.stem.lower(),
                    title=bundle_title,
                    source_path=filename,
                    prompts=prompts,
                )
            )
        return bundles

    @staticmethod
    def _last_updated(path: Path) -> datetime:
        _, newest = OpenSpecPlansService._mtime_bounds(path)
        return datetime.fromtimestamp(newest, tz=UTC)

    @staticmethod
    def _first_created(path: Path) -> datetime:
        oldest, _ = OpenSpecPlansService._mtime_bounds(path)
        return datetime.fromtimestamp(oldest, tz=UTC)

    @staticmethod
    def _mtime_bounds(path: Path) -> tuple[float, float]:
        base_mtime = _safe_path_mtime(path)
        oldest = base_mtime
        newest = base_mtime
        for candidate in path.rglob("*"):
            if not candidate.is_file():
                continue
            mtime = _safe_path_mtime(candidate)
            oldest = min(oldest, mtime)
            newest = max(newest, mtime)
        return oldest, newest


def _extract_status(summary_markdown: str) -> str:
    match = STATUS_RE.search(summary_markdown)
    if not match:
        return "unknown"
    return match.group(1).strip().lower().replace(" ", "-")


def _extract_title(summary_markdown: str, fallback_slug: str) -> str:
    match = TITLE_RE.search(summary_markdown)
    if not match:
        return fallback_slug
    return match.group(1).strip() or fallback_slug


def _checkpoint_counts(tasks_markdown: str) -> tuple[int, int]:
    total = 0
    done = 0
    for line in tasks_markdown.splitlines():
        checkpoint = CHECKPOINT_RE.match(line)
        if checkpoint is None:
            continue
        total += 1
        if checkpoint.group(1) == "x":
            done += 1
    return total, done


def _overall_progress(roles: list[PlanRoleProgressData]) -> PlanOverallProgressData:
    total_checkpoints = sum(role.total_checkpoints for role in roles)
    done_checkpoints = sum(role.done_checkpoints for role in roles)
    percent_complete = int(round((done_checkpoints / total_checkpoints) * 100)) if total_checkpoints else 0
    return PlanOverallProgressData(
        total_checkpoints=total_checkpoints,
        done_checkpoints=done_checkpoints,
        percent_complete=percent_complete,
    )


def _resolve_current_checkpoint(checkpoints_markdown: str) -> PlanCheckpointData | None:
    checkpoints: list[PlanCheckpointData] = []
    for line in checkpoints_markdown.splitlines():
        match = CHECKPOINT_LOG_RE.match(line)
        if match is None:
            continue
        checkpoints.append(
            PlanCheckpointData(
                timestamp=match.group("timestamp").strip(),
                role=match.group("role").strip().lower(),
                checkpoint_id=match.group("checkpoint_id").strip(),
                state=match.group("state").strip().upper(),
                message=match.group("message").strip(),
            )
        )

    if not checkpoints:
        return None

    in_progress = [entry for entry in checkpoints if entry.state not in DONE_CHECKPOINT_STATES]
    if in_progress:
        return in_progress[-1]

    return checkpoints[-1]


def _read_json_file(path: Path) -> Any | None:
    if not path.exists() or not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _iter_jsonl(path: Path) -> list[Any]:
    try:
        lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    except OSError:
        return []
    payloads: list[Any] = []
    for line in lines:
        normalized = line.strip()
        if not normalized:
            continue
        try:
            payloads.append(json.loads(normalized))
        except json.JSONDecodeError:
            continue
    return payloads


def _as_clean_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _parse_datetime(value: str | None) -> datetime | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).astimezone(UTC)
    except ValueError:
        return None


def _coalesce_updated_at(raw: str | None, path: Path) -> datetime:
    parsed = _parse_datetime(raw)
    if parsed is not None:
        return parsed
    return datetime.fromtimestamp(_safe_path_mtime(path), tz=UTC)


def _safe_path_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _get_dict_value(payload: Any, *keys: str) -> Any:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        if key in payload:
            return payload[key]
    return None


def _references_plan_slug(payload: dict[str, Any], slug: str) -> bool:
    needles = [slug.lower(), slug.replace("-", " ").lower()]
    candidates: list[str] = []
    for key in ("task_description", "summary", "plan_slug", "planSlug", "prompt"):
        value = _as_clean_string(payload.get(key))
        if value:
            candidates.append(value.lower())
    metadata_value = payload.get("state")
    if isinstance(metadata_value, dict):
        for key in ("plan_slug", "planSlug", "task", "context_snapshot_path"):
            value = _as_clean_string(metadata_value.get(key))
            if value:
                candidates.append(value.lower())
    haystack = " ".join(candidates)
    return any(needle in haystack for needle in needles)


def _extract_last_checkpoint(payload: Any) -> PlanCheckpointData | None:
    raw_checkpoint = _get_dict_value(payload, "lastCheckpoint", "last_checkpoint")
    if not isinstance(raw_checkpoint, dict):
        return None
    timestamp = _as_clean_string(_get_dict_value(raw_checkpoint, "timestamp", "ts", "time"))
    role = _as_clean_string(raw_checkpoint.get("role"))
    checkpoint_id = _as_clean_string(_get_dict_value(raw_checkpoint, "checkpointId", "checkpoint_id", "id"))
    state = _as_clean_string(raw_checkpoint.get("state"))
    message = _as_clean_string(raw_checkpoint.get("message")) or ""
    if not timestamp or not role or not checkpoint_id or not state:
        return None
    return PlanCheckpointData(
        timestamp=timestamp,
        role=role,
        checkpoint_id=checkpoint_id,
        state=state,
        message=message,
    )


def _extract_last_error(payload: Any) -> PlanRuntimeErrorData | None:
    raw_error = _get_dict_value(payload, "lastError", "last_error")
    if not isinstance(raw_error, dict):
        return None
    timestamp = _as_clean_string(_get_dict_value(raw_error, "timestamp", "ts", "time"))
    message = _as_clean_string(raw_error.get("message"))
    if not timestamp or not message:
        return None
    return PlanRuntimeErrorData(
        timestamp=timestamp,
        code=_as_clean_string(raw_error.get("code")),
        message=message,
        source=_as_clean_string(raw_error.get("source")),
        recoverable=(
            bool(raw_error["recoverable"])
            if isinstance(raw_error.get("recoverable"), bool)
            else None
        ),
    )


def _derive_agents_from_events(events: list[PlanRuntimeEventData]) -> list[PlanRuntimeAgentData]:
    by_key: dict[str, PlanRuntimeAgentData] = {}
    for event in sorted(events, key=lambda item: _parse_datetime(item.ts) or datetime.min.replace(tzinfo=UTC)):
        if not event.authoritative:
            continue
        key = event.agent_name or (f"{event.role}:{event.model}" if event.role or event.model else None)
        if key is None:
            continue
        current = by_key.get(key)
        if current is None:
            by_key[key] = PlanRuntimeAgentData(
                name=event.agent_name or event.role or "unknown",
                role=event.role,
                model=event.model,
                status=event.status,
                started_at=event.ts,
                updated_at=event.ts,
                source=event.source,
                authoritative=event.authoritative,
            )
            continue
        by_key[key] = PlanRuntimeAgentData(
            name=current.name,
            role=event.role or current.role,
            model=event.model or current.model,
            status=event.status or current.status,
            started_at=current.started_at,
            updated_at=event.ts,
            source=event.source,
            authoritative=current.authoritative or event.authoritative,
        )

    agents = list(by_key.values())
    agents.sort(key=lambda item: item.name.lower())
    return agents


def _dedupe_events(events: list[PlanRuntimeEventData]) -> list[PlanRuntimeEventData]:
    deduped: dict[tuple[str, str, str | None, str | None], PlanRuntimeEventData] = {}
    for event in events:
        signature = (event.ts, event.kind, event.agent_name, event.message)
        deduped[signature] = event
    items = list(deduped.values())
    items.sort(key=lambda item: _parse_datetime(item.ts) or datetime.min.replace(tzinfo=UTC), reverse=True)
    return items[:MAX_RUNTIME_EVENTS]


def _unique_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _extract_first_heading(markdown: str) -> str | None:
    for raw_line in markdown.splitlines():
        heading_match = MARKDOWN_HEADING_RE.match(raw_line.strip())
        if heading_match:
            title = heading_match.group(1).strip()
            return title or None
    return None


def _humanize_slug(value: str) -> str:
    cleaned = value.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return "Prompt bundle"
    return " ".join(segment.capitalize() for segment in cleaned.split())


def _normalize_prompt_id(value: str, fallback_index: int, seen: set[str]) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not normalized:
        normalized = f"prompt-{fallback_index}"
    if normalized not in seen:
        seen.add(normalized)
        return normalized

    suffix = 2
    while f"{normalized}-{suffix}" in seen:
        suffix += 1
    deduped = f"{normalized}-{suffix}"
    seen.add(deduped)
    return deduped


def _parse_prompt_items_from_markdown(markdown: str, *, source_path: str) -> list[PlanPromptItemData]:
    lines = markdown.splitlines()
    prompts: list[PlanPromptItemData] = []
    seen_prompt_ids: set[str] = set()
    current_heading: str | None = None
    line_index = 0

    while line_index < len(lines):
        stripped = lines[line_index].strip()
        heading_match = MARKDOWN_HEADING_RE.match(stripped)
        if heading_match:
            heading_value = heading_match.group(1).strip()
            current_heading = heading_value or current_heading
            line_index += 1
            continue

        if not FENCE_RE.match(stripped):
            line_index += 1
            continue

        line_index += 1
        block_lines: list[str] = []
        while line_index < len(lines):
            if FENCE_RE.match(lines[line_index].strip()):
                break
            block_lines.append(lines[line_index])
            line_index += 1

        content = "\n".join(block_lines).strip()
        if content:
            title = current_heading or f"Prompt {len(prompts) + 1}"
            prompt_id = _normalize_prompt_id(title, len(prompts) + 1, seen_prompt_ids)
            prompts.append(
                PlanPromptItemData(
                    id=prompt_id,
                    title=title,
                    content=content,
                    source_path=source_path,
                )
            )

        if line_index < len(lines):
            line_index += 1

    return prompts
