## 1. Specification

- [x] 1.1 Add OpenSpec change for live usage task-preview XML extension.

## 2. Backend implementation

- [x] 2.1 Extend `GET /live_usage` to include task-preview mapping metadata.
- [x] 2.2 Add per-snapshot nested `task_preview` XML rows when preview data exists.
- [x] 2.3 Preserve snapshot-only rows for snapshots without task previews.

## 3. Validation

- [x] 3.1 Update unit tests for `/live_usage` XML output.
- [x] 3.2 Run targeted health probe unit tests.
- [x] 3.3 Run OpenSpec validation.
