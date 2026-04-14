from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Sequence

from app.modules.accounts.codex_live_usage import (
    read_live_codex_process_session_attribution,
    read_runtime_live_session_counts_by_snapshot,
)
from app.core.utils.time import utcnow
from app.modules.source_control.schemas import (
    SourceControlBotSyncEntry,
    SourceControlBranchDetailsResponse,
    SourceControlBranchPreview,
    SourceControlChangedFile,
    SourceControlCommitPreview,
    SourceControlCreatePullRequestResponse,
    SourceControlDeleteBranchResponse,
    SourceControlMergePullRequestResponse,
    SourceControlMergePreviewEntry,
    SourceControlPullRequestPreview,
    SourceControlPreviewResponse,
    SourceControlWorktreeEntry,
)

_GIT_TIMEOUT_SECONDS = 4
_BOT_BRANCH_PATTERN = re.compile(r"^(?:agent[/_-]|gx[/_-]|bot[/_-]|worker[/_-]|subbranch[/_-])", re.IGNORECASE)
_SLUG_NON_ALNUM_PATTERN = re.compile(r"[^a-z0-9]+")
_FIRST_URL_PATTERN = re.compile(r"https?://\S+")


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
        merge_preview_branches: set[str] = set()
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
            merge_preview_branches.add(preview.name)

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
                    source="agent",
                    snapshot_name=None,
                    session_count=0,
                )
            )
            if matched and matched_preview and matched not in merge_preview_branches:
                merge_preview.append(
                    SourceControlMergePreviewEntry(
                        branch=matched_preview.name,
                        merge_state=matched_preview.merge_state,
                        ahead=matched_preview.ahead,
                        behind=matched_preview.behind,
                    )
                )
                merge_preview_branches.add(matched)

        live_snapshot_bots = self._build_live_snapshot_bot_entries(
            repo_root=repo_root,
            all_branches=all_branches,
            worktrees=worktrees,
        )
        for snapshot_bot in live_snapshot_bots:
            gx_bots.append(snapshot_bot)
            matched = snapshot_bot.matched_branch
            matched_preview = branch_state_by_name.get(matched) if matched else None
            if matched and matched_preview and matched not in merge_preview_branches:
                merge_preview.append(
                    SourceControlMergePreviewEntry(
                        branch=matched_preview.name,
                        merge_state=matched_preview.merge_state,
                        ahead=matched_preview.ahead,
                        behind=matched_preview.behind,
                    )
                )
                merge_preview_branches.add(matched)

        pull_requests = self._list_pull_requests(repo_root=repo_root, base_branch=base_branch)

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
            pull_requests=pull_requests,
            quick_actions=quick_actions,
        )

    def build_branch_details(
        self,
        *,
        project_path: str | None,
        bots: Sequence[SourceControlBotSnapshot],
        branch: str,
        changed_file_limit: int = 240,
    ) -> SourceControlBranchDetailsResponse:
        target_branch = branch.strip()
        if not target_branch:
            raise SourceControlError(
                "Branch is required.",
                code="source_control_git_failed",
            )
        repo_root = self._resolve_repository_root(project_path)
        active_branch = self._resolve_active_branch(repo_root)
        all_branches = self._list_local_branches(repo_root)
        if target_branch not in all_branches:
            raise SourceControlError(
                f"Branch not found: {target_branch}",
                code="source_control_git_failed",
            )
        base_branch = self._resolve_base_branch(repo_root=repo_root, active_branch=active_branch, all_branches=all_branches)
        branch_preview = self._build_branch_preview(
            repo_root=repo_root,
            branch=target_branch,
            active_branch=active_branch,
            base_branch=base_branch,
        )
        changed_files = self._list_branch_changes(
            repo_root=repo_root,
            branch=target_branch,
            base_branch=base_branch,
            limit=max(1, changed_file_limit),
        )

        pull_requests = self._list_pull_requests(repo_root=repo_root, base_branch=base_branch)
        pull_request = next((entry for entry in pull_requests if entry.head_branch == target_branch), None)

        linked_bots: list[str] = []
        for bot in bots:
            matched = self._match_bot_to_branch(bot_name=bot.name, all_branches=all_branches)
            if matched == target_branch:
                linked_bots.append(bot.name)
        worktrees = self._list_worktrees(repo_root=repo_root)
        for snapshot_bot in self._build_live_snapshot_bot_entries(
            repo_root=repo_root,
            all_branches=all_branches,
            worktrees=worktrees,
        ):
            if snapshot_bot.matched_branch == target_branch:
                linked_bots.append(snapshot_bot.bot_name)

        return SourceControlBranchDetailsResponse(
            repository_root=str(repo_root),
            project_path=project_path,
            branch=target_branch,
            base_branch=base_branch,
            merge_state=branch_preview.merge_state,
            ahead=branch_preview.ahead,
            behind=branch_preview.behind,
            changed_files=changed_files,
            linked_bots=list(dict.fromkeys(linked_bots)),
            pull_request=pull_request,
        )

    def create_pull_request(
        self,
        *,
        project_path: str | None,
        branch: str,
        base_branch: str | None = None,
        title: str | None = None,
        body: str | None = None,
        draft: bool = False,
    ) -> SourceControlCreatePullRequestResponse:
        target_branch = branch.strip()
        if not target_branch:
            raise SourceControlError("Branch is required.", code="source_control_git_failed")

        repo_root = self._resolve_repository_root(project_path)
        all_branches = self._list_local_branches(repo_root)
        if target_branch not in all_branches:
            raise SourceControlError(f"Branch not found: {target_branch}", code="source_control_git_failed")

        active_branch = self._resolve_active_branch(repo_root)
        resolved_base_branch = (base_branch or "").strip()
        if not resolved_base_branch:
            resolved_base_branch = self._resolve_base_branch(
                repo_root=repo_root,
                active_branch=active_branch,
                all_branches=all_branches,
            )

        args = [
            "pr",
            "create",
            "--head",
            target_branch,
            "--base",
            resolved_base_branch,
        ]
        normalized_title = (title or "").strip()
        normalized_body = (body or "").strip()
        if normalized_title:
            args.extend(["--title", normalized_title])
            if normalized_body:
                args.extend(["--body", normalized_body])
            else:
                args.extend(["--body", ""])
        elif normalized_body:
            args.extend(["--fill", "--body", normalized_body])
        else:
            args.append("--fill")
        if draft:
            args.append("--draft")

        output = self._run_gh(args, cwd=repo_root, allow_failure=False)
        pull_requests = self._list_pull_requests(repo_root=repo_root, base_branch=resolved_base_branch)
        pull_request = next((entry for entry in pull_requests if entry.head_branch == target_branch), None)
        if pull_request is None:
            url = _extract_first_url(output)
            if url:
                pull_request = SourceControlPullRequestPreview(
                    number=0,
                    title=normalized_title or f"PR for {target_branch}",
                    state="open",
                    head_branch=target_branch,
                    base_branch=resolved_base_branch,
                    url=url,
                    author=None,
                    is_draft=draft,
                )

        return SourceControlCreatePullRequestResponse(
            status="created",
            branch=target_branch,
            base_branch=resolved_base_branch,
            pull_request=pull_request,
            message="Pull request created.",
        )

    def merge_pull_request(
        self,
        *,
        project_path: str | None,
        branch: str,
        pull_request_number: int | None = None,
        base_branch: str | None = None,
        delete_branch: bool = True,
        squash: bool = False,
    ) -> SourceControlMergePullRequestResponse:
        target_branch = branch.strip()
        if not target_branch:
            raise SourceControlError("Branch is required.", code="source_control_git_failed")

        repo_root = self._resolve_repository_root(project_path)
        all_branches = self._list_local_branches(repo_root)
        active_branch = self._resolve_active_branch(repo_root)
        resolved_base_branch = (base_branch or "").strip()
        if not resolved_base_branch:
            resolved_base_branch = self._resolve_base_branch(
                repo_root=repo_root,
                active_branch=active_branch,
                all_branches=all_branches,
            )

        pr_number = pull_request_number
        if pr_number is None:
            pull_requests = self._list_pull_requests(repo_root=repo_root, base_branch=resolved_base_branch)
            matched_pull_request = next((entry for entry in pull_requests if entry.head_branch == target_branch), None)
            if matched_pull_request is None:
                raise SourceControlError(
                    f"No open pull request found for branch: {target_branch}",
                    code="source_control_git_failed",
                )
            pr_number = matched_pull_request.number

        args = ["pr", "merge", str(pr_number), "--squash" if squash else "--merge"]
        if delete_branch:
            args.append("--delete-branch")
        self._run_gh(args, cwd=repo_root, allow_failure=False)

        if target_branch in all_branches and target_branch != active_branch:
            self._run_git(["branch", "-D", target_branch], cwd=repo_root, allow_failure=True)

        return SourceControlMergePullRequestResponse(
            status="merged",
            branch=target_branch,
            pull_request_number=pr_number,
            message="Pull request merged.",
        )

    def delete_branch(
        self,
        *,
        project_path: str | None,
        branch: str,
    ) -> SourceControlDeleteBranchResponse:
        target_branch = branch.strip()
        if not target_branch:
            raise SourceControlError("Branch is required.", code="source_control_git_failed")

        repo_root = self._resolve_repository_root(project_path)
        all_branches = self._list_local_branches(repo_root)
        if target_branch not in all_branches:
            raise SourceControlError(f"Branch not found: {target_branch}", code="source_control_git_failed")

        active_branch = self._resolve_active_branch(repo_root)
        if target_branch == active_branch:
            raise SourceControlError(
                f"Cannot delete active branch: {target_branch}",
                code="source_control_git_failed",
            )

        base_branch = self._resolve_base_branch(
            repo_root=repo_root,
            active_branch=active_branch,
            all_branches=all_branches,
        )
        if target_branch == base_branch:
            raise SourceControlError(
                f"Cannot delete base branch: {target_branch}",
                code="source_control_git_failed",
            )

        if not _BOT_BRANCH_PATTERN.search(target_branch):
            raise SourceControlError(
                "Only agent/runtime branches can be deleted from this panel.",
                code="source_control_git_failed",
            )

        matching_worktree = next(
            (entry for entry in self._list_worktrees(repo_root=repo_root) if entry.branch == target_branch),
            None,
        )
        if matching_worktree:
            raise SourceControlError(
                f"Cannot delete branch checked out in worktree: {matching_worktree.path}",
                code="source_control_git_failed",
            )

        self._run_git(["branch", "-D", target_branch], cwd=repo_root, allow_failure=False)
        return SourceControlDeleteBranchResponse(
            status="deleted",
            branch=target_branch,
            message="Branch deleted.",
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

    def _resolve_repository_root(self, project_path: str | None) -> Path:
        repo_hint = self._resolve_repository_hint(project_path)
        return Path(self._run_git(["rev-parse", "--show-toplevel"], cwd=repo_hint)).resolve()

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

    def _list_pull_requests(self, *, repo_root: Path, base_branch: str) -> list[SourceControlPullRequestPreview]:
        raw = self._run_gh(
            [
                "pr",
                "list",
                "--state",
                "open",
                "--base",
                base_branch,
                "--json",
                "number,title,state,headRefName,baseRefName,url,isDraft,author",
                "--limit",
                "20",
            ],
            cwd=repo_root,
            allow_failure=True,
        )
        if not raw:
            return []

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            return []
        if not isinstance(payload, list):
            return []

        previews: list[SourceControlPullRequestPreview] = []
        for entry in payload:
            if not isinstance(entry, dict):
                continue
            number = entry.get("number")
            title = str(entry.get("title") or "").strip()
            if not isinstance(number, int) or not title:
                continue

            state_value = str(entry.get("state") or "OPEN").strip().lower()
            if state_value == "merged":
                normalized_state: Literal["open", "merged", "closed"] = "merged"
            elif state_value == "closed":
                normalized_state = "closed"
            else:
                normalized_state = "open"

            head_branch = str(entry.get("headRefName") or "").strip()
            if not head_branch:
                continue
            base_value = str(entry.get("baseRefName") or base_branch).strip()
            base_value = base_value or base_branch

            author = None
            author_payload = entry.get("author")
            if isinstance(author_payload, dict):
                author_login = author_payload.get("login")
                if isinstance(author_login, str) and author_login.strip():
                    author = author_login.strip()

            url = entry.get("url")
            url_value = str(url).strip() if isinstance(url, str) and url.strip() else None
            is_draft = bool(entry.get("isDraft"))

            previews.append(
                SourceControlPullRequestPreview(
                    number=number,
                    title=title,
                    state=normalized_state,
                    head_branch=head_branch,
                    base_branch=base_value,
                    url=url_value,
                    author=author,
                    is_draft=is_draft,
                )
            )
        return previews

    def _list_branch_changes(
        self,
        *,
        repo_root: Path,
        branch: str,
        base_branch: str,
        limit: int,
    ) -> list[SourceControlChangedFile]:
        if branch == base_branch:
            return []
        output = self._run_git(
            ["diff", "--name-status", f"{base_branch}...{branch}"],
            cwd=repo_root,
            allow_failure=True,
        )
        rows = [line for line in output.splitlines() if line.strip()]
        parsed: list[SourceControlChangedFile] = []
        for row in rows:
            entry = _parse_diff_changed_file(row)
            if entry is None:
                continue
            parsed.append(entry)
            if len(parsed) >= limit:
                break
        return parsed

    def _match_bot_to_branch(self, *, bot_name: str, all_branches: Sequence[str]) -> str | None:
        candidates = _candidate_branches_for_bot(bot_name)
        return next((branch for branch in candidates if branch in all_branches), None)

    def _build_live_snapshot_bot_entries(
        self,
        *,
        repo_root: Path,
        all_branches: Sequence[str],
        worktrees: Sequence[SourceControlWorktreeEntry],
    ) -> list[SourceControlBotSyncEntry]:
        attribution = read_live_codex_process_session_attribution()
        process_counts_by_snapshot = attribution.counts_by_snapshot
        runtime_counts_by_snapshot = read_runtime_live_session_counts_by_snapshot()
        if not process_counts_by_snapshot and not runtime_counts_by_snapshot:
            return []

        snapshot_names = sorted(
            set(process_counts_by_snapshot.keys()) | set(runtime_counts_by_snapshot.keys()),
            key=lambda snapshot_name: (
                -max(
                    int(process_counts_by_snapshot.get(snapshot_name, 0)),
                    int(runtime_counts_by_snapshot.get(snapshot_name, 0)),
                ),
                snapshot_name.lower(),
            ),
        )

        entries: list[SourceControlBotSyncEntry] = []
        for snapshot_name in snapshot_names:
            process_session_count = max(0, int(process_counts_by_snapshot.get(snapshot_name, 0)))
            runtime_session_count = max(0, int(runtime_counts_by_snapshot.get(snapshot_name, 0)))
            total_session_count = max(process_session_count, runtime_session_count)
            if total_session_count <= 0:
                continue

            session_pids = attribution.mapped_session_pids_by_snapshot.get(snapshot_name, [])
            matched_branch = self._resolve_snapshot_branch_for_repo(
                snapshot_name=snapshot_name,
                all_branches=all_branches,
                worktrees=worktrees,
                session_pids=session_pids,
            )
            branch_candidates = _candidate_branches_for_snapshot(
                snapshot_name=snapshot_name,
                all_branches=all_branches,
            )
            if matched_branch and matched_branch not in branch_candidates:
                branch_candidates = [matched_branch, *branch_candidates]

            entries.append(
                SourceControlBotSyncEntry(
                    bot_name=f"Codex ({snapshot_name})",
                    bot_status="active",
                    runtime="codex-auth snapshot session",
                    matched_branch=matched_branch,
                    in_sync=bool(matched_branch),
                    branch_candidates=branch_candidates,
                    source="snapshot",
                    snapshot_name=snapshot_name,
                    session_count=total_session_count,
                )
            )

        return entries

    def _resolve_snapshot_branch_for_repo(
        self,
        *,
        snapshot_name: str,
        all_branches: Sequence[str],
        worktrees: Sequence[SourceControlWorktreeEntry],
        session_pids: Sequence[int],
    ) -> str | None:
        branch_from_process = self._resolve_snapshot_branch_from_live_processes(
            worktrees=worktrees,
            session_pids=session_pids,
        )
        if branch_from_process:
            return branch_from_process

        snapshot_candidates = _candidate_branches_for_snapshot(
            snapshot_name=snapshot_name,
            all_branches=all_branches,
        )
        if snapshot_candidates:
            return snapshot_candidates[0]
        return None

    def _resolve_snapshot_branch_from_live_processes(
        self,
        *,
        worktrees: Sequence[SourceControlWorktreeEntry],
        session_pids: Sequence[int],
    ) -> str | None:
        worktree_branches: list[tuple[Path, str]] = []
        for entry in worktrees:
            if not entry.branch:
                continue
            try:
                worktree_path = Path(entry.path).resolve()
            except OSError:
                worktree_path = Path(entry.path)
            worktree_branches.append((worktree_path, entry.branch))

        if not worktree_branches or not session_pids:
            return None

        worktree_branches.sort(key=lambda item: len(str(item[0])), reverse=True)
        branch_hits: dict[str, int] = {}
        for pid in session_pids:
            cwd = _read_process_cwd(pid)
            if cwd is None:
                continue
            matched_branch = _resolve_branch_for_path(cwd, worktree_branches)
            if not matched_branch:
                continue
            branch_hits[matched_branch] = branch_hits.get(matched_branch, 0) + 1

        if not branch_hits:
            return None
        return max(branch_hits.items(), key=lambda item: (item[1], item[0]))[0]

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

    def _run_gh(self, args: list[str], *, cwd: Path, allow_failure: bool = False) -> str:
        try:
            completed = subprocess.run(
                ["gh", *args],
                cwd=str(cwd),
                text=True,
                capture_output=True,
                check=False,
                timeout=_GIT_TIMEOUT_SECONDS,
            )
        except (OSError, subprocess.SubprocessError):
            if allow_failure:
                return ""
            raise SourceControlError(
                "Failed to execute gh command.",
                code="source_control_git_failed",
            )

        stdout = completed.stdout.rstrip("\n")
        if completed.returncode == 0:
            return stdout
        if allow_failure:
            return ""
        raise SourceControlError(
            f"GitHub CLI command failed: gh {' '.join(args)}",
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


def _parse_diff_changed_file(line: str) -> SourceControlChangedFile | None:
    if not line.strip():
        return None
    parts = line.split("\t")
    if len(parts) < 2:
        return None
    code = parts[0].strip().upper() or "?"
    path = parts[-1].strip()
    if not path:
        return None
    return SourceControlChangedFile(
        path=path,
        code=code,
        staged=True,
        unstaged=False,
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


def _candidate_branches_for_snapshot(*, snapshot_name: str, all_branches: Sequence[str]) -> list[str]:
    snapshot_slug = _slugify(snapshot_name)
    if not snapshot_slug:
        return []

    preferred_prefixes = (
        f"agent/codex/{snapshot_slug}",
        f"agent/{snapshot_slug}",
        f"gx/{snapshot_slug}",
        f"subbranch/{snapshot_slug}",
        f"bot/{snapshot_slug}",
    )
    candidates: list[str] = []
    seen: set[str] = set()

    for prefix in preferred_prefixes:
        for branch in all_branches:
            normalized_branch = branch.lower()
            if normalized_branch == prefix or normalized_branch.startswith(f"{prefix}-"):
                if branch not in seen:
                    seen.add(branch)
                    candidates.append(branch)

    for branch in all_branches:
        normalized_branch = branch.lower()
        if snapshot_slug not in normalized_branch:
            continue
        if not _BOT_BRANCH_PATTERN.search(branch):
            continue
        if branch not in seen:
            seen.add(branch)
            candidates.append(branch)

    return candidates


def _path_is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except (OSError, ValueError):
        return False


def _resolve_branch_for_path(cwd: Path, worktree_branches: Sequence[tuple[Path, str]]) -> str | None:
    for worktree_path, branch in worktree_branches:
        if _path_is_within(cwd, worktree_path):
            return branch
    return None


def _read_process_cwd(pid: int) -> Path | None:
    try:
        return Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
    except OSError:
        return None


def _extract_first_url(value: str) -> str | None:
    match = _FIRST_URL_PATTERN.search(value or "")
    if not match:
        return None
    return match.group(0).strip()


def _parse_iso_datetime(value: str):
    from datetime import datetime, timezone

    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)
