from __future__ import annotations

from app.modules.accounts.codex_runtime_usage import LocalCodexRuntimeUsageSummary
from app.modules.accounts.request_usage_fallback import merge_request_usage_with_runtime_fallback
from app.modules.accounts.schemas import AccountRequestUsage


def test_merge_request_usage_fallback_populates_missing_account_usage() -> None:
    merged = merge_request_usage_with_runtime_fallback(
        request_usage_by_account={},
        snapshot_names_by_account={"acc-a": ["snap-a"]},
        runtime_usage_by_snapshot={
            "snap-a": LocalCodexRuntimeUsageSummary(
                input_tokens=100,
                output_tokens=25,
                cache_read_tokens=40,
                cache_write_tokens=15,
                session_count=3,
            )
        },
        account_ids=["acc-a"],
    )

    usage = merged["acc-a"]
    assert usage.request_count == 3
    assert usage.total_tokens == 125
    assert usage.output_tokens == 25
    assert usage.cached_input_tokens == 40
    assert usage.cache_write_tokens == 15
    assert usage.total_cost_usd == 0.0


def test_merge_request_usage_fallback_keeps_higher_existing_values() -> None:
    merged = merge_request_usage_with_runtime_fallback(
        request_usage_by_account={
            "acc-a": AccountRequestUsage(
                request_count=10,
                total_tokens=500,
                output_tokens=180,
                cached_input_tokens=60,
                cache_write_tokens=18,
                total_cost_usd=1.75,
            )
        },
        snapshot_names_by_account={"acc-a": ["snap-a"]},
        runtime_usage_by_snapshot={
            "snap-a": LocalCodexRuntimeUsageSummary(
                input_tokens=100,
                output_tokens=25,
                cache_read_tokens=20,
                cache_write_tokens=9,
                session_count=2,
            )
        },
        account_ids=["acc-a"],
    )

    usage = merged["acc-a"]
    assert usage.request_count == 10
    assert usage.total_tokens == 500
    assert usage.output_tokens == 180
    assert usage.cached_input_tokens == 60
    assert usage.cache_write_tokens == 18
    assert usage.total_cost_usd == 1.75


def test_merge_request_usage_fallback_raises_lower_input_from_runtime_when_needed() -> None:
    merged = merge_request_usage_with_runtime_fallback(
        request_usage_by_account={
            "acc-a": AccountRequestUsage(
                request_count=1,
                total_tokens=120,
                output_tokens=20,
                cached_input_tokens=10,
                cache_write_tokens=4,
                total_cost_usd=0.5,
            )
        },
        snapshot_names_by_account={"acc-a": ["snap-a"]},
        runtime_usage_by_snapshot={
            "snap-a": LocalCodexRuntimeUsageSummary(
                input_tokens=400,
                output_tokens=40,
                cache_read_tokens=180,
                cache_write_tokens=55,
                session_count=5,
            )
        },
        account_ids=["acc-a"],
    )

    usage = merged["acc-a"]
    assert usage.request_count == 5
    assert usage.output_tokens == 40
    assert usage.total_tokens == 440
    assert usage.cached_input_tokens == 180
    assert usage.cache_write_tokens == 55
    assert usage.total_cost_usd == 0.5
