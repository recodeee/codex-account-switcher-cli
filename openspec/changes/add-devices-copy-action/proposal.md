## Why
Operators often need to transfer saved device mappings to external systems (inventory sheets, DNS tools, ticket notes). The Devices table currently only supports deletion, which forces manual retyping of device names and IP addresses.

## What Changes
- Add a per-row copy action in the Devices table next to Delete.
- Copy both device name and IP address to clipboard in one action.
- Add frontend integration coverage for the new copy action.

## Impact
- Improves operational speed and reduces copy/paste mistakes.
- Keeps existing add/delete behavior unchanged.
