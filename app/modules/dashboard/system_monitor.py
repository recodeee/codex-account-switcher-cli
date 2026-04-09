from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock
import subprocess
import time


@dataclass(frozen=True)
class DashboardSystemMonitorSample:
    sampled_at: datetime
    cpu_percent: float
    gpu_percent: float | None
    vram_percent: float | None
    network_mb_s: float
    memory_percent: float
    spike: bool


_cpu_lock = Lock()
_previous_cpu_totals: tuple[int, int] | None = None

_network_lock = Lock()
_previous_network_sample: tuple[int, float] | None = None

_sample_lock = Lock()
_cached_sample: tuple[DashboardSystemMonitorSample, float] | None = None
_SAMPLE_CACHE_WINDOW_SECONDS = 2.0

_gpu_sample_lock = Lock()
_cached_gpu_sample: tuple[tuple[float | None, float | None], float] | None = None
_GPU_SAMPLE_CACHE_WINDOW_SECONDS = 3.0


def _clamp_percent(value: float) -> float:
    return max(0.0, min(100.0, value))


def _round_metric(value: float) -> float:
    return round(value, 1)


def _read_proc_cpu_totals() -> tuple[int, int] | None:
    try:
        with open("/proc/stat", "r", encoding="utf-8") as handle:
            first_line = handle.readline().strip()
    except OSError:
        return None
    if not first_line.startswith("cpu "):
        return None
    parts = first_line.split()[1:]
    if len(parts) < 4:
        return None
    try:
        values = [int(part) for part in parts]
    except ValueError:
        return None
    idle = values[3] + (values[4] if len(values) > 4 else 0)
    total = sum(values)
    return idle, total


def _sample_cpu_percent() -> float:
    global _previous_cpu_totals
    current = _read_proc_cpu_totals()
    if current is None:
        return 0.0
    with _cpu_lock:
        if _previous_cpu_totals is None:
            _previous_cpu_totals = current
            return 0.0
        previous_idle, previous_total = _previous_cpu_totals
        current_idle, current_total = current
        _previous_cpu_totals = current
    total_delta = current_total - previous_total
    idle_delta = current_idle - previous_idle
    if total_delta <= 0:
        return 0.0
    usage = 100.0 * (1.0 - (idle_delta / total_delta))
    return _round_metric(_clamp_percent(usage))


def _read_memory_percent() -> float:
    try:
        with open("/proc/meminfo", "r", encoding="utf-8") as handle:
            rows = handle.readlines()
    except OSError:
        return 0.0

    values: dict[str, int] = {}
    for row in rows:
        key, _, raw_value = row.partition(":")
        value_part = raw_value.strip().split(" ", 1)[0]
        try:
            values[key] = int(value_part)
        except ValueError:
            continue

    total_kib = values.get("MemTotal", 0)
    if total_kib <= 0:
        return 0.0
    available_kib = values.get(
        "MemAvailable",
        values.get("MemFree", 0) + values.get("Buffers", 0) + values.get("Cached", 0),
    )
    used_kib = max(total_kib - available_kib, 0)
    return _round_metric(_clamp_percent((used_kib / total_kib) * 100.0))


def _read_network_bytes() -> int:
    try:
        with open("/proc/net/dev", "r", encoding="utf-8") as handle:
            rows = handle.readlines()
    except OSError:
        return 0

    total_bytes = 0
    for row in rows[2:]:
        if ":" not in row:
            continue
        interface, payload = row.split(":", 1)
        if interface.strip() == "lo":
            continue
        fields = payload.split()
        if len(fields) < 16:
            continue
        try:
            rx_bytes = int(fields[0])
            tx_bytes = int(fields[8])
        except ValueError:
            continue
        total_bytes += rx_bytes + tx_bytes
    return total_bytes


def _sample_network_mb_s(now_monotonic: float) -> float:
    global _previous_network_sample
    current_bytes = _read_network_bytes()
    with _network_lock:
        if _previous_network_sample is None:
            _previous_network_sample = (current_bytes, now_monotonic)
            return 0.0
        previous_bytes, previous_timestamp = _previous_network_sample
        _previous_network_sample = (current_bytes, now_monotonic)
    elapsed = now_monotonic - previous_timestamp
    if elapsed <= 0:
        return 0.0
    bytes_per_second = max(current_bytes - previous_bytes, 0) / elapsed
    mb_s = bytes_per_second / (1024.0 * 1024.0)
    return _round_metric(mb_s)


def _read_gpu_and_vram_percent(now_monotonic: float) -> tuple[float | None, float | None]:
    global _cached_gpu_sample
    with _gpu_sample_lock:
        cached = _cached_gpu_sample
        if cached is not None:
            cached_values, cached_at = cached
            if now_monotonic - cached_at < _GPU_SAMPLE_CACHE_WINDOW_SECONDS:
                return cached_values

    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            check=False,
            text=True,
            timeout=0.8,
        )
    except (OSError, subprocess.SubprocessError):
        values = (None, None)
        with _gpu_sample_lock:
            _cached_gpu_sample = (values, now_monotonic)
        return values

    if result.returncode != 0:
        values = (None, None)
        with _gpu_sample_lock:
            _cached_gpu_sample = (values, now_monotonic)
        return values

    utilization_values: list[float] = []
    vram_percent_values: list[float] = []
    for line in result.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 3:
            continue
        try:
            utilization = float(parts[0])
            used_memory = float(parts[1])
            total_memory = float(parts[2])
        except ValueError:
            continue
        utilization_values.append(_clamp_percent(utilization))
        if total_memory > 0:
            vram_percent_values.append(_clamp_percent((used_memory / total_memory) * 100.0))

    if not utilization_values and not vram_percent_values:
        values = (None, None)
        with _gpu_sample_lock:
            _cached_gpu_sample = (values, now_monotonic)
        return values

    gpu_percent = (
        _round_metric(sum(utilization_values) / len(utilization_values))
        if utilization_values
        else None
    )
    vram_percent = (
        _round_metric(sum(vram_percent_values) / len(vram_percent_values))
        if vram_percent_values
        else None
    )
    values = (gpu_percent, vram_percent)
    with _gpu_sample_lock:
        _cached_gpu_sample = (values, now_monotonic)
    return values


def collect_dashboard_system_monitor_sample() -> DashboardSystemMonitorSample:
    global _cached_sample
    monotonic_now = time.monotonic()
    with _sample_lock:
        cached = _cached_sample
        if cached is not None:
            cached_sample, cached_at = cached
            if monotonic_now - cached_at < _SAMPLE_CACHE_WINDOW_SECONDS:
                return cached_sample

        now_utc = datetime.now(timezone.utc)
        cpu_percent = _sample_cpu_percent()
        gpu_percent, vram_percent = _read_gpu_and_vram_percent(monotonic_now)
        network_mb_s = _sample_network_mb_s(monotonic_now)
        memory_percent = _read_memory_percent()

        spike = (
            cpu_percent >= 85.0
            or memory_percent >= 90.0
            or network_mb_s >= 25.0
            or (gpu_percent is not None and gpu_percent >= 90.0)
            or (vram_percent is not None and vram_percent >= 95.0)
        )

        sample = DashboardSystemMonitorSample(
            sampled_at=now_utc,
            cpu_percent=cpu_percent,
            gpu_percent=gpu_percent,
            vram_percent=vram_percent,
            network_mb_s=network_mb_s,
            memory_percent=memory_percent,
            spike=spike,
        )
        _cached_sample = (sample, monotonic_now)
        return sample
