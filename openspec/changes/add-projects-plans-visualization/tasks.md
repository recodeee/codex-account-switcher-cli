## 1. Spec

- [x] 1.1 Capture/confirm frontend architecture requirements for Projects -> Plans submenu and plans visualization data contract
- [x] 1.2 Extend the plan-visualization contract to cover role canonicalization (`designer` included), active checkpoint resume pointer, and aggregate percent progress
- [x] 1.3 Validate OpenSpec changes (`openspec validate --specs`)

## 2. Tests

- [x] 2.1 Add backend integration tests for plans list/detail APIs and error handling
- [x] 2.2 Add backend assertions for aggregate progress percentage + current checkpoint pointer resolution
- [x] 2.3 Add frontend integration tests for Plans navigation and visualization
- [x] 2.4 Add frontend assertions for progress bar percentage and “where left off” checkpoint card states
- [x] 2.5 Update frontend MSW handler coverage for new plans endpoints/fields
- [x] 2.6 Add frontend assertions for user-friendly summary/checkpoint log rendering

## 3. Implementation

- [x] 3.1 Implement backend plans reader/service/API and wire router
- [x] 3.2 Add backend structured progress fields (`overallProgress`, `currentCheckpoint`) and designer-aware role ordering
- [x] 3.3 Implement frontend nav submenu + `/projects/plans` route + Plans page feature
- [x] 3.4 Update frontend API/hook/schemas for expanded plans contract
- [x] 3.5 Render progress bar + current checkpoint summary UI while preserving existing summary/checkpoints markdown panes
- [x] 3.6 Improve summary/checkpoints presentation from raw markdown blocks to scannable UI cards with fallback text handling
