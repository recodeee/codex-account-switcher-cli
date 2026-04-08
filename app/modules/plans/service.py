from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

CHECKPOINT_RE = re.compile(r"^- \[( |x)\] \[([A-Za-z0-9._-]+)\] ([A-Z_]+) - (.*)$")
STATUS_RE = re.compile(r"^\s*-\s*\*\*Status:\*\*\s*(.+?)\s*$", flags=re.IGNORECASE | re.MULTILINE)
TITLE_RE = re.compile(r"^#\s+Plan Summary:\s*(.+?)\s*$", flags=re.IGNORECASE | re.MULTILINE)
ROLE_ORDER = ("planner", "architect", "critic", "executor", "writer", "verifier")


class OpenSpecPlansError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class PlanRoleProgressData:
    role: str
    total_checkpoints: int
    done_checkpoints: int


@dataclass(frozen=True, slots=True)
class PlanSummaryData:
    slug: str
    title: str
    status: str
    updated_at: datetime
    roles: list[PlanRoleProgressData]


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
        plan_dir = self._plans_root / slug
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
            if not tasks_path.exists():
                continue

            tasks_markdown = self._read_markdown(tasks_path)
            total, done = _checkpoint_counts(tasks_markdown)
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
        )

    def _read_plan_summary(self, plan_dir: Path, summary_path: Path) -> PlanSummaryData:
        summary_markdown = self._read_markdown(summary_path)
        roles: list[PlanRoleProgressData] = []

        for role in ROLE_ORDER:
            tasks_path = plan_dir / role / "tasks.md"
            if not tasks_path.exists():
                continue
            tasks_markdown = self._read_markdown(tasks_path)
            total, done = _checkpoint_counts(tasks_markdown)
            roles.append(
                PlanRoleProgressData(
                    role=role,
                    total_checkpoints=total,
                    done_checkpoints=done,
                )
            )

        return PlanSummaryData(
            slug=plan_dir.name,
            title=_extract_title(summary_markdown, plan_dir.name),
            status=_extract_status(summary_markdown),
            updated_at=self._last_updated(plan_dir),
            roles=roles,
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
