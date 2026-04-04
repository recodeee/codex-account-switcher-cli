from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile, WebSocket

from app.core.auth.refresh import RefreshError
from app.core.audit.service import AuditService
from app.core.auth.dependencies import set_dashboard_error_format, validate_dashboard_session
from app.core.config.settings_cache import get_settings_cache
from app.core.exceptions import DashboardBadRequestError, DashboardConflictError, DashboardNotFoundError
from app.dependencies import AccountsContext, get_accounts_context
from app.modules.accounts.codex_auth_switcher import (
    CodexAuthSnapshotConflictError,
    CodexAuthNotInstalledError,
    CodexAuthSnapshotNotFoundError,
    CodexAuthSnapshotRepairFailedError,
    CodexAuthSwitchFailedError,
)
from app.modules.accounts.repository import AccountIdentityConflictError
from app.modules.accounts.schemas import (
    AccountDeleteResponse,
    AccountImportResponse,
    AccountOpenTerminalResponse,
    AccountPauseResponse,
    AccountRefreshAuthResponse,
    AccountReactivateResponse,
    AccountSnapshotRepairResponse,
    AccountsResponse,
    AccountTrendsResponse,
    AccountUseLocalResponse,
)
from app.modules.accounts.service import InvalidAuthJsonError
from app.modules.accounts.terminal import (
    TerminalLaunchError,
    TerminalProcess,
    open_host_terminal,
    stream_terminal_session,
)
from app.modules.dashboard_auth.service import DASHBOARD_SESSION_COOKIE, get_dashboard_session_store

router = APIRouter(
    prefix="/api/accounts",
    tags=["dashboard"],
    dependencies=[Depends(validate_dashboard_session), Depends(set_dashboard_error_format)],
)

ws_router = APIRouter(prefix="/api/accounts", tags=["dashboard"])


@router.get("", response_model=AccountsResponse)
async def list_accounts(
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountsResponse:
    accounts = await context.service.list_accounts()
    return AccountsResponse(accounts=accounts)


@router.get("/{account_id}/trends", response_model=AccountTrendsResponse)
async def get_account_trends(
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountTrendsResponse:
    result = await context.service.get_account_trends(account_id)
    if not result:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    return result


@router.post("/import", response_model=AccountImportResponse)
async def import_account(
    request: Request,
    auth_json: UploadFile = File(...),
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountImportResponse:
    raw = await auth_json.read()
    try:
        response = await context.service.import_account(raw)
        AuditService.log_async(
            "account_created",
            actor_ip=request.client.host if request.client else None,
            details={"account_id": response.account_id},
        )
        return response
    except InvalidAuthJsonError as exc:
        raise DashboardBadRequestError("Invalid auth.json payload", code="invalid_auth_json") from exc
    except AccountIdentityConflictError as exc:
        raise DashboardConflictError(str(exc), code="duplicate_identity_conflict") from exc


@router.post("/{account_id}/reactivate", response_model=AccountReactivateResponse)
async def reactivate_account(
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountReactivateResponse:
    success = await context.service.reactivate_account(account_id)
    if not success:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    return AccountReactivateResponse(status="reactivated")


@router.post("/{account_id}/pause", response_model=AccountPauseResponse)
async def pause_account(
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountPauseResponse:
    success = await context.service.pause_account(account_id)
    if not success:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    return AccountPauseResponse(status="paused")


@router.delete("/{account_id}", response_model=AccountDeleteResponse)
async def delete_account(
    request: Request,
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountDeleteResponse:
    success = await context.service.delete_account(account_id)
    if not success:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    AuditService.log_async(
        "account_deleted",
        actor_ip=request.client.host if request.client else None,
        details={"account_id": account_id},
    )
    return AccountDeleteResponse(status="deleted")


@router.post("/{account_id}/use-local", response_model=AccountUseLocalResponse)
async def use_account_locally(
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountUseLocalResponse:
    try:
        result = await context.service.use_account_locally(account_id)
    except CodexAuthSnapshotNotFoundError as exc:
        raise DashboardBadRequestError(str(exc), code="codex_auth_snapshot_not_found") from exc
    except CodexAuthNotInstalledError as exc:
        raise DashboardBadRequestError(str(exc), code="codex_auth_not_installed") from exc
    except CodexAuthSwitchFailedError as exc:
        raise DashboardBadRequestError(str(exc), code="codex_auth_switch_failed") from exc

    if result is None:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    return result


@router.post("/{account_id}/refresh-auth", response_model=AccountRefreshAuthResponse)
async def refresh_account_auth(
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountRefreshAuthResponse:
    try:
        result = await context.service.refresh_account_auth(account_id)
    except RefreshError as exc:
        raise DashboardBadRequestError(exc.message, code="account_refresh_failed") from exc

    if result is None:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    return result


@router.post("/{account_id}/repair-snapshot", response_model=AccountSnapshotRepairResponse)
async def repair_account_snapshot(
    account_id: str,
    mode: Literal["readd", "rename"] = Query(default="readd"),
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountSnapshotRepairResponse:
    try:
        result = await context.service.repair_account_snapshot(account_id, mode=mode)
    except CodexAuthSnapshotNotFoundError as exc:
        raise DashboardBadRequestError(str(exc), code="codex_auth_snapshot_not_found") from exc
    except CodexAuthSnapshotConflictError as exc:
        raise DashboardConflictError(str(exc), code="codex_auth_snapshot_conflict") from exc
    except CodexAuthSnapshotRepairFailedError as exc:
        raise DashboardBadRequestError(str(exc), code="codex_auth_snapshot_repair_failed") from exc

    if result is None:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    return result


@router.post("/{account_id}/open-terminal", response_model=AccountOpenTerminalResponse)
async def open_account_terminal(
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> AccountOpenTerminalResponse:
    try:
        resolved = await context.service.resolve_account_snapshot(account_id)
    except CodexAuthSnapshotNotFoundError as exc:
        raise DashboardBadRequestError(str(exc), code="codex_auth_snapshot_not_found") from exc

    if resolved is None:
        raise DashboardNotFoundError("Account not found", code="account_not_found")
    resolved_account_id, resolved_snapshot_name = resolved

    try:
        open_host_terminal(account_id=resolved_account_id, snapshot_name=resolved_snapshot_name)
    except TerminalLaunchError as exc:
        raise DashboardBadRequestError(str(exc), code="terminal_launch_failed") from exc

    return AccountOpenTerminalResponse(
        status="opened",
        account_id=resolved_account_id,
        snapshot_name=resolved_snapshot_name,
    )


@ws_router.websocket("/{account_id}/terminal/ws")
async def account_terminal_websocket(
    websocket: WebSocket,
    account_id: str,
    context: AccountsContext = Depends(get_accounts_context),
) -> None:
    if not await _validate_dashboard_websocket_session(websocket):
        return

    try:
        resolved = await context.service.resolve_account_snapshot(account_id)
    except CodexAuthSnapshotNotFoundError as exc:
        await _send_terminal_error(websocket, str(exc), code="codex_auth_snapshot_not_found")
        return

    if resolved is None:
        await _send_terminal_error(websocket, "Account not found", code="account_not_found")
        return
    resolved_account_id, resolved_snapshot_name = resolved

    try:
        terminal_process, launch = TerminalProcess.start(
            account_id=resolved_account_id,
            snapshot_name=resolved_snapshot_name,
        )
    except TerminalLaunchError as exc:
        await _send_terminal_error(websocket, str(exc), code="terminal_launch_failed")
        return

    await websocket.accept()
    await stream_terminal_session(
        websocket=websocket,
        terminal_process=terminal_process,
        launch=launch,
        account_id=resolved_account_id,
        snapshot_name=resolved_snapshot_name,
    )


async def _validate_dashboard_websocket_session(websocket: WebSocket) -> bool:
    settings = await get_settings_cache().get()
    requires_auth = settings.password_hash is not None or settings.totp_required_on_login
    if not requires_auth:
        return True

    session_id = websocket.cookies.get(DASHBOARD_SESSION_COOKIE)
    state = get_dashboard_session_store().get(session_id)
    if state is None:
        await websocket.close(code=4401, reason="Authentication is required")
        return False

    if settings.password_hash is not None and not state.password_verified:
        await websocket.close(code=4401, reason="Authentication is required")
        return False

    if settings.totp_required_on_login and not state.totp_verified:
        await websocket.close(code=4403, reason="TOTP verification is required")
        return False

    return True


async def _send_terminal_error(websocket: WebSocket, message: str, *, code: str) -> None:
    await websocket.accept()
    await websocket.send_json({"type": "error", "message": message, "code": code})
    await websocket.close(code=1011)
