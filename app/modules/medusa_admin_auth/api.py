from __future__ import annotations

from fastapi import APIRouter, Body, Depends, Query, Request
from fastapi.responses import JSONResponse

from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.exceptions import (
    DashboardBadRequestError,
    DashboardRateLimitError,
)
from app.dependencies import MedusaAdminAuthContext, get_medusa_admin_auth_context
from app.modules.medusa_admin_auth.schemas import (
    MedusaAdminSecondFactorEmailRequest,
    MedusaAdminSecondFactorSetupConfirmRequest,
    MedusaAdminSecondFactorSetupStartResponse,
    MedusaAdminSecondFactorStatusResponse,
    MedusaAdminSecondFactorVerifyRequest,
)
from app.modules.medusa_admin_auth.service import (
    MedusaAdminTotpAlreadyConfiguredError,
    MedusaAdminTotpInvalidCodeError,
    MedusaAdminTotpInvalidSetupError,
    MedusaAdminTotpNotConfiguredError,
    get_medusa_admin_totp_rate_limiter,
)

router = APIRouter(
    prefix="/api/medusa-admin-auth",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)


def _client_rate_key(request: Request, email: str, *, prefix: str) -> str:
    client_host = request.client.host if request.client else "unknown"
    return f"{prefix}:{client_host}:{email.lower()}"


@router.get("/status", response_model=MedusaAdminSecondFactorStatusResponse)
async def get_medusa_admin_second_factor_status(
    email: str = Query(...),
    context: MedusaAdminAuthContext = Depends(get_medusa_admin_auth_context),
) -> MedusaAdminSecondFactorStatusResponse:
    return await context.service.get_status(email)


@router.post("/totp/setup/start", response_model=MedusaAdminSecondFactorSetupStartResponse)
async def start_medusa_admin_totp_setup(
    payload: MedusaAdminSecondFactorEmailRequest = Body(...),
    context: MedusaAdminAuthContext = Depends(get_medusa_admin_auth_context),
) -> MedusaAdminSecondFactorSetupStartResponse:
    try:
        return await context.service.start_totp_setup(payload.email)
    except MedusaAdminTotpAlreadyConfiguredError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_setup") from exc


@router.post("/totp/setup/confirm")
async def confirm_medusa_admin_totp_setup(
    request: Request,
    payload: MedusaAdminSecondFactorSetupConfirmRequest = Body(...),
    context: MedusaAdminAuthContext = Depends(get_medusa_admin_auth_context),
) -> JSONResponse:
    limiter = get_medusa_admin_totp_rate_limiter()
    rate_key = _client_rate_key(request, payload.email, prefix="medusa_totp_setup_confirm")
    try:
        await limiter.check_and_increment(rate_key, context.session)
    except DashboardRateLimitError as exc:
        raise DashboardRateLimitError(
            f"Too many attempts. Try again in {exc.retry_after} seconds.",
            retry_after=exc.retry_after,
            code="totp_rate_limited",
        ) from exc
    try:
        await context.service.confirm_totp_setup(
            email=payload.email,
            secret=payload.secret,
            code=payload.code,
        )
    except MedusaAdminTotpAlreadyConfiguredError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_setup") from exc
    except MedusaAdminTotpInvalidSetupError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_setup") from exc
    except MedusaAdminTotpInvalidCodeError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_code") from exc
    await limiter.clear_for_key(rate_key, context.session)
    return JSONResponse(status_code=200, content={"status": "ok"})


@router.post("/totp/verify")
async def verify_medusa_admin_totp(
    request: Request,
    payload: MedusaAdminSecondFactorVerifyRequest = Body(...),
    context: MedusaAdminAuthContext = Depends(get_medusa_admin_auth_context),
) -> JSONResponse:
    limiter = get_medusa_admin_totp_rate_limiter()
    rate_key = _client_rate_key(request, payload.email, prefix="medusa_totp_verify")
    try:
        await limiter.check_and_increment(rate_key, context.session)
    except DashboardRateLimitError as exc:
        raise DashboardRateLimitError(
            f"Too many attempts. Try again in {exc.retry_after} seconds.",
            retry_after=exc.retry_after,
            code="totp_rate_limited",
        ) from exc
    try:
        await context.service.verify_totp(email=payload.email, code=payload.code)
    except MedusaAdminTotpNotConfiguredError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_code") from exc
    except MedusaAdminTotpInvalidCodeError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_code") from exc
    await limiter.clear_for_key(rate_key, context.session)
    return JSONResponse(status_code=200, content={"status": "ok"})


@router.post("/totp/disable")
async def disable_medusa_admin_totp(
    request: Request,
    payload: MedusaAdminSecondFactorVerifyRequest = Body(...),
    context: MedusaAdminAuthContext = Depends(get_medusa_admin_auth_context),
) -> JSONResponse:
    limiter = get_medusa_admin_totp_rate_limiter()
    rate_key = _client_rate_key(request, payload.email, prefix="medusa_totp_disable")
    try:
        await limiter.check_and_increment(rate_key, context.session)
    except DashboardRateLimitError as exc:
        raise DashboardRateLimitError(
            f"Too many attempts. Try again in {exc.retry_after} seconds.",
            retry_after=exc.retry_after,
            code="totp_rate_limited",
        ) from exc
    try:
        await context.service.disable_totp(email=payload.email, code=payload.code)
    except MedusaAdminTotpNotConfiguredError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_code") from exc
    except MedusaAdminTotpInvalidCodeError as exc:
        raise DashboardBadRequestError(str(exc), code="invalid_totp_code") from exc
    await limiter.clear_for_key(rate_key, context.session)
    return JSONResponse(status_code=200, content={"status": "ok"})
