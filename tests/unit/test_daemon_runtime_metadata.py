from __future__ import annotations

import subprocess

import pytest

from app.modules.accounts import daemon_runtime_metadata


@pytest.fixture(autouse=True)
def _reset_cache() -> None:
    daemon_runtime_metadata.reset_daemon_runtime_metadata_cache()
    yield
    daemon_runtime_metadata.reset_daemon_runtime_metadata_cache()


def test_build_daemon_runtime_metadata_uses_multica_profile_and_update_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MULTICA_PROFILE", "staging")
    monkeypatch.setenv("MULTICA_LATEST_CLI_VERSION", "1.5.0")
    monkeypatch.setattr(daemon_runtime_metadata.platform, "node", lambda: "devbox")

    def _which(binary: str) -> str | None:
        if binary == "multica":
            return "/usr/local/bin/multica"
        if binary == "brew":
            return "/usr/local/bin/brew"
        return None

    monkeypatch.setattr(daemon_runtime_metadata.shutil, "which", _which)

    def _run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=["multica", "--version"],
            returncode=0,
            stdout="multica 1.4.0\n",
            stderr="",
        )

    monkeypatch.setattr(daemon_runtime_metadata.subprocess, "run", _run)

    metadata = daemon_runtime_metadata._build_daemon_runtime_metadata()

    assert metadata.daemon_id == "devbox-staging"
    assert metadata.device == "devbox"
    assert metadata.runtime_mode == "local"
    assert metadata.cli_version == "1.4.0"
    assert metadata.latest_cli_version == "1.5.0"
    assert metadata.cli_update_available is True
    assert metadata.cli_update_command == "multica update"


def test_build_daemon_runtime_metadata_prefers_brew_upgrade_for_brew_multica(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(daemon_runtime_metadata.platform, "node", lambda: "devbox")

    def _which(binary: str) -> str | None:
        if binary == "multica":
            return "/opt/homebrew/Cellar/multica/1.4.0/bin/multica"
        if binary == "brew":
            return "/opt/homebrew/bin/brew"
        return None

    monkeypatch.setattr(daemon_runtime_metadata.shutil, "which", _which)

    def _run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=["multica", "--version"],
            returncode=0,
            stdout="multica version 1.4.0",
            stderr="",
        )

    monkeypatch.setattr(daemon_runtime_metadata.subprocess, "run", _run)

    metadata = daemon_runtime_metadata._build_daemon_runtime_metadata()

    assert metadata.cli_version == "1.4.0"
    assert metadata.cli_update_command == "brew upgrade multica-ai/tap/multica"


def test_build_daemon_runtime_metadata_falls_back_to_codex_when_multica_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(daemon_runtime_metadata.platform, "node", lambda: "devbox")

    def _which(binary: str) -> str | None:
        if binary == "codex":
            return "/usr/bin/codex"
        return None

    monkeypatch.setattr(daemon_runtime_metadata.shutil, "which", _which)

    def _run(*_args, **_kwargs):
        return subprocess.CompletedProcess(
            args=["codex", "--version"],
            returncode=0,
            stdout="codex 0.52.0",
            stderr="",
        )

    monkeypatch.setattr(daemon_runtime_metadata.subprocess, "run", _run)

    metadata = daemon_runtime_metadata._build_daemon_runtime_metadata()

    assert metadata.cli_version == "0.52.0"
    assert metadata.cli_update_command == "npm install -g @openai/codex@latest"
    assert metadata.cli_update_available is False
