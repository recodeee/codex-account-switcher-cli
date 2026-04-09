from __future__ import annotations

from datetime import datetime, timezone

from app.modules.dashboard import system_monitor


def test_collect_dashboard_system_monitor_sample_maps_metrics(monkeypatch) -> None:
    fixed_now = datetime(2026, 4, 8, 20, 0, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        system_monitor,
        "datetime",
        type(
            "FixedDatetime",
            (),
            {"now": staticmethod(lambda tz=None: fixed_now)},
        ),
    )
    monkeypatch.setattr(system_monitor, "_cached_sample", None)
    monkeypatch.setattr(system_monitor, "_cached_gpu_sample", None)
    monkeypatch.setattr(system_monitor.time, "monotonic", lambda: 123.0)
    monkeypatch.setattr(system_monitor, "_sample_cpu_percent", lambda: 39.8)
    monkeypatch.setattr(system_monitor, "_read_gpu_and_vram_percent", lambda _now: (33.5, 57.5))
    monkeypatch.setattr(system_monitor, "_sample_network_mb_s", lambda _now: 5.3)
    monkeypatch.setattr(system_monitor, "_read_memory_percent", lambda: 61.2)

    sample = system_monitor.collect_dashboard_system_monitor_sample()

    assert sample.sampled_at == fixed_now
    assert sample.cpu_percent == 39.8
    assert sample.gpu_percent == 33.5
    assert sample.vram_percent == 57.5
    assert sample.network_mb_s == 5.3
    assert sample.memory_percent == 61.2
    assert sample.spike is False


def test_collect_dashboard_system_monitor_sample_marks_spike(monkeypatch) -> None:
    monkeypatch.setattr(system_monitor, "_cached_sample", None)
    monkeypatch.setattr(system_monitor, "_cached_gpu_sample", None)
    monkeypatch.setattr(system_monitor.time, "monotonic", lambda: 456.0)
    monkeypatch.setattr(system_monitor, "_sample_cpu_percent", lambda: 92.1)
    monkeypatch.setattr(system_monitor, "_read_gpu_and_vram_percent", lambda _now: (None, None))
    monkeypatch.setattr(system_monitor, "_sample_network_mb_s", lambda _now: 0.4)
    monkeypatch.setattr(system_monitor, "_read_memory_percent", lambda: 55.0)

    sample = system_monitor.collect_dashboard_system_monitor_sample()

    assert sample.spike is True


def test_collect_dashboard_system_monitor_sample_reuses_cached_values(monkeypatch) -> None:
    datetimes = iter(
        [
            datetime(2026, 4, 8, 20, 0, 0, tzinfo=timezone.utc),
            datetime(2026, 4, 8, 20, 0, 1, tzinfo=timezone.utc),
        ],
    )
    monotonic_samples = iter([300.0, 300.8])
    calls = {"cpu": 0, "gpu": 0, "network": 0, "memory": 0}

    monkeypatch.setattr(
        system_monitor,
        "datetime",
        type(
            "FixedDatetime",
            (),
            {"now": staticmethod(lambda tz=None: next(datetimes))},
        ),
    )
    monkeypatch.setattr(system_monitor, "_cached_sample", None)
    monkeypatch.setattr(system_monitor, "_cached_gpu_sample", None)
    monkeypatch.setattr(system_monitor.time, "monotonic", lambda: next(monotonic_samples))

    def _cpu() -> float:
        calls["cpu"] += 1
        return 12.3

    def _gpu(_now: float) -> tuple[float, float]:
        calls["gpu"] += 1
        return 4.0, 5.0

    def _network(_now: float) -> float:
        calls["network"] += 1
        return 1.2

    def _memory() -> float:
        calls["memory"] += 1
        return 44.4

    monkeypatch.setattr(system_monitor, "_sample_cpu_percent", _cpu)
    monkeypatch.setattr(system_monitor, "_read_gpu_and_vram_percent", _gpu)
    monkeypatch.setattr(system_monitor, "_sample_network_mb_s", _network)
    monkeypatch.setattr(system_monitor, "_read_memory_percent", _memory)

    first = system_monitor.collect_dashboard_system_monitor_sample()
    second = system_monitor.collect_dashboard_system_monitor_sample()

    assert second == first
    assert calls == {"cpu": 1, "gpu": 1, "network": 1, "memory": 1}
