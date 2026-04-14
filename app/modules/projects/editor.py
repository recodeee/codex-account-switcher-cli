from __future__ import annotations

import os
import platform
import shlex
import shutil
import subprocess
from pathlib import Path
from typing import Literal


class ProjectEditorLaunchError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        code: Literal[
            "invalid_project_path",
            "project_path_not_found",
            "editor_not_found",
            "editor_launch_failed",
            "file_manager_not_found",
            "file_manager_launch_failed",
        ],
    ) -> None:
        self.code = code
        super().__init__(message)


def open_project_folder_in_editor(project_path: str) -> str | None:
    path = _resolve_existing_project_directory(project_path)

    override = os.environ.get("CODEX_LB_PROJECT_EDITOR_COMMAND", "").strip()
    if override:
        argv = _parse_override_command(override, env_var_name="CODEX_LB_PROJECT_EDITOR_COMMAND")
        return _launch_override_command(
            argv,
            path,
            missing_code="editor_not_found",
            missing_message_prefix="Editor command was not found in PATH",
            launch_code="editor_launch_failed",
            launch_message_prefix="Failed to launch editor for project folder",
        )

    return _launch_from_candidates(
        path,
        _default_editor_candidates(),
        not_found_code="editor_not_found",
        not_found_message="No supported editor command found in PATH (tried: code, cursor, code-insiders, codium, zed, windsurf).",
        launch_code="editor_launch_failed",
        launch_message_prefix="Failed to launch editor for project folder",
    )


def open_project_folder_in_file_manager(project_path: str) -> str | None:
    path = _resolve_existing_project_directory(project_path)

    override = os.environ.get("CODEX_LB_PROJECT_FILE_MANAGER_COMMAND", "").strip()
    if override:
        argv = _parse_override_command(override, env_var_name="CODEX_LB_PROJECT_FILE_MANAGER_COMMAND")
        return _launch_override_command(
            argv,
            path,
            missing_code="file_manager_not_found",
            missing_message_prefix="File manager command was not found in PATH",
            launch_code="file_manager_launch_failed",
            launch_message_prefix="Failed to launch file manager for project folder",
        )

    candidates = _default_file_manager_candidates()
    tried = ", ".join(dict.fromkeys(candidate[0] for candidate in candidates))
    return _launch_from_candidates(
        path,
        candidates,
        not_found_code="file_manager_not_found",
        not_found_message=f"No supported file manager command found in PATH (tried: {tried}).",
        launch_code="file_manager_launch_failed",
        launch_message_prefix="Failed to launch file manager for project folder",
    )


def _resolve_existing_project_directory(project_path: str) -> Path:
    resolved_project_path = _resolve_runtime_project_path(project_path)
    path = Path(resolved_project_path).expanduser()
    if not path.is_absolute():
        raise ProjectEditorLaunchError(
            "Project path must be absolute",
            code="invalid_project_path",
        )
    if not path.exists() or not path.is_dir():
        raise ProjectEditorLaunchError(
            "Project folder path was not found on this machine",
            code="project_path_not_found",
        )
    return path


def _parse_override_command(override: str, *, env_var_name: str) -> list[str]:
    try:
        argv = shlex.split(override)
    except ValueError as exc:
        raise ProjectEditorLaunchError(
            f"Invalid {env_var_name} value: {exc}",
            code="editor_launch_failed" if env_var_name.endswith("EDITOR_COMMAND") else "file_manager_launch_failed",
        ) from exc

    if not argv:
        raise ProjectEditorLaunchError(
            f"{env_var_name} is empty",
            code="editor_launch_failed" if env_var_name.endswith("EDITOR_COMMAND") else "file_manager_launch_failed",
        )

    return argv


def _launch_override_command(
    argv: list[str],
    path: Path,
    *,
    missing_code: Literal["editor_not_found", "file_manager_not_found"],
    missing_message_prefix: str,
    launch_code: Literal["editor_launch_failed", "file_manager_launch_failed"],
    launch_message_prefix: str,
) -> str | None:
    executable = _resolve_executable(argv[0])
    if executable is None:
        raise ProjectEditorLaunchError(
            f"{missing_message_prefix}: {argv[0]}",
            code=missing_code,
        )

    try:
        _spawn_detached([executable, *argv[1:], str(path)])
    except Exception as exc:  # pragma: no cover - platform-specific launch failures
        raise ProjectEditorLaunchError(
            f"{launch_message_prefix}. {argv[0]}: {exc}",
            code=launch_code,
        ) from exc

    return argv[0]


def _launch_from_candidates(
    path: Path,
    candidates: tuple[tuple[str, ...], ...],
    *,
    not_found_code: Literal["editor_not_found", "file_manager_not_found"],
    not_found_message: str,
    launch_code: Literal["editor_launch_failed", "file_manager_launch_failed"],
    launch_message_prefix: str,
) -> str | None:
    errors: list[str] = []
    found_any = False

    for candidate in candidates:
        executable = _resolve_executable(candidate[0])
        if executable is None:
            continue
        found_any = True
        try:
            _spawn_detached([executable, *candidate[1:], str(path)])
            return candidate[0]
        except Exception as exc:  # pragma: no cover - platform-specific launch failures
            errors.append(f"{candidate[0]}: {exc}")

    if not found_any:
        raise ProjectEditorLaunchError(not_found_message, code=not_found_code)

    detail = "; ".join(errors) if errors else "Unknown launch error"
    raise ProjectEditorLaunchError(
        f"{launch_message_prefix}. {detail}",
        code=launch_code,
    )


def _default_editor_candidates() -> tuple[tuple[str, ...], ...]:
    system = platform.system().lower()
    if system == "darwin":
        return (
            ("code", "-n"),
            ("cursor", "-n"),
            ("code-insiders", "-n"),
            ("codium", "-n"),
            ("zed",),
            ("windsurf", "-n"),
        )
    if system == "windows":
        return (
            ("code", "-n"),
            ("cursor", "-n"),
            ("code-insiders", "-n"),
            ("codium", "-n"),
            ("zed",),
            ("windsurf", "-n"),
        )
    return (
        ("code", "-n"),
        ("cursor", "-n"),
        ("code-insiders", "-n"),
        ("codium", "-n"),
        ("zed",),
        ("windsurf", "-n"),
    )


def _default_file_manager_candidates() -> tuple[tuple[str, ...], ...]:
    system = platform.system().lower()
    if system == "darwin":
        return (("open",),)
    if system == "windows":
        return (("explorer",),)
    return (
        ("xdg-open",),
        ("gio", "open"),
    )


def _resolve_executable(name: str) -> str | None:
    if not name:
        return None
    if os.path.isabs(name):
        return name if os.path.exists(name) and os.access(name, os.X_OK) else None
    return shutil.which(name)


def _resolve_runtime_project_path(project_path: str) -> str:
    normalized = project_path.strip()
    if not normalized:
        return normalized

    expanded = str(Path(normalized).expanduser()) if normalized.startswith("~") else normalized
    documents_suffix = _extract_documents_shorthand_suffix(expanded)
    if documents_suffix is None:
        return expanded

    documents_roots = _candidate_documents_roots()
    if not documents_roots:
        return expanded

    for documents_root in documents_roots:
        candidate = documents_root.joinpath(*documents_suffix) if documents_suffix else documents_root
        if candidate.exists():
            return str(candidate)

    fallback_root = documents_roots[0]
    fallback_path = fallback_root.joinpath(*documents_suffix) if documents_suffix else fallback_root
    return str(fallback_path)


def _candidate_documents_roots() -> tuple[Path, ...]:
    candidates: list[Path] = [Path.home() / "Documents"]
    home_from_env = os.environ.get("HOME", "").strip()
    if home_from_env:
        candidates.append(Path(home_from_env).expanduser() / "Documents")

    for env_key in ("SUDO_USER", "LOGNAME", "USER"):
        user = os.environ.get(env_key, "").strip()
        if not user or user.lower() == "root":
            continue
        candidates.append(Path("/home") / user / "Documents")
        candidates.append(Path("/Users") / user / "Documents")

    cwd_parts = Path.cwd().parts
    if len(cwd_parts) >= 3 and cwd_parts[1] in {"home", "Users"}:
        candidates.append(Path("/", cwd_parts[1], cwd_parts[2], "Documents"))

    deduped: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return tuple(deduped)


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


def _spawn_detached(argv: list[str]) -> None:
    subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
