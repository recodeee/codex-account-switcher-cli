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

Next dev server runs on port `5173` by default and proxies API routes to FastAPI:

- `/api/*`
- `/v1/*`
- `/backend-api/*`
- `/health`

## Build

```bash
bun run build
```

Production static export assets are emitted to `../app/static`.

## Quality

```bash
bun run lint
bun run typecheck
bun run test
bun run test:coverage
```
