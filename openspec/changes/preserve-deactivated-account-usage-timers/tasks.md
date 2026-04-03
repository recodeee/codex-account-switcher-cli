## 1. Implementation

- [x] 1.1 Add last usage recorded-at fields to account summary backend schema/mapping for primary and secondary windows.
- [x] 1.2 Expose new fields in frontend account summary schema.
- [x] 1.3 Render "last seen … ago" context for deactivated accounts in dashboard card and account usage panel.
- [x] 1.4 Move dashboard deactivated last-seen indicator into the card status row beside the deactivated badge.
- [x] 1.5 Render the deactivated account 5h progress bar with neutral gray styling.
- [x] 1.6 Sort dashboard account cards so deactivated accounts are listed after active/non-deactivated accounts.

## 2. Validation

- [x] 2.1 Add/extend frontend unit tests for last-seen label formatting and rendering.
- [ ] 2.2 Run targeted backend integration tests for dashboard/account payload contract.
- [x] 2.3 Run targeted frontend tests for updated components and formatters.
