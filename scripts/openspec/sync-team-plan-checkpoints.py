#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import time
from pathlib import Path
from typing import Any

ROLE_KEYS = ("role", "agent_role", "agentType", "agent_type", "owner_role")
WORKER_KEYS = ("worker", "assigned_worker", "assignedWorker", "owner", "claimed_by")
KNOWN_ROLES = {"planner", "architect", "critic", "executor", "writer", "verifier"}
STATUS_MAP = {
    "pending": "ready",
    "ready": "ready",
    "todo": "ready",
    "in_progress": "in_progress",
    "inprogress": "in_progress",
    "running": "in_progress",
    "completed": "done",
    "complete": "done",
    "done": "done",
    "failed": "blocked",
    "error": "blocked",
    "blocked": "blocked",
}
TEXT_KEYS = ("title", "summary", "description", "task", "name")


def read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def normalize_role(raw: Any) -> str | None:
    if raw is None:
        return None
    role = str(raw).strip().lower().replace(" ", "-").replace("_", "-")
    role = role.replace("team-", "")
    if role in KNOWN_ROLES:
        return role
    return None


def normalize_state(raw: Any) -> str:
    s = str(raw or "pending").strip().lower().replace("-", "_")
    return STATUS_MAP.get(s, "in_progress")


def worker_role_map(team_dir: Path) -> dict[str, str]:
    result: dict[str, str] = {}
    workers_dir = team_dir / "workers"
    if not workers_dir.exists():
        return result

    for ident in workers_dir.glob("worker-*/identity.json"):
        worker_name = ident.parent.name
        data = read_json(ident) or {}
        role: str | None = None
        for key in ROLE_KEYS:
            role = normalize_role(data.get(key))
            if role:
                break
        if role:
            result[worker_name] = role
    return result


def task_role(task: dict[str, Any], worker_roles: dict[str, str]) -> str:
    for key in ROLE_KEYS:
        role = normalize_role(task.get(key))
        if role:
            return role

    worker_name = None
    for key in WORKER_KEYS:
        value = task.get(key)
        if value:
            worker_name = str(value)
            break
    if worker_name and worker_name in worker_roles:
        return worker_roles[worker_name]

    return "executor"


def task_text(task: dict[str, Any], task_id: str) -> str:
    for key in TEXT_KEYS:
        value = task.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return f"Team task {task_id}"


def task_identifier(task_path: Path, task: dict[str, Any]) -> str:
    for key in ("id", "task_id", "taskId", "number"):
        value = task.get(key)
        if value is not None and str(value).strip() != "":
            return str(value).strip()
    stem = task_path.stem
    if stem.startswith("task-"):
        return stem.removeprefix("task-")
    return stem


def sync_once(root: Path, team: str, plan: str, cache: dict[str, str]) -> int:
    team_dir = root / ".omx" / "state" / "team" / team
    tasks_dir = team_dir / "tasks"
    if not tasks_dir.exists():
        raise SystemExit(f"Missing team tasks directory: {tasks_dir}")

    worker_roles = worker_role_map(team_dir)
    updater = root / "scripts" / "openspec" / "update-plan-checkpoint.py"
    if not updater.exists():
        raise SystemExit(f"Missing updater script: {updater}")

    updates = 0
    for task_path in sorted(tasks_dir.glob("task-*.json")):
        task = read_json(task_path)
        if not task:
            continue

        task_id = task_identifier(task_path, task)
        role = task_role(task, worker_roles)
        state = normalize_state(task.get("status"))
        text = task_text(task, task_id)

        fingerprint = f"{role}|{state}|{text}"
        if cache.get(task_id) == fingerprint:
            continue

        cmd = [
            "python3",
            str(updater),
            "--root",
            str(root),
            "--plan",
            plan,
            "--role",
            role,
            "--id",
            f"T{task_id}",
            "--state",
            state,
            "--text",
            text,
        ]
        subprocess.run(cmd, check=True)
        cache[task_id] = fingerprint
        updates += 1

    return updates


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync OMX team task state into openspec/plan/<slug>/<role>/tasks.md checkpoints")
    parser.add_argument("--team", required=True, help="OMX team name")
    parser.add_argument("--plan", required=True, help="Plan slug under openspec/plan")
    parser.add_argument("--root", default=".", help="Repository root")
    parser.add_argument("--interval", type=float, default=3.0, help="Polling interval seconds")
    parser.add_argument("--once", action="store_true", help="Sync once and exit")
    args = parser.parse_args()

    root = Path(args.root).resolve()
    cache: dict[str, str] = {}

    if args.once:
        count = sync_once(root, args.team, args.plan, cache)
        print(f"Synced {count} task checkpoint updates")
        return

    print(f"Watching team '{args.team}' -> plan '{args.plan}' every {args.interval:.1f}s")
    while True:
        try:
            count = sync_once(root, args.team, args.plan, cache)
            if count:
                print(f"Synced {count} update(s)")
        except KeyboardInterrupt:
            print("Stopped")
            return
        except Exception as exc:
            print(f"Sync warning: {exc}")
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
