#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

DEFAULT_WATCH_DIRS = ("src", "public", "app")
DEFAULT_WATCH_FILES = (
    "package.json",
    "bun.lock",
    "next.config.mjs",
    "tsconfig.json",
    "postcss.config.mjs",
    "eslint.config.js",
)
DEFAULT_IGNORE_DIRS = {"node_modules", ".next", "out", ".git"}


def _iter_watch_files(
    project_root: Path,
    *,
    watch_dirs: tuple[str, ...],
    watch_files: tuple[str, ...],
) -> list[Path]:
    files: list[Path] = []
    for name in watch_files:
        candidate = project_root / name
        if candidate.is_file():
            files.append(candidate)

    for dirname in watch_dirs:
        base = project_root / dirname
        if not base.exists():
            continue
        if base.is_file():
            files.append(base)
            continue
        for current_root, dirnames, filenames in os.walk(base):
            dirnames[:] = [d for d in dirnames if d not in DEFAULT_IGNORE_DIRS]
            for filename in filenames:
                full_path = Path(current_root) / filename
                if full_path.is_file():
                    files.append(full_path)
    return files


def _fingerprint(paths: list[Path], *, relative_to: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        rel = path.relative_to(relative_to).as_posix()
        digest.update(rel.encode("utf-8"))
        digest.update(b"|")
        digest.update(str(stat.st_mtime_ns).encode("utf-8"))
        digest.update(b"|")
        digest.update(str(stat.st_size).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def _run_build(command: str, *, cwd: Path) -> int:
    print(f"[watch-build] Running: {command}", flush=True)
    completed = subprocess.run(command, cwd=cwd, shell=True)
    if completed.returncode == 0:
        print("[watch-build] Build completed successfully.", flush=True)
    else:
        print(
            f"[watch-build] Build failed with exit code {completed.returncode}. Waiting for next change...",
            flush=True,
        )
    return completed.returncode


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Watch frontend source files and rebuild static export for :2455 on changes.",
    )
    parser.add_argument(
        "--frontend-dir",
        default="frontend",
        help="Path to frontend project directory (default: frontend).",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=1.0,
        help="Polling interval in seconds (default: 1.0).",
    )
    parser.add_argument(
        "--debounce",
        type=float,
        default=1.0,
        help="Debounce window in seconds before running build after change (default: 1.0).",
    )
    parser.add_argument(
        "--command",
        default="bun run build",
        help="Build command executed in frontend dir (default: 'bun run build').",
    )
    parser.add_argument(
        "--skip-initial-build",
        action="store_true",
        help="Do not run the initial build at startup.",
    )
    args = parser.parse_args()

    frontend_dir = Path(args.frontend_dir).resolve()
    if not frontend_dir.exists():
        print(f"[watch-build] Frontend directory does not exist: {frontend_dir}", file=sys.stderr)
        return 1

    print(f"[watch-build] Watching frontend files in: {frontend_dir}", flush=True)
    print(
        "[watch-build] Change target: :2455 static site (app/static) via 'bun run build'.",
        flush=True,
    )

    if not args.skip_initial_build:
        _run_build(args.command, cwd=frontend_dir)

    watch_dirs = tuple(DEFAULT_WATCH_DIRS)
    watch_files = tuple(DEFAULT_WATCH_FILES)
    tracked_files = _iter_watch_files(frontend_dir, watch_dirs=watch_dirs, watch_files=watch_files)
    last_fingerprint = _fingerprint(tracked_files, relative_to=frontend_dir)
    pending_since: float | None = None

    try:
        while True:
            time.sleep(max(0.1, args.interval))
            tracked_files = _iter_watch_files(frontend_dir, watch_dirs=watch_dirs, watch_files=watch_files)
            current = _fingerprint(tracked_files, relative_to=frontend_dir)
            if current != last_fingerprint:
                last_fingerprint = current
                pending_since = time.monotonic()
                print("[watch-build] Change detected. Waiting for debounce...", flush=True)
                continue

            if pending_since is None:
                continue

            if (time.monotonic() - pending_since) >= max(0.1, args.debounce):
                pending_since = None
                _run_build(args.command, cwd=frontend_dir)
    except KeyboardInterrupt:
        print("\n[watch-build] Stopped.", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
