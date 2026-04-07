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
The Projects page SHALL display a list of saved projects and allow operators to add, edit, and remove project records. Each project SHALL store `name` and optional `description` values and persist across page reloads.

#### Scenario: Projects list loads
- **WHEN** a user opens `/projects`
- **THEN** the frontend calls `GET /api/projects` and renders the returned entries

#### Scenario: User adds a project
- **WHEN** a user submits a project name and optional description
- **THEN** the frontend calls `POST /api/projects` and the new entry appears in the list

#### Scenario: User updates a project
- **WHEN** a user edits project fields and confirms save
- **THEN** the frontend calls `PUT /api/projects/{projectId}` and the list reflects the updated values

#### Scenario: User removes a project
- **WHEN** a user confirms deletion for an existing project
- **THEN** the frontend calls `DELETE /api/projects/{projectId}` and refreshes the displayed list
