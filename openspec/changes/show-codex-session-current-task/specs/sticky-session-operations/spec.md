## MODIFIED Requirements
### Requirement: Dashboard exposes sticky-session administration
The system SHALL provide dashboard APIs for listing sticky-session mappings, deleting one mapping, and purging stale mappings.

#### Scenario: List sticky-session mappings includes codex task preview metadata
- **WHEN** the dashboard requests sticky-session entries
- **THEN** each entry includes `key`, `account_id`, `display_name`, `kind`, `created_at`, `updated_at`, `expires_at`, and `is_stale`
- **AND** `codex_session` entries additionally include `task_preview`, `task_updated_at`, and `is_active`
- **AND** the response includes the total number of stale `prompt_cache` mappings that currently exist beyond the returned page

#### Scenario: List sticky-session mappings with active-only filtering
- **WHEN** the dashboard requests sticky-session entries with `activeOnly=true`
- **THEN** only mappings updated within the active recency window are returned
- **AND** the response `total` and `has_more` reflect the filtered result set

### Requirement: Sticky sessions are explicitly typed
The system SHALL persist each sticky-session mapping with an explicit kind so durable Codex backend affinity, durable dashboard sticky-thread routing, and bounded prompt-cache affinity can be managed independently.

#### Scenario: Codex session mappings preserve current task preview
- **WHEN** a backend Codex request with `codex_session` affinity creates or refreshes stickiness
- **THEN** the mapping stores a redacted, truncated `task_preview` derived from current user input when available
- **AND** the mapping updates `task_updated_at` for the captured preview
