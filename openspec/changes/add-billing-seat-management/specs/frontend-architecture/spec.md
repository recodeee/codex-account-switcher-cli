## MODIFIED Requirements
### Requirement: SPA routing
The application SHALL use React Router v6 for client-side routing with routes: `/dashboard`, `/accounts`, `/billing`, `/apis`, `/devices`, `/storage`, `/sessions`, `/settings`, and `/firewall` (redirect to `/settings`). The root path `/` SHALL redirect to `/dashboard`. FastAPI SHALL serve `index.html` for all unmatched routes as a SPA fallback.

#### Scenario: Client-side navigation to Billing route
- **WHEN** a user clicks the `Billing` tab from another page
- **THEN** the URL changes to `/billing` without full page reload and the Billing page renders

#### Scenario: Account menu navigation to Billing route
- **WHEN** a user chooses `Billing` from the account dropdown navigation
- **THEN** the URL changes to `/billing` and the Billing page renders inside the existing app layout

### Requirement: Billing page
The Billing page SHALL provide a business-plan seat management surface that shows billing cycle timing, per-seat pricing, assigned members, and computed monthly seat total.

#### Scenario: Billing cycle and base totals are visible
- **WHEN** a user opens `/billing`
- **THEN** the page displays the current cycle label and renewal date
- **AND** it shows ChatGPT seat pricing as `€26/month`
- **AND** it shows the current calculated monthly total for assigned ChatGPT seats

#### Scenario: Adding a new seat updates monthly total
- **WHEN** a user adds a new member assigned to a ChatGPT seat from the Billing page
- **THEN** the member appears in the billing users table
- **AND** the monthly ChatGPT total increases by `€26`
