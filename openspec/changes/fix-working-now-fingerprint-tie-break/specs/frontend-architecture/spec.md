## ADDED Requirements

### Requirement: Default-session fingerprint matching uses reset-time tie-breaks
When default local session samples have near-identical usage percentages across candidate accounts, matching SHALL use reset-time fingerprints to disambiguate accounts when reset evidence is materially stronger for one candidate.

#### Scenario: Percent scores are tied but reset fingerprint is decisive
- **WHEN** two candidate accounts have equivalent percentage-distance scores for a rollout sample
- **AND** one account has a materially closer reset-time fingerprint for the same sample
- **THEN** the sample is matched to the account with the stronger reset-time fingerprint
- **AND** the sample is not dropped as ambiguous
