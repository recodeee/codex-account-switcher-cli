## ADDED Requirements

### Requirement: Release prep must bump package version and release notes together

When a new publishable package version is prepared, the repo MUST update the package version metadata and create the matching release note in the same change.

#### Scenario: prepare the next patch release

- **Given** the current package version is `0.1.18`
- **When** the next publishable patch release is prepared
- **Then** `package.json` and `package-lock.json` are updated to `0.1.19`
- **And** `releases/v0.1.19.md` exists with publish-ready notes
