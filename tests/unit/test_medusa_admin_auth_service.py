from __future__ import annotations

from dataclasses import dataclass

import pytest

from app.core.auth.totp import TotpVerificationResult
from app.modules.medusa_admin_auth.service import (
    MedusaAdminAuthService,
    MedusaAdminTotpAlreadyConfiguredError,
    MedusaAdminTotpInvalidCodeError,
    MedusaAdminTotpNotConfiguredError,
)

pytestmark = pytest.mark.unit


@dataclass(slots=True)
class _FakeRecord:
    email: str
    totp_enabled: bool = False
    totp_secret_encrypted: bytes | None = None
    totp_last_verified_step: int | None = None


class _FakeRepository:
    def __init__(self) -> None:
        self.records: dict[str, _FakeRecord] = {}

    async def get_by_email(self, email: str) -> _FakeRecord | None:
        return self.records.get(email)

    async def get_or_create(self, email: str) -> _FakeRecord:
        if email not in self.records:
            self.records[email] = _FakeRecord(email=email)
        return self.records[email]

    async def configure_totp(self, email: str, secret_encrypted: bytes, verified_step: int) -> _FakeRecord:
        row = await self.get_or_create(email)
        row.totp_enabled = True
        row.totp_secret_encrypted = secret_encrypted
        row.totp_last_verified_step = verified_step
        return row

    async def clear_totp(self, email: str) -> _FakeRecord:
        row = await self.get_or_create(email)
        row.totp_enabled = False
        row.totp_secret_encrypted = None
        row.totp_last_verified_step = None
        return row

    async def try_advance_totp_last_verified_step(self, email: str, step: int) -> bool:
        row = await self.get_or_create(email)
        current = row.totp_last_verified_step
        if current is not None and current >= step:
            return False
        row.totp_last_verified_step = step
        return True


def _patch_verifier(monkeypatch: pytest.MonkeyPatch, *, accepted_code: str, matched_step: int) -> None:
    def _fake_verify(secret: str, code: str, *, window: int = 1, last_verified_step: int | None = None) -> TotpVerificationResult:
        if code != accepted_code:
            return TotpVerificationResult(is_valid=False, matched_step=None)
        if last_verified_step is not None and matched_step <= last_verified_step:
            return TotpVerificationResult(is_valid=False, matched_step=matched_step)
        return TotpVerificationResult(is_valid=True, matched_step=matched_step)

    monkeypatch.setattr(
        "app.modules.medusa_admin_auth.service.verify_totp_code",
        _fake_verify,
    )


@pytest.mark.asyncio
async def test_status_defaults_to_disabled_for_unknown_email() -> None:
    service = MedusaAdminAuthService(_FakeRepository())

    status = await service.get_status("Admin@Example.com")

    assert status.email == "admin@example.com"
    assert status.totp_enabled is False


@pytest.mark.asyncio
async def test_setup_and_verify_flow_requires_valid_code(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_verifier(monkeypatch, accepted_code="123456", matched_step=42)
    service = MedusaAdminAuthService(_FakeRepository())

    setup = await service.start_totp_setup("admin@example.com")
    await service.confirm_totp_setup(email="admin@example.com", secret=setup.secret, code="123456")

    status = await service.get_status("admin@example.com")
    assert status.totp_enabled is True

    session = await service.verify_totp(email="admin@example.com", code="123456")
    assert session.email == "admin@example.com"
    assert session.matched_step == 42

    with pytest.raises(MedusaAdminTotpInvalidCodeError):
        await service.verify_totp(email="admin@example.com", code="123456")


@pytest.mark.asyncio
async def test_confirm_rejects_duplicate_setup(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_verifier(monkeypatch, accepted_code="123456", matched_step=42)
    service = MedusaAdminAuthService(_FakeRepository())
    setup = await service.start_totp_setup("admin@example.com")
    await service.confirm_totp_setup(email="admin@example.com", secret=setup.secret, code="123456")

    with pytest.raises(MedusaAdminTotpAlreadyConfiguredError):
        await service.start_totp_setup("admin@example.com")


@pytest.mark.asyncio
async def test_disable_clears_secret(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_verifier(monkeypatch, accepted_code="654321", matched_step=77)
    service = MedusaAdminAuthService(_FakeRepository())
    setup = await service.start_totp_setup("admin@example.com")
    await service.confirm_totp_setup(email="admin@example.com", secret=setup.secret, code="654321")

    await service.disable_totp(email="admin@example.com", code="654321")

    status = await service.get_status("admin@example.com")
    assert status.totp_enabled is False

    with pytest.raises(MedusaAdminTotpNotConfiguredError):
        await service.verify_totp(email="admin@example.com", code="654321")
