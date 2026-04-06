# Frontend (Bun + Next.js App Router + React + TypeScript)

This frontend is built with Bun and Next.js App Router.

## Prerequisites

- Bun 1.3+

## Setup

```bash
cd frontend
bun install
```

## Development

```bash
bun run dev
```

Next dev server runs on port `5173` by default (`NEXT_DEV_PORT` overrides it) and proxies API routes to FastAPI:

```bash
NEXT_DEV_PORT=5174 bun run dev
```

- `/api/*`
- `/v1/*`
- `/backend-api/*`
- `/health`

## Build

```bash
bun run build
```

Production static export assets are emitted to `../app/static`.

To auto-refresh `:2455` static output while editing frontend code:

```bash
bun run build:watch
```

## Quality

```bash
bun run lint
bun run typecheck
bun run test
bun run test:coverage
```
