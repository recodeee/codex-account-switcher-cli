from __future__ import annotations

import base64
from dataclasses import dataclass
from io import BytesIO
from typing import Protocol

import segno

from app.core.auth.totp import build_otpauth_uri, generate_totp_secret, verify_totp_code
from app.core.crypto import TokenEncryptor
from app.core.rate_limiter.db_rate_limiter import DatabaseRateLimiter
from app.modules.medusa_admin_auth.schemas import (
    MedusaAdminSecondFactorSetupStartResponse,
    MedusaAdminSecondFactorStatusResponse,
)

_TOTP_ISSUER = "codex-lb"


class MedusaAdminTotpAlreadyConfiguredError(ValueError):
    pass


class MedusaAdminTotpNotConfiguredError(ValueError):
    pass


class MedusaAdminTotpInvalidCodeError(ValueError):
    pass


class MedusaAdminTotpInvalidSetupError(ValueError):
    pass


class MedusaAdminAuthRepositoryProtocol(Protocol):
    async def get_by_email(self, email: str): ...
    async def get_or_create(self, email: str): ...
    async def configure_totp(self, email: str, secret_encrypted: bytes, verified_step: int): ...
    async def clear_totp(self, email: str): ...
    async def try_advance_totp_last_verified_step(self, email: str, step: int) -> bool: ...


@dataclass(slots=True)
class MedusaAdminSecondFactorSession:
    email: str
    matched_step: int


class MedusaAdminAuthService:
    def __init__(self, repository: MedusaAdminAuthRepositoryProtocol) -> None:
        self._repository = repository
        self._encryptor = TokenEncryptor()

    async def get_status(self, email: str) -> MedusaAdminSecondFactorStatusResponse:
        normalized_email = _normalize_email(email)
        row = await self._repository.get_by_email(normalized_email)
        return MedusaAdminSecondFactorStatusResponse(
            email=normalized_email,
            totp_enabled=bool(row and row.totp_enabled and row.totp_secret_encrypted),
        )

    async def start_totp_setup(self, email: str) -> MedusaAdminSecondFactorSetupStartResponse:
        normalized_email = _normalize_email(email)
        row = await self._repository.get_or_create(normalized_email)
        if row.totp_enabled and row.totp_secret_encrypted is not None:
            raise MedusaAdminTotpAlreadyConfiguredError(
                "TOTP is already configured for this Medusa admin account."
            )
        secret = generate_totp_secret()
        otpauth_uri = build_otpauth_uri(secret, issuer=_TOTP_ISSUER, account_name=normalized_email)
        return MedusaAdminSecondFactorSetupStartResponse(
            email=normalized_email,
            totp_enabled=False,
            secret=secret,
            otpauth_uri=otpauth_uri,
            qr_svg_data_uri=_qr_svg_data_uri(otpauth_uri),
        )

    async def confirm_totp_setup(self, *, email: str, secret: str, code: str) -> None:
        normalized_email = _normalize_email(email)
        row = await self._repository.get_or_create(normalized_email)
        if row.totp_enabled and row.totp_secret_encrypted is not None:
            raise MedusaAdminTotpAlreadyConfiguredError(
                "TOTP is already configured for this Medusa admin account."
            )
        try:
            verification = verify_totp_code(secret, code, window=1)
        except ValueError as exc:
            raise MedusaAdminTotpInvalidSetupError("Invalid TOTP setup payload") from exc
        if not verification.is_valid or verification.matched_step is None:
            raise MedusaAdminTotpInvalidCodeError("Invalid TOTP code")
        await self._repository.configure_totp(
            normalized_email,
            self._encryptor.encrypt(secret),
            verification.matched_step,
        )

    async def verify_totp(self, *, email: str, code: str) -> MedusaAdminSecondFactorSession:
        normalized_email = _normalize_email(email)
        row = await self._repository.get_by_email(normalized_email)
        if row is None or not row.totp_enabled or row.totp_secret_encrypted is None:
            raise MedusaAdminTotpNotConfiguredError("TOTP is not configured for this Medusa admin account.")
        secret = self._encryptor.decrypt(row.totp_secret_encrypted)
        verification = verify_totp_code(
            secret,
            code,
            window=1,
            last_verified_step=row.totp_last_verified_step,
        )
        if not verification.is_valid or verification.matched_step is None:
            raise MedusaAdminTotpInvalidCodeError("Invalid TOTP code")
        updated = await self._repository.try_advance_totp_last_verified_step(
            normalized_email,
            verification.matched_step,
        )
        if not updated:
            raise MedusaAdminTotpInvalidCodeError("Invalid TOTP code")
        return MedusaAdminSecondFactorSession(
            email=normalized_email,
            matched_step=verification.matched_step,
        )

    async def disable_totp(self, *, email: str, code: str) -> None:
        await self.verify_totp(email=email, code=code)
        await self._repository.clear_totp(_normalize_email(email))


_medusa_admin_totp_rate_limiter = DatabaseRateLimiter(
    max_attempts=8,
    window_seconds=60,
    type="medusa_admin_totp",
)


def get_medusa_admin_totp_rate_limiter() -> DatabaseRateLimiter:
    return _medusa_admin_totp_rate_limiter


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _qr_svg_data_uri(payload: str) -> str:
    qr = segno.make(payload)
    buffer = BytesIO()
    qr.save(buffer, kind="svg", xmldecl=False, scale=6, border=2)
    raw = buffer.getvalue()
    return f"data:image/svg+xml;base64,{base64.b64encode(raw).decode('ascii')}"
