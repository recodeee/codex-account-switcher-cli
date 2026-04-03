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
    if not launch.cwd.is_dir():
        raise TerminalLaunchError(f"Terminal working directory does not exist: {launch.cwd}")

    command = f"cd {shlex.quote(str(launch.cwd))} && {launch.command}"
    system = platform.system().lower()
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
    candidates: list[list[str]] = [
        ["x-terminal-emulator", "-e", shell, "-lc", command],
        ["gnome-terminal", "--", shell, "-lc", command],
        ["konsole", "-e", shell, "-lc", command],
        ["alacritty", "-e", shell, "-lc", command],
        ["kitty", shell, "-lc", command],
        ["wezterm", "start", "--", shell, "-lc", command],
        ["xterm", "-e", shell, "-lc", command],
    ]

    errors: list[str] = []
    for argv in candidates:
        if shutil.which(argv[0]) is None:
            continue
        try:
            _spawn_detached(argv)
            return
        except Exception as exc:  # pragma: no cover - platform specific
            errors.append(f"{argv[0]}: {exc}")

    detail = "; ".join(errors) if errors else "No supported terminal app found in PATH."
    raise TerminalLaunchError(f"Failed to open host terminal. {detail}")


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
