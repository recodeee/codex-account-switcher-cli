from __future__ import annotations

import re

from app.modules.accounts.codex_runtime_usage import LocalCodexRuntimeUsageSummary
from app.modules.accounts.schemas import AccountRequestUsage

_DUP_SUFFIX_PATTERN = re.compile(r"--dup-\d+$")


def merge_request_usage_with_runtime_fallback(
    *,
    request_usage_by_account: dict[str, AccountRequestUsage],
    snapshot_names_by_account: dict[str, list[str]],
    runtime_usage_by_snapshot: dict[str, LocalCodexRuntimeUsageSummary],
    account_ids: list[str],
) -> dict[str, AccountRequestUsage]:
    merged = dict(request_usage_by_account)
    runtime_snapshot_keys_by_lower = _build_runtime_snapshot_keys_by_lower(runtime_usage_by_snapshot)
    runtime_snapshot_alias_index = _build_runtime_snapshot_alias_index(runtime_usage_by_snapshot)

    for account_id in account_ids:
        snapshot_names = snapshot_names_by_account.get(account_id, [])
        fallback_input = 0
        fallback_output = 0
        fallback_cache_read = 0
        fallback_cache_write = 0
        fallback_sessions = 0
        consumed_runtime_snapshots: set[str] = set()

        for snapshot_name in snapshot_names:
            resolved_runtime_snapshot_name = _resolve_runtime_snapshot_name(
                snapshot_name=snapshot_name,
                runtime_usage_by_snapshot=runtime_usage_by_snapshot,
                runtime_snapshot_keys_by_lower=runtime_snapshot_keys_by_lower,
                runtime_snapshot_alias_index=runtime_snapshot_alias_index,
            )
            if not resolved_runtime_snapshot_name:
                continue
            if resolved_runtime_snapshot_name in consumed_runtime_snapshots:
                continue
            runtime_usage = runtime_usage_by_snapshot.get(resolved_runtime_snapshot_name)
            if runtime_usage is None:
                continue

            consumed_runtime_snapshots.add(resolved_runtime_snapshot_name)
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


def _build_runtime_snapshot_keys_by_lower(
    runtime_usage_by_snapshot: dict[str, LocalCodexRuntimeUsageSummary],
) -> dict[str, list[str]]:
    keys_by_lower: dict[str, list[str]] = {}
    for runtime_snapshot_name in runtime_usage_by_snapshot:
        keys_by_lower.setdefault(runtime_snapshot_name.lower(), []).append(runtime_snapshot_name)
    return keys_by_lower


def _build_runtime_snapshot_alias_index(
    runtime_usage_by_snapshot: dict[str, LocalCodexRuntimeUsageSummary],
) -> dict[str, list[str]]:
    alias_index: dict[str, list[str]] = {}
    for runtime_snapshot_name in runtime_usage_by_snapshot:
        for alias in _snapshot_alias_candidates(runtime_snapshot_name):
            alias_index.setdefault(alias, []).append(runtime_snapshot_name)
    return alias_index


def _resolve_runtime_snapshot_name(
    *,
    snapshot_name: str,
    runtime_usage_by_snapshot: dict[str, LocalCodexRuntimeUsageSummary],
    runtime_snapshot_keys_by_lower: dict[str, list[str]],
    runtime_snapshot_alias_index: dict[str, list[str]],
) -> str | None:
    if snapshot_name in runtime_usage_by_snapshot:
        return snapshot_name

    exact_case_insensitive = runtime_snapshot_keys_by_lower.get(snapshot_name.lower(), [])
    if len(exact_case_insensitive) == 1:
        return exact_case_insensitive[0]
    if len(exact_case_insensitive) > 1:
        return None

    matches: set[str] = set()
    for alias in _snapshot_alias_candidates(snapshot_name):
        for runtime_snapshot_name in runtime_snapshot_alias_index.get(alias, []):
            matches.add(runtime_snapshot_name)

    if len(matches) == 1:
        return next(iter(matches))
    return None


def _snapshot_alias_candidates(snapshot_name: str) -> set[str]:
    normalized = snapshot_name.strip().lower()
    if not normalized:
        return set()

    local_part = normalized.split("@", 1)[0]
    normalized_without_dup = _DUP_SUFFIX_PATTERN.sub("", normalized)
    local_part_without_dup = _DUP_SUFFIX_PATTERN.sub("", local_part)

    candidates = {
        normalized,
        normalized_without_dup,
        local_part,
        local_part_without_dup,
    }
    return {candidate for candidate in candidates if candidate}
