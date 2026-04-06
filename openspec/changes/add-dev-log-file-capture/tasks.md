## 1. Implementation

- [x] 1.1 Add backend dev startup wrapper that conditionally tees logs to a file when `LOGGING_TO_FILE` is enabled.
- [x] 1.2 Add frontend dev startup wrapper that conditionally tees logs to a file when `LOGGING_TO_FILE` is enabled.
- [x] 1.3 Wire docker-compose services to use the new wrappers and mount a shared `./logs` directory.
- [x] 1.4 Document env toggle in `.env.example` and local env template.

## 2. Verification

- [x] 2.1 Run `docker compose config` to validate compose changes.
- [x] 2.2 Run frontend lint/typecheck to ensure no frontend regressions from script integration.
- [x] 2.3 Run shell syntax checks for both log wrapper scripts.
- [x] 2.4 Smoke-check wrapper scripts with `LOGGING_TO_FILE=true` and confirm `logs/server.log` + `logs/frontend.log` are created.
