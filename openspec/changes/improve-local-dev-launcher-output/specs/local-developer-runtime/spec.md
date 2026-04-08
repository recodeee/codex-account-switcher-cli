## ADDED Requirements

### Requirement: Root dev startup is quiet and ordered
The root `bun run dev` command SHALL start the local app API first, the commerce backend second, and the frontend last. Once the stack is ready, it SHALL print the current service URLs without streaming routine child-service logs into the main terminal.

#### Scenario: Root dev startup prints URLs without noisy child logs
- **WHEN** an operator runs `bun run dev`
- **THEN** the app API starts before the commerce backend
- **AND** the commerce backend starts before the frontend
- **AND** the terminal prints the reachable URLs for the running services
- **AND** routine child-service logs are written to log files instead of being streamed continuously to the main terminal

### Requirement: Root dev logs can be tailed by target
The root workspace SHALL expose a `bun run logs` command that can print or follow a single service log on demand.

#### Scenario: Watch a frontend log from the root
- **WHEN** an operator runs `bun run logs -watch frontend`
- **THEN** the command follows the frontend log file without starting the dev stack again

#### Scenario: Watch the app API log from the root
- **WHEN** an operator runs `bun run logs -watch app`
- **THEN** the command follows the app API log file

#### Scenario: Watch the commerce backend log from the root
- **WHEN** an operator runs `bun run logs -watch backend`
- **THEN** the command follows the commerce backend log file
