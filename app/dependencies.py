from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import cast

from fastapi import Depends, Request, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_background_session, get_session
from app.modules.accounts.repository import AccountsRepository
from app.modules.accounts.service import AccountsService
from app.modules.api_keys.repository import ApiKeysRepository
from app.modules.api_keys.service import ApiKeysService
from app.modules.audit.repository import AuditRepository
from app.modules.audit.service import AuditLogsService
from app.modules.billing.medusa_client import MedusaBillingSummaryClient
from app.modules.billing.repository import BillingRepository
from app.modules.billing.service import BillingService
from app.modules.dashboard.repository import DashboardRepository
from app.modules.dashboard.service import DashboardService
from app.modules.dashboard_auth.repository import DashboardAuthRepository
from app.modules.dashboard_auth.service import (
    DashboardAuthRepositoryProtocol,
    DashboardAuthService,
    get_dashboard_session_store,
)
from app.modules.medusa_admin_auth.repository import MedusaAdminAuthRepository
from app.modules.medusa_admin_auth.service import (
    MedusaAdminAuthRepositoryProtocol,
    MedusaAdminAuthService,
)
from app.modules.devices.repository import DevicesRepository
from app.modules.devices.service import DevicesRepositoryPort, DevicesService
from app.modules.firewall.repository import FirewallRepository
from app.modules.firewall.service import FirewallRepositoryPort, FirewallService
from app.modules.oauth.service import OauthService
from app.modules.proxy.repo_bundle import ProxyRepositories
from app.modules.proxy.service import ProxyService
from app.modules.proxy.sticky_repository import StickySessionsRepository
from app.modules.projects.repository import ProjectsRepository
from app.modules.projects.service import ProjectsRepositoryPort, ProjectsService
from app.modules.request_logs.repository import RequestLogsRepository
from app.modules.request_logs.service import RequestLogsService
from app.modules.settings.repository import SettingsRepository
from app.modules.settings.service import SettingsService
from app.modules.sticky_sessions.service import StickySessionsService
from app.modules.usage.repository import AdditionalUsageRepository, UsageRepository
from app.modules.usage.service import UsageService
from app.modules.workspaces.repository import WorkspacesRepository
from app.modules.workspaces.service import WorkspacesRepositoryPort, WorkspacesService


@dataclass(slots=True)
class AccountsContext:
    session: AsyncSession
    repository: AccountsRepository
    service: AccountsService


@dataclass(slots=True)
class AuditContext:
    session: AsyncSession
    repository: AuditRepository
    service: AuditLogsService


@dataclass(slots=True)
class BillingContext:
    session: AsyncSession
    repository: BillingRepository
    service: BillingService


@dataclass(slots=True)
class UsageContext:
    session: AsyncSession
    usage_repository: UsageRepository
    service: UsageService


@dataclass(slots=True)
class OauthContext:
    service: OauthService


@dataclass(slots=True)
class DashboardAuthContext:
    session: AsyncSession
    repository: DashboardAuthRepository
    service: DashboardAuthService


@dataclass(slots=True)
class MedusaAdminAuthContext:
    session: AsyncSession
    repository: MedusaAdminAuthRepository
    service: MedusaAdminAuthService


@dataclass(slots=True)
class ProxyContext:
    service: ProxyService


@dataclass(slots=True)
class ApiKeysContext:
    session: AsyncSession
    repository: ApiKeysRepository
    service: ApiKeysService


@dataclass(slots=True)
class RequestLogsContext:
    session: AsyncSession
    repository: RequestLogsRepository
    service: RequestLogsService


@dataclass(slots=True)
class SettingsContext:
    session: AsyncSession
    repository: SettingsRepository
    service: SettingsService


@dataclass(slots=True)
class DashboardContext:
    session: AsyncSession
    repository: DashboardRepository
    service: DashboardService


@dataclass(slots=True)
class FirewallContext:
    session: AsyncSession
    repository: FirewallRepository
    service: FirewallService


@dataclass(slots=True)
class DevicesContext:
    session: AsyncSession
    repository: DevicesRepository
    service: DevicesService


@dataclass(slots=True)
class ProjectsContext:
    session: AsyncSession
    repository: ProjectsRepository
    service: ProjectsService


@dataclass(slots=True)
class StickySessionsContext:
    session: AsyncSession
    repository: StickySessionsRepository
    settings_repository: SettingsRepository
    service: StickySessionsService


@dataclass(slots=True)
class WorkspacesContext:
    session: AsyncSession
    repository: WorkspacesRepository
    service: WorkspacesService


def get_accounts_context(
    session: AsyncSession = Depends(get_session),
) -> AccountsContext:
    repository = AccountsRepository(session)
    usage_repository = UsageRepository(session)
    additional_usage_repository = AdditionalUsageRepository(session)
    service = AccountsService(repository, usage_repository, additional_usage_repository)
    return AccountsContext(
        session=session,
        repository=repository,
        service=service,
    )


def get_audit_context(
    session: AsyncSession = Depends(get_session),
) -> AuditContext:
    repository = AuditRepository(session)
    service = AuditLogsService(repository)
    return AuditContext(session=session, repository=repository, service=service)


def get_billing_context(
    session: AsyncSession = Depends(get_session),
) -> BillingContext:
    repository = BillingRepository(session)
    service = BillingService(repository, MedusaBillingSummaryClient())
    return BillingContext(session=session, repository=repository, service=service)


def get_usage_context(
    session: AsyncSession = Depends(get_session),
) -> UsageContext:
    usage_repository = UsageRepository(session)
    request_logs_repository = RequestLogsRepository(session)
    accounts_repository = AccountsRepository(session)
    service = UsageService(
        usage_repository,
        request_logs_repository,
        accounts_repository,
    )
    return UsageContext(
        session=session,
        usage_repository=usage_repository,
        service=service,
    )


@asynccontextmanager
async def _accounts_repo_context() -> AsyncIterator[AccountsRepository]:
    async with get_background_session() as session:
        yield AccountsRepository(session)


@asynccontextmanager
async def _proxy_repo_context() -> AsyncIterator[ProxyRepositories]:
    async with get_background_session() as session:
        yield ProxyRepositories(
            accounts=AccountsRepository(session),
            usage=UsageRepository(session),
            request_logs=RequestLogsRepository(session),
            sticky_sessions=StickySessionsRepository(session),
            api_keys=ApiKeysRepository(session),
            additional_usage=AdditionalUsageRepository(session),
        )


def get_oauth_context(
    session: AsyncSession = Depends(get_session),
) -> OauthContext:
    accounts_repository = AccountsRepository(session)
    return OauthContext(service=OauthService(accounts_repository, repo_factory=_accounts_repo_context))


def get_dashboard_auth_context(
    session: AsyncSession = Depends(get_session),
) -> DashboardAuthContext:
    repository = DashboardAuthRepository(session)
    service = DashboardAuthService(cast(DashboardAuthRepositoryProtocol, repository), get_dashboard_session_store())
    return DashboardAuthContext(session=session, repository=repository, service=service)


def get_medusa_admin_auth_context(
    session: AsyncSession = Depends(get_session),
) -> MedusaAdminAuthContext:
    repository = MedusaAdminAuthRepository(session)
    service = MedusaAdminAuthService(cast(MedusaAdminAuthRepositoryProtocol, repository))
    return MedusaAdminAuthContext(session=session, repository=repository, service=service)


def get_proxy_context(request: Request) -> ProxyContext:
    service = get_proxy_service_for_app(request.app)
    return ProxyContext(service=service)


def get_proxy_service_for_app(app: object) -> ProxyService:
    state = getattr(app, "state", None)
    service = getattr(state, "proxy_service", None)
    if not isinstance(service, ProxyService):
        service = ProxyService(repo_factory=_proxy_repo_context)
        setattr(state, "proxy_service", service)
    return service


def get_proxy_websocket_context(websocket: WebSocket) -> ProxyContext:
    service = get_proxy_service_for_app(websocket.app)
    return ProxyContext(service=service)


def get_api_keys_context(
    session: AsyncSession = Depends(get_session),
) -> ApiKeysContext:
    repository = ApiKeysRepository(session)
    service = ApiKeysService(repository)
    return ApiKeysContext(session=session, repository=repository, service=service)


def get_request_logs_context(
    session: AsyncSession = Depends(get_session),
) -> RequestLogsContext:
    repository = RequestLogsRepository(session)
    service = RequestLogsService(repository)
    return RequestLogsContext(session=session, repository=repository, service=service)


def get_settings_context(
    session: AsyncSession = Depends(get_session),
) -> SettingsContext:
    repository = SettingsRepository(session)
    service = SettingsService(repository)
    return SettingsContext(session=session, repository=repository, service=service)


def get_dashboard_context(
    session: AsyncSession = Depends(get_session),
) -> DashboardContext:
    repository = DashboardRepository(session)
    service = DashboardService(repository)
    return DashboardContext(session=session, repository=repository, service=service)


def get_firewall_context(
    session: AsyncSession = Depends(get_session),
) -> FirewallContext:
    repository = FirewallRepository(session)
    service = FirewallService(cast(FirewallRepositoryPort, repository))
    return FirewallContext(session=session, repository=repository, service=service)


def get_devices_context(
    session: AsyncSession = Depends(get_session),
) -> DevicesContext:
    repository = DevicesRepository(session)
    service = DevicesService(cast(DevicesRepositoryPort, repository))
    return DevicesContext(session=session, repository=repository, service=service)


def get_projects_context(
    session: AsyncSession = Depends(get_session),
) -> ProjectsContext:
    repository = ProjectsRepository(session)
    service = ProjectsService(cast(ProjectsRepositoryPort, repository))
    return ProjectsContext(session=session, repository=repository, service=service)


def get_sticky_sessions_context(
    session: AsyncSession = Depends(get_session),
) -> StickySessionsContext:
    repository = StickySessionsRepository(session)
    settings_repository = SettingsRepository(session)
    accounts_repository = AccountsRepository(session)
    service = StickySessionsService(repository, settings_repository, accounts_repository)
    return StickySessionsContext(
        session=session,
        repository=repository,
        settings_repository=settings_repository,
        service=service,
    )


def get_workspaces_context(
    session: AsyncSession = Depends(get_session),
) -> WorkspacesContext:
    repository = WorkspacesRepository(session)
    service = WorkspacesService(cast(WorkspacesRepositoryPort, repository))
    return WorkspacesContext(
        session=session,
        repository=repository,
        service=service,
    )
