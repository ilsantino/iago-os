#!/usr/bin/env bash
set -euo pipefail

# setup-memory.sh — Install the iaGO-OS memory stack (MemPalace + Graphify)
#
# Cross-platform: works in bash on macOS/Linux and Git Bash on Windows.
# Idempotent: safe to re-run. Skips already-installed components.
#
# Usage:
#   bash scripts/setup-memory.sh              # Full install
#   bash scripts/setup-memory.sh --dry-run    # Preview without changes

# ─── Config ──────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$REPO_DIR/templates/memory"
PALACE_DIR="$HOME/.mempalace"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CLAUDE_SCRIPTS="$HOME/.claude/scripts"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
fi

# ─── Helpers ─────────────────────────────────────────────────────────────────

info()  { echo "  [INFO]  $*"; }
ok()    { echo "  [OK]    $*"; }
skip()  { echo "  [SKIP]  $*"; }
warn()  { echo "  [WARN]  $*" >&2; }
fail()  { echo "  [FAIL]  $*" >&2; exit 1; }

detect_platform() {
    case "$(uname -s)" in
        Darwin)  echo "macos" ;;
        MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
        Linux)   echo "linux" ;;
        *)       echo "unknown" ;;
    esac
}

dry() {
    if $DRY_RUN; then
        info "[DRY-RUN] $*"
        return 0
    fi
    return 1
}

# ─── Header ──────────────────────────────────────────────────────────────────

PLATFORM=$(detect_platform)
echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     iaGO-OS Memory Stack Setup                      ║"
echo "║     Platform: $PLATFORM                                  ║"
if $DRY_RUN; then
echo "║     Mode: DRY RUN (no changes)                      ║"
fi
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ─── Step 1: Check Python ────────────────────────────────────────────────────

info "Checking Python installation..."

PYTHON_CMD=""
for cmd in python3 python; do
    if command -v "$cmd" &>/dev/null; then
        version=$("$cmd" --version 2>&1 | grep -oE '[0-9]+\.[0-9]+')
        major=$(echo "$version" | cut -d. -f1)
        minor=$(echo "$version" | cut -d. -f2)
        if [[ "$major" -ge 3 && "$minor" -ge 10 ]]; then
            PYTHON_CMD="$cmd"
            ok "Found $cmd $version"
            break
        fi
    fi
done

if [[ -z "$PYTHON_CMD" ]]; then
    fail "Python 3.10+ required. Install from https://python.org/downloads/"
fi

# ─── Step 2: Install Python packages ─────────────────────────────────────────

info "Installing Python packages..."

PACKAGES=("mempalace" "graphifyy" "python-docx" "openpyxl")  # python-docx + openpyxl: Graphify corpus ingestion (Word/Excel document parsing)
INSTALLED=()
SKIPPED=()

declare -A IMPORT_NAMES=( ["python-docx"]="docx" )
for pkg in "${PACKAGES[@]}"; do
    import_name="${IMPORT_NAMES[$pkg]:-${pkg//-/_}}"
    if $PYTHON_CMD -c "import importlib; importlib.import_module('$import_name')" 2>/dev/null; then
        SKIPPED+=("$pkg")
        skip "$pkg already installed"
    else
        if dry "pip install $pkg"; then
            :
        else
            $PYTHON_CMD -m pip install "$pkg" --quiet 2>/dev/null && ok "Installed $pkg" || warn "Failed to install $pkg"
        fi
        INSTALLED+=("$pkg")
    fi
done

# ─── Step 3: Create MemPalace directory ──────────────────────────────────────

info "Setting up MemPalace directory..."

if [[ -d "$PALACE_DIR" ]]; then
    skip "~/.mempalace/ already exists"
else
    if dry "mkdir -p $PALACE_DIR"; then
        :
    else
        mkdir -p "$PALACE_DIR"
        ok "Created ~/.mempalace/"
    fi
fi

# Copy template configs (only if not already present)
for tmpl in config.json wing_config.json; do
    target="$PALACE_DIR/$tmpl"
    if [[ -f "$target" ]]; then
        skip "$tmpl already exists in ~/.mempalace/"
    else
        if dry "cp $TEMPLATES_DIR/$tmpl $target"; then
            :
        else
            cp "$TEMPLATES_DIR/$tmpl" "$target"
            # Replace palace_path placeholder
            if [[ "$tmpl" == "config.json" ]]; then
                palace_path="$PALACE_DIR/palace"
                if [[ "$PLATFORM" == "windows" ]]; then
                    # Convert to Windows-style path for JSON
                    palace_path=$(cygpath -w "$palace_path" 2>/dev/null || echo "$palace_path")
                fi
                # Use python for cross-platform JSON editing (env var avoids quoting issues)
                PALACE_PATH="$palace_path" $PYTHON_CMD -c "
import json, os
with open('$target', 'r') as f:
    d = json.load(f)
d['palace_path'] = os.environ['PALACE_PATH']
with open('$target', 'w') as f:
    json.dump(d, f, indent=2)
"
            fi
            ok "Copied $tmpl to ~/.mempalace/"
        fi
    fi
done

# Initialize palace directory
if [[ ! -d "$PALACE_DIR/palace" ]]; then
    if dry "mkdir -p $PALACE_DIR/palace"; then
        :
    else
        mkdir -p "$PALACE_DIR/palace"
        ok "Created palace storage directory"
    fi
fi

# ─── Step 4: Install session diary hook ──────────────────────────────────────

info "Installing session diary script..."

if ! dry "mkdir -p $CLAUDE_SCRIPTS"; then
    mkdir -p "$CLAUDE_SCRIPTS" 2>/dev/null || true
fi
DIARY_TARGET="$CLAUDE_SCRIPTS/session-diary.py"

if [[ -f "$DIARY_TARGET" ]]; then
    skip "session-diary.py already exists in ~/.claude/scripts/"
else
    if dry "cp $TEMPLATES_DIR/session-diary.py $DIARY_TARGET"; then
        :
    else
        cp "$TEMPLATES_DIR/session-diary.py" "$DIARY_TARGET"
        ok "Installed session-diary.py"
    fi
fi

# ─── Step 5: Register MCP servers ────────────────────────────────────────────

info "Registering MCP servers in Claude settings..."

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    warn "~/.claude/settings.json not found. Create it manually or run Claude Code first."
else
    if dry "Register mempalace + graphify MCP servers"; then
        :
    else
        $PYTHON_CMD - <<'PYEOF'
import json, sys
from pathlib import Path

settings_path = Path.home() / ".claude" / "settings.json"
with open(settings_path, "r") as f:
    settings = json.load(f)

servers = settings.setdefault("mcpServers", {})
changed = False

# MemPalace MCP server
if "mempalace" not in servers:
    servers["mempalace"] = {
        "command": sys.executable,
        "args": ["-m", "mempalace.mcp_server"],
    }
    changed = True
    print("  [OK]    Registered mempalace MCP server")
else:
    print("  [SKIP]  mempalace MCP server already registered")

# Graphify MCP server
if "graphify" not in servers:
    servers["graphify"] = {
        "command": sys.executable,
        "args": ["-m", "graphifyy.mcp_server"],
    }
    changed = True
    print("  [OK]    Registered graphify MCP server")
else:
    print("  [SKIP]  graphify MCP server already registered")

if changed:
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent="\t")

PYEOF
    fi
fi

# ─── Step 6: Install hooks ──────────────────────────────────────────────────

info "Configuring Claude Code hooks..."

if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    warn "Skipping hooks — no settings.json"
else
    if dry "Install PreToolUse (graphify) and Stop (diary) hooks"; then
        :
    else
        $PYTHON_CMD - <<'PYEOF'
import json, sys
from pathlib import Path

settings_path = Path.home() / ".claude" / "settings.json"
with open(settings_path, "r") as f:
    settings = json.load(f)

hooks = settings.setdefault("hooks", {})
changed = False

# PreToolUse hook for graphify nudge
pre_hooks = hooks.setdefault("PreToolUse", [])
has_graphify_hook = any(
    "graphify" in str(next(iter(h.get("hooks", [])), {}).get("command", ""))
    for h in pre_hooks
    if isinstance(h, dict) and "hooks" in h
)
if not has_graphify_hook:
    pre_hooks.append({
        "matcher": "Glob|Grep|mcp__obsidian__search_notes",
        "hooks": [{
            "type": "command",
            "command": (
                '[ -f "$HOME/dev/obsidian-brain/graphify-out/graph.json" ] || '
                '[ -f "$HOME/.graphify/graph.json" ] && '
                "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\","
                "\"additionalContext\":\"graphify: Knowledge graph available. "
                "Before raw file search, check graphify MCP tools (query_graph, "
                "get_node, get_community) or read graphify-out/wiki/index.md "
                "for community navigation.\"}}' || true"
            ),
        }],
    })
    changed = True
    print("  [OK]    Added PreToolUse graphify hook")
else:
    print("  [SKIP]  PreToolUse graphify hook already exists")

# Stop hook for session diary
stop_hooks = hooks.setdefault("Stop", [])
has_diary_hook = any(
    "session-diary" in str(next(iter(h.get("hooks", [])), {}).get("command", ""))
    for h in stop_hooks
    if isinstance(h, dict) and "hooks" in h
)
if not has_diary_hook:
    diary_path = str(Path.home() / ".claude" / "scripts" / "session-diary.py")
    stop_hooks.append({
        "hooks": [{
            "type": "command",
            "command": f'{sys.executable} "{diary_path}"',
            "timeout": 10000,
            "async": True,
        }],
    })
    changed = True
    print("  [OK]    Added Stop diary hook")
else:
    print("  [SKIP]  Stop diary hook already exists")

if changed:
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent="\t")

PYEOF
    fi
fi

# ─── Step 7: Platform-specific scheduled rebuilds ────────────────────────────

info "Checking scheduled graph rebuilds..."

if [[ "$PLATFORM" == "macos" ]]; then
    if crontab -l 2>/dev/null | grep -q "graphifyy"; then
        skip "Graphify cron job already exists"
    else
        info "To schedule nightly graphify rebuilds, add to crontab:"
        echo "    0 6 * * * $PYTHON_CMD -m graphifyy rebuild --input ~/path/to/corpus --output ~/path/to/graphify-out"
    fi
elif [[ "$PLATFORM" == "windows" ]]; then
    info "For scheduled rebuilds on Windows, use Task Scheduler:"
    echo "    Action: $PYTHON_CMD -m graphifyy rebuild --input C:\\path\\to\\corpus --output C:\\path\\to\\graphify-out"
    echo "    Trigger: Daily at 6:00 AM"
elif [[ "$PLATFORM" == "linux" ]]; then
    if crontab -l 2>/dev/null | grep -q "graphifyy"; then
        skip "Graphify cron job already exists"
    else
        info "To schedule nightly graphify rebuilds, add to crontab:"
        echo "    0 6 * * * $PYTHON_CMD -m graphifyy rebuild --input ~/path/to/corpus --output ~/path/to/graphify-out"
    fi
fi

# ─── Summary ─────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────────────────────"
echo "  Setup complete."
echo ""
echo "  Installed: ${INSTALLED[*]:-none (all present)}"
echo "  Skipped:   ${SKIPPED[*]:-none}"
echo ""
echo "  Next steps:"
echo "    1. Edit ~/.mempalace/wing_config.json with your client names"
echo "    2. Edit ~/.mempalace/config.json (palace_path is set)"
echo "    3. Mine existing conversations:"
echo "       mempalace mine ~/.claude/projects/{dir}/ --mode convos --wing {name}"
echo "    4. Run graphify on a document corpus:"
echo "       $PYTHON_CMD -m graphifyy extract --input ~/path/to/docs --output ~/graphify-out"
echo ""
echo "  Docs: See Memory Architecture section in CLAUDE.md"
echo "────────────────────────────────────────────────────────"
