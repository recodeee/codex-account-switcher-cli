#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <plan-slug> [agent-role ...]"
  echo "Example: $0 add-ralplan-openspec-plan-export planner architect critic executor writer verifier"
  exit 1
fi

PLAN_SLUG="$1"
shift || true

if [[ "$PLAN_SLUG" =~ [^a-z0-9-] ]]; then
  echo "Error: plan slug must be kebab-case (lowercase letters, numbers, hyphens)."
  exit 1
fi

if [[ $# -gt 0 ]]; then
  ROLES=("$@")
else
  ROLES=(planner architect critic executor writer verifier)
fi

PLAN_DIR="openspec/plan/${PLAN_SLUG}"
mkdir -p "$PLAN_DIR"

if [[ ! -f "$PLAN_DIR/summary.md" ]]; then
  cat > "$PLAN_DIR/summary.md" <<SUMEOF
# Plan Summary: ${PLAN_SLUG}

- **Mode:** ralplan
- **Status:** draft

## Context

Describe the planning context, constraints, and desired outcomes.
SUMEOF
fi

if [[ ! -f "$PLAN_DIR/README.md" ]]; then
  {
    echo "# Plan Workspace: ${PLAN_SLUG}"
    echo
    echo "This folder stores durable planning artifacts before implementation changes."
    echo
    echo "## Role folders"
    for role in "${ROLES[@]}"; do
      echo "- \`${role}/\`"
    done
    echo
    echo "Each role folder contains \`tasks.md\` with visible Spec / Tests / Implementation checklists."
  } > "$PLAN_DIR/README.md"
fi

for role in "${ROLES[@]}"; do
  ROLE_DIR="$PLAN_DIR/$role"
  mkdir -p "$ROLE_DIR"

  if [[ ! -f "$ROLE_DIR/README.md" ]]; then
    cat > "$ROLE_DIR/README.md" <<ROLEEOF
# ${role}

Role workspace for \`${role}\`.

Use this folder for role notes, artifacts, and status updates.
ROLEEOF
  fi

  if [[ ! -f "$ROLE_DIR/tasks.md" ]]; then
    cat > "$ROLE_DIR/tasks.md" <<TASKEOF
# ${role} tasks

## 1. Spec

- [ ] 1.1 Define ${role}-specific requirements and acceptance criteria
- [ ] 1.2 Validate relevant OpenSpec/spec artifacts

## 2. Tests

- [ ] 2.1 Define verification scope for ${role}
- [ ] 2.2 Confirm regression coverage expectations

## 3. Implementation

- [ ] 3.1 Execute ${role} deliverables for this plan
- [ ] 3.2 Record handoff/status notes for downstream roles
- [ ] 3.3 Mark completion with evidence links
TASKEOF
  fi
done

echo "Plan workspace ready: $PLAN_DIR"
