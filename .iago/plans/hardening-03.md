---
phase: hardening
plan: 03
wave: 1
depends_on: []
created: 2026-04-06
---

# Plan: hardening-03 — Fix scripts and commit-quality hook

## Goal

Fix the sed injection vulnerability in new-client.sh, fix the broken heredoc
regex in commit-quality.mjs, and sync bash/powershell script behavior.

## Files

| Action | Path | Purpose |
|--------|------|---------|
| modify | `scripts/new-client.sh` | Fix sed injection with special characters in client names |
| modify | `.iago/hooks/commit-quality.mjs` | Fix heredoc regex on line 39 |

## Tasks

### Task 1: Fix sed injection in new-client.sh
- **files:** `scripts/new-client.sh`
- **action:** The sed replacement on line 94 (`sed -e "s/{{CLIENT_NAME}}/$CLIENT_NAME/g"`) breaks when CLIENT_NAME contains `&`, `/`, `|`, or `\`. Fix by escaping the replacement string before passing to sed. Use this pattern: `ESCAPED_CLIENT=$(printf '%s\n' "$CLIENT_NAME" | sed -e 's/[\/&\\]/\\&/g')` and use `$ESCAPED_CLIENT` in all sed replacements. Apply the same escaping to PROJECT_NAME and CLIENT_ID. Alternatively, switch sed delimiter from `/` to `|` AND escape `&` and `\` in the replacement.
- **verify:** `bash -n scripts/new-client.sh && echo "SYNTAX OK"` then test with special chars: `CLIENT_NAME="Test & Co." PROJECT_NAME="test" bash -c 'ESCAPED=$(printf "%s\n" "$CLIENT_NAME" | sed -e "s/[\/&\\\\]/\\\\&/g"); echo "replaced: $ESCAPED"'`
- **expected:** `SYNTAX OK` and `replaced: Test \& Co.`

### Task 2: Fix commit-quality.mjs heredoc regex
- **files:** `.iago/hooks/commit-quality.mjs`
- **action:** Line 39 regex `const heredoc = command.match(/\$\(cat\s+<<'?EOF'?\s*\n([\s\S]*?)\nEOF/)` fails because the newlines in the heredoc arrive as literal `\n` in the JSON input, not as actual newline characters. The regex needs to match both real newlines and escaped `\n`. Replace the regex to handle both cases. Also, the function should extract the FIRST LINE of the heredoc content as the commit subject (for length/format validation), not the entire heredoc.
- **verify:** `echo '{"tool_name":"Bash","tool_input":{"command":"git commit -m \"$(cat <<'"'"'EOF'"'"'\nfeat: add something\n\nBody text.\n\nCo-Authored-By: test\nEOF\n)\""}}' | node .iago/hooks/commit-quality.mjs 2>&1; echo "exit: $?"`
- **expected:** Exit code 0 (commit allowed) — the message starts with `feat:` which is a valid conventional prefix

### Task 3: Add test cases as comments
- **files:** `.iago/hooks/commit-quality.mjs`, `scripts/new-client.sh`
- **action:** Add a comment block at the top of each fixed file documenting the edge cases that were broken and are now handled. For commit-quality.mjs: heredoc format, `-m` flag format, multi-line messages. For new-client.sh: client names with `&`, `/`, `|`, spaces, non-ASCII characters. This serves as a regression checklist for future edits.
- **verify:** `grep -c "Edge cases" .iago/hooks/commit-quality.mjs && grep -c "Edge cases" scripts/new-client.sh`
- **expected:** Both return 1

## Verification

After all tasks: `bash -n scripts/new-client.sh && node -c .iago/hooks/commit-quality.mjs && echo "PLAN-03 PASS"`

Expected: `PLAN-03 PASS`
