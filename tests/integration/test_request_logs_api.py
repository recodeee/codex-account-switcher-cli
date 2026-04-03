from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.crypto import TokenEncryptor
from app.core.utils.time import utcnow
from app.db.models import Account, AccountStatus, ApiKey
from app.db.session import SessionLocal
from app.modules.accounts.repository import AccountsRepository
from app.modules.request_logs.repository import RequestLogsRepository

pytestmark = pytest.mark.integration


def _make_account(account_id: str, email: str) -> Account:
    encryptor = TokenEncryptor()
    return Account(
        id=account_id,
        email=email,
        plan_type="plus",
        access_token_encrypted=encryptor.encrypt("access"),
        refresh_token_encrypted=encryptor.encrypt("refresh"),
        id_token_encrypted=encryptor.encrypt("id"),
        last_refresh=utcnow(),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
    )


@pytest.mark.asyncio
async def test_request_logs_api_returns_recent(async_client, db_setup):
    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        logs_repo = RequestLogsRepository(session)
        await accounts_repo.upsert(_make_account("acc_logs", "logs@example.com"))
        session.add(
            ApiKey(
                id="key_logs_1",
                name="Debug Key",
                key_hash="hash_logs_1",
                key_prefix="sk-test",
            )
        )
        await session.commit()

        now = utcnow()
        await logs_repo.add_log(
            account_id="acc_logs",
            request_id="req_logs_1",
            model="gpt-5.1",
            input_tokens=100,
            output_tokens=200,
            latency_ms=1200,
            status="success",
            error_code=None,
            requested_at=now - timedelta(minutes=1),
            transport="http",
        )
        await logs_repo.add_log(
            account_id="acc_logs",
            request_id="req_logs_2",
            model="gpt-5.1",
            input_tokens=50,
            output_tokens=0,
            latency_ms=300,
            status="error",
            error_code="rate_limit_exceeded",
            error_message="Rate limit reached",
            requested_at=now,
            api_key_id="key_logs_1",
            transport="websocket",
        )

    response = await async_client.get("/api/request-logs?limit=2")
    assert response.status_code == 200
    body = response.json()
    payload = body["requests"]
    assert len(payload) == 2
    assert body["total"] == 2
    assert body["hasMore"] is False

    latest = payload[0]
    assert latest["status"] == "rate_limit"
    assert latest["apiKeyName"] == "Debug Key"
    assert latest["errorCode"] == "rate_limit_exceeded"
    assert latest["errorMessage"] == "Rate limit reached"
    assert latest["transport"] == "websocket"

    older = payload[1]
    assert older["status"] == "ok"
    assert older["apiKeyName"] is None
    assert older["tokens"] == 300
    assert older["cachedInputTokens"] is None
    assert older["transport"] == "http"


@pytest.mark.asyncio
async def test_request_logs_usage_summary_returns_rolling_5h_and_7d_totals(async_client, db_setup):
    now = utcnow()
    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        logs_repo = RequestLogsRepository(session)
        await accounts_repo.upsert(_make_account("acc_usage_a", "usage-a@example.com"))
        await accounts_repo.upsert(_make_account("acc_usage_b", "usage-b@example.com"))

        await logs_repo.add_log(
            account_id="acc_usage_a",
            request_id="req_usage_1",
            model="gpt-5.1",
            input_tokens=100,
            output_tokens=50,
            latency_ms=100,
            status="success",
            error_code=None,
            requested_at=now - timedelta(hours=2),
        )
        await logs_repo.add_log(
            account_id="acc_usage_a",
            request_id="req_usage_2",
            model="gpt-5.1",
            input_tokens=20,
            output_tokens=None,
            reasoning_tokens=40,
            latency_ms=100,
            status="success",
            error_code=None,
            requested_at=now - timedelta(hours=6),
        )
        await logs_repo.add_log(
            account_id="acc_usage_b",
            request_id="req_usage_3",
            model="gpt-5.1",
            input_tokens=30,
            output_tokens=10,
            latency_ms=100,
            status="success",
            error_code=None,
            requested_at=now - timedelta(hours=1),
        )
        await logs_repo.add_log(
            account_id=None,
            request_id="req_usage_4",
            model="gpt-5.1",
            input_tokens=5,
            output_tokens=5,
            latency_ms=100,
            status="success",
            error_code=None,
            requested_at=now - timedelta(minutes=30),
        )
        await logs_repo.add_log(
            account_id="acc_usage_b",
            request_id="req_usage_5",
            model="gpt-5.1",
            input_tokens=1000,
            output_tokens=1000,
            latency_ms=100,
            status="success",
            error_code=None,
            requested_at=now - timedelta(days=8),
        )

    response = await async_client.get("/api/request-logs/usage-summary")
    assert response.status_code == 200
    payload = response.json()

    assert payload["last5h"]["totalTokens"] == 200
    assert payload["last7d"]["totalTokens"] == 260

    last5h_accounts = payload["last5h"]["accounts"]
    assert last5h_accounts[0] == {"accountId": "acc_usage_a", "tokens": 150}
    assert last5h_accounts[1] == {"accountId": "acc_usage_b", "tokens": 40}
    assert last5h_accounts[2] == {"accountId": None, "tokens": 10}

    last7d_accounts = payload["last7d"]["accounts"]
    assert last7d_accounts[0] == {"accountId": "acc_usage_a", "tokens": 210}
    assert last7d_accounts[1] == {"accountId": "acc_usage_b", "tokens": 40}
    assert last7d_accounts[2] == {"accountId": None, "tokens": 10}
