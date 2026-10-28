#!/usr/bin/env bash
# iaGO home setup for a Mac: one clone of iago-os + this script = Claude Code wired.
# Idempotent. Copies the global settings, links skills/agents/rules into ~/.claude,
# and prints what it did. Run:  bash ~/Developer/iago-os/home/install-mac.sh
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IAGO="$(cd "$HERE/.." && pwd)"
CL="$HOME/.claude"
mkdir -p "$CL/skills" "$CL/scripts" "$CL/playbooks" "$CL/state" "$HOME/Developer/.claude"

# 1. Global settings (hooks, env, plugins). Backs up an existing file first.
if [ -f "$CL/settings.json" ] && ! cmp -s "$HERE/claude/settings.json" "$CL/settings.json"; then
  cp "$CL/settings.json" "$CL/settings.json.bak-$(date +%Y%m%d-%H%M%S)"
fi
sed "s#/Users/alvarez#$HOME#g" "$HERE/claude/settings.json" > "$CL/settings.json"
echo "settings.json -> $CL/settings.json"

# 2. Global CLAUDE.md (the map Claude reads in every session).
[ -f "$HERE/claude/CLAUDE.md" ] && cp "$HERE/claude/CLAUDE.md" "$CL/CLAUDE.md" && echo "CLAUDE.md -> $CL/CLAUDE.md"

# 3. Skills: every iago-* skill is a symlink into the repo (one copy, no drift).
for s in "$IAGO"/.claude/skills/iago-*/; do ln -sfn "${s%/}" "$CL/skills/$(basename "$s")"; done
echo "skills: $(ls -d "$CL"/skills/iago-* | wc -l | tr -d ' ') iago-* links"

# 4. Agents and rules.
[ -L "$CL/agents" ] || { [ -e "$CL/agents" ] && mv "$CL/agents" "$CL/agents.pre-iago"; }
ln -sfn "$IAGO/.claude/agents" "$CL/agents"
ln -sfn "$IAGO/.claude/rules" "$HOME/Developer/.claude/rules"
echo "agents -> $IAGO/.claude/agents ; Developer/.claude/rules -> iago-os rules"

# 5. Git identity.
git config --global user.name "Santiago Alvarez Chamlati"
git config --global user.email "santiago@iagoag.com"
git config --global init.defaultBranch main
echo "done. Open a new Claude Code session for the hooks and env to load."
