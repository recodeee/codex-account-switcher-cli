## MODIFIED Requirements
### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Account card shows latest active codex task preview
- **WHEN** `GET /api/dashboard/overview` returns `accounts[].codexCurrentTaskPreview`
- **THEN** each working dashboard account card renders the preview text in a compact, truncated style
- **AND** cards without a preview do not show placeholder noise

### Requirement: Sessions page
The Sessions page SHALL display read-only Codex sessions grouped by account using sticky-session data filtered to `codex_session` kind.

#### Scenario: Sessions page requests active codex-session rows
- **WHEN** a user opens `/sessions`
- **THEN** the frontend requests sticky sessions with `kind=codex_session` and `activeOnly=true`
- **AND** the page renders only active codex-session mappings

#### Scenario: Sessions page shows per-session current task preview
- **WHEN** a codex-session sticky entry includes `taskPreview`
- **THEN** the corresponding session row shows that task preview alongside session metadata
- **AND** long previews are visually truncated while preserving a tooltip/full title
