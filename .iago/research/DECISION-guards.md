# Guard Rail Decisions

> Phase 4 — Safety Guard, Post-Edit Pipeline
> Date: 2026-03-31
> Depends on: DECISION-foundation.md (Phase 2), DECISION-core.md (Phase 3)

---

## Decision 3: Post-Edit Pipeline

| # | Hook File | Event | Matcher | Source | Adaptation | Lines Est. | Sync |
|---|-----------|-------|---------|--------|------------|------------|------|
| 1 | `post-edit-format.mjs` | PostToolUse | `Edit` | ECC `post-edit-format.js` | Hardcode Biome, drop Prettier/gofmt/ruff detection. Drop `resolve-formatter.js` dependency. | ~50 | sync <2s |
| 2 | `post-edit-typecheck.mjs` | PostToolUse | `Edit` | ECC `post-edit-typecheck.js` | Take nearly as-is. ESM conversion. Add tsconfig.json walk-up caching. | ~80 | sync <2s |
| 3 | `post-edit-console-warn.mjs` | PostToolUse | `Edit` | ECC `post-edit-console-warn.js` | Take as-is. ESM conversion. | ~45 | sync <2s |
| 4 | `config-protection.mjs` | PreToolUse | `Edit\|Write\|MultiEdit` | ECC `config-protection.js` | Expand denylist for our stack (biome.json, tailwind.config, vite.config). | ~100 | sync <2s |

### Adaptations Detail

#### 1. post-edit-format.mjs — Hardcode Biome

**ECC's approach:** Detect formatter (Biome vs Prettier) at runtime via `resolve-formatter.js`, which walks `node_modules/.bin/` for binaries and handles Windows `.cmd` wrappers.

**Our approach:** Hardcode Biome. We standardized on Biome across all projects. Prettier detection is dead code for us. This eliminates `resolve-formatter.js` entirely (ECC's shared dependency used by two hooks) and cuts ~60 lines.

What stays:
- Run `npx biome check --write` on edited JS/TS/JSX/TSX files
- Windows `.cmd` binary handling (Biome npm installs create `.cmd` wrappers on Windows)
- Shell metachar guard on file paths (injection protection)
- Skip non-JS/TS files (CSS, JSON, MD, images)

What changes:
- No Prettier detection path
- No Go (gofmt) or Python (ruff) paths — wrong stack
- `npx biome` instead of resolved binary path — simpler, works cross-platform, negligible speed difference for a post-edit hook

File extensions triggering format: `.js`, `.jsx`, `.ts`, `.tsx`, `.json` (Biome handles JSON too).

**Why not also Tailwind class sorting?** Biome doesn't sort Tailwind classes yet. A Biome plugin is in development but not stable. Adding a separate prettier-plugin-tailwindcss just for class sorting contradicts our "Biome only" decision. When Biome ships the plugin, add it to `biome.json` — no hook change needed.

**Why not import ordering?** Biome handles this natively via its organizeImports rule in `biome.json`. No hook needed — it's part of `biome check --write`.

#### 2. post-edit-typecheck.mjs — Mostly as-is

**ECC's approach:** Run `tsc --noEmit` after `.ts`/`.tsx` edits. Walk up directories to find `tsconfig.json`. Filter output to only show errors in the edited file.

**Our approach:** Take it. This is exactly right. The only changes:
- ESM conversion (import/export instead of require/module.exports)
- Cache the tsconfig.json location per session (temp file keyed on project root) — avoids re-walking the directory tree on every edit

The "filter to edited file" behavior is critical. Running `tsc --noEmit` on a large project dumps hundreds of pre-existing errors. ECC's approach of filtering to just the file Claude edited means the agent only sees errors it introduced. Smart. Keep it.

**Matcher:** `Edit` only. Not `Write` — Write is for new files. If Claude creates a new `.ts` file, there's no pre-existing state to check against, and the file probably doesn't compile yet (imports not wired). Typecheck on Edit catches real regressions.

#### 3. post-edit-console-warn.mjs — As-is

**ECC's approach:** Scan edited JS/TS files for `console.log` statements, report line numbers.

**Our approach:** Take it verbatim, ESM-converted. 

This is a warning (exit code 0 with stderr), not a block (exit code 2). Claude sees the warning and can choose to keep the console.log if it's intentional (debugging). The hook prevents accidental committed console.logs — the most common JS code smell.

Pattern: `/^\s*console\.(log|debug|info|warn|error)\s*\(/` — catches all console methods, not just `.log`.

**Not blocking console.warn/error?** No. The hook warns about ALL console methods because in production code, you should use a proper logger. But it's a warning, not a block — Claude can ignore it when console.error is genuinely appropriate (error boundaries, CLI tools).

#### 4. config-protection.mjs — Expanded denylist

**ECC's approach:** Block edits to `.eslintrc`, `biome.json`, `.prettierrc`, and ~15 other config file patterns. Forces Claude to fix code instead of weakening configs.

**Our approach:** Take the pattern, expand the denylist for our stack.

**Protected files (complete denylist):**

| Pattern | Why protected |
|---------|--------------|
| `biome.json`, `biome.jsonc` | Formatter/linter config — Claude must fix code, not disable rules |
| `.eslintrc`, `.eslintrc.*`, `eslint.config.*` | Legacy ESLint configs in client projects |
| `.prettierrc`, `.prettierrc.*`, `prettier.config.*` | Prettier configs in client projects |
| `tsconfig.json`, `tsconfig.*.json` | TypeScript strictness — Claude loves loosening `strict`, `noUncheckedIndexedAccess`, etc. |
| `vite.config.ts`, `vite.config.js` | Build config — Claude shouldn't modify build pipeline to "fix" import issues |
| `tailwind.config.*` | Design system config |
| `postcss.config.*` | CSS pipeline |
| `.env`, `.env.*` | Environment files — should never be edited by hooks, only by humans |
| `package.json` (partial) | Block changes to `scripts`, `engines`, `overrides` sections. Allow dependency changes. |
| `.gitignore` | Claude sometimes adds entries to hide its mistakes |
| `Dockerfile`, `docker-compose.*` | Infrastructure config |
| `*.lock` (package-lock, yarn.lock, pnpm-lock) | Lock files — never edit manually |

**package.json partial protection:** This is the hardest one. Claude legitimately needs to add dependencies (`npm install` via Bash is better, but sometimes it edits package.json directly). But Claude should NOT modify `scripts`, `engines`, or `overrides` to work around build issues. Implementation: parse the tool input JSON, extract the diff, check if changes touch protected keys. If yes, block. If only `dependencies`/`devDependencies` changed, allow.

**Exit behavior:** Block (exit code 2) with message: "iaGO: Cannot modify {filename}. Fix the code instead of changing the config." Clear, actionable, no ambiguity.

### Shared Dependencies

| Utility | Purpose | Lines Est. |
|---------|---------|------------|
| `lib/stdin.mjs` | Parse stdin JSON from Claude Code hook input | ~20 (existing from Decision 1) |
| `lib/flags.mjs` | `isDisabled(hookId)` check via `IAGO_DISABLED_HOOKS` env | ~15 (existing from Decision 1) |

No `resolve-formatter.js` equivalent. Biome is hardcoded. No new shared utilities needed for Phase 4 hooks.

---

## Decision 4: Safety Guard

### 4a. Destructive Command Blocklist

**Hook:** `safety-guard.mjs` — PreToolUse, matcher: `Bash`
**Philosophy:** Block catastrophic mistakes, not normal operations. The test: "Would a senior dev cringe if they saw this in a terminal?" If yes, block. If it's debatable, warn.

| # | Pattern (regex) | What It Catches | Allowlist / Exception | Exit |
|---|----------------|-----------------|----------------------|------|
| 1 | `rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*(?:\/\s*$\|\/\*\|\.\.\/)` | `rm -rf /`, `rm -rf /*`, `rm -rf ../` — recursive delete of root, glob-all, or parent traversal | `rm -rf node_modules`, `rm -rf dist`, `rm -rf .next`, `rm -rf build`, `rm -rf coverage`, `rm -rf .iago/state` — known safe cleanup targets | 2 (block) |
| 2 | `rm\s+-[a-zA-Z]*r[a-zA-Z]*f\b.*\s+\/(?:usr\|etc\|home\|var\|tmp\|boot\|sys\|proc\|Windows\|Users\|Program)` | `rm -rf` targeting system directories by name | None — always block | 2 |
| 3 | `git\s+push\s+.*--force(?!-with-lease)(?:\s\|$)` | `git push --force` (not `--force-with-lease`) | None — use `--force-with-lease` if you must force push | 2 |
| 4 | `git\s+push\s+.*(?:origin\|upstream)\s+(?:main\|master)\s*.*--force` | Force push to main/master on any remote | None — always block, even with `--force-with-lease` | 2 |
| 5 | `git\s+(?:reset\s+--hard\|clean\s+-[a-zA-Z]*f[a-zA-Z]*d)` | `git reset --hard`, `git clean -fd` — destroys uncommitted work | None — too dangerous for an AI agent to run | 2 |
| 6 | `(?:DROP\|TRUNCATE)\s+(?:TABLE\|DATABASE\|SCHEMA)` (case-insensitive) | SQL destructive operations | When the command string contains `migration`, `migrate`, or the file path ends in `.sql` and contains `migration` — allow in migration context | 2 |
| 7 | `(?:mkfs\|format\|fdisk\|dd\s+if=)` | Disk format/write operations | None — always block | 2 |
| 8 | `chmod\s+(?:777\|a\+rwx)` | World-writable permissions | None — always block, security antipattern | 2 |
| 9 | `>\s*\/dev\/sd[a-z]` | Direct write to block devices | None — always block | 2 |
| 10 | `curl\s+.*\|\s*(?:ba)?sh` | Pipe-to-shell pattern (`curl url \| sh`) | None — always block from AI agent. Human can run manually. | 2 |
| 11 | `(?:shutdown\|reboot\|halt\|init\s+[06])\b` | System power commands | None — always block | 2 |
| 12 | `npm\s+publish(?:\s\|$)` | Publishing packages | None — block. Human should publish deliberately. | 0 (warn) |
| 13 | `git\s+branch\s+-[dD]\s+(?:main\|master)` | Deleting main/master branch | None — always block | 2 |

**What we DON'T block:**
- `rm` of specific files or directories not matching the patterns above — normal cleanup
- `git push` (non-force) — normal workflow
- `git checkout -- file` — reverting a specific file is fine
- `docker rm`, `docker rmi` — container cleanup is normal
- `npm install`, `npm uninstall` — package management is normal
- `kill`, `killall` of specific processes — normal dev workflow
- `DROP` in strings, comments, or variable names — regex requires it as a SQL statement (whitespace + TABLE/DATABASE after)

**False positive mitigation strategy:**
1. Each pattern is scoped tightly — no broad "contains dangerous word" matching
2. Allowlists are explicit: known-safe `rm -rf` targets enumerated
3. Context-aware: SQL destructive ops are allowed in migration files
4. Warnings (exit 0) vs blocks (exit 2) — `npm publish` is a warning because it's not destructive, just consequential

### 4b. Secret Detection

**Hook:** `safety-guard.mjs` — PreToolUse, matcher: `Edit|Write|MultiEdit`
**Also in:** `commit-quality.mjs` — PreToolUse, matcher: `Bash` (triggers on `git commit`)

| # | Pattern (regex) | What It Catches | Where Applied |
|---|----------------|-----------------|---------------|
| 1 | `AKIA[0-9A-Z]{16}` | AWS Access Key IDs | File writes + commits |
| 2 | `(?:aws_secret_access_key\|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*\S{20,}` | AWS Secret Keys (by label) | File writes + commits |
| 3 | `ghp_[A-Za-z0-9]{36}` | GitHub Personal Access Tokens | File writes + commits |
| 4 | `gho_[A-Za-z0-9]{36}` | GitHub OAuth Tokens | File writes + commits |
| 5 | `ghs_[A-Za-z0-9]{36}` | GitHub Server Tokens | File writes + commits |
| 6 | `github_pat_[A-Za-z0-9_]{82}` | GitHub Fine-grained PATs | File writes + commits |
| 7 | `sk-ant-[A-Za-z0-9-]{80,}` | Anthropic API Keys | File writes + commits |
| 8 | `sk-[A-Za-z0-9]{48,}` | OpenAI API Keys | File writes + commits |
| 9 | `sk_(?:live\|test)_[A-Za-z0-9]{24,}` | Stripe Secret Keys | File writes + commits |
| 10 | `pk_(?:live\|test)_[A-Za-z0-9]{24,}` | Stripe Publishable Keys (live only flagged as warning) | File writes + commits |
| 11 | `xox[bpoas]-[A-Za-z0-9-]{10,}` | Slack Bot/User/App Tokens | File writes + commits |
| 12 | `-----BEGIN\s+(?:RSA\|EC\|DSA\|OPENSSH)?\s*PRIVATE\s+KEY-----` | Private key file contents | File writes + commits |
| 13 | `(?:password\|passwd\|pwd)\s*[=:]\s*['"][^'"]{8,}['"]` | Hardcoded passwords (quoted, 8+ chars) | File writes only |
| 14 | `(?:secret\|token\|api_key\|apikey\|auth_token)\s*[=:]\s*['"][A-Za-z0-9+/=_-]{16,}['"]` | Generic secret assignments | File writes only |
| 15 | `(?:mongodb(?:\+srv)?:\/\/)[^\s'"]+:[^\s'"]+@` | MongoDB connection strings with credentials | File writes + commits |
| 16 | `(?:postgres(?:ql)?:\/\/)[^\s'"]+:[^\s'"]+@` | PostgreSQL connection strings with credentials | File writes + commits |
| 17 | `(?:mysql:\/\/)[^\s'"]+:[^\s'"]+@` | MySQL connection strings with credentials | File writes + commits |

**What we DON'T flag:**
- Keys in `.env.example` or `.env.template` files (placeholder values like `your-key-here`)
- Patterns inside test files (`*.test.ts`, `*.spec.ts`, `__tests__/`) where mock keys are normal
- Patterns inside comments (lines starting with `//`, `#`, `*`) — comments about key formats are fine
- `pk_test_` Stripe keys — test publishable keys are safe to commit
- Base64 strings in image files, font files, or fixture data — length and charset overlap with secrets but context differs

**False positive mitigation:**
1. File-path exemptions: test files and example env files are excluded
2. Comment-line exclusion: patterns on comment lines are skipped
3. Minimum length requirements prevent matching short variable names
4. Specific prefix patterns (AKIA, ghp_, sk-ant-) are high-precision — nearly zero false positives
5. Generic patterns (#13, #14) apply to file writes only, not commits — tighter scope for noisier patterns

**Exit behavior:** Block (exit code 2) with message listing the pattern matched and the line number: "iaGO: Possible secret detected on line {n}: {pattern_name}. Use .env or a secrets manager."

### 4c. Injection Detection

**Hook:** `safety-guard.mjs` — PreToolUse, matcher: `Edit|Write|MultiEdit`
**Scope:** Content being written to files, especially markdown and config files.

| # | Pattern (regex) | What It Catches | False Positive Mitigation |
|---|----------------|-----------------|--------------------------|
| 1 | `\.\.[\/\\]` in file path (tool_input.file_path) | Path traversal in target file path | Only checked on the path, not file content. Legitimate `../` in imports is in content, not path. |
| 2 | `<system>`, `<\|im_start\|>`, `[INST]`, `<\|system\|>` in content being written to `.md`, `.txt`, `.yaml`, `.yml`, `.json` | Prompt injection markers in config/doc files | Only checked in config/markdown files, not in source code. Source code discussing LLM prompts is legitimate. |
| 3 | `(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions` (case-insensitive) in written content | Classic prompt injection phrasing | Only in non-source files (markdown, config, yaml). Documentation about prompt injection is flagged — acceptable false positive given the risk. |
| 4 | Base64 payload > 500 chars in `.md`, `.yaml`, `.json` files | Encoded payloads smuggled into config files | Only in config/doc files. Base64 in `.ts`/`.js` (images, fonts, test data) is fine. 500-char minimum avoids flagging short base64 strings (small icons, test tokens). |

**What we DON'T check:**
- Source code files (`.ts`, `.js`, `.tsx`, `.jsx`) — these legitimately contain prompt templates, base64 data, and LLM-related content
- Binary files — not text, not scannable
- Files in `node_modules/` — never written by Claude anyway

**Exit behavior:** Block (exit code 2) with message: "iaGO: Suspicious content detected in {filename}: {pattern_name}. Review the content before allowing."

**Scale note:** This is a lightweight tripwire, not a comprehensive injection defense. The real protection is that Claude Code runs in a sandbox and hooks fire pre-tool-use. If a prompt injection makes it into a config file, the damage is limited to influencing future Claude sessions reading that file — which the injection patterns above catch.

### 4d. Commit Quality

**Hook:** `commit-quality.mjs` — PreToolUse, matcher: `Bash`
**Trigger:** Only activates when the bash command starts with `git commit`.

| Check | Pattern / Rule | Error Message |
|-------|---------------|---------------|
| Conventional commit prefix | `/^(feat\|fix\|refactor\|docs\|chore\|research\|build\|test\|ci\|perf\|style\|revert)(\(.+\))?!?:\s/` | "iaGO: Commit message must start with a conventional prefix (feat, fix, refactor, docs, chore, research, build, test, ci, perf, style, revert)" |
| Subject line length | Max 72 characters (first line) | "iaGO: Commit subject exceeds 72 characters ({actual} chars)" |
| No empty message | Commit message must have content after the prefix | "iaGO: Commit message has no description after the prefix" |
| No WIP on main | If current branch is `main` or `master`, block messages starting with `wip:`, `WIP:`, or containing only "wip" | "iaGO: WIP commits not allowed on main/master" |
| Secret scan on staged files | Run secret detection patterns (#1-#17 from 4b) against `git diff --cached` output | "iaGO: Possible secret in staged changes — {pattern_name} on line {n}" |
| Console.log in staged JS/TS | Check staged diff for added `console.log` lines | "iaGO: console.log found in staged changes (line {n} of {file}). Remove or use a proper logger." — WARNING only (exit 0) |

**Prefix list rationale:**
- `feat` — new feature
- `fix` — bug fix
- `refactor` — restructure without behavior change
- `docs` — documentation
- `chore` — maintenance (deps, scripts, config)
- `research` — added for iaGO-OS research sprint; useful for consultancy R&D work
- `build` — build system changes
- `test` — test additions/changes
- `ci` — CI/CD pipeline
- `perf` — performance improvement
- `style` — formatting (should be rare with auto-format hook)
- `revert` — reverting a previous commit

**How commit message is extracted:** Parse the bash command for `-m` flag. Handle both `-m "message"` and `-m 'message'` quoting. For heredoc-style commits (`-m "$(cat <<'EOF'..."`), extract content between delimiters. If no `-m` flag (interactive commit), skip validation — can't parse what doesn't exist yet.

**Exit behavior:** Block (exit 2) on prefix/length violations. Warn (exit 0 with stderr) on console.log in staged files. Block (exit 2) on secrets in staged files.

### Guard Hook Files

| File | Event | Matcher | Lines Est. | Covers |
|------|-------|---------|------------|--------|
| `safety-guard.mjs` | PreToolUse | `Bash\|Edit\|Write\|MultiEdit` | ~180 | 4a (destructive commands), 4b (secret detection on writes), 4c (injection detection) |
| `commit-quality.mjs` | PreToolUse | `Bash` | ~120 | 4d (commit format), 4b (secrets in staged diff), console.log in staged diff |

**Why two files, not one:**

`safety-guard.mjs` fires on EVERY Bash/Edit/Write — it needs to be fast. It runs the destructive command blocklist on Bash inputs and secret/injection scans on file write inputs. Different tool types, different scan logic, but unified because they're all "prevent bad things from being written."

`commit-quality.mjs` fires on Bash but only activates for `git commit` commands. It does heavier work: parsing the commit message, running `git diff --cached` for secret scanning. Keeping it separate means the fast-path safety guard doesn't pay the cost of commit parsing on every Bash command.

Both use `lib/stdin.mjs` and `lib/flags.mjs`. No new shared utilities.

---

## Consolidated File Inventory (Phase 4 additions)

| File | Lines | Event | Matcher | New/Existing |
|------|-------|-------|---------|-------------|
| `.iago/hooks/post-edit-format.mjs` | ~50 | PostToolUse | Edit | New |
| `.iago/hooks/post-edit-typecheck.mjs` | ~80 | PostToolUse | Edit | New |
| `.iago/hooks/post-edit-console-warn.mjs` | ~45 | PostToolUse | Edit | New |
| `.iago/hooks/config-protection.mjs` | ~100 | PreToolUse | Edit\|Write\|MultiEdit | New |
| `.iago/hooks/safety-guard.mjs` | ~180 | PreToolUse | Bash\|Edit\|Write\|MultiEdit | New |
| `.iago/hooks/commit-quality.mjs` | ~120 | PreToolUse | Bash | New |

**Phase 4 total: ~575 lines** across 6 files.
**Running total (Phase 2-4): ~1,110-1,130 lines** across 12 files.

## Updated settings.json Shape (Phase 3 + 4 merged)

```json
{
  "hooks": {
    "Statusline": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/statusline.mjs\"",
        "timeout": 2000
      }]
    }],
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" session-start",
        "timeout": 5000
      }]
    }],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/safety-guard.mjs\"",
            "timeout": 2000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/commit-quality.mjs\"",
            "timeout": 5000
          }
        ]
      },
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/config-protection.mjs\"",
            "timeout": 2000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/safety-guard.mjs\"",
            "timeout": 2000
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [{
          "type": "command",
          "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-monitor.mjs\"",
          "timeout": 2000
        }]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-format.mjs\"",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-typecheck.mjs\"",
            "timeout": 5000
          },
          {
            "type": "command",
            "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/post-edit-console-warn.mjs\"",
            "timeout": 2000
          }
        ]
      }
    ],
    "PreCompact": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" pre-compact",
        "timeout": 15000
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "node \"$CLAUDE_PROJECT_DIR/.iago/hooks/context-persistence.mjs\" stop",
        "timeout": 10000
      }]
    }]
  }
}
```

**Execution order note:** Within a single matcher group, hooks execute in array order. For PostToolUse Edit: format runs first (fixes formatting), then typecheck runs (checks the formatted result), then console-warn (lightweight scan last). For PreToolUse Bash: safety-guard runs first (fast, blocks dangerous commands) before commit-quality (slower, only activates on `git commit`).

## Dependency Map for Phase 5

### What Phase 4 decisions constrain:

- **`safety-guard.mjs`** registers on two matcher groups (Bash AND Edit/Write/MultiEdit). Claude Code's settings.json supports this — same hook file appears in multiple matcher entries.
- **`commit-quality.mjs`** needs `git diff --cached` access — must run before the commit executes (PreToolUse is correct).
- **Post-edit format runs before typecheck** — if Biome reformats the file, tsc should check the formatted version. Array ordering in settings.json controls this.
- **No new shared utilities** — all Phase 4 hooks use `lib/stdin.mjs` and `lib/flags.mjs` from Phase 2.

### Open questions for Phase 5:
- **Decision TBD**: Slash commands (/iago:pause, /iago:client, /iago:costs) — implementation as Claude Code skills
- **Decision TBD**: CLAUDE.md generation — what instructions does iaGO inject into project-level CLAUDE.md?
- **Decision TBD**: Agent definitions — YAML frontmatter format for specialized agents
