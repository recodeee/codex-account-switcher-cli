#!/usr/bin/env bash
# claude-parallel-setup.sh — Set up parallel Claude Code accounts
# Usage: ./claude-parallel-setup.sh [account_names...]
# Example: ./claude-parallel-setup.sh work personal client

set -euo pipefail

ACCOUNTS_DIR="$HOME/.claude-accounts"
MARKER_START="# >>> codex-auth claude-parallel >>>"
MARKER_END="# <<< codex-auth claude-parallel <<<"

detect_rc() {
  if [[ "${SHELL:-}" == *zsh ]]; then echo "$HOME/.zshrc"
  else echo "$HOME/.bashrc"; fi
}

create_profiles() {
  local names=("$@")
  if [[ ${#names[@]} -eq 0 ]]; then
    names=(account1 account2)
    echo "No names given, using defaults: ${names[*]}"
  fi
  for name in "${names[@]}"; do
    local dir="$ACCOUNTS_DIR/$name"
    mkdir -p "$dir"
    echo "Created: $dir"
  done
}

generate_aliases() {
  local profiles=()
  for d in "$ACCOUNTS_DIR"/*/; do
    [[ -d "$d" ]] && profiles+=("$(basename "$d")")
  done
  if [[ ${#profiles[@]} -eq 0 ]]; then
    echo "No profiles in $ACCOUNTS_DIR" >&2; return 1
  fi
  echo "$MARKER_START"
  echo "# Claude Code parallel accounts (managed by codex-auth)"
  for p in "${profiles[@]}"; do
    echo "alias claude-${p}=\"CLAUDE_CONFIG_DIR=$ACCOUNTS_DIR/$p command claude\""
  done
  local usage
  usage=$(printf ", claude-%s" "${profiles[@]}")
  echo "alias claude=\"echo 'Use: ${usage:2}'\""
  echo "$MARKER_END"
}

install_aliases() {
  local rc
  rc=$(detect_rc)
  local block
  block=$(generate_aliases) || return 1

  if [[ -f "$rc" ]]; then
    # Remove old block
    sed -i "/$MARKER_START/,/$MARKER_END/d" "$rc"
  fi

  echo "" >> "$rc"
  echo "$block" >> "$rc"
  echo "Installed aliases in $rc"
  echo "Run: source $rc"
}

# Main
create_profiles "$@"
install_aliases
echo ""
echo "Next steps:"
echo "  1. source $(detect_rc)"
echo "  2. Run claude-<name> in separate terminals to authenticate each account"
echo "  3. Each account runs independently with its own usage limits"
