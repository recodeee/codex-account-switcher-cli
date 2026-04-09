from __future__ import annotations

import asyncio
from typing import cast

import pytest

from app.modules.dashboard.api import _DashboardOverviewSingleFlight
from app.modules.dashboard.schemas import DashboardOverviewResponse

pytestmark = pytest.mark.unit


@pytest.mark.asyncio
async def test_dashboard_overview_singleflight_coalesces_concurrent_calls() -> None:
    singleflight = _DashboardOverviewSingleFlight()
    calls = {"count": 0}
    shared_response = cast(DashboardOverviewResponse, object())

    async def _loader() -> DashboardOverviewResponse:
        calls["count"] += 1
        await asyncio.sleep(0.01)
        return shared_response

    results = await asyncio.gather(*(singleflight.run(_loader) for _ in range(8)))

    assert calls["count"] == 1
    assert all(result is shared_response for result in results)


@pytest.mark.asyncio
async def test_dashboard_overview_singleflight_clears_inflight_after_failure() -> None:
    singleflight = _DashboardOverviewSingleFlight()
    calls = {"count": 0}
    expected_response = cast(DashboardOverviewResponse, object())

    async def _loader() -> DashboardOverviewResponse:
        calls["count"] += 1
        if calls["count"] == 1:
            raise RuntimeError("boom")
        return expected_response

    with pytest.raises(RuntimeError, match="boom"):
        await singleflight.run(_loader)

    result = await singleflight.run(_loader)
    assert result is expected_response
    assert calls["count"] == 2
