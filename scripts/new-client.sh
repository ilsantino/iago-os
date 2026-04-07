#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Scaffold a new client project from template
# Usage: ./scripts/new-client.sh --name "Acme Corp" --project "dashboard" --path ../acme-dashboard
#        ./scripts/new-client.sh --name "iaGO" --project "internal-tool" --path ../internal-tool --internal

# Edge cases handled:
# - Client names with & / | \ special characters (sed-escaped)
# - Client names with spaces (quoted throughout)
# - Non-ASCII characters stripped from CLIENT_ID (documented behavior)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAGO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Escape special characters for safe use in sed replacement strings.
# Handles: & (backreference), / (delimiter), \ (escape) and | (alternate delimiter).
escape_sed() {
  printf '%s\n' "$1" | sed -e 's/[\/&\\]/\\&/g'
}

# --- Defaults ---
CLIENT_NAME=""
PROJECT_NAME=""
TARGET_PATH=""
TECH_STACK="React 19 + Vite + TS + Tailwind 4 + ShadCN + AWS Amplify Gen 2"
TEMPLATE_TYPE="client-project"

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --name)      CLIENT_NAME="$2"; shift 2 ;;
    --project)   PROJECT_NAME="$2"; shift 2 ;;
    --path)      TARGET_PATH="$2"; shift 2 ;;
    --stack)     TECH_STACK="$2"; shift 2 ;;
    --internal)  TEMPLATE_TYPE="internal-project"; shift ;;
    --help|-h)
      echo "Usage: new-client.sh --name <client> --project <project> --path <target>"
      echo ""
      echo "Options:"
      echo "  --name       Client name (e.g., \"Acme Corp\")"
      echo "  --project    Project name (e.g., \"dashboard\")"
      echo "  --path       Target directory path"
      echo "  --stack      Tech stack override (default: iaGO standard)"
      echo "  --internal   Use internal-project template (Opus default, IP clause)"
      echo "  --help       Show this help"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# --- Validate required args ---
if [[ -z "$CLIENT_NAME" ]]; then echo "Error: --name is required"; exit 1; fi
if [[ -z "$PROJECT_NAME" ]]; then echo "Error: --project is required"; exit 1; fi
if [[ -z "$TARGET_PATH" ]]; then echo "Error: --path is required"; exit 1; fi

# --- Derive variables ---
CLIENT_ID=$(echo "$CLIENT_NAME" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd '[:alnum:]-')
CREATED_DATE=$(date +%Y-%m-%d)
TEMPLATE_DIR="$IAGO_ROOT/templates/$TEMPLATE_TYPE"

# --- Pre-flight checks ---
if [[ -d "$TARGET_PATH" ]]; then
  echo "Error: Target directory already exists: $TARGET_PATH"
  echo "Remove it first or choose a different path."
  exit 1
fi

if [[ ! -d "$TEMPLATE_DIR" ]]; then
  echo "Error: Template not found: $TEMPLATE_DIR"
  exit 1
fi

# Warn on unusual characters in names
if echo "$CLIENT_NAME" | grep -qE '[^[:alnum:]_[:space:]._-]'; then
  echo "Warning: Client name contains special characters. Slug will be: $CLIENT_ID"
fi

echo "=== iaGO New Client ==="
echo "  Client:   $CLIENT_NAME ($CLIENT_ID)"
echo "  Project:  $PROJECT_NAME"
echo "  Template: $TEMPLATE_TYPE"
echo "  Target:   $TARGET_PATH"
echo "  Stack:    $TECH_STACK"
echo ""

# --- Step 1: Copy template ---
echo "[1/5] Copying template..."
mkdir -p "$TARGET_PATH"
cp -r "$TEMPLATE_DIR"/. "$TARGET_PATH"/

# --- Step 2: Copy hooks from iaGO-OS ---
echo "[2/5] Copying hooks..."
if [[ -d "$IAGO_ROOT/.iago/hooks" ]]; then
  mkdir -p "$TARGET_PATH/.iago/hooks"
  cp -r "$IAGO_ROOT/.iago/hooks"/. "$TARGET_PATH/.iago/hooks"/
fi

# --- Step 3: Replace variables and strip .template extension ---
echo "[3/5] Replacing variables..."
ESCAPED_CLIENT=$(escape_sed "$CLIENT_NAME")
ESCAPED_PROJECT=$(escape_sed "$PROJECT_NAME")
ESCAPED_CLIENT_ID=$(escape_sed "$CLIENT_ID")
ESCAPED_DATE=$(escape_sed "$CREATED_DATE")
ESCAPED_STACK=$(escape_sed "$TECH_STACK")
find "$TARGET_PATH" -name "*.template" -type f | while read -r tpl; do
  dest="${tpl%.template}"
  sed \
    -e "s/{{CLIENT_NAME}}/$ESCAPED_CLIENT/g" \
    -e "s/{{PROJECT_NAME}}/$ESCAPED_PROJECT/g" \
    -e "s/{{CLIENT_ID}}/$ESCAPED_CLIENT_ID/g" \
    -e "s/{{CREATED_DATE}}/$ESCAPED_DATE/g" \
    -e "s/{{TECH_STACK}}/$ESCAPED_STACK/g" \
    "$tpl" > "$dest"
  rm "$tpl"
done

# --- Step 4: Create .iago subdirectories ---
echo "[4/5] Creating .iago subdirectories..."
mkdir -p "$TARGET_PATH/.iago/context"
mkdir -p "$TARGET_PATH/.iago/plans"
mkdir -p "$TARGET_PATH/.iago/summaries"
mkdir -p "$TARGET_PATH/.iago/reviews"
mkdir -p "$TARGET_PATH/.iago/state"
mkdir -p "$TARGET_PATH/.iago/state/sessions"

# --- Step 5: Init git ---
echo "[5/5] Initializing git..."
(
  cd "$TARGET_PATH"
  git init -q
  git add -A
  git commit -q -m "chore: scaffold $PROJECT_NAME from iaGO $TEMPLATE_TYPE template"

  # --- Summary ---
  echo ""
  echo "=== Done ==="
  echo "  Directory: $(pwd)"
  echo "  Files:     $(git ls-files | wc -l | tr -d ' ')"
  echo "  Template:  $TEMPLATE_TYPE"
)
echo ""
echo "Next steps:"
echo "  cd $TARGET_PATH"
echo "  claude  # start Claude Code"
echo "  /iago:init  # gather vision and set up roadmap"
