from __future__ import annotations

import json
from datetime import datetime, timedelta
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
from app.db.models import Account, AccountStatus, UsageHistory
from app.modules.accounts.codex_auth_auto_import import sync_local_codex_auth_snapshots
from app.modules.accounts.codex_live_usage import (
    LocalCodexLiveUsage,
    LocalUsageWindow,
    read_local_codex_live_usage_by_snapshot,
)
from app.modules.accounts.codex_auth_switcher import (
    CodexAuthSnapshotIndex,
    CodexAuthSnapshotNotFoundError,
    build_snapshot_index,
    select_snapshot_name,
    switch_snapshot,
)
from app.modules.accounts.mappers import build_account_summaries, build_account_usage_trends
from app.modules.accounts.repository import AccountsRepository
from app.modules.accounts.schemas import (
    AccountAdditionalQuota,
    AccountAdditionalWindow,
    AccountCodexAuthStatus,
    AccountImportResponse,
    AccountRequestUsage,
    AccountSummary,
    AccountTrendsResponse,
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

    async def list_accounts(self) -> list[AccountSummary]:
        await sync_local_codex_auth_snapshots(repo=self._repo, encryptor=self._encryptor)

        accounts = await self._repo.list_accounts()
        if not accounts:
            return []
        account_ids = [account.id for account in accounts]
        account_id_set = set(account_ids)
        primary_usage = await self._usage_repo.latest_by_account(window="primary") if self._usage_repo else {}
        secondary_usage = await self._usage_repo.latest_by_account(window="secondary") if self._usage_repo else {}
        codex_session_counts_by_account = await self._repo.list_codex_session_counts_by_account(account_ids)
        request_usage_rows = await self._repo.list_request_usage_summary_by_account(account_ids)
        request_usage_by_account = {
            account_id: AccountRequestUsage(
                request_count=row.request_count,
                total_tokens=row.total_tokens,
                cached_input_tokens=row.cached_input_tokens,
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
        codex_auth_by_account = {
            account.id: self._build_codex_auth_status(
                account_id=account.id,
                snapshot_index=snapshot_index,
            )
            for account in accounts
        }
        self._apply_local_live_usage_overrides(
            accounts=accounts,
            snapshot_index=snapshot_index,
            codex_auth_by_account=codex_auth_by_account,
            primary_usage=primary_usage,
            secondary_usage=secondary_usage,
            codex_session_counts_by_account=codex_session_counts_by_account,
        )

        return build_account_summaries(
            accounts=accounts,
            primary_usage=primary_usage,
            secondary_usage=secondary_usage,
            request_usage_by_account=request_usage_by_account,
            codex_session_counts_by_account=codex_session_counts_by_account,
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
            get_account_selection_cache().invalidate()
        return result

    async def use_account_locally(self, account_id: str) -> AccountUseLocalResponse | None:
        account = await self._repo.get_by_id(account_id)
        if account is None:
            return None

        snapshot_index = build_snapshot_index()
        snapshot_names = snapshot_index.snapshots_by_account_id.get(account.id, [])
        selected_snapshot_name = select_snapshot_name(snapshot_names, snapshot_index.active_snapshot_name)
        if selected_snapshot_name is None:
            raise CodexAuthSnapshotNotFoundError(
                f"No codex-auth snapshot found for account {account.email}. Run `codex-auth save <name>` first."
            )

        switch_snapshot(selected_snapshot_name)
        return AccountUseLocalResponse(
            status="switched",
            account_id=account.id,
            snapshot_name=selected_snapshot_name,
        )

    @staticmethod
    def _build_codex_auth_status(
        *,
        account_id: str,
        snapshot_index: CodexAuthSnapshotIndex,
    ) -> AccountCodexAuthStatus:
        snapshot_names = snapshot_index.snapshots_by_account_id.get(account_id, [])
        selected_snapshot_name = select_snapshot_name(snapshot_names, snapshot_index.active_snapshot_name)
        active_snapshot_name = snapshot_index.active_snapshot_name
        return AccountCodexAuthStatus(
            has_snapshot=bool(snapshot_names),
            snapshot_name=selected_snapshot_name,
            active_snapshot_name=active_snapshot_name,
            is_active_snapshot=bool(active_snapshot_name and active_snapshot_name in snapshot_names),
        )

    def _apply_local_live_usage_overrides(
        self,
        *,
        accounts: list[Account],
        snapshot_index: CodexAuthSnapshotIndex,
        codex_auth_by_account: dict[str, AccountCodexAuthStatus],
        primary_usage: dict[str, UsageHistory],
        secondary_usage: dict[str, UsageHistory],
        codex_session_counts_by_account: dict[str, int],
    ) -> None:
        live_usage_by_snapshot = read_local_codex_live_usage_by_snapshot()

        for account in accounts:
            codex_auth_status = codex_auth_by_account.get(account.id)
            if codex_auth_status is None:
                continue

            snapshot_names = snapshot_index.snapshots_by_account_id.get(account.id, [])
            live_usage = _resolve_live_usage_for_account(
                snapshot_names=snapshot_names,
                selected_snapshot_name=codex_auth_status.snapshot_name,
                live_usage_by_snapshot=live_usage_by_snapshot,
            )
            has_tracked_sessions = codex_session_counts_by_account.get(account.id, 0) > 0
            codex_auth_status.has_live_session = has_tracked_sessions or bool(
                live_usage and live_usage.active_session_count > 0
            )
            if live_usage is None:
                continue

            account_id = account.id
            codex_session_counts_by_account[account_id] = max(
                codex_session_counts_by_account.get(account_id, 0),
                live_usage.active_session_count,
            )
            recorded_at = to_utc_naive(live_usage.recorded_at)
            if live_usage.primary is not None:
                primary_usage[account_id] = _usage_history_from_live_window(
                    account_id=account_id,
                    window="primary",
                    recorded_at=recorded_at,
                    usage_window=live_usage.primary,
                )
            if live_usage.secondary is not None:
                secondary_usage[account_id] = _usage_history_from_live_window(
                    account_id=account_id,
                    window="secondary",
                    recorded_at=recorded_at,
                    usage_window=live_usage.secondary,
                )

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


def _resolve_live_usage_for_account(
    *,
    snapshot_names: list[str],
    selected_snapshot_name: str | None,
    live_usage_by_snapshot: dict[str, LocalCodexLiveUsage],
) -> LocalCodexLiveUsage | None:
    candidate_names = [name for name in [selected_snapshot_name, *snapshot_names] if name]
    merged: LocalCodexLiveUsage | None = None
    seen: set[str] = set()
    for snapshot_name in candidate_names:
        if snapshot_name in seen:
            continue
        seen.add(snapshot_name)
        usage = live_usage_by_snapshot.get(snapshot_name)
        if usage is None:
            continue
        merged = _merge_live_usage(merged, usage)
    return merged


def _merge_live_usage(previous: LocalCodexLiveUsage | None, current: LocalCodexLiveUsage) -> LocalCodexLiveUsage:
    if previous is None:
        return current

    prefer_current = current.recorded_at >= previous.recorded_at
    preferred = current if prefer_current else previous
    fallback = previous if prefer_current else current

    return LocalCodexLiveUsage(
        recorded_at=max(previous.recorded_at, current.recorded_at),
        active_session_count=max(0, previous.active_session_count) + max(0, current.active_session_count),
        primary=preferred.primary if preferred.primary is not None else fallback.primary,
        secondary=preferred.secondary if preferred.secondary is not None else fallback.secondary,
    )


def _usage_history_from_live_window(
    *,
    account_id: str,
    window: str,
    recorded_at: datetime,
    usage_window: LocalUsageWindow,
) -> UsageHistory:
    return UsageHistory(
        account_id=account_id,
        window=window,
        used_percent=float(usage_window.used_percent),
        reset_at=usage_window.reset_at,
        window_minutes=usage_window.window_minutes,
        recorded_at=recorded_at,
    )
