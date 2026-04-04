## Why

Operators still see noisy snapshot attribution in dashboard live-quota debug output for some accounts.
In affected cases, account status resolves a single snapshot, but downstream live-usage override logic can fall back to the broader snapshot index bucket and re-introduce stale aliases.

Separately, when multiple snapshot names share the same email-local-part prefix (for example `codexina` and `codexinaforever`), selection can jump back to the shortest alias even when another matching snapshot is actively selected.

## What Changes

- Ensure live-usage override/debug paths always consume the resolved `snapshot_name` from account auth status when available.
- Refine snapshot selection precedence so active snapshot wins in local-part prefix ambiguity collisions.
- Add regression tests for both behaviors.

## Impact

- Dashboard debug `snapshots=` stays single-valued and stable per account.
- `no_live_telemetry` cards no longer advertise stale alias lists.
- Snapshot selection better aligns with explicit `codex-auth save <name>` workflows when multiple prefix aliases exist.
