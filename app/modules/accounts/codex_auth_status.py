from __future__ import annotations

from app.db.models import Account
from app.modules.accounts.codex_auth_switcher import (
    CodexAuthSnapshotIndex,
    build_email_snapshot_name,
    resolve_snapshot_names_for_account,
    select_snapshot_name,
)
from app.modules.accounts.schemas import AccountCodexAuthStatus


def build_codex_auth_status(
    *,
    account: Account,
    snapshot_index: CodexAuthSnapshotIndex,
) -> AccountCodexAuthStatus:
    snapshot_names = resolve_snapshot_names_for_account(
        snapshot_index=snapshot_index,
        account_id=account.id,
        chatgpt_account_id=account.chatgpt_account_id,
        email=account.email,
    )
    selected_snapshot_name = select_snapshot_name(
        snapshot_names,
        snapshot_index.active_snapshot_name,
        email=account.email,
    )
    active_snapshot_name = snapshot_index.active_snapshot_name
    expected_snapshot_name = build_email_snapshot_name(account.email)
    snapshot_name_matches_email = bool(
        selected_snapshot_name and selected_snapshot_name == expected_snapshot_name
    )
    runtime_ready = bool(snapshot_names and selected_snapshot_name and snapshot_name_matches_email)

    return AccountCodexAuthStatus(
        has_snapshot=bool(snapshot_names),
        snapshot_name=selected_snapshot_name,
        active_snapshot_name=active_snapshot_name,
        is_active_snapshot=bool(active_snapshot_name and active_snapshot_name in snapshot_names),
        expected_snapshot_name=expected_snapshot_name,
        snapshot_name_matches_email=snapshot_name_matches_email,
        runtime_ready=runtime_ready,
        runtime_ready_source="validated_snapshot_email_match" if runtime_ready else None,
    )
