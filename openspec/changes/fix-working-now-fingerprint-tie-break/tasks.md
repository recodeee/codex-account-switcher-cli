## 1. Implementation

- [x] 1.1 Allow reset-time fingerprint deltas to resolve near-tied percent fingerprints in default-session sample matching.
- [x] 1.2 Keep ambiguity fallback for cases without a strong reset-time signal.

## 2. Validation

- [x] 2.1 Add unit test coverage for percent-tie + reset-delta disambiguation.
- [x] 2.2 Run backend unit tests for live-usage override matching.
- [x] 2.3 Validate specs with `openspec validate --specs`.
