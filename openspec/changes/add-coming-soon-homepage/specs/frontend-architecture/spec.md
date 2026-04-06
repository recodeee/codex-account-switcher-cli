## MODIFIED Requirements
### Requirement: SPA routing
The application SHALL use React Router v6 for client-side routing with routes: `/dashboard`, `/accounts`, `/apis`, `/devices`, `/storage`, `/sessions`, and `/settings`. The root path `/` SHALL render a public `Coming Soon` landing page for recodee.com, and `/coming-soon` SHALL render the same landing page content. FastAPI SHALL serve `index.html` for all unmatched routes as a SPA fallback.

#### Scenario: Direct navigation to root landing page
- **WHEN** a user navigates directly to `/` in the browser
- **THEN** the app renders a public `Coming Soon` page with recodee.com branding
- **AND** the page does not redirect to `/dashboard`

#### Scenario: Direct navigation to explicit coming-soon route
- **WHEN** a user navigates directly to `/coming-soon` in the browser
- **THEN** the app renders the same `Coming Soon` page as `/`

### Requirement: Public coming-soon interest form
The public landing page SHALL include an email input and submit button so visitors can express interest.

#### Scenario: Visitor submits an email on the landing page
- **WHEN** a visitor enters a valid email address and clicks `Submit`
- **THEN** the page accepts the submission interaction and shows an on-page confirmation message

### Requirement: Public coming-soon dashboard teaser
The public landing page SHALL display a dashboard teaser image sourced from `/commingsoon.jpg`.

#### Scenario: Landing page shows dashboard preview image
- **WHEN** a visitor opens `/` or `/coming-soon`
- **THEN** the page shows a visible dashboard preview image sourced from `/commingsoon.jpg`
