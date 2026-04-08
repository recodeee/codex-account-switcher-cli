from __future__ import annotations

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import MedusaAdminSecondFactor


class MedusaAdminAuthRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_email(self, email: str) -> MedusaAdminSecondFactor | None:
        result = await self._session.execute(
            select(MedusaAdminSecondFactor).where(MedusaAdminSecondFactor.email == email)
        )
        return result.scalar_one_or_none()

    async def get_or_create(self, email: str) -> MedusaAdminSecondFactor:
        row = await self.get_by_email(email)
        if row is not None:
            return row
        row = MedusaAdminSecondFactor(email=email)
        self._session.add(row)
        await self._session.commit()
        await self._session.refresh(row)
        return row

    async def configure_totp(
        self,
        email: str,
        secret_encrypted: bytes,
        verified_step: int,
    ) -> MedusaAdminSecondFactor:
        row = await self.get_or_create(email)
        row.totp_enabled = True
        row.totp_secret_encrypted = secret_encrypted
        row.totp_last_verified_step = verified_step
        await self._session.commit()
        await self._session.refresh(row)
        return row

    async def clear_totp(self, email: str) -> MedusaAdminSecondFactor:
        row = await self.get_or_create(email)
        row.totp_enabled = False
        row.totp_secret_encrypted = None
        row.totp_last_verified_step = None
        await self._session.commit()
        await self._session.refresh(row)
        return row

    async def try_advance_totp_last_verified_step(self, email: str, step: int) -> bool:
        await self.get_or_create(email)
        result = await self._session.execute(
            update(MedusaAdminSecondFactor)
            .where(MedusaAdminSecondFactor.email == email)
            .where(
                or_(
                    MedusaAdminSecondFactor.totp_last_verified_step.is_(None),
                    MedusaAdminSecondFactor.totp_last_verified_step < step,
                )
            )
            .values(totp_last_verified_step=step)
            .returning(MedusaAdminSecondFactor.email)
        )
        await self._session.commit()
        return result.scalar_one_or_none() is not None
