## MODIFIED Requirements
### Requirement: SPA routing
The application SHALL use React Router v6 for client-side routing with routes: `/dashboard`, `/accounts`, `/projects`, `/apis`, `/devices`, and `/settings`. The root path `/` SHALL redirect to `/dashboard`. FastAPI SHALL serve `index.html` for all unmatched routes as a SPA fallback.

#### Scenario: Direct navigation to Projects route
- **WHEN** a user navigates directly to `/projects` in the browser
- **THEN** FastAPI serves `index.html` and React Router renders the Projects page

#### Scenario: Client-side navigation to Projects route
- **WHEN** a user clicks the `Projects` tab from another page
- **THEN** the URL changes to `/projects` without full page reload and the Projects page renders

### Requirement: Projects page
The Projects page SHALL display a list of saved projects and allow operators to add, edit, and remove project records. Each project SHALL store `name`, optional `description`, optional absolute `projectPath`, `sandboxMode`, and optional `gitBranch` values and persist across page reloads.

#### Scenario: Projects list loads
- **WHEN** a user opens `/projects`
- **THEN** the frontend calls `GET /api/projects` and renders the returned entries

#### Scenario: User adds a project
- **WHEN** a user submits a project name with optional description/path/branch and sandbox mode
- **THEN** the frontend calls `POST /api/projects` and the new entry appears in the list

#### Scenario: User updates a project
- **WHEN** a user edits project fields and confirms save
- **THEN** the frontend calls `PUT /api/projects/{projectId}` and the list reflects the updated values

#### Scenario: User removes a project
- **WHEN** a user confirms deletion for an existing project
- **THEN** the frontend calls `DELETE /api/projects/{projectId}` and refreshes the displayed list

#### Scenario: User injects project context into a Codex task prompt
- **WHEN** a user selects a saved project in the Codex control center and chooses to insert project context
- **THEN** the prompt draft is populated with project path, sandbox mode, and git branch setup guidance before the task body

### Requirement: Project control dispatch
The Projects page SHALL provide a control panel that allows an operator to select an account target, compose a task prompt, optionally inject selected project context, and dispatch the prompt to that account's CLI terminal without opening a local CLI window manually.

#### Scenario: Operator dispatches prompt from projects page
- **WHEN** a user selects an account and submits a non-empty prompt from `/projects`
- **THEN** the frontend opens `/api/accounts/{accountId}/terminal/ws` and sends the prompt payload to the terminal session

#### Scenario: Operator injects saved project context
- **WHEN** a user selects a saved project and clicks to insert project context
- **THEN** the prompt editor is prefilled with structured project details including name, description, sandbox mode, path, and branch
