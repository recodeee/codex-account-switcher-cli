from __future__ import annotations

import asyncio
import fcntl
import json
import os
import pty
import platform
import shlex
import shutil
import signal
import struct
import subprocess
import termios
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.core.config.settings import BASE_DIR

DEFAULT_TERMINAL_COLS = 120
DEFAULT_TERMINAL_ROWS = 36
_DEFAULT_CHUNK_SIZE = 4096
_LINUX_TERMINAL_SEARCH_DIRS: tuple[str, ...] = (
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/local/sbin",
    "/usr/sbin",
    "/sbin",
    "/snap/bin",
    "/var/lib/flatpak/exports/bin",
)
_LINUX_DESKTOP_ENTRY_FALLBACKS: tuple[str, ...] = (
    "org.gnome.Console",
    "org.gnome.Terminal",
    "org.kde.konsole",
    "xfce4-terminal",
)
_CONTAINER_HOST_TERMINAL_BRIDGES: tuple[tuple[str, ...], ...] = (
    ("flatpak-spawn", "--host"),
    ("distrobox-host-exec",),
    ("host-spawn",),
)


@dataclass(slots=True)
class TerminalLaunchConfig:
    command: str
    cwd: Path
    shell: str


class TerminalLaunchError(RuntimeError):
    """Raised when terminal launch cannot proceed."""


def resolve_terminal_launch_config() -> TerminalLaunchConfig:
    raw_command = os.environ.get("CODEX_LB_TERMINAL_COMMAND", "codex").strip()
    if not raw_command:
        raise TerminalLaunchError("Terminal command is empty. Set CODEX_LB_TERMINAL_COMMAND.")

    raw_cwd = os.environ.get("CODEX_LB_TERMINAL_CWD", "").strip()
    cwd = Path(raw_cwd).expanduser() if raw_cwd else BASE_DIR

    shell = os.environ.get("SHELL", "/bin/bash").strip() or "/bin/bash"
    return TerminalLaunchConfig(command=raw_command, cwd=cwd, shell=shell)


def _build_startup_input(*, cwd: Path, command: str) -> str:
    return f"cd {shlex.quote(str(cwd))}\n{command}\n"


def open_host_terminal(*, snapshot_name: str) -> TerminalLaunchConfig:
    launch = resolve_terminal_launch_config()
    system = platform.system().lower()
    if not launch.cwd.is_dir():
        # When running in a containerized runtime, host-terminal launch can still work via
        # bridge commands (for example flatpak-spawn --host) even if the cwd is not visible
        # inside the container filesystem.
        if not (system == "linux" and _is_containerized_runtime()):
            raise TerminalLaunchError(f"Terminal working directory does not exist: {launch.cwd}")

    command = f"cd {shlex.quote(str(launch.cwd))} && {launch.command}"
    if system == "darwin":
        _open_macos_terminal(command)
        return launch
    if system == "windows":
        _open_windows_terminal(command)
        return launch
    if system == "linux":
        _open_linux_terminal(launch.shell, command)
        return launch

    raise TerminalLaunchError(
        f"Opening host terminal is not supported on this OS ({platform.system()})."
    )


def _spawn_detached(argv: list[str]) -> None:
    subprocess.Popen(
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )


def _open_linux_terminal(shell: str, command: str) -> None:
    is_containerized = _is_containerized_runtime()
    if _open_linux_terminal_with_override(
        shell=shell,
        command=command,
        is_containerized=is_containerized,
    ):
        return

    candidates: list[list[str]] = [
        ["x-terminal-emulator", "-e", shell, "-lc", command],
        ["gnome-terminal", "--", shell, "-lc", command],
        ["gnome-terminal.wrapper", "--", shell, "-lc", command],
        ["kgx", "--", shell, "-lc", command],
        ["gnome-console", "--", shell, "-lc", command],
        ["ptyxis", "--", shell, "-lc", command],
        ["xfce4-terminal", "-e", f"{shell} -lc {shlex.quote(command)}"],
        ["tilix", "-e", f"{shell} -lc {shlex.quote(command)}"],
        ["konsole", "-e", shell, "-lc", command],
        ["mate-terminal", "-e", f"{shell} -lc {shlex.quote(command)}"],
        ["terminator", "-x", shell, "-lc", command],
        ["lxterminal", "-e", f"{shell} -lc {shlex.quote(command)}"],
        ["qterminal", "-e", f"{shell} -lc {shlex.quote(command)}"],
        ["alacritty", "-e", shell, "-lc", command],
        ["kitty", shell, "-lc", command],
        ["wezterm", "start", "--", shell, "-lc", command],
        ["foot", shell, "-lc", command],
        ["footclient", shell, "-lc", command],
        ["xterm", "-e", shell, "-lc", command],
    ]

    errors: list[str] = []
    for argv in candidates:
        executable = _resolve_executable(argv[0])
        if executable is None:
            continue
        launch_argv = [executable, *argv[1:]]
        try:
            _spawn_detached(launch_argv)
            return
        except Exception as exc:  # pragma: no cover - platform specific
            errors.append(f"{argv[0]}: {exc}")

    gtk_launch = _resolve_executable("gtk-launch")
    if gtk_launch is not None:
        for desktop_entry in _LINUX_DESKTOP_ENTRY_FALLBACKS:
            try:
                _spawn_detached([gtk_launch, desktop_entry])
                return
            except Exception as exc:  # pragma: no cover - platform specific
                errors.append(f"gtk-launch {desktop_entry}: {exc}")

    bridge_prefixes = _linux_host_bridge_prefixes()
    if bridge_prefixes and is_containerized:
        for prefix in bridge_prefixes:
            for argv in candidates:
                try:
                    _spawn_detached([*prefix, *argv])
                    return
                except Exception as exc:  # pragma: no cover - platform specific
                    errors.append(f"{' '.join(prefix)} {' '.join(argv)}: {exc}")

        for prefix in bridge_prefixes:
            for desktop_entry in _LINUX_DESKTOP_ENTRY_FALLBACKS:
                try:
                    _spawn_detached([*prefix, "gtk-launch", desktop_entry])
                    return
                except Exception as exc:  # pragma: no cover - platform specific
                    errors.append(f"{' '.join(prefix)} gtk-launch {desktop_entry}: {exc}")

    detail = "; ".join(errors) if errors else "No supported terminal app found in PATH."
    if is_containerized:
        bridge_hint = _linux_bridge_missing_hint()
        if bridge_hint:
            detail += f" {bridge_hint}"
        detail += (
            " Detected containerized runtime; host terminal apps may be unavailable in this environment."
            " Set CODEX_LB_LINUX_TERMINAL_LAUNCHER or CODEX_LB_LINUX_TERMINAL_BRIDGE to a host-aware launcher."
        )
    raise TerminalLaunchError(f"Failed to open host terminal. {detail}")


def _resolve_executable(name: str) -> str | None:
    if not name:
        return None
    if os.path.isabs(name):
        return name if os.path.exists(name) and os.access(name, os.X_OK) else None

    resolved = shutil.which(name)
    if resolved:
        return resolved

    home_local_bin = str(Path.home() / ".local" / "bin")
    for directory in (*_LINUX_TERMINAL_SEARCH_DIRS, home_local_bin):
        candidate = Path(directory) / name
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def _is_containerized_runtime() -> bool:
    if Path("/.dockerenv").exists():
        return True
    container_hint = os.environ.get("container", "").strip().lower()
    return bool(container_hint and container_hint != "0")


def _open_linux_terminal_with_override(
    *,
    shell: str,
    command: str,
    is_containerized: bool,
) -> bool:
    template = os.environ.get("CODEX_LB_LINUX_TERMINAL_LAUNCHER", "").strip()
    if not template:
        return False

    try:
        formatted = template.format(
            shell=shell,
            shell_q=shlex.quote(shell),
            command=command,
            command_q=shlex.quote(command),
        )
    except Exception as exc:
        raise TerminalLaunchError(f"Invalid CODEX_LB_LINUX_TERMINAL_LAUNCHER template: {exc}") from exc

    try:
        argv = shlex.split(formatted)
    except ValueError as exc:
        raise TerminalLaunchError(f"Invalid CODEX_LB_LINUX_TERMINAL_LAUNCHER value: {exc}") from exc
    if not argv:
        raise TerminalLaunchError("CODEX_LB_LINUX_TERMINAL_LAUNCHER produced an empty command.")

    errors: list[str] = []
    executable = _resolve_executable(argv[0])
    if executable is not None:
        try:
            _spawn_detached([executable, *argv[1:]])
            return True
        except Exception as exc:  # pragma: no cover - platform specific
            errors.append(f"{argv[0]}: {exc}")

    bridge_prefixes = _linux_host_bridge_prefixes()
    if bridge_prefixes and is_containerized:
        for prefix in bridge_prefixes:
            try:
                _spawn_detached([*prefix, *argv])
                return True
            except Exception as exc:  # pragma: no cover - platform specific
                errors.append(f"{' '.join(prefix)} {' '.join(argv)}: {exc}")

    if executable is None and not errors:
        raise TerminalLaunchError(
            f"CODEX_LB_LINUX_TERMINAL_LAUNCHER executable was not found in PATH: {argv[0]}"
        )

    detail = "; ".join(errors) if errors else "No launch attempts were made."
    raise TerminalLaunchError(f"Failed to launch terminal via override: {detail}")


def _linux_host_bridge_prefixes() -> list[list[str]]:
    prefixes: list[list[str]] = []

    explicit_bridge = os.environ.get("CODEX_LB_LINUX_TERMINAL_BRIDGE", "").strip()
    if explicit_bridge:
        try:
            parts = shlex.split(explicit_bridge)
        except ValueError:
            parts = []
        if parts:
            executable = _resolve_executable(parts[0])
            if executable is not None:
                prefixes.append([executable, *parts[1:]])

    for bridge in _CONTAINER_HOST_TERMINAL_BRIDGES:
        executable = _resolve_executable(bridge[0])
        if executable is None:
            continue
        prefixes.append([executable, *bridge[1:]])

    return prefixes


def _linux_bridge_missing_hint() -> str:
    explicit_bridge = os.environ.get("CODEX_LB_LINUX_TERMINAL_BRIDGE", "").strip()
    if not explicit_bridge:
        return ""

    try:
        parts = shlex.split(explicit_bridge)
    except ValueError:
        return "Configured CODEX_LB_LINUX_TERMINAL_BRIDGE has invalid shell syntax."
    if not parts:
        return "Configured CODEX_LB_LINUX_TERMINAL_BRIDGE is empty after parsing."

    if _resolve_executable(parts[0]) is None:
        return f"Configured CODEX_LB_LINUX_TERMINAL_BRIDGE executable not found in PATH: {parts[0]}."
    return ""


def _open_macos_terminal(command: str) -> None:
    script = f'tell application "Terminal" to do script {json.dumps(command)}'
    try:
        _spawn_detached(["osascript", "-e", script, "-e", 'activate application "Terminal"'])
    except Exception as exc:  # pragma: no cover - platform specific
        raise TerminalLaunchError(f"Failed to open macOS Terminal: {exc}") from exc


def _open_windows_terminal(command: str) -> None:
    wt_path = shutil.which("wt")
    try:
        if wt_path:
            _spawn_detached([wt_path, "new-tab", "cmd", "/k", command])
            return

        _spawn_detached(["cmd", "/c", "start", "", "cmd", "/k", command])
    except Exception as exc:  # pragma: no cover - platform specific
        raise TerminalLaunchError(f"Failed to open Windows terminal: {exc}") from exc


@dataclass(slots=True)
class TerminalProcess:
    process: subprocess.Popen[bytes]
    master_fd: int

    @classmethod
    def start(cls, *, snapshot_name: str) -> tuple["TerminalProcess", TerminalLaunchConfig]:
        launch = resolve_terminal_launch_config()
        if not launch.cwd.is_dir():
            raise TerminalLaunchError(f"Terminal working directory does not exist: {launch.cwd}")

        argv = [launch.shell, "-il"]

        master_fd, slave_fd = pty.openpty()
        env = os.environ.copy()
        env.setdefault("TERM", "xterm-256color")
        env["CODEX_AUTH_ACTIVE_SNAPSHOT"] = snapshot_name

        try:
            process = subprocess.Popen(
                argv,
                stdin=slave_fd,
                stdout=slave_fd,
                stderr=slave_fd,
                env=env,
                start_new_session=True,
                close_fds=True,
            )
        except Exception as exc:  # pragma: no cover - exercised via caller behavior
            os.close(master_fd)
            os.close(slave_fd)
            raise TerminalLaunchError(f"Failed to launch terminal: {exc}") from exc
        finally:
            os.close(slave_fd)

        terminal_process = cls(process=process, master_fd=master_fd)
        terminal_process.resize(cols=DEFAULT_TERMINAL_COLS, rows=DEFAULT_TERMINAL_ROWS)
        terminal_process.write(_build_startup_input(cwd=launch.cwd, command=launch.command))
        return terminal_process, launch

    def write(self, data: str) -> None:
        if data:
            os.write(self.master_fd, data.encode("utf-8", errors="ignore"))

    def resize(self, *, cols: int, rows: int) -> None:
        packed = struct.pack("HHHH", max(rows, 1), max(cols, 1), 0, 0)
        fcntl.ioctl(self.master_fd, termios.TIOCSWINSZ, packed)

    async def read_chunk(self) -> bytes:
        return await asyncio.to_thread(os.read, self.master_fd, _DEFAULT_CHUNK_SIZE)

    async def wait(self) -> int:
        return await asyncio.to_thread(self.process.wait)

    async def terminate(self) -> None:
        if self.process.poll() is None:
            try:
                if hasattr(os, "killpg"):
                    os.killpg(self.process.pid, signal.SIGTERM)
                else:  # pragma: no cover - Windows fallback
                    self.process.terminate()
            except ProcessLookupError:
                pass
            try:
                await asyncio.to_thread(self.process.wait, 1)
            except subprocess.TimeoutExpired:
                if self.process.poll() is None:
                    try:
                        if hasattr(os, "killpg"):
                            os.killpg(self.process.pid, signal.SIGKILL)
                        else:  # pragma: no cover - Windows fallback
                            self.process.kill()
                    except ProcessLookupError:
                        pass
                    await asyncio.to_thread(self.process.wait)

        try:
            os.close(self.master_fd)
        except OSError:
            pass


async def stream_terminal_session(
    *,
    websocket: WebSocket,
    terminal_process: TerminalProcess,
    launch: TerminalLaunchConfig,
    account_id: str,
    snapshot_name: str,
) -> None:
    await _safe_send(
        websocket,
        {
            "type": "ready",
            "accountId": account_id,
            "snapshotName": snapshot_name,
            "cwd": str(launch.cwd),
            "command": launch.command,
        },
    )

    output_task = asyncio.create_task(_relay_terminal_output(websocket, terminal_process))
    exit_task = asyncio.create_task(_relay_terminal_exit(websocket, terminal_process))

    try:
        while True:
            if exit_task.done():
                break

            try:
                payload = await asyncio.wait_for(websocket.receive_text(), timeout=0.2)
            except TimeoutError:
                continue
            except WebSocketDisconnect:
                break

            _handle_client_message(payload, terminal_process)
    finally:
        await terminal_process.terminate()
        output_task.cancel()
        exit_task.cancel()
        await asyncio.gather(output_task, exit_task, return_exceptions=True)

        if websocket.application_state == WebSocketState.CONNECTED:
            await websocket.close(code=1000)


def _handle_client_message(payload: str, terminal_process: TerminalProcess) -> None:
    try:
        message = json.loads(payload)
    except json.JSONDecodeError:
        return

    if not isinstance(message, dict):
        return

    message_type = message.get("type")
    if message_type == "input":
        data = message.get("data")
        if isinstance(data, str):
            terminal_process.write(data)
        return

    if message_type == "resize":
        cols = _coerce_positive_int(message.get("cols"), DEFAULT_TERMINAL_COLS)
        rows = _coerce_positive_int(message.get("rows"), DEFAULT_TERMINAL_ROWS)
        terminal_process.resize(cols=cols, rows=rows)


async def _relay_terminal_output(websocket: WebSocket, terminal_process: TerminalProcess) -> None:
    while True:
        try:
            chunk = await terminal_process.read_chunk()
        except OSError:
            break
        if not chunk:
            break

        text = chunk.decode("utf-8", errors="replace")
        await _safe_send(websocket, {"type": "output", "data": text})


async def _relay_terminal_exit(websocket: WebSocket, terminal_process: TerminalProcess) -> None:
    code = await terminal_process.wait()
    await _safe_send(websocket, {"type": "exit", "code": code})


async def _safe_send(websocket: WebSocket, payload: dict[str, Any]) -> None:
    if websocket.application_state != WebSocketState.CONNECTED:
        return
    try:
        await websocket.send_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    except RuntimeError:
        return


def _coerce_positive_int(value: object, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return max(value, 1)
    if isinstance(value, float):
        return max(int(value), 1)
    return default
