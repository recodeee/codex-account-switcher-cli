from __future__ import annotations

import os
import platform
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from typing import Literal

_VERSION_RE = re.compile(r"\bv?(\d+\.\d+\.\d+)\b")
_CACHE_TTL_SECONDS = 15.0


@dataclass(frozen=True)
class DaemonRuntimeMetadata:
    runtime_mode: Literal["local", "cloud"] = "local"
    daemon_id: str | None = None
    device: str | None = None
    cli_version: str | None = None
    latest_cli_version: str | None = None
    cli_update_available: bool = False
    cli_update_command: str | None = None


_cache_lock = threading.Lock()
_cached_metadata: DaemonRuntimeMetadata | None = None
_cached_at_monotonic = 0.0


def read_daemon_runtime_metadata() -> DaemonRuntimeMetadata:
    global _cached_metadata, _cached_at_monotonic

    now = time.monotonic()
    with _cache_lock:
        if _cached_metadata is not None and (now - _cached_at_monotonic) < _CACHE_TTL_SECONDS:
            return _cached_metadata

        metadata = _build_daemon_runtime_metadata()
        _cached_metadata = metadata
        _cached_at_monotonic = now
        return metadata


def reset_daemon_runtime_metadata_cache() -> None:
    global _cached_metadata, _cached_at_monotonic
    with _cache_lock:
        _cached_metadata = None
        _cached_at_monotonic = 0.0


def _build_daemon_runtime_metadata() -> DaemonRuntimeMetadata:
    host = _resolve_host_name()
    profile = _first_non_empty_env(
        "MULTICA_PROFILE",
        "CODEX_LB_DAEMON_PROFILE",
    )

    daemon_id = _first_non_empty_env(
        "MULTICA_DAEMON_ID",
        "CODEX_LB_DAEMON_ID",
    ) or host
    if profile and not daemon_id.endswith(f"-{profile}"):
        daemon_id = f"{daemon_id}-{profile}"

    device = _first_non_empty_env(
        "MULTICA_DAEMON_DEVICE_NAME",
        "CODEX_LB_DAEMON_DEVICE_NAME",
    ) or host

    runtime_mode = _resolve_runtime_mode()
    cli_name, cli_path = _resolve_cli_binary()
    cli_version = _detect_cli_version(cli_name=cli_name, cli_path=cli_path)
    latest_cli_version = _normalize_version(
        _first_non_empty_env(
            "MULTICA_LATEST_CLI_VERSION",
            "CODEX_LB_DAEMON_CLI_LATEST_VERSION",
            "CODEX_LB_RUNTIME_CLI_LATEST_VERSION",
        )
    )
    cli_update_available = _resolve_cli_update_available(
        current_version=cli_version,
        latest_version=latest_cli_version,
    )
    cli_update_command = _resolve_cli_update_command(
        cli_name=cli_name,
        cli_path=cli_path,
    )

    return DaemonRuntimeMetadata(
        runtime_mode=runtime_mode,
        daemon_id=daemon_id,
        device=device,
        cli_version=cli_version,
        latest_cli_version=latest_cli_version,
        cli_update_available=cli_update_available,
        cli_update_command=cli_update_command,
    )


def _first_non_empty_env(*keys: str) -> str | None:
    for key in keys:
        value = os.environ.get(key, "").strip()
        if value:
            return value
    return None


def _resolve_host_name() -> str:
    host = platform.node().strip()
    return host or "local-machine"


def _resolve_runtime_mode() -> Literal["local", "cloud"]:
    raw_mode = _first_non_empty_env(
        "MULTICA_RUNTIME_MODE",
        "CODEX_LB_RUNTIME_MODE",
    )
    if raw_mode is None:
        return "local"
    mode = raw_mode.strip().lower()
    if mode == "cloud":
        return "cloud"
    if mode == "local":
        return "local"
    return "local"


def _resolve_cli_binary() -> tuple[str | None, str | None]:
    multica_candidate = _first_non_empty_env("MULTICA_CLI_PATH") or "multica"
    multica_path = shutil.which(multica_candidate)
    if multica_path:
        return "multica", multica_path

    codex_candidate = _first_non_empty_env(
        "MULTICA_CODEX_PATH",
        "CODEX_CLI_PATH",
    ) or "codex"
    codex_path = shutil.which(codex_candidate)
    if codex_path:
        return "codex", codex_path

    return None, None


def _detect_cli_version(*, cli_name: str | None, cli_path: str | None) -> str | None:
    if not cli_name or not cli_path:
        return None

    commands: list[list[str]] = [[cli_path, "--version"]]
    if cli_name == "multica":
        commands.append([cli_path, "version"])

    for command in commands:
        version = _run_version_command(command)
        if version is not None:
            return version
    return None


def _run_version_command(command: list[str]) -> str | None:
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None

    output = " ".join([completed.stdout or "", completed.stderr or ""]).strip()
    if not output:
        return None
    return _normalize_version(output)


def _normalize_version(raw: str | None) -> str | None:
    if raw is None:
        return None
    match = _VERSION_RE.search(raw.strip())
    if match is None:
        return None
    return match.group(1)


def _resolve_cli_update_command(*, cli_name: str | None, cli_path: str | None) -> str | None:
    explicit = _first_non_empty_env(
        "CODEX_LB_DAEMON_CLI_UPDATE_COMMAND",
        "CODEX_LB_RUNTIME_CLI_UPDATE_COMMAND",
    )
    if explicit:
        return explicit

    if cli_name == "multica":
        brew_path = shutil.which("brew")
        if brew_path and _looks_like_brew_managed_binary(cli_path):
            return "brew upgrade multica-ai/tap/multica"
        return "multica update"

    if cli_name == "codex":
        return "npm install -g @openai/codex@latest"

    return None


def _looks_like_brew_managed_binary(path: str | None) -> bool:
    if not path:
        return False
    lower = path.lower()
    return "/cellar/" in lower or "/homebrew/" in lower


def _resolve_cli_update_available(
    *,
    current_version: str | None,
    latest_version: str | None,
) -> bool:
    override = _parse_bool(
        _first_non_empty_env(
            "CODEX_LB_DAEMON_CLI_UPDATE_AVAILABLE",
            "CODEX_LB_RUNTIME_CLI_UPDATE_AVAILABLE",
        )
    )
    if override is not None:
        return override

    if not current_version or not latest_version:
        return False
    return _is_newer_version(latest_version=latest_version, current_version=current_version)


def _parse_bool(raw: str | None) -> bool | None:
    if raw is None:
        return None
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return None


def _is_newer_version(*, latest_version: str, current_version: str) -> bool:
    latest_parts = _version_parts(latest_version)
    current_parts = _version_parts(current_version)
    if latest_parts is None or current_parts is None:
        return False
    return latest_parts > current_parts


def _version_parts(value: str) -> tuple[int, int, int] | None:
    normalized = _normalize_version(value)
    if normalized is None:
        return None
    parts = normalized.split(".")
    if len(parts) != 3:
        return None
    try:
        return int(parts[0]), int(parts[1]), int(parts[2])
    except ValueError:
        return None
