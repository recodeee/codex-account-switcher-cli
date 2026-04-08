from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys

from app.modules.handoffs.schemas import (
    RuntimeHandoffCheckpoint,
    RuntimeHandoffCreateRequest,
    RuntimeHandoffResumeRequest,
    RuntimeHandoffStatus,
    RuntimeHandoffTriggerReason,
)
from app.modules.handoffs.service import RuntimeHandoffService
from app.tools.codex_auth_multi_runtime import activate_runtime_snapshot, build_runtime_env, build_runtime_paths


def _parse_list(values: list[str] | None) -> list[str]:
    if not values:
        return []
    items: list[str] = []
    for value in values:
        normalized = value.strip()
        if normalized:
            items.append(normalized)
    return items


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create and resume runtime handoff artifacts across Codex accounts.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    list_parser = subparsers.add_parser("list", help="List runtime handoff artifacts")
    list_parser.add_argument("--status", choices=["ready", "resumed", "aborted", "expired"])
    list_parser.add_argument("--source-snapshot")
    list_parser.add_argument("--limit", type=int, default=100)
    list_parser.add_argument("--json", action="store_true")

    create_parser = subparsers.add_parser("create", help="Create a runtime handoff artifact")
    create_parser.add_argument("source_runtime")
    create_parser.add_argument("source_snapshot")
    create_parser.add_argument(
        "--trigger-reason",
        choices=[reason.value for reason in RuntimeHandoffTriggerReason],
        required=True,
    )
    create_parser.add_argument("--source-session-id")
    create_parser.add_argument("--expected-target-runtime")
    create_parser.add_argument("--expected-target-snapshot")
    create_parser.add_argument("--title")
    create_parser.add_argument("--goal", required=True)
    create_parser.add_argument("--done", action="append")
    create_parser.add_argument("--next", dest="next_items", action="append")
    create_parser.add_argument("--blocker", dest="blockers", action="append")
    create_parser.add_argument("--file", dest="files_touched", action="append")
    create_parser.add_argument("--command", dest="commands_run", action="append")
    create_parser.add_argument("--evidence", dest="evidence_refs", action="append")
    create_parser.add_argument("--ttl-hours", type=int)
    create_parser.add_argument("--json", action="store_true")

    resume_parser = subparsers.add_parser("resume", help="Resume a runtime handoff artifact")
    resume_parser.add_argument("handoff_id")
    resume_parser.add_argument("target_runtime")
    resume_parser.add_argument("target_snapshot")
    resume_parser.add_argument("--override-mismatch", action="store_true")
    resume_parser.add_argument("--activate-runtime", action="store_true")
    resume_parser.add_argument("--run")
    resume_parser.add_argument("--json", action="store_true")

    abort_parser = subparsers.add_parser("abort", help="Abort a handoff artifact")
    abort_parser.add_argument("handoff_id")
    abort_parser.add_argument("--json", action="store_true")

    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    service = RuntimeHandoffService()

    if args.command == "list":
        status = RuntimeHandoffStatus(args.status) if args.status else None
        entries = service.list_handoffs(status=status, source_snapshot=args.source_snapshot, limit=args.limit)
        if args.json:
            json.dump([entry.model_dump(mode="json", by_alias=True) for entry in entries], sys.stdout, indent=2)
            sys.stdout.write("\n")
            return 0
        if not entries:
            print("No runtime handoff artifacts found.")
            return 0
        for entry in entries:
            print(
                f"{entry.id}  status={entry.status.value}  "
                f"source={entry.source_runtime}/{entry.source_snapshot}  "
                f"created={entry.created_at.isoformat()}Z"
            )
        return 0

    if args.command == "create":
        checkpoint = RuntimeHandoffCheckpoint(
            title=args.title,
            goal=args.goal,
            completed_work=_parse_list(args.done),
            next_steps=_parse_list(args.next_items),
            blockers=_parse_list(args.blockers),
            files_touched=_parse_list(args.files_touched),
            commands_run=_parse_list(args.commands_run),
            evidence_refs=_parse_list(args.evidence_refs),
        )
        payload = RuntimeHandoffCreateRequest(
            source_runtime=args.source_runtime,
            source_snapshot=args.source_snapshot,
            source_session_id=args.source_session_id,
            trigger_reason=RuntimeHandoffTriggerReason(args.trigger_reason),
            expected_target_runtime=args.expected_target_runtime,
            expected_target_snapshot=args.expected_target_snapshot,
            checkpoint=checkpoint,
            ttl_hours=args.ttl_hours,
        )
        created = service.create_handoff(payload)
        if args.json:
            json.dump(created.model_dump(mode="json", by_alias=True), sys.stdout, indent=2)
            sys.stdout.write("\n")
        else:
            print(f"Created handoff: {created.id}")
        return 0

    if args.command == "resume":
        payload = RuntimeHandoffResumeRequest(
            target_runtime=args.target_runtime,
            target_snapshot=args.target_snapshot,
            override_mismatch=args.override_mismatch,
        )
        handoff, resume_prompt = service.resume_handoff(args.handoff_id, payload)

        if args.activate_runtime or args.run:
            paths = build_runtime_paths(args.target_runtime)
            activate_runtime_snapshot(paths, args.target_snapshot)
            if args.run:
                command = shlex.split(args.run)
                env = os.environ.copy()
                env.update(build_runtime_env(paths))
                env["CODEX_HANDOFF_PROMPT"] = resume_prompt
                completed = subprocess.run(command, env=env, check=False)
                if completed.returncode != 0:
                    return completed.returncode

        if args.json:
            json.dump(
                {
                    "handoff": handoff.model_dump(mode="json", by_alias=True),
                    "resumePrompt": resume_prompt,
                },
                sys.stdout,
                indent=2,
            )
            sys.stdout.write("\n")
        else:
            print(f"Resumed handoff: {handoff.id}")
            print("")
            print(resume_prompt)
        return 0

    if args.command == "abort":
        entry = service.abort_handoff(args.handoff_id)
        if args.json:
            json.dump(entry.model_dump(mode="json", by_alias=True), sys.stdout, indent=2)
            sys.stdout.write("\n")
        else:
            print(f"Aborted handoff: {entry.id}")
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
