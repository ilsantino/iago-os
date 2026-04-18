# Setup Guide

First-time setup for iaGO-OS. Covers both Windows and macOS.

## Prerequisites

| Tool | Version | Install | Check |
|------|---------|---------|-------|
| Node.js | 20+ | [nodejs.org](https://nodejs.org/) | `node --version` |
| Git | 2.30+ | [git-scm.com](https://git-scm.com/) | `git --version` |
| Claude Code | Latest | `npm install -g @anthropic-ai/claude-code` | `claude --version` |
| AWS CLI | 2.x | [AWS install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) | `aws --version` |
| GitHub CLI | 2.x | [cli.github.com](https://cli.github.com/) | `gh --version` |
| Biome | 1.x | Installed per-project via npm | `npx biome --version` |

### Authenticate everything

```bash
# Claude Code (prompts for login on first run)
claude

# AWS CLI (needs Access Key ID, Secret Access Key, region)
aws configure

# GitHub CLI (follow the browser prompts)
gh auth login
```

## Clone iaGO-OS

```bash
git clone https://github.com/iagoai/iago-os.git
cd iago-os

# Install hook dependencies (biome, typescript)
npm install
```

## Global Install

This makes all iaGO-OS skills, agents, and rules available in every Claude Code session — not just projects scaffolded from the template.

### macOS / Linux

```bash
./scripts/sync-skills.sh --global
```

### Windows (PowerShell)

```powershell
.\scripts\sync-skills.ps1 -Global
```

**What this does:** Copies `.claude/skills/`, `.claude/agents/`, and `.claude/rules/` to `~/.claude/`. It does NOT copy hooks — hooks reference `.iago/hooks/` which only exists inside projects scaffolded from the template.

**Verify:** After running, check the counts:

```bash
# macOS / Linux
ls ~/.claude/skills | wc -l                  # Should be 33
ls ~/.claude/agents/*.md | wc -l             # Should be 3 (base agents)
ls ~/.claude/agents/capabilities | wc -l     # Should be 13
ls ~/.claude/agents/profiles | wc -l         # Should be 12
ls ~/.claude/rules | wc -l                   # Should be 8

# Windows (PowerShell)
(Get-ChildItem ~/.claude/skills).Count                    # Should be 33
(Get-ChildItem ~/.claude/agents/*.md).Count               # Should be 3 (base agents)
(Get-ChildItem ~/.claude/agents/capabilities).Count       # Should be 12
(Get-ChildItem ~/.claude/agents/profiles).Count           # Should be 12
(Get-ChildItem ~/.claude/rules).Count                     # Should be 8
```

## GitHub Pipeline (PR Review-Fix Loop)

The iaGO pipeline creates PRs and tags @claude for async review. This requires
two GitHub secrets on each client repo. **Without this, the review-fix loop
will not work.**

See **[GITHUB-PIPELINE.md](GITHUB-PIPELINE.md)** for the full step-by-step guide.

Quick version:
1. Get `CLAUDE_CODE_OAUTH_TOKEN` from [Anthropic Console](https://console.anthropic.com) → Settings → Claude Code
2. Create `GH_PAT` at [github.com/settings/tokens](https://github.com/settings/tokens?type=beta) (needs `Contents`, `Issues`, `Pull requests` read+write)
3. Add both as secrets on the repo: `https://github.com/bas-labs/{repo}/settings/secrets/actions`
4. Workflow files are auto-included by `new-client.sh`. For existing repos, copy from `templates/client-project/.github/workflows/`

## Scaffold Your First Project

### macOS / Linux

```bash
./scripts/new-client.sh \
  --name "Acme Corp" \
  --project "dashboard" \
  --path ../acme-dashboard
```

### Windows (PowerShell)

```powershell
.\scripts\new-client.ps1 `
  -Name "Acme Corp" `
  -Project "dashboard" `
  -Path ..\acme-dashboard
```

For internal (non-client) projects, add `--internal` / `-Internal`:

```bash
./scripts/new-client.sh --name "iaGO" --project "internal-tool" --path ../tool --internal
```

**What this does:**
1. Copies the project template (CLAUDE.md, .iago/ structure, settings.json)
2. Copies hooks from iaGO-OS to the new project
3. Replaces template variables (client name, project name, date)
4. Creates `.iago/` subdirectories (context, plans, summaries, reviews, state)
5. Initializes git with an initial commit

## Start Working

```bash
cd ../acme-dashboard
claude
```

Claude Code will load the hooks automatically. The session-start hook will report "First iaGO session. No prior context."

Start with:

```
> /iago-init
```

This begins the interactive discovery process — Claude asks about your project vision, constraints, and phases, then produces the foundation artifacts.

## Memory Stack (Optional)

Adds persistent cross-session memory to Claude Code via MemPalace (semantic search over conversation history) and Graphify (knowledge graph over document corpora). Not required — iaGO-OS works without it.

### Install

```bash
# macOS / Linux / Git Bash on Windows
bash scripts/setup-memory.sh

# Windows (PowerShell)
.\scripts\setup-memory.ps1

# Preview first
bash scripts/setup-memory.sh --dry-run
```

**Requires:** Python 3.10+

**What it does:** Installs Python packages, creates `~/.mempalace/` with config templates, registers MCP servers, installs Claude Code hooks (graphify search nudge + session diary).

**After setup:** Edit `~/.mempalace/wing_config.json` with your client names, then mine existing conversations.

**Full docs:** See the **Memory Architecture** section in [CLAUDE.md](../CLAUDE.md).

## Verification Checklist

After setup, verify these five things:

1. **Skills are discoverable:** Inside Claude Code, type `/iago-` — you should see autocomplete suggestions for init, plan, execute, etc.

2. **Hooks are wired:** Check that `.claude/settings.json` exists in your project and references `.iago/hooks/`.

3. **State engine works:**
   ```bash
   cd your-project
   node -e "import('./.iago/hooks/lib/state-manager.mjs').then(m => console.log(m.init()))"
   ```
   Should print `{ created: [...], skipped: [...] }`.

4. **Session start fires:** Open Claude Code in your project. You should see session context output (or "First iaGO session").

5. **Git is clean:** `git status` should show a clean working tree after scaffold.

## Keeping Projects in Sync

When iaGO-OS is updated (new skills, agent improvements, rule changes), sync to existing projects:

```bash
# Sync to a specific project
./scripts/sync-skills.sh --target ../acme-dashboard

# Sync globally
./scripts/sync-skills.sh --global

# Preview changes first
./scripts/sync-skills.sh --target ../acme-dashboard --dry-run
```

## Troubleshooting

### "command not found" when running scripts

Make the scripts executable:

```bash
chmod +x scripts/*.sh
```

On Windows, use PowerShell scripts (`.ps1`) instead.

### Hooks not firing

1. Check `.claude/settings.json` exists in your project directory
2. Verify hook paths reference `$CLAUDE_PROJECT_DIR/.iago/hooks/`
3. Test a hook manually: `echo '{}' | node .iago/hooks/usage-tracker.mjs post-tool-use`

### Skills not showing in autocomplete

1. Verify `.claude/skills/` exists (locally or in `~/.claude/`)
2. Each skill needs a `SKILL.md` file with valid frontmatter
3. Restart Claude Code after syncing skills

### "ENOENT" errors from hooks

The hooks expect `.iago/state/` to exist. Run the state engine init:

```bash
node -e "import('./.iago/hooks/lib/state-manager.mjs').then(m => m.init())"
```

### Node.js version errors

iaGO-OS requires Node 20+ for ESM support (`.mjs` files). Check with `node --version`.

### Windows path issues

Git Bash and Node.js resolve `/tmp/` differently on Windows. Use relative paths or `$CLAUDE_PROJECT_DIR` (set automatically by Claude Code) for consistency.
