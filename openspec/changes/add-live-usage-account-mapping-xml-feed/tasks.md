## 1. Specification

- [x] 1.1 Add OpenSpec change for live usage account mapping XML feed.

## 2. Backend implementation

- [x] 2.1 Add `GET /live_usage/mapping` endpoint under health API.
- [x] 2.2 Emit XML account mapping rows with CLI signal attributes and unmapped snapshot rows.
- [x] 2.3 Keep existing `/live_usage` XML payload unchanged.
- [x] 2.4 Add `?minimal=true` compact mapping variant for watch dashboards.

## 3. Validation

- [x] 3.1 Add/extend unit tests for live usage XML endpoints.
- [x] 3.2 Run targeted unit tests for health probes.
- [x] 3.3 Run lint/static checks for changed Python files.
