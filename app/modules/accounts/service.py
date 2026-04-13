from __future__ import annotations

import json
from datetime import timedelta
from typing import cast

from pydantic import ValidationError

from app.core.auth import (
    DEFAULT_EMAIL,
    DEFAULT_PLAN,
    claims_from_auth,
    generate_unique_account_id,
    parse_auth_json,
)
from app.core.crypto import TokenEncryptor
from app.core.plan_types import coerce_account_plan_type
from app.core.utils.time import naive_utc_to_epoch, to_utc_naive, utcnow
from app.db.models import Account, AccountStatus
from app.modules.accounts.codex_auth_auto_import import sync_local_codex_auth_snapshots
from app.modules.accounts.codex_auth_status import build_codex_auth_status
from app.modules.accounts.codex_auth_auto_import_ignore import (
    add_auto_import_ignored_account_id,
    remove_auto_import_ignored_account_id,
)
from app.modules.accounts.codex_auth_switcher import (
    CodexAuthSnapshotIndex,
    CodexAuthSnapshotNotFoundError,
    build_snapshot_index,
    repair_snapshot_for_account,
    resolve_snapshot_name_candidates_for_account,
    resolve_snapshot_names_for_account,
    select_snapshot_name,
    switch_snapshot,
)
from app.modules.accounts.auth_manager import AuthManager
from app.modules.accounts.codex_live_usage import (
    read_live_codex_process_session_attribution,
    terminate_live_codex_processes_for_snapshot,
)
from app.modules.accounts.codex_runtime_usage import (
    read_local_codex_runtime_usage_summary_by_snapshot,
)
from app.modules.accounts.live_usage_overrides import (
    apply_local_live_usage_overrides,
    remember_terminated_cli_session_snapshots,
)
from app.modules.accounts.live_usage_persistence import persist_live_usage_overrides
from app.modules.accounts.mappers import build_account_summaries, build_account_usage_trends
from app.modules.accounts.request_usage_fallback import merge_request_usage_with_runtime_fallback
from app.modules.accounts.repository import AccountsRepository
from app.modules.accounts.task_preview_overlay import overlay_live_codex_task_previews
from app.modules.accounts.schemas import (
    AccountAdditionalQuota,
    AccountAdditionalWindow,
    AccountCodexAuthStatus,
    AccountLiveQuotaDebug,
    AccountImportResponse,
    AccountRefreshAuthResponse,
    AccountRequestUsage,
    AccountSessionTaskPreview,
    AccountTerminateCliSessionsResponse,
    AccountSummary,
    AccountTrendsResponse,
    AccountSnapshotRepairResponse,
    AccountUseLocalResponse,
)
from app.modules.proxy.account_cache import get_account_selection_cache
from app.modules.usage.additional_quota_keys import get_additional_display_label_for_quota_key
from app.modules.usage.repository import AdditionalUsageRepository, UsageRepository
from app.modules.usage.updater import AdditionalUsageRepositoryPort, UsageUpdater

_SPARKLINE_DAYS = 7
_DETAIL_BUCKET_SECONDS = 3600  # 1h → 168 points


class InvalidAuthJsonError(Exception):
    pass


class AccountsService:
    def __init__(
        self,
        repo: AccountsRepository,
        usage_repo: UsageRepository | None = None,
        additional_usage_repo: AdditionalUsageRepository | AdditionalUsageRepositoryPort | None = None,
    ) -> None:
        self._repo = repo
        self._usage_repo = usage_repo
        self._additional_usage_repo = additional_usage_repo
        self._usage_updater = UsageUpdater(usage_repo, repo, additional_usage_repo) if usage_repo else None
        self._encryptor = TokenEncryptor()
        self._auth_manager = AuthManager(repo)

    async def list_accounts(self) -> list[AccountSummary]:
        now = utcnow()
        await sync_local_codex_auth_snapshots(repo=self._repo, encryptor=self._encryptor)

        accounts = await self._repo.list_accounts()
        if not accounts:
            return []
        account_ids = [account.id for account in accounts]
        account_id_set = set(account_ids)
        primary_usage = await self._usage_repo.latest_by_account(window="primary") if self._usage_repo else {}
        if self._usage_updater and self._usage_repo:
            await self._usage_updater.refresh_accounts(accounts, primary_usage)
            primary_usage = await self._usage_repo.latest_by_account(window="primary")
        secondary_usage = await self._usage_repo.latest_by_account(window="secondary") if self._usage_repo else {}
        codex_tracked_session_counts_by_account = await self._repo.list_codex_session_counts_by_account(
            account_ids,
            active_since=None,
        )
        codex_live_session_counts_by_account = {account_id: 0 for account_id in account_ids}
        codex_current_task_preview_by_account = await self._repo.list_codex_current_task_preview_by_account(
            account_ids,
            active_since=None,
        )
        raw_codex_session_task_previews_by_account = await self._repo.list_codex_session_task_previews_by_account(
            account_ids,
            active_since=None,
            limit_per_account=None,
        )
        codex_session_task_previews_by_account: dict[str, list[AccountSessionTaskPreview]] = {
            account_id: [
                AccountSessionTaskPreview(
                    session_key=preview.session_key,
                    task_preview=preview.task_preview,
                    task_updated_at=preview.task_updated_at,
                )
                for preview in previews
            ]
            for account_id, previews in raw_codex_session_task_previews_by_account.items()
        }
        codex_last_task_preview_by_account: dict[str, str] = {}
        request_usage_rows = await self._repo.list_request_usage_summary_by_account(account_ids)
        request_usage_by_account = {
            account_id: AccountRequestUsage(
                request_count=row.request_count,
                total_tokens=row.total_tokens,
                output_tokens=row.output_tokens,
                cached_input_tokens=row.cached_input_tokens,
                cache_write_tokens=0,
                total_cost_usd=row.total_cost_usd,
            )
            for account_id, row in request_usage_rows.items()
        }
        additional_quotas_by_account: dict[str, list[AccountAdditionalQuota]] = {}
        additional_usage_repo = cast(AdditionalUsageRepository | None, self._additional_usage_repo)
        if additional_usage_repo:
            quota_keys = await additional_usage_repo.list_quota_keys(account_ids=account_ids)
            for quota_key in quota_keys:
                primary_entries = await additional_usage_repo.latest_by_account(quota_key, "primary")
                secondary_entries = await additional_usage_repo.latest_by_account(quota_key, "secondary")
                for account_id in (set(primary_entries) | set(secondary_entries)) & account_id_set:
                    primary_entry = primary_entries.get(account_id)
                    secondary_entry = secondary_entries.get(account_id)
                    reference_entry = primary_entry or secondary_entry
                    if reference_entry is None:
                        continue
                    additional_quotas_by_account.setdefault(account_id, []).append(
                        AccountAdditionalQuota(
                            quota_key=quota_key,
                            limit_name=reference_entry.limit_name,
                            metered_feature=reference_entry.metered_feature,
                            display_label=get_additional_display_label_for_quota_key(quota_key)
                            or reference_entry.limit_name,
                            primary_window=AccountAdditionalWindow(
                                used_percent=primary_entry.used_percent,
                                reset_at=primary_entry.reset_at,
                                window_minutes=primary_entry.window_minutes,
                            )
                            if primary_entry is not None
                            else None,
                            secondary_window=AccountAdditionalWindow(
                                used_percent=secondary_entry.used_percent,
                                reset_at=secondary_entry.reset_at,
                                window_minutes=secondary_entry.window_minutes,
                            )
                            if secondary_entry is not None
                            else None,
                        )
                    )
        for account_quota_list in additional_quotas_by_account.values():
            account_quota_list.sort(key=lambda quota: quota.display_label or quota.quota_key or quota.limit_name)

        snapshot_index = build_snapshot_index()
        snapshot_names_by_account = {
            account.id: resolve_snapshot_names_for_account(
                snapshot_index=snapshot_index,
                account_id=account.id,
                chatgpt_account_id=account.chatgpt_account_id,
                email=account.email,
            )
            for account in accounts
        }
        runtime_usage_by_snapshot = read_local_codex_runtime_usage_summary_by_snapshot(now=now, days=90)
        request_usage_by_account = merge_request_usage_with_runtime_fallback(
            request_usage_by_account=request_usage_by_account,
            snapshot_names_by_account=snapshot_names_by_account,
            runtime_usage_by_snapshot=runtime_usage_by_snapshot,
            account_ids=account_ids,
        )
        codex_auth_by_account = {
            account.id: self._build_codex_auth_status(
                account=account,
                snapshot_index=snapshot_index,
            )
            for account in accounts
        }
        live_process_attribution = read_live_codex_process_session_attribution()
        omx_snapshot_names = {
            snapshot_name
            for snapshot_name, session_pids in live_process_attribution.omx_session_pids_by_snapshot.items()
            if session_pids
        }
        live_quota_debug_by_account: dict[str, AccountLiveQuotaDebug] = {}
        persist_candidates = apply_local_live_usage_overrides(
            accounts=accounts,
            snapshot_index=snapshot_index,
            codex_auth_by_account=codex_auth_by_account,
            primary_usage=primary_usage,
            secondary_usage=secondary_usage,
            codex_live_session_counts_by_account=codex_live_session_counts_by_account,
            live_quota_debug_by_account=live_quota_debug_by_account,
        )
        if self._usage_repo and persist_candidates:
            await persist_live_usage_overrides(
                usage_repo=self._usage_repo,
                candidates=persist_candidates,
            )
        for account in accounts:
            codex_auth_status = codex_auth_by_account.get(account.id)
            if codex_auth_status is None:
                continue
            snapshot_names = snapshot_names_by_account.get(account.id, [])
            codex_auth_status.is_omx_boosted = bool(
                codex_auth_status.has_live_session
                and any(snapshot_name in omx_snapshot_names for snapshot_name in snapshot_names)
            )
        overlay_live_codex_task_previews(
            accounts=accounts,
            codex_auth_by_account=codex_auth_by_account,
            snapshot_names_by_account=snapshot_names_by_account,
            codex_current_task_preview_by_account=codex_current_task_preview_by_account,
            codex_last_task_preview_by_account=codex_last_task_preview_by_account,
            codex_session_task_previews_by_account=codex_session_task_previews_by_account,
            live_quota_debug_by_account=live_quota_debug_by_account,
            now=now,
        )

        return build_account_summaries(
            accounts=accounts,
            primary_usage=primary_usage,
            secondary_usage=secondary_usage,
            request_usage_by_account=request_usage_by_account,
            codex_live_session_counts_by_account=codex_live_session_counts_by_account,
            codex_tracked_session_counts_by_account=codex_tracked_session_counts_by_account,
            codex_current_task_preview_by_account=codex_current_task_preview_by_account,
            codex_last_task_preview_by_account=codex_last_task_preview_by_account,
            codex_session_task_previews_by_account=codex_session_task_previews_by_account,
            live_quota_debug_by_account=live_quota_debug_by_account,
            additional_quotas_by_account=additional_quotas_by_account,
            codex_auth_by_account=codex_auth_by_account,
            encryptor=self._encryptor,
        )

    async def get_account_trends(self, account_id: str) -> AccountTrendsResponse | None:
        account = await self._repo.get_by_id(account_id)
        if not account or not self._usage_repo:
            return None
        now = utcnow()
        since = now - timedelta(days=_SPARKLINE_DAYS)
        since_epoch = naive_utc_to_epoch(since)
        bucket_count = (_SPARKLINE_DAYS * 24 * 3600) // _DETAIL_BUCKET_SECONDS
        buckets = await self._usage_repo.trends_by_bucket(
            since=since,
            bucket_seconds=_DETAIL_BUCKET_SECONDS,
            account_id=account_id,
        )
        trends = build_account_usage_trends(buckets, since_epoch, _DETAIL_BUCKET_SECONDS, bucket_count)
        trend = trends.get(account_id)
        return AccountTrendsResponse(
            account_id=account_id,
            primary=trend.primary if trend else [],
            secondary=trend.secondary if trend else [],
        )

    async def import_account(self, raw: bytes) -> AccountImportResponse:
        account = self._account_from_auth_bytes(raw)

        saved = await self._repo.upsert(account)
        remove_auto_import_ignored_account_id(saved.id)
        if self._usage_repo and self._usage_updater:
            latest_usage = await self._usage_repo.latest_by_account(window="primary")
            await self._usage_updater.refresh_accounts([saved], latest_usage)
        get_account_selection_cache().invalidate()
        return AccountImportResponse(
            account_id=saved.id,
            email=saved.email,
            plan_type=saved.plan_type,
            status=saved.status,
        )

    async def reactivate_account(self, account_id: str) -> bool:
        result = await self._repo.update_status(account_id, AccountStatus.ACTIVE, None)
        if result:
            get_account_selection_cache().invalidate()
        return result

    async def pause_account(self, account_id: str) -> bool:
        result = await self._repo.update_status(account_id, AccountStatus.PAUSED, None)
        if result:
            get_account_selection_cache().invalidate()
        return result

    async def delete_account(self, account_id: str) -> bool:
        result = await self._repo.delete(account_id)
        if result:
            add_auto_import_ignored_account_id(account_id)
            get_account_selection_cache().invalidate()
        return result

    async def use_account_locally(self, account_id: str) -> AccountUseLocalResponse | None:
        resolved = await self.resolve_account_snapshot(account_id)
        if resolved is None:
            return None

        resolved_account_id, selected_snapshot_name = resolved
        switch_snapshot(selected_snapshot_name)
        return AccountUseLocalResponse(
            status="switched",
            account_id=resolved_account_id,
            snapshot_name=selected_snapshot_name,
        )

    async def resolve_account_snapshot(self, account_id: str) -> tuple[str, str] | None:
        account = await self._repo.get_by_id(account_id)
        if account is None:
            return None

        snapshot_index = build_snapshot_index()
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
        if selected_snapshot_name is None:
            raise CodexAuthSnapshotNotFoundError(
                f"No codex-auth snapshot found for account {account.email}. Run `codex-auth save <name>` first."
            )

        return account.id, selected_snapshot_name

    async def refresh_account_auth(self, account_id: str) -> AccountRefreshAuthResponse | None:
        account = await self._repo.get_by_id(account_id)
        if account is None:
            return None

        refreshed = await self._auth_manager.refresh_account(account)
        if account.status == AccountStatus.DEACTIVATED:
            await self._repo.update_status(account.id, AccountStatus.ACTIVE, None)
            refreshed.status = AccountStatus.ACTIVE
            refreshed.deactivation_reason = None
        get_account_selection_cache().invalidate()
        return AccountRefreshAuthResponse(
            status="refreshed",
            account_id=refreshed.id,
            email=refreshed.email,
            plan_type=refreshed.plan_type,
        )

    async def terminate_account_live_codex_sessions(
        self,
        account_id: str,
    ) -> AccountTerminateCliSessionsResponse | None:
        account = await self._repo.get_by_id(account_id)
        if account is None:
            return None

        snapshot_index = build_snapshot_index()
        snapshot_candidates = resolve_snapshot_name_candidates_for_account(
            snapshot_index=snapshot_index,
            account_id=account.id,
            chatgpt_account_id=account.chatgpt_account_id,
            email=account.email,
        )
        selected_snapshot_name = select_snapshot_name(
            snapshot_candidates,
            snapshot_index.active_snapshot_name,
            email=account.email,
        )
        if selected_snapshot_name is None:
            raise CodexAuthSnapshotNotFoundError(
                f"No codex-auth snapshot found for account {account.email}. Run `codex-auth save <name>` first."
            )

        snapshot_names_to_terminate = list(dict.fromkeys([selected_snapshot_name, *snapshot_candidates]))
        terminated_session_count = 0
        for snapshot_name in snapshot_names_to_terminate:
            terminated_session_count += terminate_live_codex_processes_for_snapshot(snapshot_name)

        if terminated_session_count > 0:
            remember_terminated_cli_session_snapshots(
                snapshot_names_to_terminate,
                observed_at=utcnow(),
            )

        await self._repo.delete_codex_sessions_for_account(account.id)
        return AccountTerminateCliSessionsResponse(
            status="terminated",
            account_id=account.id,
            snapshot_name=selected_snapshot_name,
            terminated_session_count=terminated_session_count,
        )

    async def repair_account_snapshot(
        self,
        account_id: str,
        *,
        mode: str = "readd",
    ) -> AccountSnapshotRepairResponse | None:
        account = await self._repo.get_by_id(account_id)
        if account is None:
            return None

        normalized_mode = "rename" if mode == "rename" else "readd"
        repair = repair_snapshot_for_account(
            account_id=account.id,
            chatgpt_account_id=account.chatgpt_account_id,
            email=account.email,
            mode=normalized_mode,
        )
        return AccountSnapshotRepairResponse(
            status="repaired",
            account_id=account.id,
            previous_snapshot_name=repair.previous_snapshot_name,
            snapshot_name=repair.snapshot_name,
            mode=repair.mode,
            changed=repair.changed,
        )

    @staticmethod
    def _build_codex_auth_status(
        *,
        account: Account,
        snapshot_index: CodexAuthSnapshotIndex,
    ) -> AccountCodexAuthStatus:
        return build_codex_auth_status(account=account, snapshot_index=snapshot_index)

    def _account_from_auth_bytes(self, raw: bytes) -> Account:
        try:
            auth = parse_auth_json(raw)
        except (json.JSONDecodeError, ValidationError, UnicodeDecodeError, TypeError) as exc:
            raise InvalidAuthJsonError("Invalid auth.json payload") from exc

        claims = claims_from_auth(auth)
        email = claims.email or DEFAULT_EMAIL
        raw_account_id = claims.account_id
        account_id = generate_unique_account_id(raw_account_id, email)
        plan_type = coerce_account_plan_type(claims.plan_type, DEFAULT_PLAN)
        last_refresh = to_utc_naive(auth.last_refresh_at) if auth.last_refresh_at else utcnow()
        return Account(
            id=account_id,
            chatgpt_account_id=raw_account_id,
            email=email,
            plan_type=plan_type,
            access_token_encrypted=self._encryptor.encrypt(auth.tokens.access_token),
            refresh_token_encrypted=self._encryptor.encrypt(auth.tokens.refresh_token),
            id_token_encrypted=self._encryptor.encrypt(auth.tokens.id_token),
            last_refresh=last_refresh,
            status=AccountStatus.ACTIVE,
            deactivation_reason=None,
        )
