# codex-lb Medusa backend

This service is copied/adapted from `WEBU/apps/backend` to provide a separate
commerce backend boundary for codex-lb.

## Scope

- Runs as an independent Medusa service
- Uses Supabase Postgres via `SUPABASE_DB_URL` (or `DATABASE_URL`)
- Stays isolated from the Python proxy backend in `app/`

## Quick start

```bash
cd backend/apps/backend
cp .env.template .env
pnpm install
pnpm dev
```

Default local port: `9000`

## Useful scripts

- `pnpm dev` – singleton dev launcher
- `pnpm build` – Medusa build
- `pnpm seed` – seed script
- `pnpm test:integration:http` – HTTP integration tests

## Notes

- `scripts/dev-singleton.js` keeps one local Medusa dev process alive and
  records the selected port in the shared `.dev-ports.json`.
- Supabase SQL artifacts for the commerce layer live in `supabase/`.
