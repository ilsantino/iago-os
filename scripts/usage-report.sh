#!/usr/bin/env bash
set -euo pipefail

# iaGO-OS — Usage Report
# Reads .iago/state/usage-log.jsonl from one or more project paths
# and produces a human-readable usage summary.
#
# Usage: ./scripts/usage-report.sh ../acme-dashboard ../beta-app
#        ./scripts/usage-report.sh .   (current project)

if [[ $# -eq 0 ]]; then
  echo "Usage: usage-report.sh <project-path> [project-path...]"
  echo ""
  echo "Reads .iago/state/usage-log.jsonl from each project and prints a usage summary."
  exit 1
fi

# Collect all JSONL lines from all projects
ALL_LINES=""
PROJECTS_FOUND=0

for PROJECT in "$@"; do
  LOG_FILE="$PROJECT/.iago/state/usage-log.jsonl"
  if [[ -f "$LOG_FILE" ]]; then
    ALL_LINES+="$(cat "$LOG_FILE")"$'\n'
    PROJECTS_FOUND=$((PROJECTS_FOUND + 1))
    echo "  Found: $LOG_FILE"
  else
    echo "  Skip: $LOG_FILE (not found)"
  fi
done

if [[ $PROJECTS_FOUND -eq 0 ]]; then
  echo ""
  echo "No usage logs found. Run some iaGO skills first!"
  exit 0
fi

echo ""
echo "=== iaGO Usage Report ==="
echo "  Projects scanned: $PROJECTS_FOUND"
echo ""

# Use node for JSON parsing (available since we require Node 20+)
node -e "
const lines = process.argv[1].trim().split('\n').filter(Boolean);
const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

// Skill frequency
const skills = {};
events.filter(e => e.event === 'skill_invoked').forEach(e => {
  skills[e.skill] = (skills[e.skill] || 0) + 1;
});

// Agent frequency
const agents = {};
events.filter(e => e.event === 'agent_dispatched').forEach(e => {
  agents[e.agent] = (agents[e.agent] || 0) + 1;
});

// Session stats
const sessions = events.filter(e => e.event === 'session_end');
const durations = sessions.map(s => s.duration_min || 0);
const avgDuration = durations.length > 0
  ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
  : 0;

// Common workflows (skill sequences per session)
const workflows = {};
sessions.forEach(s => {
  const key = (s.skills_used || []).sort().join(' → ');
  if (key) workflows[key] = (workflows[key] || 0) + 1;
});

// --- Output ---
console.log('--- Skill Frequency ---');
const sortedSkills = Object.entries(skills).sort((a, b) => b[1] - a[1]);
if (sortedSkills.length === 0) console.log('  (no skill invocations recorded)');
sortedSkills.forEach(([name, count]) => console.log('  ' + name.padEnd(35) + count + ' invocations'));

console.log('');
console.log('--- Agent Frequency ---');
const sortedAgents = Object.entries(agents).sort((a, b) => b[1] - a[1]);
if (sortedAgents.length === 0) console.log('  (no agent dispatches recorded)');
sortedAgents.forEach(([name, count]) => console.log('  ' + name.padEnd(35) + count + ' dispatches'));

console.log('');
console.log('--- Session Summary ---');
console.log('  Total sessions:        ' + sessions.length);
console.log('  Avg duration (min):    ' + avgDuration);
console.log('  Total events:          ' + events.length);

console.log('');
console.log('--- Common Workflows ---');
const sortedWorkflows = Object.entries(workflows).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (sortedWorkflows.length === 0) console.log('  (no completed sessions recorded)');
sortedWorkflows.forEach(([flow, count]) => console.log('  [' + count + 'x] ' + flow));
" "$ALL_LINES"

echo ""
echo "=== Done ==="
