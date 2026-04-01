# Paperclip Analysis

## Overview

- **Version**: v0.3.0 area (latest release notes at `releases/v0.3.0.md`). Active development, frequent merges.
- **Stack**: Node.js 20+ / TypeScript monorepo, pnpm 9.15+, Express REST API, React + Vite UI, PostgreSQL via Drizzle ORM, embedded PGlite for zero-config dev.
- **License**: MIT (c) 2026 Paperclip
- **Repo**: `paperclipai/paperclip` on GitHub. Monorepo with `server/`, `ui/`, `packages/`, `cli/`, `skills/`.
- **Maturity**: V1 implementation spec exists (`doc/SPEC-implementation.md`). Core features (companies, agents, issues, heartbeats, budgets, approvals, routines, skills, company import/export) are implemented. Plugin system exists. Multi-adapter support is production-grade with 10 adapter types.
- **Activity**: Recent commits fixing UI/server issues, document revisions feature, Docker volumes. Active PRs from community contributors.

## Database Schema

PostgreSQL via Drizzle ORM. Schema files at `packages/db/src/schema/*.ts`. 50+ schema files. Key tables and actual columns below.

### `companies` (`packages/db/src/schema/companies.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | `defaultRandom()` |
| `name` | text not null | |
| `description` | text | |
| `status` | text default `active` | `active / paused / archived` |
| `pause_reason` | text | `manual / budget / system` |
| `paused_at` | timestamptz | |
| `issue_prefix` | text not null default `PAP` | unique index, used for issue identifiers like `PAP-42` |
| `issue_counter` | integer default 0 | auto-incrementing per company |
| `budget_monthly_cents` | integer default 0 | |
| `spent_monthly_cents` | integer default 0 | |
| `require_board_approval_for_new_agents` | boolean default true | |
| `brand_color` | text | |
| `created_at` / `updated_at` | timestamptz | |

### `agents` (`packages/db/src/schema/agents.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk companies | |
| `name` | text not null | |
| `role` | text default `general` | e.g. `ceo`, `engineer`, `manager` |
| `title` | text | |
| `icon` | text | |
| `status` | text default `idle` | `active / idle / running / paused / error / terminated / pending_approval` |
| `reports_to` | uuid fk agents | nullable root for CEO |
| `capabilities` | text | |
| `adapter_type` | text default `process` | see Adapter table below |
| `adapter_config` | jsonb default `{}` | adapter-specific config blob |
| `runtime_config` | jsonb default `{}` | heartbeat policy lives here under `.heartbeat` |
| `budget_monthly_cents` | integer default 0 | |
| `spent_monthly_cents` | integer default 0 | |
| `pause_reason` | text | `manual / budget` |
| `paused_at` | timestamptz | |
| `permissions` | jsonb default `{}` | |
| `last_heartbeat_at` | timestamptz | |
| `metadata` | jsonb | |

### `issues` (`packages/db/src/schema/issues.ts`) -- the core task entity
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk | |
| `project_id` | uuid fk projects | |
| `project_workspace_id` | uuid fk | |
| `goal_id` | uuid fk goals | |
| `parent_id` | uuid fk issues (self) | hierarchical tasks |
| `title` | text not null | |
| `description` | text | |
| `status` | text default `backlog` | `backlog / todo / in_progress / in_review / done / blocked / cancelled` |
| `priority` | text default `medium` | `critical / high / medium / low` |
| `assignee_agent_id` | uuid fk agents | single assignee model |
| `assignee_user_id` | text | board user can also be assignee |
| `checkout_run_id` | uuid fk heartbeat_runs | atomic checkout lock |
| `execution_run_id` | uuid fk heartbeat_runs | |
| `execution_agent_name_key` | text | |
| `execution_locked_at` | timestamptz | |
| `created_by_agent_id` | uuid fk agents | |
| `created_by_user_id` | text | |
| `issue_number` | integer | sequential per company |
| `identifier` | text unique | e.g. `PAP-42` |
| `origin_kind` | text default `manual` | `manual / routine_execution` |
| `origin_id` | text | |
| `request_depth` | integer default 0 | cross-team delegation depth |
| `billing_code` | text | cost attribution |
| `assignee_adapter_overrides` | jsonb | |
| `execution_workspace_id` | uuid fk | git worktree / workspace isolation |
| `execution_workspace_preference` | text | |
| `execution_workspace_settings` | jsonb | |
| `started_at` / `completed_at` / `cancelled_at` / `hidden_at` | timestamptz | lifecycle timestamps |

### `goals` (`packages/db/src/schema/goals.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk | |
| `title` | text not null | |
| `description` | text | |
| `level` | text default `task` | `company / team / agent / task` |
| `status` | text default `planned` | `planned / active / achieved / cancelled` |
| `parent_id` | uuid fk goals (self) | hierarchical goals |
| `owner_agent_id` | uuid fk agents | |

### `projects` (`packages/db/src/schema/projects.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk | |
| `goal_id` | uuid fk goals | |
| `name` | text not null | |
| `description` | text | |
| `status` | text default `backlog` | `backlog / planned / in_progress / completed / cancelled` |
| `lead_agent_id` | uuid fk agents | |
| `target_date` | date | |
| `color` | text | |
| `pause_reason` | text | |
| `execution_workspace_policy` | jsonb | git worktree config |
| `archived_at` | timestamptz | |

### `heartbeat_runs` (`packages/db/src/schema/heartbeat_runs.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk | |
| `agent_id` | uuid fk | |
| `invocation_source` | text default `on_demand` | `timer / assignment / on_demand / automation` |
| `trigger_detail` | text | `manual / ping / callback / system` |
| `status` | text default `queued` | `queued / running / succeeded / failed / cancelled / timed_out` |
| `started_at` / `finished_at` | timestamptz | |
| `error` | text | |
| `wakeup_request_id` | uuid fk | |
| `exit_code` | integer | |
| `signal` | text | |
| `usage_json` | jsonb | token/cost summary |
| `result_json` | jsonb | |
| `session_id_before` / `session_id_after` | text | session continuity tracking |
| `log_store` / `log_ref` / `log_bytes` / `log_sha256` / `log_compressed` | various | run log storage |
| `stdout_excerpt` / `stderr_excerpt` | text | |
| `error_code` | text | e.g. `claude_auth_required`, `timeout`, `process_detached` |
| `external_run_id` | text | |
| `process_pid` | integer | |
| `retry_of_run_id` | uuid fk self | auto-retry for orphaned processes |
| `process_loss_retry_count` | integer default 0 | |
| `context_snapshot` | jsonb | wake context passed to agent |

### `cost_events` (`packages/db/src/schema/cost_events.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk | |
| `agent_id` | uuid fk agents | required |
| `issue_id` | uuid fk issues | optional |
| `project_id` | uuid fk projects | optional |
| `goal_id` | uuid fk goals | optional |
| `heartbeat_run_id` | uuid fk | optional, links to run |
| `billing_code` | text | |
| `provider` | text not null | e.g. `anthropic`, `openai` |
| `biller` | text default `unknown` | |
| `billing_type` | text default `unknown` | `api / subscription / metered_api / credits / ...` |
| `model` | text not null | e.g. `claude-opus-4-6` |
| `input_tokens` / `cached_input_tokens` / `output_tokens` | integer | |
| `cost_cents` | integer not null | dollar-denominated cost |
| `occurred_at` | timestamptz not null | |

### `budget_policies` (`packages/db/src/schema/budget_policies.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `company_id` | uuid fk | |
| `scope_type` | text not null | `company / agent / project` |
| `scope_id` | uuid not null | points to company/agent/project ID |
| `metric` | text default `billed_cents` | |
| `window_kind` | text not null | `calendar_month_utc / lifetime` |
| `amount` | integer default 0 | budget limit in cents |
| `warn_percent` | integer default 80 | soft alert threshold |
| `hard_stop_enabled` | boolean default true | |
| `notify_enabled` | boolean default true | |
| `is_active` | boolean default true | |

### `budget_incidents` (`packages/db/src/schema/budget_incidents.ts`)
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid pk | |
| `policy_id` | uuid fk budget_policies | |
| `scope_type` / `scope_id` | text / uuid | |
| `threshold_type` | text | `warning / hard_stop` |
| `amount_limit` / `amount_observed` | integer | |
| `status` | text default `open` | `open / dismissed` |
| `approval_id` | uuid fk approvals | links to budget override approval |

### Other notable tables:
- **`agent_api_keys`**: hashed bearer tokens per agent, company-scoped
- **`agent_wakeup_requests`**: queued wake events with source/reason/payload, coalescing support
- **`approvals`**: `hire_agent / approve_ceo_strategy / budget_override` types, linked to agents/users
- **`routines` + `routine_triggers` + `routine_runs`**: scheduled recurring tasks with cron expressions and timezone support
- **`company_memberships`**: user-to-company membership with `principal_type` / `principal_id` / `membership_role`
- **`company_skills`**: installed skills per company (markdown content, source metadata, trust level)
- **`company_secrets` + `company_secret_versions`**: encrypted secret storage, `local_encrypted` provider default
- **`execution_workspaces`**: git worktree / isolated workspace management per project/issue
- **`documents` + `document_revisions` + `issue_documents`**: versioned documents attached to issues (plans, notes)
- **`assets` + `issue_attachments`**: file storage (local_disk or S3)
- **`activity_log`**: immutable audit trail with `actor_type`, `action`, `entity_type`, `run_id`
- **`plugins` + `plugin_config` + `plugin_state` + `plugin_jobs` + `plugin_logs` + `plugin_webhooks` + `plugin_entities` + `plugin_company_settings`**: full plugin system infrastructure
- **`instance_settings`**: server-level configuration
- **`instance_user_roles`**: admin/user roles at instance level
- **`board_api_keys`**: board/admin API keys

## Agent Adapters

Source: `packages/adapters/` directories and `server/src/adapters/registry.ts` (lines 1-180).

| Adapter | `adapter_type` value | How It Works | Config Fields (in `adapter_config` jsonb) | Auth Method |
|---------|---------------------|-------------|------------------------------------------|-------------|
| Claude Code | `claude_local` | Spawns local `claude` CLI with `--print` and `--output-format stream-json`. Resumes sessions via `--resume`. Injects skills via `--add-dir`. | `command` (default `claude`), `cwd`, `model`, `effort`, `chrome`, `promptTemplate`, `bootstrapPromptTemplate`, `instructionsFilePath`, `maxTurnsPerRun`, `dangerouslySkipPermissions`, `timeoutSec`, `graceSec`, `extraArgs`, `env` (map of plain values or secret refs), `workspaceStrategy` | Auto-injected short-lived JWT (`PAPERCLIP_API_KEY`). Or `ANTHROPIC_API_KEY` in env for API billing. Claude login session for subscription billing. |
| Codex | `codex_local` | Spawns local Codex CLI process. Similar pattern to Claude. | `command`, `cwd`, `model`, `env`, `timeoutSec`, `graceSec`, `instructionsFilePath`, `maxTurnsPerRun`, `extraArgs`, `workspaceStrategy` | Auto-injected JWT. `OPENAI_API_KEY` in env. |
| Cursor | `cursor` | Cursor API/CLI bridge. | `command`, `cwd`, `model`, `env`, `timeoutSec`, `graceSec`, `instructionsFilePath`, `extraArgs` | Auto-injected JWT. |
| Gemini | `gemini_local` | Spawns local Gemini CLI. | `command`, `cwd`, `model`, `env`, `timeoutSec`, `graceSec` | Auto-injected JWT. |
| OpenCode | `opencode_local` | Spawns local OpenCode CLI. | `command`, `cwd`, `model`, `env`, `timeoutSec`, `graceSec`, `instructionsFilePath`, `extraArgs` | Auto-injected JWT. |
| Pi | `pi_local` | Spawns local Pi CLI. | `command`, `cwd`, `model`, `env`, `timeoutSec`, `graceSec` | Auto-injected JWT. |
| Hermes | `hermes_local` | Spawns local Hermes agent. | Similar to Claude pattern. | Auto-injected JWT. |
| OpenClaw Gateway | `openclaw_gateway` | HTTP-based gateway to managed OpenClaw agents. Does NOT support local JWT. | `url`, gateway-specific config | External API key in adapter config. |
| Process (generic) | `process` | Spawns any child process command. | `command`, `args`, `cwd`, `env`, `timeoutSec`, `graceSec` | Via env vars in config. |
| HTTP (generic) | `http` | Sends HTTP request to external endpoint. | `url`, `method`, `headers`, `timeoutMs`, `payloadTemplate` | Headers in config (e.g. Bearer token). |

All local adapters (`claude_local`, `codex_local`, `cursor`, `gemini_local`, `opencode_local`, `pi_local`) support:
- `supportsLocalAgentJwt: true` -- auto-generated short-lived JWT for Paperclip API access
- Session continuity via `AdapterSessionCodec` (session ID, cwd, workspace metadata)
- Skill listing and syncing
- Environment test capability

The `ServerAdapterModule` interface (at `packages/adapter-utils/src/types.ts`) requires:
```typescript
interface ServerAdapterModule {
  type: string;
  execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult>;
  testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult>;
  // Optional: listSkills, syncSkills, sessionCodec, sessionManagement,
  //           supportsLocalAgentJwt, models, listModels, agentConfigurationDoc,
  //           onHireApproved, getQuotaWindows, detectModel
}
```

## Company Model

**Source**: `packages/db/src/schema/companies.ts`, `doc/SPEC-implementation.md` section 7.1

**Creation flow**: Companies are created via `POST /api/companies` (board-only action). The CLI also supports `pnpm paperclipai company list/get/delete`. Company import/export supports creating companies from portable markdown packages.

**Actual fields** (see schema above):
- `name`, `description`, `status` (active/paused/archived)
- `issue_prefix` (unique, used for identifiers like `PAP-42`)
- `issue_counter` (auto-incrementing)
- `budget_monthly_cents`, `spent_monthly_cents`
- `require_board_approval_for_new_agents` (boolean)
- `brand_color`, `pause_reason`, `paused_at`

**What is configurable**: Company creation is DB-backed and exposed through both UI and API. The UI provides a company selector for multi-company navigation. Companies can be paused, archived, and (with `PAPERCLIP_ENABLE_COMPANY_DELETION=true`) deleted. Budget policies are stored separately in `budget_policies` table, not inline on the company row.

**Company membership**: The `company_memberships` table tracks user-to-company relationships with `principal_type` / `principal_id` / `status` / `membership_role`. Creation of a company automatically creates a membership for the creator.

## Heartbeat System

**Source**: `server/src/services/heartbeat.ts`, `server/src/services/cron.ts`, `server/src/services/routines.ts`

### Agent Timer Heartbeats

Heartbeat policy is stored in `agents.runtime_config` jsonb under the `.heartbeat` key. Parsed by `parseHeartbeatPolicy()` at `server/src/services/heartbeat.ts` ~line 1726:

```typescript
{
  enabled: boolean,          // default true
  intervalSec: number,       // minimum 30 per spec; 0 = disabled
  wakeOnDemand: boolean,     // default true -- allows on_demand/assignment wakes
  maxConcurrentRuns: number  // default 1, max 10
}
```

**Scheduling format**: Simple interval-based (`intervalSec`). The server runs a background scheduler loop (configurable via `HEARTBEAT_SCHEDULER_INTERVAL_MS`, default 30000ms, min 10000ms). The `tickTimers()` function iterates all agents, checks elapsed time since `last_heartbeat_at`, and enqueues wakeup requests when the interval has elapsed.

**Scheduler can be disabled**: `HEARTBEAT_SCHEDULER_ENABLED=false` env var.

### Routine Triggers (Cron-Based)

For cron-based scheduling, the `routines` + `routine_triggers` tables are used. Routine triggers support full 5-field cron expressions (`* * * * *`) with timezone support (`server/src/services/cron.ts` -- a complete cron parser with `parseCron()` and `nextCronTick()` functions).

Routine triggers have:
- `kind`: trigger type
- `cron_expression`: standard 5-field cron
- `timezone`: IANA timezone string
- `next_run_at`: precomputed next fire time
- `enabled`: boolean

Routines support concurrency policies (`coalesce_if_active`) and catch-up policies (`skip_missed`).

### Wake-Up Mechanism

Wake-ups flow through the `agent_wakeup_requests` table:

1. A wakeup request is created (via timer tick, assignment, on_demand invoke, or automation)
2. Request is queued with `source`, `reason`, `payload`, and `idempotency_key`
3. The heartbeat service claims queued requests, creates `heartbeat_runs` entries
4. Before claiming, checks: agent status (not paused/terminated), budget block, max concurrent runs
5. The appropriate adapter `execute()` is called

Wake sources: `timer` (scheduled), `assignment` (task assigned), `on_demand` (manual/API), `automation` (routine/plugin).

### How Agents Get Assigned Work

Agents do NOT poll for unassigned work. The SKILL.md explicitly forbids it ("Never look for unassigned work"). The flow is:
1. Board user or manager agent creates an issue with `assignee_agent_id` set
2. Assignment triggers a wakeup request for the assignee agent (via `issue-assignment-wakeup.ts`)
3. Agent wakes, checks inbox (`GET /api/agents/me/inbox-lite`), checks out assigned tasks via atomic `POST /api/issues/:issueId/checkout`
4. `@AgentName` mentions in comments also trigger targeted wakeups

## Budget System

**Source**: `server/src/services/budgets.ts`, `packages/db/src/schema/budget_policies.ts`, `packages/db/src/schema/budget_incidents.ts`

### Budget Layers

Three scope types supported:
- **Company**: `scope_type = 'company'`, `scope_id` = company UUID
- **Agent**: `scope_type = 'agent'`, `scope_id` = agent UUID  
- **Project**: `scope_type = 'project'`, `scope_id` = project UUID

Window kinds: `calendar_month_utc` (monthly UTC reset) and `lifetime`.

### Enforcement Rules

From `budgets.ts` `budgetStatusFromObserved()` function:
- **OK**: observed < warn threshold
- **Warning at `warn_percent`** (default 80%): `observed >= ceil((amount * warnPercent) / 100)`
- **Hard stop at 100%**: `observed >= amount`

At hard stop (`budgets.ts` ~line 220-260):
1. Agent/project/company status is set to `paused` with `pause_reason = 'budget'`
2. Active heartbeat runs for the scope are cancelled via `cancelWorkForScope` hook
3. A `budget_incident` record is created with `threshold_type = 'hard_stop'`
4. An approval is created so the board can raise the budget or dismiss

At warning threshold:
- A `budget_incident` record with `threshold_type = 'warning'` is created
- Notification enabled if `notify_enabled = true`

### Pre-invocation Budget Check

Before any heartbeat run is claimed (`claimQueuedRun` in heartbeat.ts ~line 1752):
```typescript
const budgetBlock = await budgets.getInvocationBlock(run.companyId, run.agentId, {
  issueId, projectId
});
if (budgetBlock) {
  await cancelRunInternal(run.id, budgetBlock.reason);
  return null;
}
```

Budget is also checked at wakeup enqueue time (~line 3185).

### Board Override

Board can:
- Raise the budget amount on the policy
- Resume the agent (which clears `pause_reason = 'budget'`)
- Approve budget override via the approvals system

Legacy fields `budget_monthly_cents` / `spent_monthly_cents` still exist on `agents` and `companies` tables, but the `budget_policies` + `budget_incidents` system is the real enforcement mechanism.

## Environment Variables (ACTUAL)

**Source**: `server/src/config.ts`, `.env.example`, `docker-compose.yml`, `docker-compose.quickstart.yml`

| Variable | Required? | What It Does |
|----------|-----------|-------------|
| `DATABASE_URL` | No | PostgreSQL connection string. If unset, uses embedded PGlite at `~/.paperclip/instances/default/db/`. |
| `PORT` | No | Server port. Default `3100`. |
| `HOST` | No | Bind address. Default `127.0.0.1`. Set `0.0.0.0` for Docker/remote. |
| `SERVE_UI` | No | Serve React UI from server. Default `true`. |
| `PAPERCLIP_DEPLOYMENT_MODE` | No | `local_trusted` (default, no login) or `authenticated` (login required). |
| `PAPERCLIP_DEPLOYMENT_EXPOSURE` | No | `private` (default) or `public`. Only relevant for `authenticated` mode. |
| `PAPERCLIP_PUBLIC_URL` | No | Public base URL. Required for `authenticated + public` mode. |
| `BETTER_AUTH_SECRET` | For authenticated mode | Secret for Better Auth session signing. Required if `PAPERCLIP_DEPLOYMENT_MODE=authenticated`. |
| `PAPERCLIP_HOME` | No | Override data directory. Default `~/.paperclip`. |
| `PAPERCLIP_SECRETS_PROVIDER` | No | `local_encrypted` (default). |
| `PAPERCLIP_SECRETS_MASTER_KEY` | No | 32-byte key (base64/hex/raw) for secret encryption. Auto-generated if missing. |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | No | Path to key file. Default `~/.paperclip/instances/default/secrets/master.key`. |
| `PAPERCLIP_SECRETS_STRICT_MODE` | No | `true` to block new inline sensitive env values. |
| `PAPERCLIP_STORAGE_PROVIDER` | No | `local_disk` (default) or `s3`. |
| `PAPERCLIP_STORAGE_LOCAL_DIR` | No | Local disk storage base dir. |
| `PAPERCLIP_STORAGE_S3_BUCKET` | No | S3 bucket name. Default `paperclip`. |
| `PAPERCLIP_STORAGE_S3_REGION` | No | S3 region. Default `us-east-1`. |
| `PAPERCLIP_STORAGE_S3_ENDPOINT` | No | Custom S3 endpoint (for MinIO etc). |
| `PAPERCLIP_STORAGE_S3_PREFIX` | No | Object key prefix in S3. |
| `PAPERCLIP_STORAGE_S3_FORCE_PATH_STYLE` | No | `true` for path-style S3 (MinIO). |
| `HEARTBEAT_SCHEDULER_ENABLED` | No | Default `true`. Set `false` to disable background timer. |
| `HEARTBEAT_SCHEDULER_INTERVAL_MS` | No | Scheduler poll interval. Default 30000ms, min 10000ms. |
| `PAPERCLIP_ENABLE_COMPANY_DELETION` | No | Default `true` in `local_trusted`, `false` otherwise. |
| `PAPERCLIP_DB_BACKUP_ENABLED` | No | Default `true`. Embedded PG backup toggle. |
| `PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES` | No | Default 60. |
| `PAPERCLIP_DB_BACKUP_RETENTION_DAYS` | No | Default 30. |
| `PAPERCLIP_DB_BACKUP_DIR` | No | Backup directory path. |
| `PAPERCLIP_ALLOWED_HOSTNAMES` | No | Comma-separated hostnames for private mode. |
| `PAPERCLIP_AUTH_BASE_URL_MODE` | No | `auto` or `explicit`. |
| `PAPERCLIP_AUTH_DISABLE_SIGN_UP` | No | `true` to disable new user registration. |
| `PAPERCLIP_UI_DEV_MIDDLEWARE` | No | `true` for dev proxy mode. |
| `OPENAI_API_KEY` | No | Passed through to Codex adapter in Docker. |
| `ANTHROPIC_API_KEY` | No | Passed through to Claude adapter in Docker. |

**Agent-injected env vars** (set automatically in adapter execution context per `skills/paperclip/SKILL.md`):
- `PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_RUN_ID`
- Wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`, `PAPERCLIP_APPROVAL_ID`, `PAPERCLIP_APPROVAL_STATUS`, `PAPERCLIP_LINKED_ISSUE_IDS`
- Workspace context: `PAPERCLIP_WORKSPACE_CWD`, `PAPERCLIP_WORKSPACE_SOURCE`, `PAPERCLIP_WORKSPACE_STRATEGY`, `PAPERCLIP_WORKSPACE_ID`, `PAPERCLIP_WORKSPACE_REPO_URL`, `PAPERCLIP_WORKSPACE_REPO_REF`, `PAPERCLIP_WORKSPACE_BRANCH`, `PAPERCLIP_WORKSPACE_WORKTREE_PATH`, `AGENT_HOME`

## Claude Code as Agent

**Source**: `packages/adapters/claude-local/src/server/execute.ts`, `packages/adapters/claude-local/src/ui/build-config.ts`

### Adapter Config (`adapter_config` jsonb when `adapter_type = 'claude_local'`)

```json
{
  "command": "claude",
  "cwd": "/path/to/workspace",
  "model": "claude-sonnet-4-20250514",
  "effort": "high",
  "chrome": false,
  "promptTemplate": "You are agent {{agent.id}} ({{agent.name}}). Continue your Paperclip work.",
  "bootstrapPromptTemplate": "...",
  "instructionsFilePath": "/path/to/AGENTS.md",
  "maxTurnsPerRun": 50,
  "dangerouslySkipPermissions": true,
  "timeoutSec": 0,
  "graceSec": 15,
  "extraArgs": ["--flag"],
  "env": {
    "ANTHROPIC_API_KEY": { "type": "secret_ref", "secretId": "uuid", "version": "latest" },
    "CUSTOM_VAR": { "type": "plain", "value": "hello" }
  },
  "workspaceStrategy": {
    "type": "git_worktree",
    "baseRef": "main",
    "branchTemplate": "paperclip/{{agent.name}}/{{issue.identifier}}",
    "worktreeParentDir": "/path/to/worktrees"
  },
  "workspaceRuntime": { "services": [...] }
}
```

### Authentication Flow

1. **Local JWT**: When `supportsLocalAgentJwt: true` (which it is for `claude_local`), the server generates a short-lived JWT via `createLocalAgentJwt()` (`server/src/agent-auth-jwt.ts`). This is injected as `PAPERCLIP_API_KEY` env var.
2. **Anthropic auth**: Two billing types detected by `resolveClaudeBillingType()`:
   - `api`: When `ANTHROPIC_API_KEY` is present in the env config
   - `subscription`: When relying on local Claude login session (OAuth/session-based)
3. **Claude login**: `runClaudeLogin()` function supports `claude login` command for session-based auth.

### Session Handling

The Claude adapter maintains session continuity via `sessionCodec` at `packages/adapters/claude-local/src/server/index.ts`:
- Deserializes session state from `{ sessionId, cwd, workspaceId, repoUrl, repoRef }`
- On execution, checks if saved session's `cwd` matches current `cwd` -- if not, starts fresh
- Passes `--resume <sessionId>` to Claude CLI for session continuity
- If resume fails with "unknown session" error, auto-retries with fresh session
- Session ID is extracted from Claude's stream-json output
- Session params are persisted in `heartbeat_runs.session_id_after` and tracked per agent-task pair in `agent_task_sessions`

### Skills Injection

The `buildSkillsDir()` function creates a temp directory with `.claude/skills/` containing symlinks to Paperclip skills from the repo's `skills/` directory. This is passed to Claude via `--add-dir`. The Paperclip SKILL.md teaches agents the full heartbeat procedure and API contract.

## Multi-Company Isolation

**Source**: `doc/SPEC-implementation.md` section 3, `AGENTS.md` section 5 rule 1

### Technical Isolation Model

**`company_id` column on every business entity** -- this is the primary isolation mechanism. Every table that represents business data has a `company_id` foreign key to `companies.id`.

Specific enforcement:
1. **Schema-level**: Every business table (`agents`, `issues`, `goals`, `projects`, `cost_events`, `heartbeat_runs`, `approvals`, `activity_log`, `routines`, etc.) has `company_id` not null with FK constraint.
2. **Query-level**: All service functions and API routes include `company_id` in WHERE clauses. From `AGENTS.md` rule 1: "Keep changes company-scoped. Every domain entity should be scoped to a company and company boundaries must be enforced in routes/services."
3. **Agent API key scope**: `agent_api_keys` table has both `agent_id` and `company_id`. Keys are validated against company scope. "Agent keys must not access other companies" (`AGENTS.md` section 8).
4. **Index-level**: Most indexes are compound starting with `company_id` (e.g. `agents_company_status_idx`, `issues_company_status_idx`).
5. **Membership-level**: `company_memberships` table controls user access per company.

There are NO separate schemas or separate databases per company. It is purely row-level isolation via `company_id` scoping.

## Deployment Reality

### Minimum Viable Deployment (Local Dev)

```bash
npx paperclipai onboard --yes
# or:
pnpm install && pnpm dev
```

This starts:
- API server at `http://localhost:3100`
- UI served by the same server
- Embedded PGlite database at `~/.paperclip/instances/default/db/`
- Auto-generated secrets key at `~/.paperclip/instances/default/secrets/master.key`
- Local file storage at `~/.paperclip/instances/default/data/storage`
- No login required (`local_trusted` mode)

**Zero external dependencies** -- no Docker, no Postgres, no Redis. Just Node.js 20+ and pnpm.

### Docker Quickstart (`docker-compose.quickstart.yml`)

Single container with embedded PGlite:
- Requires: `BETTER_AUTH_SECRET`, `PAPERCLIP_PUBLIC_URL` (if authenticated mode)
- Volume: `${PAPERCLIP_DATA_DIR:-./data/docker-paperclip}:/paperclip`
- Port: `${PAPERCLIP_PORT:-3100}:3100`
- Installs `@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai` globally in the image

### Docker Production (`docker-compose.yml`)

Two services:
- `db`: PostgreSQL 17 Alpine with healthcheck
- `server`: Paperclip app with `DATABASE_URL` pointing to the db service
- Requires: `BETTER_AUTH_SECRET`
- Volume: `paperclip-data:/paperclip` for persistent data

### What the Onboarding CLI Does

`npx paperclipai onboard` is interactive:
1. Asks deployment mode (`local_trusted` or `authenticated`)
2. If authenticated, asks exposure (`private` or `public`)
3. Sets up config file at `~/.paperclip/instances/default/config.json`
4. Starts the server
5. Runs health check (`/api/health`)

`paperclipai doctor` validates configuration, database connectivity, adapter environments.

### Config File

Server also reads from `~/.paperclip/instances/default/config.json` (managed by CLI). Fields cover `server` (mode, exposure, host, port), `database` (mode, connectionString), `secrets`, `storage`, `auth`. Environment variables override config file values.

## What We Should NOT Build Custom

Based on thorough analysis of the repo, Paperclip already handles all of the following natively:

1. **Company creation and management** -- Full CRUD via API and UI, with import/export of portable company packages.
2. **Agent lifecycle** -- Creation, org chart placement, pause/resume/terminate, adapter configuration -- all through UI and API.
3. **Task/issue management** -- Complete ticket system with hierarchy, status machine, atomic checkout, comments, documents, attachments. The UI is a full board/kanban.
4. **Heartbeat/scheduling** -- Both interval-based (per-agent `runtime_config.heartbeat.intervalSec`) and cron-based (routines system). Background scheduler built into server process.
5. **Budget enforcement** -- Multi-scope (company/agent/project) budget policies with configurable warn/hard-stop thresholds. Auto-pause at limit. Board override via approvals.
6. **Cost tracking** -- Per-event ingestion with agent/issue/project/goal attribution. Token counts, dollar costs, provider/model tracking.
7. **Agent authentication** -- Auto-generated short-lived JWTs for local adapters. Hashed API keys for persistent access. Board session auth via Better Auth.
8. **Multi-company isolation** -- Row-level via `company_id` on every table. Company memberships for user access control.
9. **Governance/approvals** -- Approval gates for hiring, CEO strategy, budget overrides. Board has full override power at all times.
10. **Skills system** -- Company-level skill installation, per-agent skill assignment, runtime injection via adapter `--add-dir` or equivalent.
11. **Audit trail** -- Immutable `activity_log` with actor type/id, action, entity, run linkage. Every mutation is logged.
12. **Secret management** -- Encrypted at rest with `local_encrypted` provider. Secret refs in adapter config env vars. Master key auto-generated.
13. **Workspace management** -- Git worktree strategy, project workspaces, execution workspace isolation per issue. Branch templates.
14. **Company import/export** -- Portable markdown packages, GitHub import, collision handling, dry-run preview.
15. **Plugin system** -- Full plugin infrastructure with config, state, jobs, webhooks, logs, entity storage.
16. **Routine scheduling** -- Cron-based recurring tasks with timezone support, concurrency/catch-up policies.

## Paperclip's SKILL.md

**Source**: `skills/paperclip/SKILL.md` (267 lines)

This is the primary document that teaches agents how to interact with Paperclip. It is injected into agent execution context via the skills system. Key contents:

1. **Authentication**: Documents auto-injected env vars (`PAPERCLIP_AGENT_ID`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, `PAPERCLIP_RUN_ID`, wake context vars). All requests use `Authorization: Bearer $PAPERCLIP_API_KEY` with `X-Paperclip-Run-Id` header for audit.

2. **The Heartbeat Procedure** (9 steps):
   - Step 1: Identity (`GET /api/agents/me`)
   - Step 2: Approval follow-up (if `PAPERCLIP_APPROVAL_ID` set)
   - Step 3: Get assignments (`GET /api/agents/me/inbox-lite`)
   - Step 4: Pick work (priority: in_progress > todo > blocked; mention exception; blocked-task dedup)
   - Step 5: Checkout (`POST /api/issues/:issueId/checkout` -- atomic, 409 on conflict)
   - Step 6: Understand context (`GET /api/issues/:issueId/heartbeat-context`, incremental comments)
   - Step 7: Do the work
   - Step 8: Update status (`PATCH /api/issues/:issueId` with comment)
   - Step 9: Delegate if needed (`POST /api/companies/:companyId/issues` with parentId/goalId)

3. **Critical Rules**: Always checkout before working. Never retry a 409. Never look for unassigned work. Always comment on in_progress work. Always set parentId on subtasks. Never cancel cross-team tasks. Budget: auto-paused at 100%, focus on critical only above 80%.

4. **Comment Style**: Markdown with ticket-linking (`[PAP-42](/PAP/issues/PAP-42)`), company-prefixed URLs required.

5. **Planning workflow**: Uses issue documents with key `plan` via `PUT /api/issues/:issueId/documents/plan`.

6. **Key Endpoints**: Complete quick-reference table of ~30 endpoints.

Additional reference at `skills/paperclip/references/api-reference.md` with JSON schemas, worked examples (IC heartbeat, manager heartbeat), governance/approval flows, error codes, and common mistakes table.

Also: `skills/paperclip-create-agent/SKILL.md` for agent hiring workflows, `skills/para-memory-files/SKILL.md` for memory/knowledge management.

---

## Modularity Analysis

**Paperclip is a monolithic platform — patterns are extractable, code is not:**

1. **The company model is the core abstraction.** Everything hangs off `company_id` — agents, issues, budgets, activity logs, skills. You can't take "just the budget system" without the company/agent schema. However, the *pattern* of row-level isolation via `company_id` is independently applicable.

2. **Heartbeat procedure is self-contained as a pattern.** The 9-step heartbeat loop (identity → assignments → checkout → context → work → update → delegate) is a clean, reusable agent wake-up protocol. It doesn't require Paperclip's database — the pattern works with any task queue.

3. **Adapter system is highly modular.** Each adapter (`claude-code`, `codex-cli`, `aider`, etc.) is a standalone implementation of the same interface. Adding a new adapter doesn't touch other adapters. The adapter factory pattern is extractable.

4. **Budget system is coupled to the cost tracking pipeline.** Budget policies → cost events → threshold checks → auto-pause. These four components work as a unit. The pattern (multi-scope budgets with warn/hard-stop thresholds) is extractable independently.

5. **Skills system is loosely coupled.** Skills are markdown files injected into agent context via adapter `--add-dir`. The injection mechanism is adapter-specific, but the SKILL.md format and company-level skill assignment pattern are independently reusable.

6. **Import/export is standalone.** Company import/export produces/consumes portable markdown packages. This is a clean, extractable isolation mechanism.

**Extractable as patterns:** Heartbeat protocol, company-based multi-tenant isolation, budget threshold system, adapter factory, SKILL.md format, import/export for portability
**Not extractable (too coupled):** Database schema, Express API routes, React UI, approval workflow internals

---

## Comparison vs ECC / Ruflo / GSD / The Architect / Superpowers

| Dimension | Paperclip | ECC | Ruflo | GSD | The Architect | Superpowers |
|-----------|-----------|-----|-------|-----|--------------|-------------|
| **Primary purpose** | Multi-agent orchestration platform with UI | Hook-based workflow automation | Context lifecycle management | Spec-driven development workflow | Design-phase planning | Development methodology |
| **Multi-client isolation** | **Best in class.** Row-level `company_id` on every table, company memberships, import/export | None | None | None (single `.planning/`) | None | None |
| **Agent orchestration** | **Most sophisticated.** Org chart, heartbeat scheduling, atomic checkout, delegation hierarchy | No orchestration | No orchestration | Fresh-context subagent spawning | No agents (single session) | Subagent per task |
| **Budget/cost control** | **Unique.** Multi-scope policies (company/agent/project), warn/hard-stop thresholds, auto-pause | Per-response cost JSONL only | None | Execution time metrics only | None | None |
| **Approval workflows** | **Unique.** Governance gates for hiring, strategy, budget overrides. Board override power. | None | None | None | None | None |
| **Task management** | Full ticket system with hierarchy, status machine, kanban UI — **most complete** | None | None | PLAN.md files with task checkboxes | Build order in blueprint | TodoWrite-based |
| **Audit trail** | Immutable activity_log with actor/action/entity — **unique** | None | None | Git commits only | None | Git commits only |
| **UI** | Full React + Vite dashboard — **unique** | None | None | None | None | None |
| **Deployment complexity** | High (PostgreSQL, Docker, server process) | Low (file-based) | Low (file-based) | Low (file-based) | Zero (pure markdown) | Zero (pure markdown) |
| **Cross-platform** | Docker-based (platform-agnostic) | Node.js hooks (cross-platform) | Node.js hooks (cross-platform) | Node.js hooks (cross-platform) | Pure markdown | Pure markdown |

**Paperclip's unique contributions not found elsewhere:**
1. Multi-tenant company isolation with row-level `company_id` — only Paperclip handles multiple clients
2. Agent heartbeat protocol (9-step wake-up loop) — most structured agent lifecycle
3. Multi-scope budget enforcement with auto-pause — no other repo enforces spending limits
4. Approval/governance workflows — no other repo has human approval gates
5. Portable company import/export — no other repo can package and transfer a client setup
6. Immutable audit trail — no other repo logs every mutation

---

## Top Patterns to Extract (Ranked)

1. **Multi-client isolation via company_id** — The core pattern iaGO-OS needs. Every table/file scoped by client identifier. Adapt from row-level DB isolation to directory-level file isolation (`.iago/clients/{client-id}/`). Source: `packages/db/src/schema/*.ts` (every table has `company_id`)

2. **Heartbeat protocol (9-step agent wake-up)** — Clean, reusable agent lifecycle: check identity → get assignments → checkout (atomic) → load context → do work → update status → delegate. Adapt for iaGO subagent dispatching. Source: `skills/paperclip/SKILL.md`

3. **Budget threshold system** — Multi-scope (client/project/agent) with configurable warn (80%) and hard-stop (100%) thresholds. Auto-pause at limit. Adapt for iaGO cost tracking with per-client spend limits. Source: `packages/db/src/schema/budget-policies.ts`, `server/src/services/budget.service.ts`

4. **Company import/export for portability** — Package a client's entire configuration as a portable markdown bundle. Adapt for iaGO: export `.iago/clients/{id}/` as a shareable package for team handoffs. Source: `server/src/services/company-import.service.ts`

5. **Adapter factory pattern** — Clean interface for multiple execution backends (claude-code, codex, aider, etc.). Adapt if iaGO ever needs to support multiple AI providers. Source: `packages/adapters/src/`

---

## Adaptation Notes

**What to adopt as patterns (not code):**

1. **Client directory isolation** → `.iago/clients/{client-slug}/` with STATE.md, DECISIONS.md, ROADMAP.md per client. Mirrors Paperclip's `company_id` scoping but at the filesystem level. No database needed.

2. **Heartbeat-inspired subagent protocol** → When dispatching subagents: (1) inject identity context, (2) load task assignment, (3) atomic checkout (mark task in-progress in STATE.md), (4) load relevant context files, (5) execute, (6) update status, (7) escalate/delegate if needed. This maps the 9-step heartbeat to our file-based workflow.

3. **Budget tracking per client** → Extend ECC's cost-tracker.js with client attribution. Store in `.iago/clients/{client-slug}/costs.jsonl`. Add configurable spend alerts (not hard limits — we control the pipeline).

4. **Portable client packages** → `iaGO export {client-slug}` packages `.iago/clients/{slug}/` as a zip/tar for sharing with team members or archiving completed engagements.

**What NOT to build:**
- Don't build a web UI — we use Claude Code CLI
- Don't build a PostgreSQL-backed system — file-based state is sufficient for a 3-person team
- Don't build approval workflows — we trust our team, overkill for 3 people
- Don't build a full adapter system — we use Claude Code only
- Don't build routine scheduling — n8n handles our recurring tasks
