from __future__ import annotations

from app.modules.shared.schemas import DashboardModel


class MedusaAdminSecondFactorStatusResponse(DashboardModel):
    email: str
    totp_enabled: bool


class MedusaAdminSecondFactorEmailRequest(DashboardModel):
    email: str


class MedusaAdminSecondFactorSetupStartResponse(DashboardModel):
    email: str
    totp_enabled: bool
    secret: str
    otpauth_uri: str
    qr_svg_data_uri: str


class MedusaAdminSecondFactorSetupConfirmRequest(DashboardModel):
    email: str
    secret: str
    code: str


class MedusaAdminSecondFactorVerifyRequest(DashboardModel):
    email: str
    code: str
