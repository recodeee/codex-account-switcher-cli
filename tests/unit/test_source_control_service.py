from __future__ import annotations

import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

import app.modules.source_control.service as source_control_service
from app.modules.source_control.schemas import (
    SourceControlPullRequestPreview,
    SourceControlReviewContent,
)
from app.modules.source_control.service import (
    SourceControlBotSnapshot,
    SourceControlError,
    SourceControlService,
)

pytestmark = pytest.mark.unit


def _git(repo: Path, *args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=str(repo),
        text=True,
        capture_output=True,
        check=True,
    )
    return completed.stdout.strip()


def _init_repo(tmp_path: Path) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir(parents=True, exist_ok=True)
    _git(repo, "init")
    _git(repo, "config", "user.email", "tests@example.com")
    _git(repo, "config", "user.name", "Tests")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    _git(repo, "add", "README.md")
    _git(repo, "commit", "-m", "Initial commit")
    default_branch = _git(repo, "rev-parse", "--abbrev-ref", "HEAD")
    if default_branch != "main":
        _git(repo, "branch", "-M", "main")
    return repo


def test_build_preview_includes_branch_merge_and_bot_sync(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    _git(repo, "checkout", "-b", "agent/master-agent")
    (repo / "feature.txt").write_text("feature\n", encoding="utf-8")
    _git(repo, "add", "feature.txt")
    _git(repo, "commit", "-m", "Add feature from bot")
    _git(repo, "checkout", "main")

    service = SourceControlService()
    preview = service.build_preview(
        project_path=str(repo),
        bots=[SourceControlBotSnapshot(name="Master Agent", status="active", runtime="Codex")],
    )

    assert preview.repository_root == str(repo.resolve())
    assert preview.active_branch == "main"
    assert preview.base_branch == "main"
    assert preview.commit_preview.subject
    assert any(entry.name == "agent/master-agent" for entry in preview.branches)
    assert any(entry.branch == "agent/master-agent" for entry in preview.merge_preview)
    assert any(
        bot.bot_name == "Master Agent" and bot.matched_branch == "agent/master-agent"
        for bot in preview.gx_bots
    )


def test_build_preview_reports_dirty_changed_files(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    (repo / "README.md").write_text("base\nchanged\n", encoding="utf-8")

    service = SourceControlService()
    preview = service.build_preview(project_path=str(repo), bots=[])

    assert preview.dirty is True
    assert any(entry.path == "README.md" for entry in preview.changed_files)


def test_build_preview_rejects_missing_project_path(tmp_path: Path) -> None:
    service = SourceControlService()

    with pytest.raises(SourceControlError, match="Project path does not exist"):
        service.build_preview(project_path=str(tmp_path / "missing"), bots=[])


def test_build_preview_includes_active_snapshot_sessions_with_worktree_branch_mapping(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _init_repo(tmp_path)
    snapshot_name = "admin@kozponthiusbolt.hu--dup-2"
    snapshot_branch = "agent/codex/admin-kozponthiusbolt-hu--dup-2"

    _git(repo, "checkout", "-b", snapshot_branch)
    (repo / "snapshot.txt").write_text("snapshot\n", encoding="utf-8")
    _git(repo, "add", "snapshot.txt")
    _git(repo, "commit", "-m", "Add snapshot branch")
    _git(repo, "checkout", "main")

    snapshot_worktree = tmp_path / "snapshot-worktree"
    _git(repo, "worktree", "add", str(snapshot_worktree), snapshot_branch)

    monkeypatch.setattr(
        source_control_service,
        "read_live_codex_process_session_attribution",
        lambda: SimpleNamespace(
            counts_by_snapshot={snapshot_name: 1},
            mapped_session_pids_by_snapshot={snapshot_name: [101]},
        ),
    )
    monkeypatch.setattr(
        source_control_service,
        "read_runtime_live_session_counts_by_snapshot",
        lambda: {snapshot_name: 1},
    )
    monkeypatch.setattr(
        source_control_service,
        "_read_process_cwd",
        lambda pid: snapshot_worktree if pid == 101 else None,
    )

    service = SourceControlService()
    preview = service.build_preview(project_path=str(repo), bots=[])

    matching_entries = [
        entry
        for entry in preview.gx_bots
        if entry.source == "snapshot" and entry.snapshot_name == snapshot_name
    ]
    assert matching_entries
    assert matching_entries[0].matched_branch == snapshot_branch
    assert matching_entries[0].session_count == 1


def test_build_branch_details_includes_review_content_for_review_bot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _init_repo(tmp_path)
    branch = "agent/review-target"
    _git(repo, "checkout", "-b", branch)
    (repo / "review-target.txt").write_text("review target\n", encoding="utf-8")
    _git(repo, "add", "review-target.txt")
    _git(repo, "commit", "-m", "Add review target")
    _git(repo, "checkout", "main")

    service = SourceControlService()
    monkeypatch.setattr(
        service,
        "_list_pull_requests",
        lambda **_: [
            SourceControlPullRequestPreview(
                number=41,
                title="Review target",
                state="open",
                head_branch=branch,
                base_branch="main",
                url="https://example.com/pr/41",
                author="review-bot",
                is_draft=False,
            )
        ],
    )
    monkeypatch.setattr(
        service,
        "_load_pull_request_review_content",
        lambda **_: SourceControlReviewContent(
            kind="review",
            content="Please add verification steps before merge.",
            state="CHANGES_REQUESTED",
            author="review-bot",
            submitted_at=None,
            url="https://example.com/pr/41#review",
        ),
    )

    details = service.build_branch_details(
        project_path=str(repo),
        bots=[SourceControlBotSnapshot(name="Review Target", status="idle", runtime="Codex")],
        branch=branch,
    )

    assert details.review_content is not None
    assert details.review_content.kind == "review"
    assert details.review_content.content == "Please add verification steps before merge."
    assert details.review_content.state == "CHANGES_REQUESTED"
    assert "Review Target" in details.linked_bots


def test_build_branch_details_skips_review_content_without_review_bot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _init_repo(tmp_path)
    branch = "agent/master-agent"
    _git(repo, "checkout", "-b", branch)
    (repo / "master-agent.txt").write_text("master\n", encoding="utf-8")
    _git(repo, "add", "master-agent.txt")
    _git(repo, "commit", "-m", "Add master agent")
    _git(repo, "checkout", "main")

    service = SourceControlService()
    monkeypatch.setattr(
        service,
        "_list_pull_requests",
        lambda **_: [
            SourceControlPullRequestPreview(
                number=73,
                title="Master agent sync",
                state="open",
                head_branch=branch,
                base_branch="main",
                url="https://example.com/pr/73",
                author="master-agent",
                is_draft=False,
            )
        ],
    )

    def _unexpected_review_lookup(**_):
        raise AssertionError("review content lookup should not run without review bot")

    monkeypatch.setattr(service, "_load_pull_request_review_content", _unexpected_review_lookup)

    details = service.build_branch_details(
        project_path=str(repo),
        bots=[SourceControlBotSnapshot(name="Master Agent", status="active", runtime="Codex")],
        branch=branch,
    )

    assert details.review_content is None


def test_load_pull_request_review_content_prefers_latest_review(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _init_repo(tmp_path)
    service = SourceControlService()
    monkeypatch.setattr(
        service,
        "_run_gh",
        lambda *_, **__: json.dumps(
            {
                "url": "https://example.com/pr/41",
                "reviewDecision": "CHANGES_REQUESTED",
                "reviews": [
                    {
                        "state": "APPROVED",
                        "body": "Older review",
                        "author": {"login": "first-reviewer"},
                        "submittedAt": "2026-04-14T09:00:00Z",
                        "url": "https://example.com/pr/41#review-older",
                    },
                    {
                        "state": "CHANGES_REQUESTED",
                        "body": "Latest review content",
                        "author": {"login": "review-bot"},
                        "submittedAt": "2026-04-14T10:00:00Z",
                        "url": "https://example.com/pr/41#review-latest",
                    },
                ],
                "comments": [
                    {
                        "body": "General PR comment",
                        "author": {"login": "commenter"},
                        "createdAt": "2026-04-14T10:30:00Z",
                        "url": "https://example.com/pr/41#issuecomment-1",
                    }
                ],
            }
        ),
    )

    review = service._load_pull_request_review_content(
        repo_root=repo,
        pull_request_number=41,
        pull_request_url="https://example.com/pr/41",
    )

    assert review is not None
    assert review.kind == "review"
    assert review.content == "Latest review content"
    assert review.state == "CHANGES_REQUESTED"
    assert review.author == "review-bot"
    assert review.url == "https://example.com/pr/41#review-latest"


def test_load_pull_request_diagnostics_extracts_conflicts_checks_and_bot_feedback(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    repo = _init_repo(tmp_path)
    service = SourceControlService()
    pull_request = SourceControlPullRequestPreview(
        number=78,
        title="Autofix workflow",
        state="open",
        head_branch="agent/codex/autofix",
        base_branch="dev",
        url="https://github.com/NagyVikt/recodee/pull/78",
        author="NagyVikt",
        is_draft=False,
    )

    def _run_gh(args: list[str], **_) -> str:
        joined = " ".join(args)
        if joined.startswith("pr view 78"):
            return json.dumps(
                {
                    "mergeable": "CONFLICTING",
                    "mergeStateStatus": "DIRTY",
                    "statusCheckRollup": [
                        {
                            "name": "Frontend lint (eslint)",
                            "workflowName": "CI",
                            "conclusion": "FAILURE",
                            "detailsUrl": "https://example.com/checks/1",
                        },
                        {
                            "name": "GitGuardian Security Checks",
                            "workflowName": "",
                            "conclusion": "SUCCESS",
                            "detailsUrl": "https://example.com/checks/2",
                        },
                    ],
                    "comments": [
                        {
                            "author": {"login": "chatgpt-codex-connector"},
                            "body": "You have reached your Codex usage limits for code reviews.",
                            "createdAt": "2026-04-15T07:46:13Z",
                            "url": "https://github.com/NagyVikt/recodee/pull/78#issuecomment-1",
                        }
                    ],
                    "reviews": [
                        {
                            "author": {"login": "cr-gpt"},
                            "body": "",
                            "state": "COMMENTED",
                            "submittedAt": "2026-04-15T07:46:14Z",
                            "url": "https://github.com/NagyVikt/recodee/pull/78#pullrequestreview-1",
                        }
                    ],
                    "url": "https://github.com/NagyVikt/recodee/pull/78",
                }
            )
        if joined.startswith("api repos/NagyVikt/recodee/pulls/78/comments?per_page=100"):
            return json.dumps(
                [
                    {
                        "user": {"login": "cr-gpt"},
                        "body": "Keep output short and operational.",
                        "path": ".agents/commands/guardex.md",
                        "created_at": "2026-04-15T07:46:14Z",
                        "html_url": "https://github.com/NagyVikt/recodee/pull/78#discussion_r1",
                    }
                ]
            )
        return ""

    monkeypatch.setattr(service, "_run_gh", _run_gh)

    diagnostics = service._load_pull_request_diagnostics(
        repo_root=repo,
        pull_request=pull_request,
    )

    assert diagnostics is not None
    assert diagnostics.has_merge_conflicts is True
    assert diagnostics.mergeable == "CONFLICTING"
    assert diagnostics.merge_state_status == "DIRTY"
    assert len(diagnostics.failed_checks) == 1
    assert diagnostics.failed_checks[0].name == "Frontend lint (eslint)"
    assert len(diagnostics.feedback) >= 2
    assert any(item.author == "chatgpt-codex-connector" for item in diagnostics.feedback)
    assert any(item.file_path == ".agents/commands/guardex.md" for item in diagnostics.feedback)
