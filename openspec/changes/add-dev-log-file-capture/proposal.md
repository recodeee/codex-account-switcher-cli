## Why

During local docker-compose development, backend and frontend logs are only streamed to stdout. Operators asked for an opt-in way to persist those logs to `.log` files without changing the default behavior.

## What Changes

- Add an opt-in `LOGGING_TO_FILE` environment toggle for docker-compose development services.
- When enabled, write backend service logs to `./logs/server.log`.
- When enabled, write frontend service logs to `./logs/frontend.log`.
- Keep streaming logs to stdout while writing to files.

## Impact

- Easier post-mortem debugging for frontend/backend issues in dev.
- No behavior change unless `LOGGING_TO_FILE` is explicitly enabled.
