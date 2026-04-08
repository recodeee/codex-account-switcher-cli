## MODIFIED Requirements

### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Dashboard reacts to websocket invalidation events
- **WHEN** dashboard websocket connection to `/api/dashboard/overview/ws` is authenticated and active
- **AND** backend emits `dashboard.overview.invalidate`
- **THEN** frontend SHALL invalidate and refetch dashboard overview query data.
- **AND** the UI SHALL continue using `/api/dashboard/overview` as the canonical payload source.

#### Scenario: Dashboard keeps fallback polling when websocket is unavailable
- **WHEN** websocket connection is disconnected or cannot be established
- **THEN** dashboard SHALL continue refreshing via polling-based behavior.

#### Scenario: Dashboard strips control-wrapper payloads from task preview text
- **WHEN** local task preview inputs include control wrappers (`<skill>`, `<hook_prompt>`, `<subagent_notification>`)
- **THEN** dashboard task preview text SHALL omit wrapper payloads.
- **AND** meaningful user task text after/before wrappers SHALL remain visible.
