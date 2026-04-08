## Why

Usage-limit task text inside CLI session rows is easy to miss in the session panel because it renders with the same neutral text color as ordinary prompts.

## What Changes

- Detect usage-limit wording in per-session task previews.
- Render those session preview lines in red text for faster triage.

## Impact

- Operators can immediately spot quota-hit session prompts in the session list.
