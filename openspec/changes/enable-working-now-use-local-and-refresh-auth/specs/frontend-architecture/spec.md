## MODIFIED Requirements

### Requirement: Re-auth actions attempt non-interactive refresh before OAuth fallback

Re-auth actions for deactivated accounts SHALL first attempt non-interactive token refresh before opening OAuth fallback flows.

#### Scenario: Dashboard re-auth succeeds with refresh-auth

- **WHEN** a dashboard account card is `deactivated`
- **AND** the user clicks `Re-auth`
- **THEN** the app calls `POST /api/accounts/{accountId}/refresh-auth`
- **AND** on success, the dashboard remains on `/dashboard`

#### Scenario: Dashboard re-auth falls back when refresh-auth fails

- **WHEN** a dashboard account card is `deactivated`
- **AND** `POST /api/accounts/{accountId}/refresh-auth` returns an error
- **THEN** the app navigates to `/accounts?selected={accountId}` for fallback recovery

#### Scenario: Accounts re-authenticate falls back to OAuth dialog on refresh-auth failure

- **WHEN** the selected account in `/accounts` is `deactivated`
- **AND** the user clicks `Re-authenticate`
- **THEN** the app calls `POST /api/accounts/{accountId}/refresh-auth` first
- **AND** when refresh fails, the OAuth dialog opens for manual re-authentication
