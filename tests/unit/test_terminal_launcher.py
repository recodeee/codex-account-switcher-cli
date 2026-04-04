from __future__ import annotations

from pathlib import Path

import pytest

from app.modules.accounts import terminal
from app.modules.accounts.terminal import TerminalLaunchError


def test_resolve_executable_falls_back_to_known_linux_dirs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake_bin_dir = tmp_path / "bin"
    fake_bin_dir.mkdir(parents=True, exist_ok=True)
    executable = fake_bin_dir / "kgx"
    executable.write_text("#!/bin/sh\n", encoding="utf-8")
    executable.chmod(0o755)

    monkeypatch.setattr(terminal.shutil, "which", lambda _name: None)
    monkeypatch.setattr(terminal, "_LINUX_TERMINAL_SEARCH_DIRS", (str(fake_bin_dir),))

    resolved = terminal._resolve_executable("kgx")

    assert resolved == str(executable)


def test_open_linux_terminal_uses_resolved_executable(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_argv: list[list[str]] = []

    def _resolve(name: str) -> str | None:
        if name == "x-terminal-emulator":
            return "/opt/bin/x-terminal-emulator"
        return None

    monkeypatch.setattr(terminal, "_resolve_executable", _resolve)
    monkeypatch.setattr(terminal, "_spawn_detached", lambda argv: captured_argv.append(argv))

    terminal._open_linux_terminal("/bin/bash", "echo test")

    assert captured_argv == [["/opt/bin/x-terminal-emulator", "-e", "/bin/bash", "-lc", "echo test"]]


def test_open_linux_terminal_falls_back_to_desktop_entry(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_argv: list[list[str]] = []

    def _resolve(name: str) -> str | None:
        if name == "gtk-launch":
            return "/usr/bin/gtk-launch"
        return None

    monkeypatch.setattr(terminal, "_resolve_executable", _resolve)
    monkeypatch.setattr(terminal, "_spawn_detached", lambda argv: captured_argv.append(argv))

    terminal._open_linux_terminal("/bin/bash", "echo test")

    assert captured_argv == [["/usr/bin/gtk-launch", "org.gnome.Console"]]


def test_open_linux_terminal_reports_container_hint_when_no_launcher(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(terminal, "_resolve_executable", lambda _name: None)
    monkeypatch.setattr(terminal, "_is_containerized_runtime", lambda: True)

    with pytest.raises(TerminalLaunchError) as excinfo:
        terminal._open_linux_terminal("/bin/bash", "echo test")

    message = str(excinfo.value)
    assert "No supported terminal app found in PATH" in message
    assert "Detected containerized runtime" in message


def test_open_linux_terminal_uses_override_launcher(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_argv: list[list[str]] = []
    monkeypatch.setenv(
        "CODEX_LB_LINUX_TERMINAL_LAUNCHER",
        "custom-launch --shell {shell_q} --command {command_q}",
    )
    monkeypatch.setattr(
        terminal,
        "_resolve_executable",
        lambda name: "/opt/bin/custom-launch" if name == "custom-launch" else None,
    )
    monkeypatch.setattr(terminal, "_spawn_detached", lambda argv: captured_argv.append(argv))

    terminal._open_linux_terminal("/bin/bash", "echo test")

    assert captured_argv == [
        ["/opt/bin/custom-launch", "--shell", "/bin/bash", "--command", "echo test"]
    ]


def test_open_linux_terminal_uses_override_launcher_with_bridge(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_argv: list[list[str]] = []
    monkeypatch.setenv(
        "CODEX_LB_LINUX_TERMINAL_LAUNCHER",
        "x-terminal-emulator -e {shell} -lc {command_q}",
    )
    monkeypatch.setenv("CODEX_LB_LINUX_TERMINAL_BRIDGE", "flatpak-spawn --host")
    monkeypatch.setattr(
        terminal,
        "_resolve_executable",
        lambda name: "/usr/bin/flatpak-spawn" if name == "flatpak-spawn" else None,
    )
    monkeypatch.setattr(terminal, "_is_containerized_runtime", lambda: True)
    monkeypatch.setattr(terminal, "_spawn_detached", lambda argv: captured_argv.append(argv))

    terminal._open_linux_terminal("/bin/bash", "echo test")

    assert captured_argv == [
        [
            "/usr/bin/flatpak-spawn",
            "--host",
            "x-terminal-emulator",
            "-e",
            "/bin/bash",
            "-lc",
            "echo test",
        ]
    ]


def test_open_linux_terminal_uses_host_bridge_when_containerized(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_argv: list[list[str]] = []

    def _resolve(name: str) -> str | None:
        if name == "flatpak-spawn":
            return "/usr/bin/flatpak-spawn"
        return None

    monkeypatch.setattr(terminal, "_resolve_executable", _resolve)
    monkeypatch.setattr(terminal, "_is_containerized_runtime", lambda: True)
    monkeypatch.setattr(terminal, "_spawn_detached", lambda argv: captured_argv.append(argv))

    terminal._open_linux_terminal("/bin/bash", "echo test")

    assert captured_argv == [
        ["/usr/bin/flatpak-spawn", "--host", "x-terminal-emulator", "-e", "/bin/bash", "-lc", "echo test"]
    ]
