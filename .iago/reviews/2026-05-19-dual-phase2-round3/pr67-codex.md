# Codex Adversarial Review

Target: branch diff against fd9f27c
Verdict: needs-attention

No-ship: the scheduled PR triage path is wired, but it still cannot execute the agent, and the prompt's PR enumeration command is invalid.

Findings:
- [high] Cron wiring never dispatches the PR triage agent (runtime/daemon/main.ts:744-757)
  `startDaemon` now registers cron entries and starts both the scheduler and polling loop, but the cron path only writes a pending task file. `loadAgentCronEntries` does not carry `runtimeId`, `cwd`, `env`, or `authProfile` into anything that can spawn `claude-pty`; `runtime/agents/pr-triage/agent-config.json` also has `autoStart:false`, so `processPendingTask` sees `pr-triage` as unregistered and emits `task-unrouted` instead of running the prompt. Even for registered agents, `claimTask` is explicitly decrement-only and does not dispatch task content. The likely production result is a daily `cron-fired`/`task-unrouted` trail with accumulating pending files and no Telegram triage message.
  Recommendation: Wire cron-fired tasks to actual agent execution using the full agent config, or register/spawn the cron agent on demand before resolving the task. Add an integration test that a `pr-triage` cron fire invokes the runtime with the prompt and reaches the Telegram/fallback path.
- [high] Prompt uses a non-existent `gh pr list --owner` command (runtime/agents/pr-triage/prompt-template.md:24-31)
  The agent is instructed to enumerate org-wide PRs with `gh pr list --owner ilsantino`, but the GitHub CLI manual says `gh pr list` lists PRs in a repository and exposes `--repo`, not `--owner`: https://cli.github.com/manual/gh_pr_list. If the agent follows this prompt, step (a) fails before classification and the daily job sends only the failure-path message instead of the triage summary.
  Recommendation: Replace this with a tested org-wide enumeration flow, such as `gh repo list ilsantino` followed by per-repo `gh pr list -R owner/repo --json ...`, or a `gh search prs --owner ...` flow only if it returns every field needed for the bucket rules.
