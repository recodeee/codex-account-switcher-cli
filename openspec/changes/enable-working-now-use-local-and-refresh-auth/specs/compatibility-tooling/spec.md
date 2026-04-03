## MODIFIED Requirements

### Requirement: Dashboard per-account local codex-auth switch

The dashboard and accounts UI SHALL expose a per-account action that attempts to switch the host's active Codex login using `codex-auth use <snapshot>`.

#### Scenario: Use this action is enabled for accounts that are working now

- **WHEN** account telemetry indicates the account is working now (`hasLiveSession == true` OR `codexSessionCount > 0`)
- **THEN** the UI shows **Use this** / **Use this account** as enabled
- **AND** does not require 5h quota to be >= 1 for that working-now account

#### Scenario: Non-working accounts still require active status and 5h quota

- **WHEN** an account is not working now
- **THEN** **Use this** is enabled only when status resolves to `active` and `primary_remaining_percent >= 1`
- **AND** remains disabled with an explanatory reason otherwise

### ADDED Requirement: Account refresh-auth endpoint

The backend SHALL provide a refresh-token reauthentication endpoint so the UI can recover account auth without interactive login.

#### Scenario: Refresh-auth succeeds without login

- **WHEN** the client calls `POST /api/accounts/{accountId}/refresh-auth` for an existing account
- **THEN** the server refreshes account tokens using the stored refresh token
- **AND** returns a success payload indicating the account was refreshed

#### Scenario: Refresh-auth reports permanent refresh failure

- **WHEN** token refresh returns a permanent auth error
- **THEN** the endpoint returns a dashboard error with a stable refresh-failure code
- **AND** callers can fall back to interactive OAuth reauthentication
