## Why

The dashboard currently takes over `/`, but we need a simple branded public entry page that says the product is coming soon and lets people share interest via email.

## What Changes

- Replace the `/` redirect with a public `Coming Soon` landing page.
- Add a dedicated `/coming-soon` route that renders the same landing page content.
- Add recodee.com branding (logo + label) and a basic email input + submit flow.
- Show a dashboard teaser image (`/commingsoon.jpg`) on the landing page.

## Impact

- Code: `frontend/app/page.tsx`, `frontend/app/coming-soon/page.tsx`, `frontend/src/features/coming-soon/components/coming-soon-page.tsx`
- Tests: `frontend/src/features/coming-soon/components/coming-soon-page.test.tsx`
- Specs: `openspec/specs/frontend-architecture/spec.md` (via change delta)
