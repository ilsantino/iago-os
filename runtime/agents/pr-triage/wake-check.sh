#!/usr/bin/env bash
# Hermes wake-check for the PR-triage agent.
#
# Returns exit 0 if there is work for pr-triage (≥1 open PR org-wide),
# exit 1 if there is none. Saves ~$0.10 per skipped LLM invocation by
# letting the daemon's CronScheduler short-circuit before spawning
# claude-pty. Exit 2 if rate-limited (distinct signal so the scheduler
# can emit a richer telemetry event — I2 carry-over from original Plan 04).
#
# Requires GH_TOKEN in env (loaded from systemd credstore by
# runtime/daemon/cred-bootstrap.ts). PAT scopes: repo + read:org.
set -euo pipefail

# Timezone for telemetry forensics (I1 carry-over). systemd unit pins
# Environment=TZ=UTC (Plan 01a) so this should always print "UTC".
echo "wake-check-tz $(date -u +%Z)" >&2

if [ -z "${GH_TOKEN:-}" ]; then
	echo "ERROR: GH_TOKEN unset; wake-check needs it to query gh." >&2
	exit 2
fi

# Include response headers (-i) so we can grep the HTTP status line.
# Plain `--jq '.total_count'` on a non-200 response silently produces
# null + exit 0; defensive guard via explicit status check (C2 fix).
# `|| true` is load-bearing: `gh api` exits non-zero on 401/403/429/5xx,
# and `set -e` would otherwise abort the script before the rate-limit
# branch below could distinguish 429 from generic auth failure.
RESPONSE=$(gh api -i '/search/issues?q=org:ilsantino+is:pr+is:open&per_page=1' 2>&1) || true
STATUS=$(echo "$RESPONSE" | head -1)

if echo "$STATUS" | grep -qE 'HTTP/[12](\.[0-9])? 200'; then
	# Match both object `{` and array `[` openers so the body extraction
	# survives if a future endpoint returns a JSON array.
	COUNT=$(echo "$RESPONSE" | grep -A 999 -E '^[{[]' | jq -r '.total_count // 0')
else
	if echo "$RESPONSE" | grep -qiE 'rate.?limit'; then
		echo "Rate-limited: $STATUS" >&2
		exit 2
	fi
	echo "ERROR: gh api returned non-200: $STATUS" >&2
	exit 2
fi

if [ -z "$COUNT" ] || [ "$COUNT" = "0" ]; then
	echo "No open PRs; skipping LLM invocation."
	exit 1
fi

echo "Found $COUNT open PR(s); proceeding."
exit 0
