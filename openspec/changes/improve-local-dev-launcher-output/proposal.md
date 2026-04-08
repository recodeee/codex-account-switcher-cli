## Why

Local `bun run dev` currently streams all child-service logs into one terminal. That makes startup noisy even when the operator only wants the app URLs and a quiet long-running session.

## What Changes

- Make root `bun run dev` start the app API, commerce backend, and frontend in order while keeping the terminal output quiet by default.
- Print the service URLs and log-watch hints once startup completes.
- Add a root `bun run logs` command that can tail a specific service log on demand.

## Impact

- Code: `scripts/dev-all.sh`, `scripts/dev-logs.sh`, `package.json`
- Tests: add script coverage for quiet startup and targeted log watching
- Specs: add local developer runtime requirements for quiet startup and targeted log access
