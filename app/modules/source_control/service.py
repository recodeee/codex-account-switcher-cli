from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from app.core.utils.time import utcnow
from app.modules.source_control.schemas import (
    SourceControlBotSyncEntry,
    SourceControlBranchPreview,
    SourceControlChangedFile,
    SourceControlCommitPreview,
    SourceControlMergePreviewEntry,
    SourceControlPreviewResponse,
    SourceControlWorktreeEntry,
)

_GIT_TIMEOUT_SECONDS = 4
_BOT_BRANCH_PATTERN = re.compile(r"^(?:agent[/_-]|gx[/_-]|bot[/_-]|worker[/_-]|subbranch[/_-])", re.IGNORECASE)
_SLUG_NON_ALNUM_PATTERN = re.compile(r"[^a-z0-9]+")


class SourceControlError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: Literal[
            "source_control_invalid_path",
            "source_control_not_git_repo",
            "source_control_git_failed",
        ],
    ) -> None:
        self.code = code
        super().__init__(message)


@dataclass(frozen=True, slots=True)
class SourceControlBotSnapshot:
    name: str
    status: Literal["idle", "active"]
    runtime: str


class SourceControlService:
    def __init__(self, *, fallback_repository_root: Path | None = None) -> None:
        self._fallback_repository_root = (fallback_repository_root or Path.cwd()).resolve()

    def build_preview(
        self,
        *,
        project_path: str | None,
        bots: Sequence[SourceControlBotSnapshot],
        branch_limit: int = 24,
        changed_file_limit: int = 120,
    ) -> SourceControlPreviewResponse:
        repo_hint = self._resolve_repository_hint(project_path)
        repo_root = Path(self._run_git(["rev-parse", "--show-toplevel"], cwd=repo_hint)).resolve()
        active_branch = self._resolve_active_branch(repo_root)
        all_branches = self._list_local_branches(repo_root)
        base_branch = self._resolve_base_branch(repo_root=repo_root, active_branch=active_branch, all_branches=all_branches)
        status_lines = self._run_git(
            ["status", "--porcelain=v1", "--untracked-files=all"],
            cwd=repo_root,
            allow_failure=True,
        ).splitlines()
        changed_files = [_parse_changed_file(line) for line in status_lines if line.strip()]
        changed_files = [entry for entry in changed_files if entry is not None][: max(1, changed_file_limit)]

        commit_preview = self._build_commit_preview(repo_root=repo_root)
        worktrees = self._list_worktrees(repo_root=repo_root)

        preferred_branches: list[str] = []
        bot_branch_candidates = [branch for branch in all_branches if _BOT_BRANCH_PATTERN.search(branch)]
        for branch in [active_branch, base_branch, *bot_branch_candidates]:
            if branch and branch not in preferred_branches:
                preferred_branches.append(branch)
        for branch in all_branches:
            if len(preferred_branches) >= max(2, branch_limit):
                break
            if branch not in preferred_branches:
                preferred_branches.append(branch)

        branch_previews = [
            self._build_branch_preview(
                repo_root=repo_root,
                branch=branch,
                active_branch=active_branch,
                base_branch=base_branch,
            )
            for branch in preferred_branches
        ]
        branch_state_by_name = {entry.name: entry for entry in branch_previews}

        merge_preview: list[SourceControlMergePreviewEntry] = []
        for branch in preferred_branches:
            if branch == base_branch:
                continue
            preview = branch_state_by_name.get(branch)
            if preview is None:
                continue
            if not _BOT_BRANCH_PATTERN.search(branch):
                continue
            merge_preview.append(
                SourceControlMergePreviewEntry(
                    branch=preview.name,
                    merge_state=preview.merge_state,
                    ahead=preview.ahead,
                    behind=preview.behind,
                )
            )

        gx_bots: list[SourceControlBotSyncEntry] = []
        for bot in bots:
            candidates = _candidate_branches_for_bot(bot.name)
            matched = next((branch for branch in candidates if branch in all_branches), None)
            matched_preview = branch_state_by_name.get(matched) if matched else None
            gx_bots.append(
                SourceControlBotSyncEntry(
                    bot_name=bot.name,
                    bot_status=bot.status,
                    runtime=bot.runtime,
                    matched_branch=matched,
                    in_sync=bool(matched and matched_preview is not None),
                    branch_candidates=candidates,
                )
            )
            if matched and matched_preview and matched not in {entry.branch for entry in merge_preview}:
                merge_preview.append(
                    SourceControlMergePreviewEntry(
                        branch=matched_preview.name,
                        merge_state=matched_preview.merge_state,
                        ahead=matched_preview.ahead,
                        behind=matched_preview.behind,
                    )
                )

        quick_actions = [
            "git status --short",
            "git log --oneline --decorate -n 8",
            f"git checkout {active_branch}",
            f"gh pr list --state open --base {base_branch}",
        ]
        ready_candidate = next((entry.branch for entry in merge_preview if entry.merge_state == "ready"), None)
        if ready_candidate:
            quick_actions.append(f"gh pr create --fill --head {ready_candidate} --base {base_branch}")

        return SourceControlPreviewResponse(
            repository_root=str(repo_root),
            project_path=project_path,
            active_branch=active_branch,
            base_branch=base_branch,
            dirty=bool(changed_files),
            refreshed_at=utcnow(),
            changed_files=changed_files,
            commit_preview=commit_preview,
            branches=branch_previews,
            merge_preview=merge_preview,
            worktrees=worktrees,
            gx_bots=gx_bots,
            quick_actions=quick_actions,
        )

    def _resolve_repository_hint(self, project_path: str | None) -> Path:
        if not project_path:
            return self._fallback_repository_root
        candidate = Path(project_path).expanduser()
        if not candidate.is_absolute():
            candidate = (self._fallback_repository_root / candidate).resolve()
        else:
            candidate = candidate.resolve()
        if not candidate.exists() or not candidate.is_dir():
            raise SourceControlError(
                f"Project path does not exist: {candidate}",
                code="source_control_invalid_path",
            )
        return candidate

    def _resolve_active_branch(self, repo_root: Path) -> str:
        branch = self._run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root, allow_failure=True).strip()
        if not branch or branch == "HEAD":
            return "detached"
        return branch

    def _resolve_base_branch(self, *, repo_root: Path, active_branch: str, all_branches: Sequence[str]) -> str:
        origin_head = self._run_git(
            ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
            cwd=repo_root,
            allow_failure=True,
        ).strip()
        if origin_head.startswith("refs/remotes/origin/"):
            candidate = origin_head.removeprefix("refs/remotes/origin/")
            if candidate in all_branches:
                return candidate
        for candidate in ("main", "dev", "master"):
            if candidate in all_branches:
                return candidate
        return active_branch

    def _list_local_branches(self, repo_root: Path) -> list[str]:
        output = self._run_git(
            ["for-each-ref", "refs/heads", "--sort=-committerdate", "--format=%(refname:short)"],
            cwd=repo_root,
            allow_failure=True,
        )
        return [line.strip() for line in output.splitlines() if line.strip()]

    def _build_commit_preview(self, *, repo_root: Path) -> SourceControlCommitPreview:
        raw = self._run_git(
            ["log", "-1", "--pretty=format:%H%x00%s%x00%b%x00%an%x00%aI"],
            cwd=repo_root,
            allow_failure=True,
        )
        if not raw:
            return SourceControlCommitPreview(subject="No commits yet")

        parts = raw.split("\x00")
        if len(parts) < 5:
            return SourceControlCommitPreview(subject="Commit preview unavailable")

        commit_hash, subject, body, author_name, authored_at = parts[:5]
        parsed_authored_at = None
        authored_at_value = authored_at.strip()
        if authored_at_value:
            try:
                parsed_authored_at = _parse_iso_datetime(authored_at_value)
            except ValueError:
                parsed_authored_at = None

        return SourceControlCommitPreview(
            hash=commit_hash.strip() or None,
            subject=subject.strip() or "Commit subject unavailable",
            body=(body.strip() or None),
            author_name=author_name.strip() or None,
            authored_at=parsed_authored_at,
        )

    def _list_worktrees(self, *, repo_root: Path) -> list[SourceControlWorktreeEntry]:
        output = self._run_git(["worktree", "list", "--porcelain"], cwd=repo_root, allow_failure=True)
        if not output.strip():
            return [SourceControlWorktreeEntry(path=str(repo_root), branch=None, is_current=True)]

        entries: list[SourceControlWorktreeEntry] = []
        current_path = repo_root.resolve()
        current_worktree_path: Path | None = None
        current_branch: str | None = None

        def flush() -> None:
            nonlocal current_worktree_path, current_branch
            if current_worktree_path is None:
                return
            resolved = current_worktree_path.resolve()
            entries.append(
                SourceControlWorktreeEntry(
                    path=str(resolved),
                    branch=current_branch,
                    is_current=resolved == current_path,
                )
            )
            current_worktree_path = None
            current_branch = None

        for line in output.splitlines():
            if not line.strip():
                flush()
                continue
            if line.startswith("worktree "):
                flush()
                current_worktree_path = Path(line.removeprefix("worktree ").strip())
                continue
            if line.startswith("branch "):
                ref = line.removeprefix("branch ").strip()
                if ref.startswith("refs/heads/"):
                    current_branch = ref.removeprefix("refs/heads/")
                else:
                    current_branch = ref
        flush()

        if not entries:
            entries.append(SourceControlWorktreeEntry(path=str(repo_root), branch=None, is_current=True))
        return entries

    def _build_branch_preview(
        self,
        *,
        repo_root: Path,
        branch: str,
        active_branch: str,
        base_branch: str,
    ) -> SourceControlBranchPreview:
        if branch == base_branch:
            return SourceControlBranchPreview(
                name=branch,
                is_active=(branch == active_branch),
                ahead=0,
                behind=0,
                merged_into_base=True,
                merge_state="merged",
            )

        ahead = 0
        behind = 0
        if base_branch and branch and base_branch != branch:
            ahead, behind = self._ahead_behind(repo_root=repo_root, base_branch=base_branch, branch=branch)
        merged = self._is_merged_into_base(repo_root=repo_root, branch=branch, base_branch=base_branch)
        merge_state = _resolve_merge_state(merged=merged, ahead=ahead, behind=behind)
        return SourceControlBranchPreview(
            name=branch,
            is_active=(branch == active_branch),
            ahead=ahead,
            behind=behind,
            merged_into_base=merged,
            merge_state=merge_state,
        )

    def _ahead_behind(self, *, repo_root: Path, base_branch: str, branch: str) -> tuple[int, int]:
        raw = self._run_git(
            ["rev-list", "--left-right", "--count", f"{base_branch}...{branch}"],
            cwd=repo_root,
            allow_failure=True,
        ).strip()
        if not raw:
            return (0, 0)
        parts = raw.split()
        if len(parts) != 2:
            return (0, 0)
        try:
            behind = int(parts[0])
            ahead = int(parts[1])
        except ValueError:
            return (0, 0)
        return (ahead, behind)

    def _is_merged_into_base(self, *, repo_root: Path, branch: str, base_branch: str) -> bool | None:
        if not branch or not base_branch or branch == base_branch:
            return True
        try:
            self._run_git(
                ["merge-base", "--is-ancestor", branch, base_branch],
                cwd=repo_root,
                allow_failure=False,
            )
            return True
        except SourceControlError:
            return False

    def _run_git(self, args: list[str], *, cwd: Path, allow_failure: bool = False) -> str:
        try:
            completed = subprocess.run(
                ["git", *args],
                cwd=str(cwd),
                text=True,
                capture_output=True,
                check=False,
                timeout=_GIT_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.SubprocessError) as exc:
            raise SourceControlError(
                "Failed to execute git command.",
                code="source_control_git_failed",
            ) from exc

        # Preserve leading spaces (for example in `git status --porcelain`),
        # only trimming trailing newlines from command output.
        stdout = completed.stdout.rstrip("\n")
        if completed.returncode == 0:
            return stdout

        stderr = (completed.stderr or "").strip()
        if allow_failure:
            return ""

        if "not a git repository" in stderr.lower():
            raise SourceControlError(
                "Selected path is not a git repository.",
                code="source_control_not_git_repo",
            )

        raise SourceControlError(
            f"Git command failed: git {' '.join(args)}",
            code="source_control_git_failed",
        )


def _parse_changed_file(line: str) -> SourceControlChangedFile | None:
    if len(line) < 3:
        return None
    x = line[0]
    y = line[1]
    payload = line[3:].strip()
    if not payload:
        return None
    path = payload.split(" -> ")[-1].strip()
    code = (y if y not in {" ", "."} else x).strip() or "?"
    return SourceControlChangedFile(
        path=path,
        code=code.upper(),
        staged=(x not in {" ", "."}),
        unstaged=(y not in {" ", "."}),
    )


def _resolve_merge_state(*, merged: bool | None, ahead: int, behind: int) -> Literal["merged", "ready", "diverged", "behind", "unknown"]:
    if merged:
        return "merged"
    if ahead > 0 and behind == 0:
        return "ready"
    if ahead > 0 and behind > 0:
        return "diverged"
    if ahead == 0 and behind > 0:
        return "behind"
    return "unknown"


def _slugify(value: str) -> str:
    normalized = value.strip().lower()
    normalized = _SLUG_NON_ALNUM_PATTERN.sub("-", normalized)
    normalized = normalized.strip("-")
    return normalized or "bot"


def _candidate_branches_for_bot(bot_name: str) -> list[str]:
    slug = _slugify(bot_name)
    return [
        f"agent/{slug}",
        f"agent_{slug}",
        f"subbranch/{slug}",
        f"gx/{slug}",
        f"bot/{slug}",
        slug,
    ]


def _parse_iso_datetime(value: str):
    from datetime import datetime, timezone

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)
