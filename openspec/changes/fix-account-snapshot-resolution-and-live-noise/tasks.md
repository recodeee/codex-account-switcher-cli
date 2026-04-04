## 1. Snapshot resolution correctness
- [x] 1.1 Prioritize email-derived snapshot candidates during account snapshot resolution.
- [x] 1.2 Ensure account snapshot selection prefers email-aligned snapshot names over active-pointer ties.
- [x] 1.3 Add unit coverage for conflicting snapshot-name scenarios.

## 2. Live attribution noise reduction
- [x] 2.1 Make default-session fingerprint spreading opt-in behind an explicit environment flag.
- [x] 2.2 Add unit coverage proving fallback remains disabled by default.

## 3. Verification
- [x] 3.1 Run targeted backend unit tests for codex-auth snapshot mapping and live-usage overrides.
- [x] 3.2 Validate specs with `openspec validate --specs`.
