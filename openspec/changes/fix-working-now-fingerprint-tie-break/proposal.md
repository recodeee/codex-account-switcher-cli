## Why

When multiple accounts have very similar usage percentages, default-session fingerprint matching can treat samples as ambiguous even when reset timestamps clearly identify the correct account. This can hide a genuinely active account from the dashboard `Working now` group.

## What Changes

- Refine default-session fingerprint matching so reset-time fingerprints can break near-tied percentage matches.
- Preserve the existing ambiguity guard when neither percent nor reset data can confidently disambiguate.
- Add backend unit coverage for the tie-break case.

## Expected Outcome

- Live rollout samples map to the intended account more reliably in multi-terminal usage.
- Accounts active in a separate terminal can still appear in `Working now` even when usage percentages are close.
