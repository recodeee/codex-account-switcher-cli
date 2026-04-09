from __future__ import annotations

import os
import shutil
import socket
import stat
import subprocess
import time
from pathlib import Path

import pytest

pytestmark = pytest.mark.unit

REPO_ROOT = Path(__file__).resolve().parents[2]
DEV_ALL_SCRIPT = REPO_ROOT / "scripts" / "dev-all.sh"
DEV_LOGS_SCRIPT = REPO_ROOT / "scripts" / "dev-logs.sh"


def _write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _write_rust_runtime_dev_stub(project: Path) -> None:
    _write_executable(
        project / "scripts" / "run-rust-runtime-dev.sh",
        """#!/bin/sh
set -eu
bind="${RUST_RUNTIME_BIND:-127.0.0.1:8099}"
port="${bind##*:}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )


def _read_until(process: subprocess.Popen[str], needle: str, timeout: float = 20.0) -> str:
    deadline = time.time() + timeout
    chunks: list[str] = []
    assert process.stdout is not None

    while time.time() < deadline:
        line = process.stdout.readline()
        if not line:
            if process.poll() is not None:
                raise AssertionError(
                    f"process exited early with {process.returncode}\nOutput:\n{''.join(chunks)}"
                )
            time.sleep(0.05)
            continue
        chunks.append(line)
        if needle in line:
            return "".join(chunks)

    raise AssertionError(f"timed out waiting for {needle!r}\nOutput so far:\n{''.join(chunks)}")


def _wait_for_listening_port(port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.settimeout(0.2)
            if sock.connect_ex(("127.0.0.1", port)) == 0:
                return
        time.sleep(0.05)

    raise AssertionError(f"timed out waiting for port {port} to start listening")


def _start_health_stub(port: int, cwd: Path) -> subprocess.Popen[str]:
    return subprocess.Popen(
        [
            "python3",
            "-c",
            (
                "from http.server import BaseHTTPRequestHandler, HTTPServer\n"
                "class Handler(BaseHTTPRequestHandler):\n"
                "    def do_GET(self):\n"
                "        if self.path == '/health':\n"
                "            body = b'{\"status\":\"ok\"}'\n"
                "            self.send_response(200)\n"
                "            self.send_header('Content-Type', 'application/json')\n"
                "            self.send_header('Content-Length', str(len(body)))\n"
                "            self.end_headers()\n"
                "            self.wfile.write(body)\n"
                "            return\n"
                "        self.send_response(404)\n"
                "        self.end_headers()\n"
                "    def log_message(self, *args):\n"
                "        return\n"
                f"HTTPServer(('127.0.0.1', {port}), Handler).serve_forever()\n"
            ),
        ],
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )


def test_dev_logs_watch_streams_requested_target(tmp_path: Path) -> None:
    log_dir = tmp_path / "logs"
    log_dir.mkdir()
    frontend_log = log_dir / "frontend.log"
    frontend_log.write_text("first line\n", encoding="utf-8")

    env = os.environ.copy()
    env["DEV_LOG_DIR"] = str(log_dir)
    proc = subprocess.Popen(
        ["bash", str(DEV_LOGS_SCRIPT), "-watch", "frontend"],
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        initial_output = _read_until(proc, "first line")
        assert "frontend ->" in initial_output

        with frontend_log.open("a", encoding="utf-8") as handle:
            handle.write("second line\n")
        watched_output = _read_until(proc, "second line")
        assert "second line" in watched_output
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_dev_all_reports_urls_without_streaming_service_noise(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "apps" / "backend").mkdir(parents=True)
    (project / "apps" / "frontend" / "scripts").mkdir(parents=True)
    (project / "logs").mkdir()
    (project / "apps" / "backend" / ".medusa").mkdir(parents=True)

    shutil.copy2(DEV_ALL_SCRIPT, project / "scripts" / "dev-all.sh")

    _write_executable(
        project / "scripts" / "run-server-dev.sh",
        """#!/bin/sh
set -eu
port="${APP_BACKEND_PORT:-2455}"
echo "APP NOISY LINE"
echo "[stub] App URL -> http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )
    _write_rust_runtime_dev_stub(project)
    _write_rust_runtime_dev_stub(project)

    _write_executable(
        project / "apps" / "backend" / "dev-stub.sh",
        """#!/usr/bin/env bash
set -euo pipefail
port="${MEDUSA_PORT:-9000}"
echo "BACKEND NOISY LINE"
echo "info:    Admin URL → http://localhost:${port}/app"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    _write_executable(
        project / "apps" / "frontend" / "scripts" / "run-frontend-dev.sh",
        """#!/bin/sh
set -eu
port="${NEXT_DEV_PORT:-5174}"
echo "FRONTEND NOISY LINE"
echo "[codex-lb] Frontend dev server: http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    stubs = project / "stubs"
    stubs.mkdir()
    _write_executable(
        stubs / "bun",
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "run" && "${{2:-}}" == "dev" && "$PWD" == "{project / 'apps' / 'backend'}" ]]; then
  shift 2
  exec bash ./dev-stub.sh "$@"
fi
echo "unsupported bun invocation: $*" >&2
exit 1
""",
    )

    env = os.environ.copy()
    env["PATH"] = f"{stubs}:{env['PATH']}"
    env["APP_BACKEND_PORT"] = "32455"
    env["MEDUSA_BACKEND_PORT"] = "39000"
    env["FRONTEND_PORT"] = "35174"
    env["RUST_RUNTIME_PORT"] = "38090"

    proc = subprocess.Popen(
        ["bash", "./scripts/dev-all.sh"],
        cwd=project,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        output = _read_until(proc, "[dev] Ready")
        output += _read_until(proc, "bun run logs -watch frontend")

        assert "http://localhost:32455" in output
        assert "http://localhost:39000/app" in output
        assert "http://localhost:35174" in output
        assert "runtime  http://localhost:32455 (python)" in output
        assert "bun run logs -watch rust" not in output
        assert "APP NOISY LINE" not in output
        assert "BACKEND NOISY LINE" not in output
        assert "FRONTEND NOISY LINE" not in output

        assert "APP NOISY LINE" in (project / "logs" / "server.log").read_text(encoding="utf-8")
        assert "BACKEND NOISY LINE" in (project / "logs" / "backend.log").read_text(encoding="utf-8")
        assert "FRONTEND NOISY LINE" in (project / "logs" / "frontend.log").read_text(encoding="utf-8")
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_dev_all_forwards_app_backend_port_to_rust_runtime(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "apps" / "backend").mkdir(parents=True)
    (project / "apps" / "frontend" / "scripts").mkdir(parents=True)
    (project / "logs").mkdir()
    (project / "apps" / "backend" / ".medusa").mkdir(parents=True)

    shutil.copy2(DEV_ALL_SCRIPT, project / "scripts" / "dev-all.sh")

    _write_executable(
        project / "scripts" / "run-server-dev.sh",
        """#!/bin/sh
set -eu
port="${APP_BACKEND_PORT:-2455}"
echo "[stub] App URL -> http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )
    _write_rust_runtime_dev_stub(project)

    _write_executable(
        project / "scripts" / "run-rust-runtime-dev.sh",
        """#!/bin/sh
set -eu
bind="${RUST_RUNTIME_BIND:-127.0.0.1:8099}"
port="${bind##*:}"
echo "RUST APP PORT ${APP_BACKEND_PORT:-missing}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    _write_executable(
        project / "apps" / "backend" / "dev-stub.sh",
        """#!/usr/bin/env bash
set -euo pipefail
port="${MEDUSA_PORT:-9000}"
echo "info:    Admin URL → http://localhost:${port}/app"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    _write_executable(
        project / "apps" / "frontend" / "scripts" / "run-frontend-dev.sh",
        """#!/bin/sh
set -eu
port="${NEXT_DEV_PORT:-5174}"
echo "[codex-lb] Frontend dev server: http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    stubs = project / "stubs"
    stubs.mkdir()
    _write_executable(
        stubs / "bun",
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "run" && "${{2:-}}" == "dev" && "$PWD" == "{project / 'apps' / 'backend'}" ]]; then
  shift 2
  exec bash ./dev-stub.sh "$@"
fi
echo "unsupported bun invocation: $*" >&2
exit 1
""",
    )
    _write_executable(
        stubs / "cargo",
        """#!/usr/bin/env bash
set -euo pipefail
echo "cargo stub"
""",
    )

    env = os.environ.copy()
    env["PATH"] = f"{stubs}:{env['PATH']}"
    env["APP_BACKEND_PORT"] = "32465"
    env["MEDUSA_BACKEND_PORT"] = "39065"
    env["FRONTEND_PORT"] = "35165"
    env["RUST_RUNTIME_PORT"] = "38099"
    env["RUNTIME_LAYER"] = "rust"

    proc = subprocess.Popen(
        ["bash", "./scripts/dev-all.sh"],
        cwd=project,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        output = _read_until(proc, "[dev] Ready")
        output += _read_until(proc, "bun run logs -watch frontend")
        assert "runtime  http://localhost:38099 (rust)" in output
        assert "bun run logs -watch rust" in output
        rust_log = (project / "logs" / "rust-runtime.log").read_text(encoding="utf-8")
        assert "RUST APP PORT 32465" in rust_log
    finally:
        proc.terminate()
        proc.wait(timeout=5)


def test_dev_all_uses_actual_backend_port_after_launcher_fallback(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "apps" / "backend").mkdir(parents=True)
    (project / "apps" / "frontend" / "scripts").mkdir(parents=True)
    (project / "logs").mkdir()
    (project / "apps" / "backend" / ".medusa").mkdir(parents=True)

    shutil.copy2(DEV_ALL_SCRIPT, project / "scripts" / "dev-all.sh")

    _write_executable(
        project / "scripts" / "run-server-dev.sh",
        """#!/bin/sh
set -eu
port="${APP_BACKEND_PORT:-2455}"
echo "[stub] App URL -> http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )
    _write_rust_runtime_dev_stub(project)

    _write_executable(
        project / "apps" / "backend" / "dev-stub.sh",
        """#!/usr/bin/env bash
set -euo pipefail
preferred="${MEDUSA_PORT:-9000}"
fallback="$((preferred + 1))"
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
cat > "${project_root}/.dev-ports.json" <<EOF
{
  "backend": ${fallback},
  "updatedAt": "2026-04-08T13:02:04.850Z"
}
EOF
echo "[backend:dev] Port ${preferred} is in use by a non-backend process. Searching for a free backend port..."
echo "[backend:dev] Using fallback backend port ${fallback}."
echo "info:    Admin URL → http://localhost:${fallback}/app"
exec python3 -m http.server "${fallback}" --bind 127.0.0.1
""",
    )

    _write_executable(
        project / "apps" / "frontend" / "scripts" / "run-frontend-dev.sh",
        """#!/bin/sh
set -eu
port="${NEXT_DEV_PORT:-5174}"
echo "FRONTEND MEDUSA URL ${NEXT_PUBLIC_MEDUSA_BACKEND_URL:-missing}"
echo "[codex-lb] Frontend dev server: http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    stubs = project / "stubs"
    stubs.mkdir()
    _write_executable(
        stubs / "bun",
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "run" && "${{2:-}}" == "dev" && "$PWD" == "{project / 'apps' / 'backend'}" ]]; then
  shift 2
  exec bash ./dev-stub.sh "$@"
fi
echo "unsupported bun invocation: $*" >&2
exit 1
""",
    )

    env = os.environ.copy()
    env["PATH"] = f"{stubs}:{env['PATH']}"
    env["APP_BACKEND_PORT"] = "32456"
    env["MEDUSA_BACKEND_PORT"] = "39000"
    env["FRONTEND_PORT"] = "35175"
    env["RUST_RUNTIME_PORT"] = "38091"

    blocker = subprocess.Popen(
        ["python3", "-m", "http.server", "39000", "--bind", "127.0.0.1"],
        cwd=project,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )

    proc = subprocess.Popen(
        ["bash", "./scripts/dev-all.sh"],
        cwd=project,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        output = _read_until(proc, "[dev] Ready")
        output += _read_until(proc, "bun run logs -watch frontend")

        assert "http://localhost:39001/app" in output
        assert (
            "FRONTEND MEDUSA URL http://localhost:39001"
            in (project / "logs" / "frontend.log").read_text(encoding="utf-8")
        )
    finally:
        proc.terminate()
        proc.wait(timeout=5)
        blocker.terminate()
        blocker.wait(timeout=5)


def test_dev_all_reuses_existing_app_api_when_health_probe_matches(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "apps" / "backend").mkdir(parents=True)
    (project / "apps" / "frontend" / "scripts").mkdir(parents=True)
    (project / "logs").mkdir()
    (project / "apps" / "backend" / ".medusa").mkdir(parents=True)

    shutil.copy2(DEV_ALL_SCRIPT, project / "scripts" / "dev-all.sh")

    _write_executable(
        project / "scripts" / "run-server-dev.sh",
        """#!/bin/sh
set -eu
echo "app should have been reused instead of restarted" >&2
exit 99
""",
    )
    _write_rust_runtime_dev_stub(project)

    _write_executable(
        project / "apps" / "backend" / "dev-stub.sh",
        """#!/usr/bin/env bash
set -euo pipefail
port="${MEDUSA_PORT:-9000}"
echo "info:    Admin URL → http://localhost:${port}/app"
python3 -m http.server "${port}" --bind 127.0.0.1 &
server_pid=$!
sleep 1
kill "${server_pid}" >/dev/null 2>&1 || true
wait "${server_pid}" || true
""",
    )

    _write_executable(
        project / "apps" / "frontend" / "scripts" / "run-frontend-dev.sh",
        """#!/bin/sh
set -eu
port="${NEXT_DEV_PORT:-5174}"
echo "[codex-lb] Frontend dev server: http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    stubs = project / "stubs"
    stubs.mkdir()
    _write_executable(
        stubs / "bun",
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "run" && "${{2:-}}" == "dev" && "$PWD" == "{project / 'apps' / 'backend'}" ]]; then
  shift 2
  exec bash ./dev-stub.sh "$@"
fi
echo "unsupported bun invocation: $*" >&2
exit 1
""",
    )
    _write_executable(
        stubs / "lsof",
        """#!/usr/bin/env bash
exit 1
""",
    )

    env = os.environ.copy()
    env["PATH"] = f"{stubs}:{env['PATH']}"
    env["APP_BACKEND_PORT"] = "32457"
    env["MEDUSA_BACKEND_PORT"] = "39010"
    env["FRONTEND_PORT"] = "35176"
    env["RUST_RUNTIME_PORT"] = "38092"

    app_blocker = _start_health_stub(32457, project)
    _wait_for_listening_port(32457)

    proc = subprocess.Popen(
        ["bash", "./scripts/dev-all.sh"],
        cwd=project,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        output = _read_until(proc, "[dev] Ready")
        output += _read_until(proc, "bun run logs -watch frontend")
        stdout, _ = proc.communicate(timeout=5)
        output += stdout

        assert "wait: : no such job" not in output
        assert "http://localhost:32457" in output
        assert "http://localhost:39010/app" in output
        assert "http://localhost:35176" in output
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
        app_blocker.terminate()
        app_blocker.wait(timeout=5)


def test_dev_all_waits_cleanly_for_reused_service_watcher_pid(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "apps" / "backend").mkdir(parents=True)
    (project / "apps" / "frontend" / "scripts").mkdir(parents=True)
    (project / "logs").mkdir()
    (project / "apps" / "backend" / ".medusa").mkdir(parents=True)

    shutil.copy2(DEV_ALL_SCRIPT, project / "scripts" / "dev-all.sh")

    _write_executable(
        project / "scripts" / "run-server-dev.sh",
        """#!/bin/sh
set -eu
echo "app should have been reused instead of restarted" >&2
exit 99
""",
    )
    _write_rust_runtime_dev_stub(project)

    _write_executable(
        project / "apps" / "backend" / "dev-stub.sh",
        """#!/usr/bin/env bash
set -euo pipefail
port="${MEDUSA_PORT:-9000}"
echo "info:    Admin URL → http://localhost:${port}/app"
python3 -m http.server "${port}" --bind 127.0.0.1 &
server_pid=$!
sleep 1
kill "${server_pid}" >/dev/null 2>&1 || true
wait "${server_pid}" || true
""",
    )

    _write_executable(
        project / "apps" / "frontend" / "scripts" / "run-frontend-dev.sh",
        """#!/bin/sh
set -eu
port="${NEXT_DEV_PORT:-5174}"
echo "[codex-lb] Frontend dev server: http://localhost:${port}"
exec python3 -m http.server "${port}" --bind 127.0.0.1
""",
    )

    stubs = project / "stubs"
    stubs.mkdir()
    _write_executable(
        stubs / "bun",
        f"""#!/usr/bin/env bash
set -euo pipefail
if [[ "${{1:-}}" == "run" && "${{2:-}}" == "dev" && "$PWD" == "{project / 'apps' / 'backend'}" ]]; then
  shift 2
  exec bash ./dev-stub.sh "$@"
fi
echo "unsupported bun invocation: $*" >&2
exit 1
""",
    )

    env = os.environ.copy()
    env["PATH"] = f"{stubs}:{env['PATH']}"
    env["APP_BACKEND_PORT"] = "32459"
    env["MEDUSA_BACKEND_PORT"] = "39012"
    env["FRONTEND_PORT"] = "35178"
    env["RUST_RUNTIME_PORT"] = "38093"

    app_blocker = _start_health_stub(32459, project)
    _wait_for_listening_port(32459)

    proc = subprocess.Popen(
        ["bash", "./scripts/dev-all.sh"],
        cwd=project,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        output = _read_until(proc, "[dev] Ready")
        output += _read_until(proc, "bun run logs -watch frontend")
        stdout, _ = proc.communicate(timeout=5)
        output += stdout

        assert "wait: " not in output
        assert "http://localhost:32459" in output
        assert "http://localhost:39012/app" in output
        assert "http://localhost:35178" in output
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
        app_blocker.terminate()
        app_blocker.wait(timeout=5)


def test_dev_all_fails_when_app_port_belongs_to_non_codex_service(tmp_path: Path) -> None:
    project = tmp_path / "project"
    (project / "scripts").mkdir(parents=True)
    (project / "apps" / "backend").mkdir(parents=True)
    (project / "apps" / "frontend" / "scripts").mkdir(parents=True)
    (project / "logs").mkdir()
    (project / "apps" / "backend" / ".medusa").mkdir(parents=True)

    shutil.copy2(DEV_ALL_SCRIPT, project / "scripts" / "dev-all.sh")

    _write_executable(
        project / "scripts" / "run-server-dev.sh",
        """#!/bin/sh
set -eu
echo "app should not start when a non-codex blocker owns the port" >&2
exit 99
""",
    )
    _write_rust_runtime_dev_stub(project)

    _write_executable(
        project / "apps" / "backend" / "dev-stub.sh",
        """#!/usr/bin/env bash
set -euo pipefail
echo "backend should not start when app API validation fails" >&2
exit 98
""",
    )

    _write_executable(
        project / "apps" / "frontend" / "scripts" / "run-frontend-dev.sh",
        """#!/bin/sh
set -eu
echo "frontend should not start when app API validation fails" >&2
exit 97
""",
    )

    stubs = project / "stubs"
    stubs.mkdir()
    _write_executable(
        stubs / "bun",
        """#!/usr/bin/env bash
set -euo pipefail
echo "bun should not be called when app API validation fails" >&2
exit 96
""",
    )

    env = os.environ.copy()
    env["PATH"] = f"{stubs}:{env['PATH']}"
    env["APP_BACKEND_PORT"] = "32458"
    env["MEDUSA_BACKEND_PORT"] = "39011"
    env["FRONTEND_PORT"] = "35177"
    env["RUST_RUNTIME_PORT"] = "38094"

    app_blocker = subprocess.Popen(
        ["python3", "-m", "http.server", "32458", "--bind", "127.0.0.1"],
        cwd=project,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    _wait_for_listening_port(32458)

    proc = subprocess.Popen(
        ["bash", "./scripts/dev-all.sh"],
        cwd=project,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        output, _ = proc.communicate(timeout=10)
        assert proc.returncode != 0
        assert "Reusing app API" not in output
        assert "non-codex-lb service" in output
        assert "app should not start" not in output
        assert "bun should not be called" not in output
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
        app_blocker.terminate()
        app_blocker.wait(timeout=5)
