#!/usr/bin/env node
// Behavioral test harness for dual-adversarial-fix.js and its untracked-file guard
// (scripts/untracked-snapshot.mjs).
//
// Same approach as dual-adversarial.test.mjs: load the workflow BODY inside the async
// wrapper the live harness uses and inject mock agent/log/phase/args. The difference: the
// mock agents here are OBEDIENT against a real throwaway git repo — they run the exact
// commands the workflow's prompts tell them to run, so the assertions are about what
// those commands do to the files on disk, not about prompt wording.
//
// Run:  node .claude/workflows/dual-adversarial-fix.test.mjs
//
// Covers (regression for the Sentria gate report of 2026-09-17, section "Fix round"):
//  - an untracked file owned by another track does not block the fix flow, is not
//    committed, and is not deleted (the precondition used to demand an empty git status)
//  - a retry's rollback tolerates that file (it used to require an empty git status)
//  - staged or modified TRACKED files still block the fix flow
//  - restore removes only untracked files created after the snapshot (the retry path
//    used to delete every untracked file) and fails closed without a valid snapshot
//  - the post-fix safety check catches a pre-existing untracked file that was committed

import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const IAGO_ROOT = resolve(__dirname, '..', '..')
const HELPER = join(IAGO_ROOT, 'scripts', 'untracked-snapshot.mjs')
const SRC = readFileSync(join(__dirname, 'dual-adversarial-fix.js'), 'utf8').replace(
  /export const meta/,
  'const meta',
)

function buildWorkflow() {
  // eslint-disable-next-line no-new-func
  return new Function(
    'agent',
    'parallel',
    'pipeline',
    'log',
    'phase',
    'args',
    'budget',
    'workflow',
    `return (async () => {\n${SRC}\n})()`,
  )
}

// ── Throwaway git repo ────────────────────────────────────────────────────
const SCRATCH = 'scripts/_maquinas-readonly-scan.mjs'
const SCRATCH_BODY = '// another track owns this file\n'
const TMPS = []

function git(cwd, ...gitArgs) {
  const r = spawnSync('git', gitArgs, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${gitArgs.join(' ')} failed: ${r.stderr}`)
  return r.stdout
}

function write(repo, rel, body) {
  mkdirSync(dirname(join(repo, rel)), { recursive: true })
  writeFileSync(join(repo, rel), body)
}

function mkRepo({ scratch = true } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'iago-dafix-'))
  TMPS.push(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'test')
  git(repo, 'config', 'core.autocrlf', 'false')
  write(repo, '.gitignore', '.iago/state/\n')
  write(repo, 'src/app.js', 'export const answer = 41\n')
  write(repo, 'src/util.js', 'export const util = 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'init')
  if (scratch) write(repo, SCRATCH, SCRATCH_BODY)
  return repo
}

function status(repo) {
  return git(repo, 'status', '--porcelain', '--untracked-files=all').trim().split('\n').filter(Boolean)
}

// ── Obedient agent: runs the commands the workflow hands out ──────────────
// Minimal shell-word splitter for the helper invocations (double/single quotes, no escapes).
function shellWords(s) {
  const out = []
  let cur = ''
  let inWord = false
  let quote = null
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      inWord = true
    } else if (/\s/.test(ch)) {
      if (inWord) out.push(cur)
      cur = ''
      inWord = false
    } else {
      cur += ch
      inWord = true
    }
  }
  if (inWord) out.push(cur)
  return out
}

function helperCall(prompt, sub) {
  for (const m of prompt.matchAll(/node "([^"]*untracked-snapshot\.mjs)" ([^\n]*)/g)) {
    const words = shellWords(m[2])
    if (words[0] === sub) return { script: m[1], args: words }
  }
  return null
}

function runHelper(call) {
  const r = spawnSync(process.execPath, [call.script, ...call.args], { encoding: 'utf8' })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr }
}

function runHelperDirect(repo, ...helperArgs) {
  return runHelper({ script: HELPER, args: [helperArgs[0], '--dir', repo, ...helperArgs.slice(1)] })
}

// A prompt that orders an empty `git status --porcelain` (the pre-fix contract) is obeyed
// literally: any output — untracked files included — means BLOCKED.
function demandsEmptyStatus(prompt) {
  return /git status --porcelain(?! ?--untracked-files=no)/.test(prompt) && /NON-EMPTY|MUST be empty/.test(prompt)
}

function obedientAgents(repo, opts = {}) {
  const calls = []
  let preStateFailures = opts.failPreStateOnce ? 1 : 0
  const agent = async (prompt, options = {}) => {
    const label = options.label || ''
    calls.push({ label, prompt })
    if (label === 'pre-state') {
      if (preStateFailures-- > 0) throw new Error('transient: stream reset')
      if (demandsEmptyStatus(prompt) && status(repo).length > 0) {
        return { status: 'BLOCKED', notes: status(repo).join('\n') }
      }
      const save = helperCall(prompt, 'save')
      if (!save) throw new Error('pre-state prompt carries no snapshot save command')
      const r = runHelper(save)
      if (r.code !== 0) return { status: 'BLOCKED', notes: r.stderr }
      const out = JSON.parse(r.stdout)
      return { status: 'DONE', branch: out.branch, headSha: out.head, upstreamSha: '', untrackedCount: out.untrackedCount }
    }
    if (label.endsWith('-rollback')) {
      const cmd = prompt.match(/run exactly:\n {2}([^\n]*)\n/)
      assert.ok(cmd, 'rollback prompt names a command to run verbatim')
      const helper = cmd[1].match(/^node "([^"]*untracked-snapshot\.mjs)" (.*)$/)
      if (helper) {
        const r = runHelper({ script: helper[1], args: shellWords(helper[2]) })
        if (r.code !== 0) return { status: 'BLOCKED', notes: r.stderr }
      }
      if (demandsEmptyStatus(prompt) && status(repo).length > 0) {
        return { status: 'BLOCKED', notes: status(repo).join('\n') }
      }
      return { status: 'DONE' }
    }
    if (label === 'fix') {
      // What an executor does: fix a tracked file, add a regression test, then stage +
      // commit exactly as the prompt says. `.env` stands in for a secret it wrote.
      write(repo, 'src/app.js', 'export const answer = 42\n')
      write(repo, 'src/app.test.js', "import { answer } from './app.js'\n")
      write(repo, '.env', 'TOKEN=do-not-commit\n')
      if (opts.fixStagesEverything) {
        git(repo, 'add', '-A')
      } else {
        const stage = helperCall(prompt, 'stage')
        if (!stage) throw new Error('fix prompt carries no snapshot stage command')
        const r = runHelper(stage)
        if (r.code !== 0) return { status: 'BLOCKED', notes: r.stderr }
      }
      git(repo, 'commit', '-q', '-m', 'fix: address dual-adversarial findings')
      unlinkSync(join(repo, '.env'))
      return {
        status: 'DONE',
        commitSha: git(repo, 'rev-parse', 'HEAD').trim(),
        applied: [{ severity: 'Important', summary: 'off by one', file: 'src/app.js', fixedIn: 'src/app.js:1', test: 'regression test in src/app.test.js' }],
      }
    }
    if (label === 'safety-verify') {
      assert.ok(calls.some((c) => c.label === 'fix'), 'safety-verify runs after the fix agent')
      const preFixSha = prompt.match(/merge-base --is-ancestor ([0-9a-f]{40}) HEAD/)[1]
      const descendant = spawnSync('git', ['merge-base', '--is-ancestor', preFixSha, 'HEAD'], { cwd: repo }).status === 0
      const verify = helperCall(prompt, 'verify')
      const r = verify ? runHelper(verify) : { code: 0, stderr: '' }
      const untrackedPreserved = r.code === 0
      return {
        ok: descendant && untrackedPreserved,
        branchUnchanged: true,
        descendant,
        upstreamUnchanged: true,
        untrackedPreserved,
        notes: r.stderr,
      }
    }
    throw new Error(`mock agent: no rule for label "${label}"`)
  }
  return { agent, calls }
}

const FINDINGS = [{ severity: 'Important', summary: 'off by one', file: 'src/app.js' }]

async function runWorkflow(repo, opts = {}) {
  const h = obedientAgents(repo, opts)
  const logs = []
  const out = await buildWorkflow()(
    h.agent,
    null,
    null,
    (m) => logs.push(String(m)),
    () => {},
    { projectDir: repo, iagoRoot: IAGO_ROOT, base: 'main', findings: FINDINGS },
    null,
    null,
  )
  return { out, calls: h.calls, logs }
}

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed++
    console.log(`PASS  ${name}`)
  } catch (e) {
    failed++
    console.error(`FAIL  ${name}\n      ${e && e.message ? e.message : e}`)
  }
}

// ── Workflow: the reported defects ────────────────────────────────────────
await test("another track's untracked file does not block the fix, and is neither committed nor deleted", async () => {
  const repo = mkRepo()
  const { out, calls } = await runWorkflow(repo)
  assert.ok(out.commitSha, 'fix commit reported')
  assert.deepStrictEqual(calls.map((c) => c.label), ['pre-state', 'fix', 'safety-verify'])
  assert.strictEqual(readFileSync(join(repo, SCRATCH), 'utf8'), SCRATCH_BODY, 'scratch file intact')
  const committed = git(repo, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()
  assert.deepStrictEqual(committed, ['src/app.js', 'src/app.test.js'], 'commit holds the fix only — no scratch, no .env')
  assert.deepStrictEqual(status(repo), [`?? ${SCRATCH}`], 'scratch file is still untracked')
})

await test('a retry rolls back without requiring an empty git status', async () => {
  const repo = mkRepo()
  const { out, calls } = await runWorkflow(repo, { failPreStateOnce: true })
  assert.ok(out.commitSha, 'fix commit reported')
  assert.deepStrictEqual(calls.map((c) => c.label), ['pre-state', 'pre-state-rollback', 'pre-state', 'fix', 'safety-verify'])
  assert.strictEqual(readFileSync(join(repo, SCRATCH), 'utf8'), SCRATCH_BODY, 'scratch file intact')
})

await test('a modified tracked file still blocks the fix before any agent writes', async () => {
  const repo = mkRepo()
  write(repo, 'src/util.js', 'export const util = 2\n')
  await assert.rejects(runWorkflow(repo), /Pre-fix state capture BLOCKED: [\s\S]*src\/util\.js/)
})

await test('a staged file still blocks the fix', async () => {
  const repo = mkRepo()
  write(repo, 'src/new.js', 'export {}\n')
  git(repo, 'add', 'src/new.js')
  await assert.rejects(runWorkflow(repo), /Pre-fix state capture BLOCKED: [\s\S]*src\/new\.js/)
})

await test('the safety check fails the run when a pre-existing untracked file gets committed', async () => {
  const repo = mkRepo()
  await assert.rejects(runWorkflow(repo, { fixStagesEverything: true }), /SAFETY BREACH[\s\S]*committed: scripts\/_maquinas-readonly-scan\.mjs/)
})

await test('the workflow never enumerates or sweeps untracked files itself', async () => {
  assert.doesNotMatch(SRC, /ls-files\s+--others/, 'untracked listing belongs to the snapshot helper only')
  assert.doesNotMatch(SRC, /'git status --porcelain'/, 'no retry guard demands an empty git status')
  assert.match(SRC, /`\$\{SNAPSHOT\} restore \$\{DIR\} --expect-head \$\{preFixSha\}`/, 'fix rollback goes through the helper')
})

// ── Helper: restore is scoped to the snapshot and fails closed ────────────
await test('restore removes only untracked files created after the snapshot and restores tracked files', async () => {
  const repo = mkRepo()
  write(repo, 'notes/research.md', '# kept\n')
  const head = git(repo, 'rev-parse', 'HEAD').trim()
  assert.strictEqual(runHelperDirect(repo, 'save').code, 0)
  // The failed attempt: edits and deletes tracked files, leaves new untracked files behind.
  write(repo, 'src/app.js', 'broken\n')
  unlinkSync(join(repo, 'src/util.js'))
  write(repo, 'src/half-done.test.js', 'x\n')
  write(repo, 'scripts/attempt [1].mjs', 'x\n')
  const r = runHelperDirect(repo, 'restore', '--expect-head', head)
  assert.strictEqual(r.code, 0, r.stderr)
  assert.deepStrictEqual(JSON.parse(r.stdout).removed.sort(), ['scripts/attempt [1].mjs', 'src/half-done.test.js'])
  assert.strictEqual(readFileSync(join(repo, 'src/app.js'), 'utf8'), 'export const answer = 41\n')
  assert.ok(existsSync(join(repo, 'src/util.js')), 'deleted tracked file restored')
  assert.deepStrictEqual(status(repo), ['?? notes/research.md', `?? ${SCRATCH}`])
})

await test('restore fails closed and deletes nothing without a snapshot for this checkpoint', async () => {
  const repo = mkRepo()
  const head = git(repo, 'rev-parse', 'HEAD').trim()
  write(repo, 'src/new.js', 'x\n')
  let r = runHelperDirect(repo, 'restore', '--expect-head', head)
  assert.strictEqual(r.code, 1, 'no snapshot → exit 1')
  assert.match(r.stderr, /no snapshot/)
  assert.ok(existsSync(join(repo, 'src/new.js')) && existsSync(join(repo, SCRATCH)), 'nothing deleted')

  assert.strictEqual(runHelperDirect(repo, 'save').code, 0)
  r = runHelperDirect(repo, 'restore', '--expect-head', '0'.repeat(40))
  assert.strictEqual(r.code, 1, 'stale snapshot → exit 1')
  assert.match(r.stderr, /stale snapshot/)

  write(repo, 'src/later.js', 'x\n')
  git(repo, 'add', 'src/app.js')
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'attempt committed')
  r = runHelperDirect(repo, 'restore', '--expect-head', head)
  assert.strictEqual(r.code, 1, 'moved HEAD → exit 1')
  assert.match(r.stderr, /failed attempt committed/)
  assert.ok(existsSync(join(repo, 'src/later.js')) && existsSync(join(repo, SCRATCH)), 'nothing deleted')
})

await test('stage excludes snapshot paths even when their names contain glob characters', async () => {
  const repo = mkRepo()
  write(repo, 'scripts/scan[1].mjs', 'foreign\n')
  assert.strictEqual(runHelperDirect(repo, 'save').code, 0)
  write(repo, 'scripts/scan1.mjs', 'created by the fix\n')
  const r = runHelperDirect(repo, 'stage', '--', ':!.env')
  assert.strictEqual(r.code, 0, r.stderr)
  assert.deepStrictEqual(JSON.parse(r.stdout).staged, ['scripts/scan1.mjs'])
})

for (const d of TMPS) rmSync(d, { recursive: true, force: true })
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
