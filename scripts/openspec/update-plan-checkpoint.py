#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path

CHECKPOINT_RE = re.compile(r"^- \[( |x)\] \[([A-Za-z0-9._-]+)\] ([A-Z_]+) - (.*)$")


def now_utc() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_state(raw: str) -> tuple[str, str]:
    state = raw.strip().lower().replace("-", "_")
    mapping = {
        "ready": ("READY", " "),
        "todo": ("READY", " "),
        "pending": ("READY", " "),
        "in_progress": ("IN_PROGRESS", " "),
        "inprogress": ("IN_PROGRESS", " "),
        "started": ("IN_PROGRESS", " "),
        "blocked": ("BLOCKED", " "),
        "failed": ("FAILED", " "),
        "done": ("DONE", "x"),
        "completed": ("DONE", "x"),
    }
    if state not in mapping:
        raise SystemExit(f"Unsupported state: {raw}. Use one of ready|in_progress|blocked|failed|done")
    return mapping[state]


def ensure_checkpoint_section(lines: list[str]) -> tuple[list[str], int, int]:
    header = "## 4. Checkpoints"
    start = -1
    for i, line in enumerate(lines):
        if line.strip() == header:
            start = i
            break

    if start == -1:
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend([header, "", ""])
        start = len(lines) - 3

    end = len(lines)
    for i in range(start + 1, len(lines)):
        if lines[i].startswith("## "):
            end = i
            break

    return lines, start, end


def update_tasks_file(tasks_path: Path, checkpoint_id: str, state_label: str, checkbox: str, text: str) -> None:
    lines = tasks_path.read_text(encoding="utf-8").splitlines()
    lines, start, end = ensure_checkpoint_section(lines)

    section = lines[start + 1 : end]
    updated = False
    new_line = f"- [{checkbox}] [{checkpoint_id}] {state_label} - {text}"

    for idx, line in enumerate(section):
        m = CHECKPOINT_RE.match(line)
        if m and m.group(2) == checkpoint_id:
            section[idx] = new_line
            updated = True
            break

    if not updated:
        # Insert after leading blank lines, else append
        insert_at = len(section)
        for i, line in enumerate(section):
            if line.strip() == "":
                continue
            insert_at = i
            break
        section.insert(insert_at if insert_at < len(section) else len(section), new_line)

    # Ensure trailing blank inside section for readability
    if section and section[-1] != "":
        section.append("")

    lines[start + 1 : end] = section
    tasks_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def append_log(log_path: Path, entry: str, title: str) -> None:
    if not log_path.exists():
        log_path.write_text(f"# {title}\n\n", encoding="utf-8")
    with log_path.open("a", encoding="utf-8") as f:
        f.write(entry + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Update role tasks.md checkpoints for an OpenSpec plan workspace")
    parser.add_argument("--plan", required=True, help="Plan slug (openspec/plan/<slug>)")
    parser.add_argument("--role", required=True, help="Role folder name (planner/architect/critic/executor/writer/verifier)")
    parser.add_argument("--id", required=True, dest="checkpoint_id", help="Checkpoint ID (for example P1, E2)")
    parser.add_argument("--state", required=True, help="State: ready|in_progress|blocked|failed|done")
    parser.add_argument("--text", required=True, help="Checkpoint text")
    parser.add_argument("--root", default=".", help="Repo root (default: .)")
    parser.add_argument("--no-log", action="store_true", help="Skip writing checkpoint logs")
    args = parser.parse_args()

    role = args.role.strip().lower()
    root = Path(args.root).resolve()
    plan_dir = root / "openspec" / "plan" / args.plan
    tasks_path = plan_dir / role / "tasks.md"

    if not tasks_path.exists():
        raise SystemExit(f"Missing tasks file: {tasks_path}")

    state_label, checkbox = normalize_state(args.state)
    text = args.text.strip()
    update_tasks_file(tasks_path, args.checkpoint_id.strip(), state_label, checkbox, text)

    if not args.no_log:
        timestamp = now_utc()
        entry = f"- {timestamp} | role={role} | id={args.checkpoint_id.strip()} | state={state_label} | {text}"
        append_log(plan_dir / "checkpoints.md", entry, f"Plan Checkpoints: {args.plan}")
        if role == "executor":
            append_log(plan_dir / role / "checkpoints.md", entry, "executor checkpoints")

    print(f"Updated checkpoint {args.checkpoint_id.strip()} ({state_label}) in {tasks_path}")


if __name__ == "__main__":
    main()
