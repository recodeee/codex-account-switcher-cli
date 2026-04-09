#!/usr/bin/env python3
"""Compare endpoint contract parity and latency between Python and Rust runtimes."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


@dataclass(slots=True)
class ProbeSample:
    status: int
    elapsed_ms: float
    body_sha256: str
    content_type: str
    json_canonical: str | None
    xml_canonical: str | None


@dataclass(slots=True)
class EndpointReport:
    endpoint: str
    python_status: int
    rust_status: int
    status_match: bool
    python_content_type: str
    rust_content_type: str
    content_type_match: bool
    body_hash_match: bool
    json_body_match: bool
    xml_body_match: bool
    payload_match_kind: str
    payload_match: bool
    contract_match: bool
    mismatch_reasons: list[str]
    python_p50_ms: float
    rust_p50_ms: float
    python_p95_ms: float
    rust_p95_ms: float


@dataclass(slots=True)
class ProbeRequest:
    endpoint: str
    method: str = "GET"
    headers: dict[str, str] = field(default_factory=dict)
    body: str | None = None
    label: str | None = None

    def report_label(self) -> str:
        if self.label:
            return self.label
        return f"{self.method} {self.endpoint}"


@dataclass(slots=True)
class RuntimeComparison:
    python_base_url: str
    rust_base_url: str
    iterations: int
    strict: bool
    overall_match: bool
    reports: list[EndpointReport]


def _normalize_content_type(value: str | None) -> str:
    if not value:
        return ""
    return value.split(";", 1)[0].strip().lower()


def _canonical_json(body: bytes) -> str | None:
    try:
        parsed = json.loads(body)
    except Exception:
        return None
    return json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _canonical_xml(body: bytes) -> str | None:
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return None

    normalized = text.strip()
    if not normalized.startswith("<"):
        return None

    normalized = re.sub(r'generated_at="[^"]*"', 'generated_at="__DYNAMIC__"', normalized)
    normalized = re.sub(r">\s+<", "><", normalized)
    return normalized


def _fetch_once(base_url: str, probe_request: ProbeRequest, timeout_seconds: float) -> ProbeSample:
    url = f"{base_url.rstrip('/')}{probe_request.endpoint}"
    request_body = probe_request.body.encode("utf-8") if probe_request.body is not None else None
    req = urllib.request.Request(url, data=request_body, method=probe_request.method)
    for header_name, header_value in probe_request.headers.items():
        req.add_header(header_name, header_value)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout_seconds) as resp:
            body = resp.read()
            status = resp.status
            content_type = _normalize_content_type(resp.headers.get("Content-Type"))
    except urllib.error.HTTPError as exc:
        body = exc.read() if exc.fp else b""
        status = exc.code
        content_type = _normalize_content_type(exc.headers.get("Content-Type") if exc.headers else "")
    except urllib.error.URLError as exc:
        body = json.dumps({"detail": f"request failed: {exc.reason}"}).encode("utf-8")
        status = 503
        content_type = "application/json"
    elapsed_ms = (time.perf_counter() - started) * 1000
    return ProbeSample(
        status=status,
        elapsed_ms=elapsed_ms,
        body_sha256=hashlib.sha256(body).hexdigest(),
        content_type=content_type,
        json_canonical=_canonical_json(body),
        xml_canonical=_canonical_xml(body),
    )


def _percentile(values: Iterable[float], pct: float) -> float:
    sorted_values = sorted(values)
    if not sorted_values:
        return 0.0
    if len(sorted_values) == 1:
        return sorted_values[0]
    idx = int(round((pct / 100) * (len(sorted_values) - 1)))
    return sorted_values[idx]


def _probe_runtime(
    base_url: str,
    probe_request: ProbeRequest,
    iterations: int,
    timeout_seconds: float,
) -> list[ProbeSample]:
    return [
        _fetch_once(base_url, probe_request, timeout_seconds)
        for _ in range(iterations)
    ]


def _parse_header_pairs(raw_headers: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw_header in raw_headers:
        if ":" not in raw_header:
            raise ValueError(f"invalid --header value '{raw_header}' (expected 'Name: Value')")
        header_name, header_value = raw_header.split(":", 1)
        name = header_name.strip()
        value = header_value.strip()
        if not name:
            raise ValueError(f"invalid --header value '{raw_header}' (empty name)")
        parsed[name] = value
    return parsed


def _request_body_to_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _build_request_from_record(
    record: dict[str, Any],
    global_headers: dict[str, str],
    *,
    index: int,
) -> ProbeRequest:
    endpoint = str(record.get("endpoint", "")).strip()
    if not endpoint.startswith("/"):
        raise ValueError(f"fixture request #{index} missing absolute endpoint")

    method = str(record.get("method", "GET")).strip().upper() or "GET"
    request_headers = {
        str(key): str(value)
        for key, value in (record.get("headers") or {}).items()
    }
    merged_headers = {**global_headers, **request_headers}
    body = _request_body_to_text(record.get("body"))
    if (
        body is not None
        and "content-type" not in {key.lower() for key in merged_headers}
        and not isinstance(record.get("body"), str)
    ):
        merged_headers["Content-Type"] = "application/json"
    label = record.get("label")
    label_text = str(label).strip() if label is not None else None
    if label_text == "":
        label_text = None

    return ProbeRequest(
        endpoint=endpoint,
        method=method,
        headers=merged_headers,
        body=body,
        label=label_text,
    )


def _load_requests_from_fixture(
    fixture_path: str,
    global_headers: dict[str, str],
) -> list[ProbeRequest]:
    payload = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    records: list[dict[str, Any]]
    if isinstance(payload, dict):
        requests_payload = payload.get("requests")
        if not isinstance(requests_payload, list):
            raise ValueError("fixture object must include a 'requests' array")
        records = requests_payload
    elif isinstance(payload, list):
        records = payload
    else:
        raise ValueError("fixture must be a JSON object or array")

    requests: list[ProbeRequest] = []
    for index, record in enumerate(records, start=1):
        if not isinstance(record, dict):
            raise ValueError(f"fixture request #{index} must be an object")
        requests.append(_build_request_from_record(record, global_headers, index=index))
    if not requests:
        raise ValueError("fixture contains no requests")
    return requests


def _build_probe_requests(args: argparse.Namespace) -> list[ProbeRequest]:
    global_headers = _parse_header_pairs(args.header)
    if args.requests_fixture:
        return _load_requests_from_fixture(args.requests_fixture, global_headers)
    return [
        ProbeRequest(endpoint=endpoint, headers=dict(global_headers))
        for endpoint in args.endpoints
    ]


def _build_report(
    endpoint: str,
    python_samples: list[ProbeSample],
    rust_samples: list[ProbeSample],
) -> EndpointReport:
    python_status = statistics.mode(sample.status for sample in python_samples)
    rust_status = statistics.mode(sample.status for sample in rust_samples)

    python_content_type = statistics.mode(sample.content_type for sample in python_samples)
    rust_content_type = statistics.mode(sample.content_type for sample in rust_samples)

    python_body = statistics.mode(sample.body_sha256 for sample in python_samples)
    rust_body = statistics.mode(sample.body_sha256 for sample in rust_samples)

    python_json = statistics.mode(sample.json_canonical for sample in python_samples)
    rust_json = statistics.mode(sample.json_canonical for sample in rust_samples)

    status_match = python_status == rust_status
    content_type_match = python_content_type == rust_content_type
    body_hash_match = python_body == rust_body
    python_xml = statistics.mode(sample.xml_canonical for sample in python_samples)
    rust_xml = statistics.mode(sample.xml_canonical for sample in rust_samples)

    json_body_match = python_json == rust_json
    xml_body_match = python_xml == rust_xml
    payload_match_kind = "json" if python_json is not None and rust_json is not None else "xml"
    payload_match = json_body_match if payload_match_kind == "json" else xml_body_match
    if payload_match_kind == "xml" and python_xml is None and rust_xml is None:
        payload_match_kind = "hash"
        payload_match = body_hash_match

    contract_match = status_match and content_type_match and payload_match

    mismatch_reasons: list[str] = []
    if not status_match:
        mismatch_reasons.append("status")
    if not content_type_match:
        mismatch_reasons.append("content_type")
    if not payload_match:
        mismatch_reasons.append(f"{payload_match_kind}_body")

    python_latencies = [sample.elapsed_ms for sample in python_samples]
    rust_latencies = [sample.elapsed_ms for sample in rust_samples]

    return EndpointReport(
        endpoint=endpoint,
        python_status=python_status,
        rust_status=rust_status,
        status_match=status_match,
        python_content_type=python_content_type,
        rust_content_type=rust_content_type,
        content_type_match=content_type_match,
        body_hash_match=body_hash_match,
        json_body_match=json_body_match,
        xml_body_match=xml_body_match,
        payload_match_kind=payload_match_kind,
        payload_match=payload_match,
        contract_match=contract_match,
        mismatch_reasons=mismatch_reasons,
        python_p50_ms=round(_percentile(python_latencies, 50), 2),
        rust_p50_ms=round(_percentile(rust_latencies, 50), 2),
        python_p95_ms=round(_percentile(python_latencies, 95), 2),
        rust_p95_ms=round(_percentile(rust_latencies, 95), 2),
    )


def run(args: argparse.Namespace) -> RuntimeComparison:
    probe_requests = _build_probe_requests(args)
    reports: list[EndpointReport] = []
    for probe_request in probe_requests:
        py_samples = _probe_runtime(
            args.python_base_url,
            probe_request,
            args.iterations,
            args.timeout,
        )
        rs_samples = _probe_runtime(
            args.rust_base_url,
            probe_request,
            args.iterations,
            args.timeout,
        )
        reports.append(_build_report(probe_request.report_label(), py_samples, rs_samples))

    overall_match = all(report.contract_match for report in reports)
    return RuntimeComparison(
        python_base_url=args.python_base_url,
        rust_base_url=args.rust_base_url,
        iterations=args.iterations,
        strict=args.strict,
        overall_match=overall_match,
        reports=reports,
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--rust-base-url", default="http://127.0.0.1:8099")
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument(
        "--requests-fixture",
        default="",
        help="Path to JSON fixture with request entries (method/endpoint/headers/body).",
    )
    parser.add_argument(
        "--endpoints",
        nargs="+",
        default=["/health", "/health/live", "/health/ready", "/health/startup"],
        help="List of endpoint paths to compare.",
    )
    parser.add_argument(
        "--header",
        action="append",
        default=[],
        help="Global header in 'Name: Value' format. Can be repeated.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Exit with status 1 when any endpoint has contract mismatch.",
    )
    parser.add_argument("--output", default="", help="Optional path to write JSON result.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    result = run(args)

    payload: dict[str, Any] = {
        "python_base_url": result.python_base_url,
        "rust_base_url": result.rust_base_url,
        "iterations": result.iterations,
        "strict": result.strict,
        "overall_match": result.overall_match,
        "reports": [asdict(report) for report in result.reports],
    }

    print(json.dumps(payload, indent=2, sort_keys=True))
    if args.output:
        with open(args.output, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")

    if args.strict and not result.overall_match:
        sys.exit(1)


if __name__ == "__main__":
    main()
