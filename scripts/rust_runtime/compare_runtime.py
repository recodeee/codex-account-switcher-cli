#!/usr/bin/env python3
"""Compare basic endpoint parity and latency between Python and Rust runtimes."""

from __future__ import annotations

import argparse
import hashlib
import json
import statistics
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from typing import Iterable


@dataclass(slots=True)
class ProbeSample:
    status: int
    elapsed_ms: float
    body_sha256: str


@dataclass(slots=True)
class EndpointReport:
    endpoint: str
    python_status: int
    rust_status: int
    status_match: bool
    body_hash_match: bool
    python_p50_ms: float
    rust_p50_ms: float
    python_p95_ms: float
    rust_p95_ms: float


@dataclass(slots=True)
class RuntimeComparison:
    python_base_url: str
    rust_base_url: str
    iterations: int
    reports: list[EndpointReport]


def _fetch_once(base_url: str, endpoint: str, timeout_seconds: float) -> ProbeSample:
    url = f"{base_url.rstrip('/')}{endpoint}"
    req = urllib.request.Request(url, method="GET")
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            body = resp.read()
            status = resp.status
    except urllib.error.HTTPError as exc:
        body = exc.read() if exc.fp else b""
        status = exc.code
    elapsed_ms = (time.perf_counter() - started) * 1000
    return ProbeSample(
        status=status,
        elapsed_ms=elapsed_ms,
        body_sha256=hashlib.sha256(body).hexdigest(),
    )


def _percentile(values: Iterable[float], pct: float) -> float:
    sorted_values = sorted(values)
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    idx = int(round((pct / 100) * (len(sorted_values) - 1)))
    return sorted_values[idx]


def _probe_runtime(base_url: str, endpoint: str, iterations: int, timeout_seconds: float) -> list[ProbeSample]:
    return [_fetch_once(base_url, endpoint, timeout_seconds) for _ in range(iterations)]


def _build_report(
    endpoint: str,
    python_samples: list[ProbeSample],
    rust_samples: list[ProbeSample],
) -> EndpointReport:
    python_status = statistics.mode(sample.status for sample in python_samples)
    rust_status = statistics.mode(sample.status for sample in rust_samples)
    python_body = statistics.mode(sample.body_sha256 for sample in python_samples)
    rust_body = statistics.mode(sample.body_sha256 for sample in rust_samples)

    python_latencies = [sample.elapsed_ms for sample in python_samples]
    rust_latencies = [sample.elapsed_ms for sample in rust_samples]

    return EndpointReport(
        endpoint=endpoint,
        python_status=python_status,
        rust_status=rust_status,
        status_match=python_status == rust_status,
        body_hash_match=python_body == rust_body,
        python_p50_ms=round(_percentile(python_latencies, 50), 2),
        rust_p50_ms=round(_percentile(rust_latencies, 50), 2),
        python_p95_ms=round(_percentile(python_latencies, 95), 2),
        rust_p95_ms=round(_percentile(rust_latencies, 95), 2),
    )


def run(args: argparse.Namespace) -> RuntimeComparison:
    reports: list[EndpointReport] = []
    for endpoint in args.endpoints:
        py_samples = _probe_runtime(args.python_base_url, endpoint, args.iterations, args.timeout)
        rs_samples = _probe_runtime(args.rust_base_url, endpoint, args.iterations, args.timeout)
        reports.append(_build_report(endpoint, py_samples, rs_samples))

    return RuntimeComparison(
        python_base_url=args.python_base_url,
        rust_base_url=args.rust_base_url,
        iterations=args.iterations,
        reports=reports,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--rust-base-url", default="http://127.0.0.1:8099")
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument(
        "--endpoints",
        nargs="+",
        default=["/health", "/health/live", "/health/ready", "/health/startup"],
        help="List of endpoint paths to compare.",
    )
    parser.add_argument("--output", default="", help="Optional path to write JSON result.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = run(args)

    payload = {
        "python_base_url": result.python_base_url,
        "rust_base_url": result.rust_base_url,
        "iterations": result.iterations,
        "reports": [asdict(report) for report in result.reports],
    }

    print(json.dumps(payload, indent=2, sort_keys=True))
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")


if __name__ == "__main__":
    main()
