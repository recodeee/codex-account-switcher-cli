from __future__ import annotations

import pytest
from sqlalchemy.exc import OperationalError

from app.modules.accounts.repository import (
    AccountsRepository,
    _SQLITE_MERGE_LOCK_MAX_ATTEMPTS,
)

pytestmark = pytest.mark.unit


class _StubSession:
    def __init__(self, side_effects: list[object]) -> None:
        self._side_effects = list(side_effects)
        self.execute_calls: list[str] = []

    async def execute(self, statement, *args, **kwargs):  # noqa: ANN001
        self.execute_calls.append(str(statement))
        if not self._side_effects:
            return object()
        outcome = self._side_effects.pop(0)
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


def _locked_error() -> OperationalError:
    return OperationalError("BEGIN IMMEDIATE", {}, Exception("database is locked"))


def _within_transaction_error() -> OperationalError:
    return OperationalError(
        "BEGIN IMMEDIATE",
        {},
        Exception("cannot start a transaction within a transaction"),
    )


@pytest.mark.asyncio
async def test_acquire_sqlite_merge_lock_retries_then_succeeds(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    monkeypatch.setattr("app.modules.accounts.repository.asyncio.sleep", _fake_sleep)
    session = _StubSession([_locked_error(), _locked_error(), object()])
    repo = AccountsRepository(session)  # type: ignore[arg-type]

    await repo._acquire_sqlite_merge_lock()

    assert len(session.execute_calls) == 3
    assert session.execute_calls[0] == "BEGIN IMMEDIATE"
    assert sleep_calls == [0.05, 0.1]


@pytest.mark.asyncio
async def test_acquire_sqlite_merge_lock_escalates_when_already_in_transaction() -> None:
    session = _StubSession([_within_transaction_error(), object()])
    repo = AccountsRepository(session)  # type: ignore[arg-type]

    await repo._acquire_sqlite_merge_lock()

    assert len(session.execute_calls) == 2
    assert session.execute_calls[0] == "BEGIN IMMEDIATE"
    assert session.execute_calls[1] == "UPDATE accounts SET id = id WHERE 1 = 0"


@pytest.mark.asyncio
async def test_acquire_sqlite_merge_lock_raises_after_retry_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    sleep_calls: list[float] = []

    async def _fake_sleep(delay: float) -> None:
        sleep_calls.append(delay)

    monkeypatch.setattr("app.modules.accounts.repository.asyncio.sleep", _fake_sleep)
    session = _StubSession([_locked_error() for _ in range(_SQLITE_MERGE_LOCK_MAX_ATTEMPTS)])
    repo = AccountsRepository(session)  # type: ignore[arg-type]

    with pytest.raises(OperationalError):
        await repo._acquire_sqlite_merge_lock()

    assert len(session.execute_calls) == _SQLITE_MERGE_LOCK_MAX_ATTEMPTS
    assert len(sleep_calls) == _SQLITE_MERGE_LOCK_MAX_ATTEMPTS - 1
