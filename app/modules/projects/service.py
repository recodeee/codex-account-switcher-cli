from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol
from urllib.parse import urlparse

from app.modules.projects.repository import ProjectRepositoryConflictError


class ProjectEntryLike(Protocol):
    id: str
    name: str
    description: str | None
    project_url: str | None
    github_repo_url: str | None
    project_path: str | None
    sandbox_mode: str
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


class ProjectsRepositoryPort(Protocol):
    async def list_entries(self) -> Sequence[ProjectEntryLike]: ...

    async def get_entry(self, project_id: str) -> ProjectEntryLike | None: ...

    async def exists_name(self, name: str) -> bool: ...

    async def exists_path(
        self,
        project_path: str,
        *,
        exclude_project_id: str | None = None,
    ) -> bool: ...

    async def add(
        self,
        name: str,
        description: str | None,
        project_url: str | None,
        github_repo_url: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> ProjectEntryLike: ...

    async def update(
        self,
        project_id: str,
        name: str,
        description: str | None,
        project_url: str | None,
        github_repo_url: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> ProjectEntryLike | None: ...

    async def delete(self, project_id: str) -> bool: ...


class ProjectValidationError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: Literal[
            "invalid_project_name",
            "invalid_project_description",
            "invalid_project_url",
            "invalid_project_github_repo_url",
            "invalid_project_path",
            "invalid_project_sandbox",
            "invalid_project_branch",
        ],
    ) -> None:
        self.code = code
        super().__init__(message)


class ProjectNameExistsError(ValueError):
    pass


class ProjectPathExistsError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProjectEntryData:
    id: str
    name: str
    description: str | None
    project_url: str | None
    github_repo_url: str | None
    project_path: str | None
    sandbox_mode: str
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ProjectsListData:
    entries: list[ProjectEntryData]


@dataclass(frozen=True, slots=True)
class ProjectPlanLinkData:
    project_id: str
    plan_count: int
    completed_plan_count: int
    latest_plan_slug: str | None
    latest_plan_updated_at: datetime | None


@dataclass(frozen=True, slots=True)
class ProjectPlanLinksData:
    entries: list[ProjectPlanLinkData]


DEFAULT_SANDBOX_MODE = "workspace-write"
ALLOWED_SANDBOX_MODES = ("read-only", "workspace-write", "danger-full-access")
_WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = re.compile(r"^[A-Za-z]:[\\/]")
_GIT_BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")
_GIT_REMOTE_SCP_PATTERN = re.compile(r"^(?:ssh://)?git@([^:]+):(.+)$", flags=re.IGNORECASE)
_GITHUB_REPO_PATH_PATTERN = re.compile(r"^/([^/\s]+)/([^/\s]+?)(?:\.git)?/?$")
_GIT_COMMAND_TIMEOUT_SECONDS = 2.5


@dataclass(frozen=True, slots=True)
class AutoDiscoveredGitProject:
    name: str
    project_path: str
    git_branch: str | None
    github_repo_url: str | None


class ProjectsService:
    def __init__(self, repository: ProjectsRepositoryPort) -> None:
        self._repository = repository

    async def list_projects(self) -> ProjectsListData:
        await self._sync_auto_discovered_projects()
        rows = await self._repository.list_entries()
        entries = [self._to_project_entry_data(row) for row in rows]
        return ProjectsListData(entries=entries)

    async def get_project(self, project_id: str) -> ProjectEntryData | None:
        row = await self._repository.get_entry(project_id)
        if row is None:
            return None
        return self._to_project_entry_data(row)

    async def add_project(
        self,
        name: str,
        description: str | None,
        project_url: str | None,
        github_repo_url: str | None,
        project_path: str | None,
        sandbox_mode: str | None,
        git_branch: str | None,
    ) -> ProjectEntryData:
        normalized_name = normalize_project_name(name)
        normalized_description = normalize_project_description(description)
        normalized_project_url = normalize_project_url(project_url)
        normalized_github_repo_url = normalize_github_repo_url(github_repo_url)
        normalized_project_path = normalize_project_path(project_path)
        normalized_sandbox_mode = normalize_sandbox_mode(sandbox_mode)
        normalized_git_branch = normalize_git_branch(git_branch)

        if await self._repository.exists_name(normalized_name):
            raise ProjectNameExistsError("Project name already exists")
        if normalized_project_path and await self._repository.exists_path(normalized_project_path):
            raise ProjectPathExistsError("Project path is already linked to another project")

        try:
            row = await self._repository.add(
                normalized_name,
                normalized_description,
                normalized_project_url,
                normalized_github_repo_url,
                normalized_project_path,
                normalized_sandbox_mode,
                normalized_git_branch,
            )
        except ProjectRepositoryConflictError as exc:
            if exc.field == "name":
                raise ProjectNameExistsError("Project name already exists") from exc
            if exc.field == "path":
                raise ProjectPathExistsError("Project path is already linked to another project") from exc
            raise

        return self._to_project_entry_data(row)

    async def update_project(
        self,
        project_id: str,
        name: str,
        description: str | None,
        project_url: str | None,
        github_repo_url: str | None,
        project_path: str | None,
        sandbox_mode: str | None,
        git_branch: str | None,
    ) -> ProjectEntryData | None:
        normalized_name = normalize_project_name(name)
        normalized_description = normalize_project_description(description)
        normalized_project_url = normalize_project_url(project_url)
        normalized_github_repo_url = normalize_github_repo_url(github_repo_url)
        normalized_project_path = normalize_project_path(project_path)
        normalized_sandbox_mode = normalize_sandbox_mode(sandbox_mode)
        normalized_git_branch = normalize_git_branch(git_branch)

        if normalized_project_path and await self._repository.exists_path(
            normalized_project_path,
            exclude_project_id=project_id,
        ):
            raise ProjectPathExistsError("Project path is already linked to another project")

        try:
            row = await self._repository.update(
                project_id,
                normalized_name,
                normalized_description,
                normalized_project_url,
                normalized_github_repo_url,
                normalized_project_path,
                normalized_sandbox_mode,
                normalized_git_branch,
            )
        except ProjectRepositoryConflictError as exc:
            if exc.field == "name":
                raise ProjectNameExistsError("Project name already exists") from exc
            if exc.field == "path":
                raise ProjectPathExistsError("Project path is already linked to another project") from exc
            raise

        if row is None:
            return None

        return self._to_project_entry_data(row)

    async def remove_project(self, project_id: str) -> bool:
        return await self._repository.delete(project_id)

    async def list_project_plan_links(self) -> ProjectPlanLinksData:
        await self._sync_auto_discovered_projects()
        rows = await self._repository.list_entries()
        entries: list[ProjectPlanLinkData] = []

        for row in rows:
            normalized_project_path = normalize_stored_project_path(row.project_path)
            if not normalized_project_path:
                entries.append(
                    ProjectPlanLinkData(
                        project_id=row.id,
                        plan_count=0,
                        completed_plan_count=0,
                        latest_plan_slug=None,
                        latest_plan_updated_at=None,
                    )
                )
                continue

            plan_root = Path(normalized_project_path) / "openspec" / "plan"
            plan_dirs = _list_plan_directories(plan_root)

            if not plan_dirs:
                entries.append(
                    ProjectPlanLinkData(
                        project_id=row.id,
                        plan_count=0,
                        completed_plan_count=0,
                        latest_plan_slug=None,
                        latest_plan_updated_at=None,
                    )
                )
                continue

            latest_plan_slug: str | None = None
            latest_plan_updated_at: datetime | None = None
            latest_plan_mtime = 0.0
            completed_plan_count = 0

            for plan_dir in plan_dirs:
                if _is_plan_successful(plan_dir):
                    completed_plan_count += 1
                candidate_mtime = _latest_plan_mtime(plan_dir)
                if candidate_mtime <= latest_plan_mtime:
                    continue
                latest_plan_mtime = candidate_mtime
                latest_plan_slug = plan_dir.name
                latest_plan_updated_at = datetime.fromtimestamp(candidate_mtime, tz=UTC)

            entries.append(
                ProjectPlanLinkData(
                    project_id=row.id,
                    plan_count=len(plan_dirs),
                    completed_plan_count=completed_plan_count,
                    latest_plan_slug=latest_plan_slug,
                    latest_plan_updated_at=latest_plan_updated_at,
                )
            )

        return ProjectPlanLinksData(entries=entries)

    def _to_project_entry_data(self, row: ProjectEntryLike) -> ProjectEntryData:
        return ProjectEntryData(
            id=row.id,
            name=row.name,
            description=row.description,
            project_url=row.project_url,
            github_repo_url=row.github_repo_url,
            project_path=normalize_stored_project_path(row.project_path),
            sandbox_mode=row.sandbox_mode,
            git_branch=row.git_branch,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def _sync_auto_discovered_projects(self) -> None:
        if not _is_auto_discovery_enabled():
            return
        discovered_projects = await asyncio.to_thread(discover_active_codex_git_projects)

        rows = list(await self._repository.list_entries())
        existing_by_path: dict[str, ProjectEntryLike] = {}
        reserved_names = {row.name.strip().lower() for row in rows if row.name.strip()}
        for row in rows:
            normalized_path = normalize_stored_project_path(row.project_path)
            if normalized_path:
                existing_by_path[normalized_path] = row

        discovered_paths: set[str] = set()
        for discovered in discovered_projects:
            normalized_path = normalize_project_path(discovered.project_path)
            if not normalized_path:
                continue
            discovered_paths.add(normalized_path)

            existing = existing_by_path.get(normalized_path)
            if existing is None:
                candidate_name = _resolve_unique_project_name(discovered.name, reserved_names)
                reserved_names.add(candidate_name.strip().lower())
                try:
                    created = await self._repository.add(
                        candidate_name,
                        None,
                        None,
                        discovered.github_repo_url,
                        normalized_path,
                        DEFAULT_SANDBOX_MODE,
                        discovered.git_branch,
                    )
                except ProjectRepositoryConflictError:
                    continue
                existing_by_path[normalized_path] = created
                continue

            next_git_branch = discovered.git_branch or existing.git_branch
            next_github_repo_url = existing.github_repo_url
            if discovered.github_repo_url and discovered.github_repo_url != existing.github_repo_url:
                next_github_repo_url = discovered.github_repo_url

            if (
                existing.git_branch == next_git_branch
                and existing.github_repo_url == next_github_repo_url
            ):
                continue

            try:
                updated = await self._repository.update(
                    existing.id,
                    existing.name,
                    existing.description,
                    existing.project_url,
                    next_github_repo_url,
                    normalized_path,
                    existing.sandbox_mode,
                    next_git_branch,
                )
            except ProjectRepositoryConflictError:
                continue
            if updated is not None:
                existing_by_path[normalized_path] = updated

        for normalized_path, existing in list(existing_by_path.items()):
            if normalized_path in discovered_paths:
                continue
            refreshed = await asyncio.to_thread(_discover_git_metadata_for_project_path, normalized_path)
            if refreshed is None:
                continue
            discovered_git_branch, discovered_github_repo_url = refreshed
            next_git_branch = discovered_git_branch or existing.git_branch
            next_github_repo_url = (
                discovered_github_repo_url
                if discovered_github_repo_url and discovered_github_repo_url != existing.github_repo_url
                else existing.github_repo_url
            )

            if (
                normalize_stored_project_path(existing.project_path) == normalized_path
                and existing.git_branch == next_git_branch
                and existing.github_repo_url == next_github_repo_url
            ):
                continue

            try:
                updated = await self._repository.update(
                    existing.id,
                    existing.name,
                    existing.description,
                    existing.project_url,
                    next_github_repo_url,
                    normalized_path,
                    existing.sandbox_mode,
                    next_git_branch,
                )
            except ProjectRepositoryConflictError:
                continue
            if updated is not None:
                existing_by_path[normalized_path] = updated

        for normalized_path, existing in list(existing_by_path.items()):
            if normalized_path in discovered_paths:
                continue
            refreshed = await asyncio.to_thread(_discover_git_metadata_for_project_path, normalized_path)
            if refreshed is None:
                continue
            discovered_git_branch, discovered_github_repo_url = refreshed
            next_git_branch = discovered_git_branch or existing.git_branch
            next_github_repo_url = (
                discovered_github_repo_url
                if discovered_github_repo_url and discovered_github_repo_url != existing.github_repo_url
                else existing.github_repo_url
            )

            if (
                normalize_stored_project_path(existing.project_path) == normalized_path
                and existing.git_branch == next_git_branch
                and existing.github_repo_url == next_github_repo_url
            ):
                continue

            try:
                updated = await self._repository.update(
                    existing.id,
                    existing.name,
                    existing.description,
                    existing.project_url,
                    next_github_repo_url,
                    normalized_path,
                    existing.sandbox_mode,
                    next_git_branch,
                )
            except ProjectRepositoryConflictError:
                continue
            if updated is not None:
                existing_by_path[normalized_path] = updated


def _discover_git_metadata_for_project_path(project_path: str) -> tuple[str | None, str | None] | None:
    try:
        project_path_value = Path(project_path).expanduser().resolve()
    except OSError:
        return None
    repo_root = _resolve_git_repo_root(project_path_value)
    if repo_root is None:
        return None
    return (_resolve_git_branch(repo_root), _resolve_github_repo_url(repo_root))


def _discover_git_metadata_for_project_path(project_path: str) -> tuple[str | None, str | None] | None:
    try:
        project_path_value = Path(project_path).expanduser().resolve()
    except OSError:
        return None
    repo_root = _resolve_git_repo_root(project_path_value)
    if repo_root is None:
        return None
    return (_resolve_git_branch(repo_root), _resolve_github_repo_url(repo_root))


def normalize_project_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ProjectValidationError("Project name is required", code="invalid_project_name")
    if len(normalized) > 128:
        raise ProjectValidationError("Project name must be 128 characters or fewer", code="invalid_project_name")
    return normalized


def normalize_project_description(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 512:
        raise ProjectValidationError(
            "Project description must be 512 characters or fewer",
            code="invalid_project_description",
        )
    return normalized


def normalize_project_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 2048:
        raise ProjectValidationError(
            "Project URL must be 2048 characters or fewer",
            code="invalid_project_url",
        )

    parsed = urlparse(normalized)
    if not parsed.scheme and not parsed.netloc:
        has_path_markers = normalized.startswith("/") or normalized.startswith("\\")
        if "." in normalized and not has_path_markers and " " not in normalized:
            normalized = f"https://{normalized}"
            parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ProjectValidationError(
            "Project URL must be a valid http/https URL",
            code="invalid_project_url",
        )
    return normalized


def normalize_github_repo_url(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 2048:
        raise ProjectValidationError(
            "GitHub repo URL must be 2048 characters or fewer",
            code="invalid_project_github_repo_url",
        )

    normalized_url = _normalize_remote_to_https_url(normalized) or normalized
    parsed = urlparse(normalized_url)
    if not parsed.scheme and not parsed.netloc:
        normalized_url = f"https://{normalized_url}"
        parsed = urlparse(normalized_url)
    if parsed.scheme not in {"http", "https"}:
        raise ProjectValidationError(
            "GitHub repo URL must be a valid github.com URL",
            code="invalid_project_github_repo_url",
        )
    if parsed.netloc.lower() not in {"github.com", "www.github.com"}:
        raise ProjectValidationError(
            "GitHub repo URL must use github.com",
            code="invalid_project_github_repo_url",
        )

    match = _GITHUB_REPO_PATH_PATTERN.match(parsed.path.strip())
    if match is None:
        raise ProjectValidationError(
            "GitHub repo URL must include owner and repository",
            code="invalid_project_github_repo_url",
        )
    owner, repo = match.groups()
    return f"https://github.com/{owner}/{repo}"


def normalize_project_path(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = _expand_project_path_shorthand(value.strip())
    if not normalized:
        return None
    if len(normalized) > 1024:
        raise ProjectValidationError(
            "Project path must be 1024 characters or fewer",
            code="invalid_project_path",
        )
    if not _is_absolute_project_path(normalized):
        raise ProjectValidationError(
            "Project path must be absolute",
            code="invalid_project_path",
        )
    return normalized


def normalize_stored_project_path(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    expanded = _expand_project_path_shorthand(normalized)
    if _is_absolute_project_path(expanded):
        return expanded
    return normalized


def normalize_sandbox_mode(value: str | None) -> str:
    if value is None:
        return DEFAULT_SANDBOX_MODE
    normalized = value.strip().lower()
    if not normalized:
        return DEFAULT_SANDBOX_MODE
    if normalized not in ALLOWED_SANDBOX_MODES:
        raise ProjectValidationError(
            "Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
            code="invalid_project_sandbox",
        )
    return normalized


def normalize_git_branch(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 255:
        raise ProjectValidationError(
            "Git branch must be 255 characters or fewer",
            code="invalid_project_branch",
        )
    if (
        not _GIT_BRANCH_PATTERN.fullmatch(normalized)
        or normalized.startswith("/")
        or normalized.endswith("/")
        or ".." in normalized
        or normalized.endswith(".lock")
    ):
        raise ProjectValidationError(
            "Git branch contains invalid characters",
            code="invalid_project_branch",
        )
    return normalized


def _is_absolute_project_path(value: str) -> bool:
    return value.startswith("/") or value.startswith("\\\\") or _WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.match(value) is not None


def _expand_project_path_shorthand(value: str) -> str:
    if not value:
        return value
    normalized = str(Path(value).expanduser()) if value.startswith("~") else value
    documents_suffix = _extract_documents_shorthand_suffix(normalized)
    if documents_suffix is None:
        return normalized
    documents_root = Path.home() / "Documents"
    return str(documents_root.joinpath(*documents_suffix)) if documents_suffix else str(documents_root)


def _extract_documents_shorthand_suffix(value: str) -> tuple[str, ...] | None:
    normalized = value.replace("\\", "/")
    if not normalized.startswith("/"):
        return None
    parts = [part for part in normalized.split("/") if part]
    if not parts:
        return None
    if parts[0].lower() != "documents":
        return None
    return tuple(parts[1:])


def _list_plan_directories(plan_root: Path) -> list[Path]:
    try:
        if not plan_root.exists() or not plan_root.is_dir():
            return []
        entries = [entry for entry in plan_root.iterdir() if entry.is_dir() and not entry.name.startswith(".")]
    except OSError:
        return []

    return [entry for entry in entries if (entry / "summary.md").is_file()]


def _latest_plan_mtime(plan_dir: Path) -> float:
    latest_mtime = _safe_path_mtime(plan_dir)
    try:
        for candidate in plan_dir.rglob("*"):
            if not candidate.is_file():
                continue
            latest_mtime = max(latest_mtime, _safe_path_mtime(candidate))
    except OSError:
        return latest_mtime
    return latest_mtime


def _is_plan_successful(plan_dir: Path) -> bool:
    summary_path = plan_dir / "summary.md"
    checkpoints_path = plan_dir / "checkpoints.md"
    try:
        summary_markdown = summary_path.read_text(encoding="utf-8")
    except OSError:
        summary_markdown = ""
    if "**status:** completed" in summary_markdown.lower():
        return True

    try:
        checkpoints_markdown = checkpoints_path.read_text(encoding="utf-8")
    except OSError:
        checkpoints_markdown = ""
    lowered = checkpoints_markdown.lower()
    return "role=verifier" in lowered and "state=done" in lowered


def _safe_path_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def discover_active_codex_git_projects() -> list[AutoDiscoveredGitProject]:
    repo_roots: dict[str, Path] = {}
    for cwd in _iter_codex_process_cwds():
        repo_root = _resolve_git_repo_root(cwd)
        if repo_root is None:
            continue
        repo_roots[str(repo_root)] = repo_root

    current_cwd = _resolve_current_process_cwd()
    if current_cwd is not None:
        repo_root = _resolve_git_repo_root(current_cwd)
        if repo_root is not None:
            repo_roots[str(repo_root)] = repo_root

    discovered: list[AutoDiscoveredGitProject] = []
    for repo_root in sorted(repo_roots.values(), key=lambda value: str(value).lower()):
        branch = _resolve_git_branch(repo_root)
        github_repo_url = _resolve_github_repo_url(repo_root)
        discovered.append(
            AutoDiscoveredGitProject(
                name=repo_root.name or "project",
                project_path=str(repo_root),
                git_branch=branch,
                github_repo_url=github_repo_url,
            )
        )
    return discovered


def _iter_codex_process_cwds() -> list[Path]:
    proc_root = Path("/proc")
    if not proc_root.exists() or not proc_root.is_dir():
        return []

    discovered_cwds: list[Path] = []
    for pid_dir in proc_root.iterdir():
        if not pid_dir.is_dir() or not pid_dir.name.isdigit():
            continue
        command = _read_process_cmdline(pid_dir)
        if not _looks_like_codex_cli_command(command):
            continue
        cwd = _read_process_cwd(pid_dir)
        if cwd is None:
            continue
        discovered_cwds.append(cwd)
    return discovered_cwds


def _resolve_current_process_cwd() -> Path | None:
    try:
        return Path.cwd().resolve()
    except OSError:
        return None


def _read_process_cmdline(pid_dir: Path) -> list[str]:
    cmdline_path = pid_dir / "cmdline"
    try:
        raw = cmdline_path.read_bytes()
    except OSError:
        return []
    return [part for part in raw.decode("utf-8", errors="ignore").split("\x00") if part.strip()]


def _looks_like_codex_cli_command(command: list[str]) -> bool:
    codex_index: int | None = None
    for index, part in enumerate(command[:5]):
        if Path(part).name.lower() == "codex":
            codex_index = index
            break
    if codex_index is None:
        return False

    for arg in command[codex_index + 1 :]:
        normalized = arg.strip().lower()
        if not normalized or normalized.startswith("-"):
            continue
        return normalized != "app-server"
    return True


def _read_process_cwd(pid_dir: Path) -> Path | None:
    cwd_link = pid_dir / "cwd"
    try:
        return Path(os.readlink(cwd_link)).resolve()
    except OSError:
        return None


def _resolve_git_repo_root(cwd: Path) -> Path | None:
    output = _run_git(repo_hint=cwd, args=["rev-parse", "--show-toplevel"])
    if not output:
        return None
    try:
        return Path(output).expanduser().resolve()
    except OSError:
        return None


def _resolve_git_branch(repo_root: Path) -> str | None:
    output = _run_git(repo_hint=repo_root, args=["rev-parse", "--abbrev-ref", "HEAD"])
    if not output or output == "HEAD":
        return None
    try:
        return normalize_git_branch(output)
    except ProjectValidationError:
        return None


def _resolve_github_repo_url(repo_root: Path) -> str | None:
    origin_remote = _run_git(repo_hint=repo_root, args=["remote", "get-url", "origin"])
    origin_candidate = _normalize_remote_to_https_url(origin_remote) if origin_remote else None
    github_repo_url = _extract_github_repo_url(origin_candidate)
    if github_repo_url:
        return github_repo_url

    gh_bin = shutil.which("gh")
    if not gh_bin:
        return None
    gh_url = _run_command(
        [gh_bin, "repo", "view", "--json", "url", "--jq", ".url"],
        cwd=repo_root,
        timeout_seconds=_GIT_COMMAND_TIMEOUT_SECONDS,
        env_overrides={"GH_PROMPT_DISABLED": "1"},
    )
    if not gh_url:
        return None
    return _extract_github_repo_url(gh_url)


def _run_git(*, repo_hint: Path, args: list[str]) -> str | None:
    git_bin = shutil.which("git")
    if not git_bin:
        return None
    return _run_command(
        [git_bin, "-C", str(repo_hint), *args],
        cwd=repo_hint,
        timeout_seconds=_GIT_COMMAND_TIMEOUT_SECONDS,
    )


def _run_command(
    command: list[str],
    *,
    cwd: Path,
    timeout_seconds: float,
    env_overrides: dict[str, str] | None = None,
) -> str | None:
    env = None
    if env_overrides:
        env = os.environ.copy()
        env.update(env_overrides)
    try:
        completed = subprocess.run(
            command,
            cwd=cwd,
            env=env,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if completed.returncode != 0:
        return None
    output = completed.stdout.strip()
    return output or None


def _normalize_remote_to_https_url(remote: str) -> str | None:
    normalized = remote.strip()
    if not normalized:
        return None

    scp_match = _GIT_REMOTE_SCP_PATTERN.match(normalized)
    if scp_match is not None:
        host, path = scp_match.groups()
        return f"https://{host}/{path.lstrip('/')}"

    parsed = urlparse(normalized)
    if parsed.scheme and parsed.netloc:
        host = parsed.hostname or parsed.netloc
        if not host:
            return None
        path = parsed.path or ""
        if not path:
            return None
        return f"https://{host}{path}"

    if "/" in normalized and "." in normalized and " " not in normalized:
        return f"https://{normalized.lstrip('/')}"
    return None


def _extract_github_repo_url(candidate: str | None) -> str | None:
    if not candidate:
        return None
    normalized = candidate.strip()
    if not normalized:
        return None
    parsed = urlparse(normalized)
    if not parsed.scheme and not parsed.netloc:
        normalized = f"https://{normalized}"
        parsed = urlparse(normalized)
    host = parsed.netloc.lower()
    if host not in {"github.com", "www.github.com"}:
        return None
    match = _GITHUB_REPO_PATH_PATTERN.match(parsed.path.strip())
    if match is None:
        return None
    owner, repo = match.groups()
    return f"https://github.com/{owner}/{repo}"


def _resolve_unique_project_name(base_name: str, reserved_names: set[str]) -> str:
    collapsed = " ".join(base_name.strip().split())
    normalized_base = collapsed or "project"
    if len(normalized_base) > 128:
        normalized_base = normalized_base[:128].rstrip(" -_.") or "project"
    candidate = normalized_base
    suffix = 2
    while candidate.lower() in reserved_names:
        candidate = f"{normalized_base}-{suffix}"
        if len(candidate) > 128:
            candidate = f"{normalized_base[:120].rstrip(' -_.')}-{suffix}"
        suffix += 1
    return candidate


def _is_auto_discovery_enabled() -> bool:
    raw = os.environ.get("CODEX_LB_PROJECTS_AUTO_DISCOVER_ENABLED")
    if raw is not None:
        return raw.strip().lower() in {"1", "true", "yes", "on"}
    return os.environ.get("PYTEST_CURRENT_TEST") is None
