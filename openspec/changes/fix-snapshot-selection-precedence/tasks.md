## 1. Implementation

- [x] 1.1 Update live usage override snapshot candidate resolution to always honor selected snapshot when present.
- [x] 1.2 Update codex-auth snapshot selection precedence to prefer active snapshot during multiple local-part prefix matches.
- [x] 1.3 Remove stale `codexina` local snapshot alias and retain `codexinaforever`.

## 2. Validation

- [x] 2.1 Add/adjust unit tests for selected-snapshot-only live quota debug behavior.
- [x] 2.2 Add/adjust unit tests for prefix-ambiguity active-snapshot precedence.
- [ ] 2.3 Run targeted Python unit tests for snapshot-selection and live-usage override modules.
- [ ] 2.4 Run `openspec validate --specs`.
