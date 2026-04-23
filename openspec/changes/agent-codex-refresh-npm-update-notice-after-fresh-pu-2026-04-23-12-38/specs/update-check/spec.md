## ADDED Requirements

### Requirement: Fresh npm releases become visible soon after publish

The CLI MUST not suppress update prompts for hours when cached npm metadata only proves the user was up to date before a newer release was published.

#### Scenario: stale negative cache after publish

- **Given** the installed CLI version is `0.1.16`
- **And** the cached npm latest version is also `0.1.16`
- **And** npm now serves `0.1.18`
- **When** the short up-to-date cache TTL expires
- **Then** `codex-auth` rechecks npm before deciding that no update is available

### Requirement: Known newer releases can reuse the longer cache window

When the cached npm version is already newer than the installed CLI version, the CLI MUST keep reusing that cached update result for the normal cache TTL unless the normal cache window has expired.

#### Scenario: cached update remains reusable

- **Given** the installed CLI version is `0.1.16`
- **And** the cached npm latest version is `0.1.18`
- **When** the user reruns an interactive command within the long cache TTL
- **Then** the CLI may reuse the cached `0.1.18` result without another npm request
