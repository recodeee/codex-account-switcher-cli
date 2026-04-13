from __future__ import annotations

from app.modules.accounts.codex_runtime_usage import LocalCodexRuntimeUsageSummary
from app.modules.accounts.schemas import AccountRequestUsage


def merge_request_usage_with_runtime_fallback(
    *,
    request_usage_by_account: dict[str, AccountRequestUsage],
    snapshot_names_by_account: dict[str, list[str]],
    runtime_usage_by_snapshot: dict[str, LocalCodexRuntimeUsageSummary],
    account_ids: list[str],
) -> dict[str, AccountRequestUsage]:
    merged = dict(request_usage_by_account)

    for account_id in account_ids:
        snapshot_names = snapshot_names_by_account.get(account_id, [])
        fallback_input = 0
        fallback_output = 0
        fallback_cache_read = 0
        fallback_cache_write = 0
        fallback_sessions = 0

        for snapshot_name in snapshot_names:
            runtime_usage = runtime_usage_by_snapshot.get(snapshot_name)
            if runtime_usage is None:
                continue
            fallback_input += max(0, int(runtime_usage.input_tokens))
            fallback_output += max(0, int(runtime_usage.output_tokens))
            fallback_cache_read += max(0, int(runtime_usage.cache_read_tokens))
            fallback_cache_write += max(0, int(runtime_usage.cache_write_tokens))
            fallback_sessions += max(0, int(runtime_usage.session_count))

        if fallback_input <= 0 and fallback_output <= 0 and fallback_cache_read <= 0 and fallback_cache_write <= 0:
            continue

        existing = merged.get(account_id)
        if existing is None:
            merged_input = fallback_input
            merged_output = fallback_output
            merged_cache = max(0, min(fallback_cache_read, merged_input))
            merged[account_id] = AccountRequestUsage(
                request_count=fallback_sessions,
                total_tokens=merged_input + merged_output,
                output_tokens=merged_output,
                cached_input_tokens=merged_cache,
                cache_write_tokens=max(0, fallback_cache_write),
                total_cost_usd=0.0,
            )
            continue

        existing_output = max(0, int(existing.output_tokens))
        existing_input = max(0, int(existing.total_tokens) - existing_output)
        merged_input = max(existing_input, fallback_input)
        merged_output = max(existing_output, fallback_output)
        merged_cache = max(int(existing.cached_input_tokens), min(fallback_cache_read, merged_input))
        merged_cache_write = max(int(existing.cache_write_tokens), fallback_cache_write)
        merged[account_id] = AccountRequestUsage(
            request_count=max(int(existing.request_count), fallback_sessions),
            total_tokens=merged_input + merged_output,
            output_tokens=merged_output,
            cached_input_tokens=merged_cache,
            cache_write_tokens=max(0, merged_cache_write),
            total_cost_usd=float(existing.total_cost_usd),
        )

    return merged
