### ADDED Requirement: Redeploy installs bundled codex-auth CLI
The project redeploy workflow SHALL install or update `codex-auth` globally from the repository-bundled `codex-account-switcher` package before Docker services are rebuilt/restarted.

#### Scenario: Default redeploy installs codex-auth
- **WHEN** an operator runs `./redeploy.sh` with default settings
- **THEN** the workflow installs/updates global `codex-auth` from `./codex-account-switcher`
- **AND** continues with Docker compose build/restart steps

#### Scenario: Operator disables codex-auth install step
- **WHEN** an operator runs `./redeploy.sh --skip-codex-auth-install`
- **OR** sets `CODEX_LB_INSTALL_CODEX_AUTH=false`
- **THEN** redeploy skips the global `codex-auth` install/update step
- **AND** continues with Docker compose build/restart steps
