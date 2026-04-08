from __future__ import annotations

from datetime import datetime, timezone

from app.core.auth import generate_unique_account_id
from app.core.crypto import TokenEncryptor
from app.db.models import Account, AccountStatus
from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
from app.modules.accounts.codex_auth_status import build_codex_auth_status


def _make_account(*, account_id: str, chatgpt_account_id: str, email: str) -> Account:
    encryptor = TokenEncryptor()
    return Account(
        id=account_id,
        chatgpt_account_id=chatgpt_account_id,
        email=email,
        plan_type="team",
        access_token_encrypted=encryptor.encrypt("access"),
        refresh_token_encrypted=encryptor.encrypt("refresh"),
        id_token_encrypted=encryptor.encrypt("id"),
        last_refresh=datetime.now(tz=timezone.utc),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
    )


def test_build_codex_auth_status_collapses_conflicts_to_single_snapshot_mapping() -> None:
    denver_email = "denver@edixal.com"
    chatgpt_account_id = "shared-chatgpt-id"
    denver_account = _make_account(
        account_id="legacy-denver-account-id",
        chatgpt_account_id=chatgpt_account_id,
        email=denver_email,
    )

    denver_canonical_id = generate_unique_account_id(chatgpt_account_id, denver_email)
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            denver_canonical_id: ["denver", "nagyviktordp"],
        },
        active_snapshot_name="nagyviktordp",
    )

    status = build_codex_auth_status(account=denver_account, snapshot_index=snapshot_index)

    assert status.snapshot_name == "denver"
    assert status.active_snapshot_name == "nagyviktordp"
    assert status.is_active_snapshot is False
    assert status.expected_snapshot_name == denver_email
    assert status.snapshot_name_matches_email is False
    assert status.runtime_ready is False
    assert status.runtime_ready_source is None


def test_build_codex_auth_status_marks_runtime_ready_for_validated_email_snapshot() -> None:
    email = "tokio@example.com"
    chatgpt_account_id = "acc_tokio"
    tokio_account = _make_account(
        account_id=generate_unique_account_id(chatgpt_account_id, email),
        chatgpt_account_id=chatgpt_account_id,
        email=email,
    )
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={tokio_account.id: [email]},
        active_snapshot_name=email,
    )

    status = build_codex_auth_status(account=tokio_account, snapshot_index=snapshot_index)

    assert status.snapshot_name == email
    assert status.snapshot_name_matches_email is True
    assert status.runtime_ready is True
    assert status.runtime_ready_source == "validated_snapshot_email_match"
