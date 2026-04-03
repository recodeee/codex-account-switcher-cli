## MODIFIED Requirements
### Requirement: SPA routing
The application SHALL use React Router v6 for client-side routing with routes: `/dashboard`, `/accounts`, `/apis`, `/devices`, `/sessions`, and `/settings`. The root path `/` SHALL redirect to `/dashboard`. FastAPI SHALL serve `index.html` for all unmatched routes as a SPA fallback.

#### Scenario: Direct navigation to Sessions route
- **WHEN** a user navigates directly to `/sessions` in the browser
- **THEN** FastAPI serves `index.html` and React Router renders the Sessions page

#### Scenario: Client-side navigation to Sessions route
- **WHEN** a user clicks the `Sessions` tab from another page
- **THEN** the URL changes to `/sessions` without full page reload and the Sessions page renders

### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Account card shows total token usage
- **WHEN** `GET /api/dashboard/overview` returns `accounts[].requestUsage.totalTokens`
- **THEN** each dashboard account card shows a `Tokens used` value using that per-account total

#### Scenario: Account card formats token usage with k-suffix credits
- **WHEN** a dashboard account card renders `Tokens used`
- **THEN** the value is displayed with a `k` suffix (for example `225k`)
- **AND** decimal precision from the source value is preserved when present

#### Scenario: Account card shows codex session count
- **WHEN** `GET /api/dashboard/overview` returns `accounts[].codexSessionCount`
- **THEN** each dashboard account card shows a `Codex sessions` count for that account

#### Scenario: Account card exposes Sessions shortcut for active codex sessions
- **WHEN** an account card has `Codex sessions > 0`
- **THEN** the card includes a `Sessions` action button
- **AND** selecting it navigates to `/sessions?accountId=<accountId>`

### Requirement: Sessions page
The Sessions page SHALL display read-only Codex sessions grouped by account using sticky-session data filtered to `codex_session` kind.

#### Scenario: Sessions page loads Codex sessions
- **WHEN** a user opens `/sessions`
- **THEN** the frontend requests sticky sessions scoped to `kind=codex_session`
- **AND** only codex-session mappings are rendered

#### Scenario: Sessions page groups by account
- **WHEN** the sessions response contains entries across multiple accounts
- **THEN** the UI groups entries by account identity and shows each account's session rows and count

#### Scenario: Sessions page falls back to dashboard counters when sticky mappings are empty
- **WHEN** `/sessions` has zero `codex_session` sticky mappings
- **AND** `GET /api/dashboard/overview` reports one or more accounts with `codexSessionCount > 0`
- **THEN** the Sessions page shows account-level live Codex session counters instead of an empty state
