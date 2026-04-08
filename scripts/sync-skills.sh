#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Sync skills, agents, and rules to a client project (or globally)
# Usage: ./scripts/sync-skills.sh --target ../acme-dashboard
#        ./scripts/sync-skills.sh --target ../acme-dashboard --dry-run
#        ./scripts/sync-skills.sh --global
#        ./scripts/sync-skills.sh --global --dry-run

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAGO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Defaults ---
TARGET_PATH=""
GLOBAL=false
DRY_RUN=false

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --target)    TARGET_PATH="$2"; shift 2 ;;
    --global)    GLOBAL=true; shift ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: sync-skills.sh --target <project-path> [--dry-run]"
      echo "       sync-skills.sh --global [--dry-run]"
      echo ""
      echo "Syncs skills, agents, and rules from iaGO-OS to a client project or ~/.claude/."
      echo ""
      echo "Options:"
      echo "  --target    Path to client project"
      echo "  --global    Sync to ~/.claude/ (skills, agents, rules only — no hooks)"
      echo "  --dry-run   Show what would change without copying"
      echo "  --help      Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Validate ---
if $GLOBAL; then
  TARGET_PATH="$HOME/.claude"
  mkdir -p "$TARGET_PATH"
elif [[ -z "$TARGET_PATH" ]]; then
  echo "Error: --target or --global is required"; exit 1
elif [[ ! -d "$TARGET_PATH" ]]; then
  echo "Error: Target does not exist: $TARGET_PATH"; exit 1
else
  TARGET_PATH="$(cd "$TARGET_PATH" && pwd)"
fi

echo "=== iaGO Sync Skills ==="
echo "  Source: $IAGO_ROOT"
echo "  Target: $TARGET_PATH"
if $GLOBAL; then echo "  Mode:   GLOBAL (no hooks)"; fi
if $DRY_RUN; then echo "  Mode:   DRY RUN"; fi
echo ""

# --- Sync function ---
sync_dir() {
  local name="$1"
  local src="$IAGO_ROOT/.claude/$name"
  local dst
  if $GLOBAL; then
    dst="$TARGET_PATH/$name"
  else
    dst="$TARGET_PATH/.claude/$name"
  fi

  if [[ ! -d "$src" ]]; then
    echo "  Skip: $name (source not found)"
    return
  fi

  # Count files in source
  local src_count
  src_count=$(find "$src" -type f | wc -l | tr -d ' ')

  # Count files in destination (if exists)
  local dst_count=0
  if [[ -d "$dst" ]]; then
    dst_count=$(find "$dst" -type f | wc -l | tr -d ' ')
  fi

  echo "  $name: $src_count source files, $dst_count in target"

  if $DRY_RUN; then
    # Show diff
    if [[ -d "$dst" ]]; then
      diff -rq "$src" "$dst" 2>/dev/null | head -20 || echo "    (no differences)"
    else
      echo "    Would create $dst with $src_count files"
    fi
  else
    mkdir -p "$dst"
    cp -r "$src"/. "$dst"/
    local new_count
    new_count=$(find "$dst" -type f | wc -l | tr -d ' ')
    echo "    Synced: $new_count files in target"
  fi
}

# --- Sync hooks ---
sync_hooks() {
  local src="$IAGO_ROOT/.iago/hooks"
  local dst="$TARGET_PATH/.iago/hooks"

  if [[ ! -d "$src" ]]; then
    echo "  Skip: hooks (source not found)"
    return
  fi

  local src_count
  src_count=$(find "$src" -type f | wc -l | tr -d ' ')

  local dst_count=0
  if [[ -d "$dst" ]]; then
    dst_count=$(find "$dst" -type f | wc -l | tr -d ' ')
  fi

  echo "  hooks: $src_count source files, $dst_count in target"

  if $DRY_RUN; then
    if [[ -d "$dst" ]]; then
      diff -rq "$src" "$dst" 2>/dev/null | head -20 || echo "    (no differences)"
    else
      echo "    Would create $dst with $src_count files"
    fi
  else
    mkdir -p "$dst"
    cp -r "$src"/. "$dst"/
    local new_count
    new_count=$(find "$dst" -type f | wc -l | tr -d ' ')
    echo "    Synced: $new_count files in target"
  fi
}

# --- Sync workflows ---
sync_workflows() {
  local src="$IAGO_ROOT/.github/workflows"
  local dst="$TARGET_PATH/.github/workflows"

  if [[ ! -d "$src" ]]; then
    echo "  Skip: workflows (source not found)"
    return
  fi

  local src_count
  src_count=$(find "$src" -maxdepth 1 -name "claude*.yml" -type f | wc -l | tr -d ' ')

  local dst_count=0
  if [[ -d "$dst" ]]; then
    dst_count=$(find "$dst" -maxdepth 1 -name "claude*.yml" -type f 2>/dev/null | wc -l | tr -d ' ')
  fi

  echo "  workflows (claude*.yml): $src_count source files, $dst_count in target"

  if $DRY_RUN; then
    if [[ -d "$dst" ]]; then
      for f in "$src"/claude*.yml; do
        local fname
        fname=$(basename "$f")
        if [[ -f "$dst/$fname" ]]; then
          if ! diff -q "$f" "$dst/$fname" > /dev/null 2>&1; then
            echo "    Would update: $fname"
          fi
        else
          echo "    Would create: $fname"
        fi
      done
    else
      echo "    Would create $dst with $src_count workflow files"
    fi
  else
    mkdir -p "$dst"
    for f in "$src"/claude*.yml; do
      cp "$f" "$dst"/
    done
    echo "    Synced: $src_count workflow files"
    echo "    NOTE: Ensure GH_PAT and CLAUDE_CODE_OAUTH_TOKEN secrets are set in the target repo"
  fi
}

# --- Execute ---
echo "Syncing..."
sync_dir "skills"
sync_dir "agents"
sync_dir "rules"
if ! $GLOBAL; then
  sync_hooks
  sync_workflows
else
  echo "  hooks: skipped (--global mode — hooks require .iago/hooks/ in project)"
  echo "  workflows: skipped (--global mode — workflows require .github/ in each repo)"
fi

echo ""
echo "=== Done ==="
if $DRY_RUN; then
  echo "No files were changed (dry run). Remove --dry-run to apply."
fi
