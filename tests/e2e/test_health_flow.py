from __future__ import annotations

import pytest


@pytest.mark.asyncio
@pytest.mark.e2e
async def test_all_health_endpoints_respond(client):
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

    response = await client.get("/health/live")
    assert response.status_code == 200
    live_payload = response.json()
    assert live_payload["status"] == "ok"
    assert live_payload["checks"] is None
    assert live_payload.get("bridge_ring") is None

    response = await client.get("/health/ready")
    assert response.status_code == 200
    ready_payload = response.json()
    assert ready_payload["status"] == "ok"
    assert "checks" in ready_payload
    assert ready_payload["checks"]["database"] == "ok"

    response = await client.get("/health/startup")
    assert response.status_code in (200, 503)

    response = await client.get("/_rust_layer/info")
    assert response.status_code == 200
    info_payload = response.json()
    assert info_payload["language"] == "python"
    assert info_payload["service"] == "codex-lb-python-runtime"

    response = await client.get("/_python_layer/health")
    assert response.status_code == 200
    python_health_payload = response.json()
    assert python_health_payload["status"] in ("ok", "degraded")
    assert "/health" in python_health_payload["checks"]

    response = await client.get("/_python_layer/apis")
    assert response.status_code == 200
    apis_payload = response.json()
    assert "/health" in apis_payload["paths"]
