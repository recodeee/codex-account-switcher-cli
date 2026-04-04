from __future__ import annotations

from datetime import datetime
from typing import cast

import pytest

from app.core.auth.refresh import RefreshError, TokenRefreshResult
from app.core.crypto import TokenEncryptor
from app.core.utils.time import utcnow
from app.db.models import Account, AccountStatus
from app.modules.accounts import auth_manager as auth_manager_module
from app.modules.accounts.auth_manager import AccountsRepositoryPort, AuthManager

pytestmark = pytest.mark.unit


class _DummyRepo:
    def __init__(self) -> None:
        self.tokens_payload: dict[str, object] | None = None
        self.status_payload: dict[str, object] | None = None
        self.token_donor: Account | None = None

    async def update_status(
        self,
        account_id: str,
        status: AccountStatus,
        deactivation_reason: str | None = None,
    ) -> bool:
        self.status_payload = {
            "account_id": account_id,
            "status": status,
            "deactivation_reason": deactivation_reason,
        }
        return True

    async def update_tokens(
        self,
        account_id: str,
        access_token_encrypted: bytes,
        refresh_token_encrypted: bytes,
        id_token_encrypted: bytes,
        last_refresh: datetime,
        plan_type: str | None = None,
        email: str | None = None,
        chatgpt_account_id: str | None = None,
    ) -> bool:
        self.tokens_payload = {
            "account_id": account_id,
            "access_token_encrypted": access_token_encrypted,
            "refresh_token_encrypted": refresh_token_encrypted,
            "id_token_encrypted": id_token_encrypted,
            "last_refresh": last_refresh,
            "plan_type": plan_type,
            "email": email,
            "chatgpt_account_id": chatgpt_account_id,
        }
        return True

    async def get_token_donor_by_chatgpt_account_id(
        self,
        chatgpt_account_id: str,
        *,
        exclude_account_id: str | None = None,
    ) -> Account | None:
        _ = chatgpt_account_id, exclude_account_id
        return self.token_donor


@pytest.mark.asyncio
async def test_refresh_account_preserves_plan_type_when_missing(monkeypatch):
    async def _fake_refresh(_: str) -> TokenRefreshResult:
        return TokenRefreshResult(
            access_token="new-access",
            refresh_token="new-refresh",
            id_token="new-id",
            account_id="acc_1",
            plan_type=None,
            email=None,
        )

    monkeypatch.setattr(auth_manager_module, "refresh_access_token", _fake_refresh)

    encryptor = TokenEncryptor()
    account = Account(
        id="acc_1",
        email="user@example.com",
        plan_type="pro",
        access_token_encrypted=encryptor.encrypt("access-old"),
        refresh_token_encrypted=encryptor.encrypt("refresh-old"),
        id_token_encrypted=encryptor.encrypt("id-old"),
        last_refresh=utcnow(),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
    )
    repo = _DummyRepo()
    manager = AuthManager(cast(AccountsRepositoryPort, repo))

    updated = await manager.refresh_account(account)

    assert updated.plan_type == "pro"
    assert repo.tokens_payload is not None
    assert repo.tokens_payload["plan_type"] == "pro"


@pytest.mark.asyncio
async def test_refresh_account_recovers_from_refresh_token_reused_with_donor(monkeypatch):
    async def _fake_refresh(_: str) -> TokenRefreshResult:
        raise RefreshError(
            code="refresh_token_reused",
            message="refresh token reused",
            is_permanent=True,
        )

    monkeypatch.setattr(auth_manager_module, "refresh_access_token", _fake_refresh)

    encryptor = TokenEncryptor()
    donor = Account(
        id="acc_donor",
        email="donor@example.com",
        plan_type="team",
        access_token_encrypted=encryptor.encrypt("donor-access"),
        refresh_token_encrypted=encryptor.encrypt("donor-refresh"),
        id_token_encrypted=encryptor.encrypt("donor-id"),
        last_refresh=utcnow(),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
        chatgpt_account_id="workspace_1",
    )
    target = Account(
        id="acc_target",
        email="target@example.com",
        plan_type="free",
        access_token_encrypted=encryptor.encrypt("target-access"),
        refresh_token_encrypted=encryptor.encrypt("target-refresh"),
        id_token_encrypted=encryptor.encrypt("target-id"),
        last_refresh=utcnow(),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
        chatgpt_account_id="workspace_1",
    )
    repo = _DummyRepo()
    repo.token_donor = donor
    manager = AuthManager(cast(AccountsRepositoryPort, repo))

    updated = await manager.refresh_account(target)

    assert updated.status == AccountStatus.ACTIVE
    assert updated.deactivation_reason is None
    assert updated.plan_type == "team"
    assert repo.tokens_payload is not None
    assert repo.tokens_payload["account_id"] == "acc_target"
    assert repo.status_payload is not None
    assert repo.status_payload["status"] == AccountStatus.ACTIVE
    assert repo.status_payload["deactivation_reason"] is None


@pytest.mark.asyncio
async def test_refresh_account_deactivates_when_no_token_donor(monkeypatch):
    async def _fake_refresh(_: str) -> TokenRefreshResult:
        raise RefreshError(
            code="refresh_token_reused",
            message="refresh token reused",
            is_permanent=True,
        )

    monkeypatch.setattr(auth_manager_module, "refresh_access_token", _fake_refresh)

    encryptor = TokenEncryptor()
    account = Account(
        id="acc_target",
        email="target@example.com",
        plan_type="free",
        access_token_encrypted=encryptor.encrypt("target-access"),
        refresh_token_encrypted=encryptor.encrypt("target-refresh"),
        id_token_encrypted=encryptor.encrypt("target-id"),
        last_refresh=utcnow(),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
        chatgpt_account_id="workspace_1",
    )
    repo = _DummyRepo()
    manager = AuthManager(cast(AccountsRepositoryPort, repo))

    with pytest.raises(RefreshError):
        await manager.refresh_account(account)

    assert account.status == AccountStatus.DEACTIVATED
    assert repo.status_payload is not None
    assert repo.status_payload["status"] == AccountStatus.DEACTIVATED
    assert repo.tokens_payload is None
