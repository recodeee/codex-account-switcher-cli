from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

CHECKPOINT_RE = re.compile(r"^- \[( |x)\] \[([A-Za-z0-9._-]+)\] ([A-Z_]+) - (.*)$")
STATUS_RE = re.compile(r"^\s*-\s*\*\*Status:\*\*\s*(.+?)\s*$", flags=re.IGNORECASE | re.MULTILINE)
TITLE_RE = re.compile(r"^#\s+Plan Summary:\s*(.+?)\s*$", flags=re.IGNORECASE | re.MULTILINE)
CHECKPOINT_LOG_RE = re.compile(
    r"^- (?P<timestamp>[^|]+?) \| role=(?P<role>[A-Za-z0-9._-]+) \| id=(?P<checkpoint_id>[A-Za-z0-9._-]+) \| state=(?P<state>[A-Z_]+) \| (?P<message>.*)$"
)
ROLE_ORDER = ("planner", "architect", "critic", "executor", "writer", "verifier", "designer")
DONE_CHECKPOINT_STATES = {"DONE", "COMPLETED"}
PLAN_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


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
    updated_at: datetime
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
    updated_at: datetime
    summary_markdown: str
    checkpoints_markdown: str
    roles: list[PlanRoleDetailData]
    overall_progress: PlanOverallProgressData
    current_checkpoint: PlanCheckpointData | None


class OpenSpecPlansService:
    def __init__(self, plans_root: Path | None = None) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        self._plans_root = plans_root or (repo_root / "openspec" / "plan")

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
        )

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
            updated_at=self._last_updated(plan_dir),
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

    @staticmethod
    def _last_updated(path: Path) -> datetime:
        newest = path.stat().st_mtime
        for candidate in path.rglob("*"):
            if candidate.is_file():
                newest = max(newest, candidate.stat().st_mtime)
        return datetime.fromtimestamp(newest, tz=UTC)


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
