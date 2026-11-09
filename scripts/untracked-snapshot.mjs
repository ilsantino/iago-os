#!/usr/bin/env node
// Untracked-file guard for .claude/workflows/dual-adversarial-fix.js.
//
// The fix workflow runs a WRITE-capable agent on a worktree that may hold untracked files
// owned by another track (scratch scripts, research notes). Those files are not the
// workflow's to stage, commit, or delete. This script is the deterministic layer: it
// records which untracked paths existed BEFORE the fix agent ran, so staging skips them,
// a rollback removes only what the failed attempt created, and the post-fix check proves
// nothing pre-existing was committed or deleted.
//
// Usage:
//   node untracked-snapshot.mjs check   --dir <projectDir>
//   node untracked-snapshot.mjs save    --dir <projectDir>
//   node untracked-snapshot.mjs stage   --dir <projectDir> [-- <extra pathspec>...]
//   node untracked-snapshot.mjs restore --dir <projectDir> --expect-head <sha>
//   node untracked-snapshot.mjs verify  --dir <projectDir> --expect-head <sha>
//
// check    Precondition only. Exit 2 (dirty paths on stderr) if any TRACKED file is staged
//          or modified. Untracked paths are tolerated. Read-only.
// save     check + snapshot. Writes {head, untracked[]} inside the git dir (never visible
//          to git status) and prints {head, branch, untrackedCount} as JSON.
// stage    `git add -A` over the whole tree EXCEPT the snapshot paths and any extra
//          pathspecs (e.g. the secret excludes). Exit 1 if a snapshot path ends up staged.
// restore  Rollback before a retry. Restores tracked files to --expect-head, removes the
//          untracked files that are NOT in the snapshot, then asserts the tree is back at
//          the checkpoint. Fails closed (exit 1, touches nothing) when the snapshot is
//          missing, unreadable, from another checkpoint, or HEAD has moved.
// verify   Post-fix guard. Exit 1 if a snapshot path was committed since --expect-head, is
//          staged, or no longer exists on disk. Read-only.
//
// Exit codes: 0 ok, 1 guard failed (fail closed), 2 tracked files dirty, 64 usage error.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const SNAPSHOT_GIT_PATH = 'iago/dual-adversarial-fix-untracked.json'
const COMMANDS = ['check', 'save', 'stage', 'restore', 'verify']

function git(cwd, args, input) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

function splitNul(out) {
  return out.split('\0').filter((p) => p.length > 0)
}

function fail(code, message) {
  process.stderr.write(`untracked-snapshot: ${message}\n`)
  process.exit(code)
}

function parseCli(argv) {
  const [command, ...rest] = argv
  const opts = { pathspecs: [] }
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--') {
      opts.pathspecs = rest.slice(i + 1)
      break
    }
    if (rest[i] === '--dir') opts.dir = rest[++i]
    else if (rest[i] === '--expect-head') opts.expectHead = rest[++i]
    else fail(64, `unknown argument: ${rest[i]}`)
  }
  if (!COMMANDS.includes(command)) {
    fail(64, `usage: untracked-snapshot.mjs <${COMMANDS.join('|')}> --dir <projectDir> [--expect-head <sha>]`)
  }
  if (!opts.dir) fail(64, '--dir <projectDir> is required')
  if ((command === 'restore' || command === 'verify') && !opts.expectHead) {
    fail(64, `${command} requires --expect-head <sha>`)
  }
  return { command, ...opts }
}

// Every git call runs from the repo top-level: `git ls-files --others` only lists paths
// under its cwd, so a projectDir that is a subdirectory would snapshot a subtree.
function repoContext(dir) {
  let top
  try {
    top = git(dir, ['rev-parse', '--show-toplevel']).trim()
  } catch {
    fail(1, `not a git repository: ${dir}`)
  }
  const snapshotPath = resolve(top, git(top, ['rev-parse', '--git-path', SNAPSHOT_GIT_PATH]).trim())
  return { top, snapshotPath }
}

function head(top) {
  return git(top, ['rev-parse', 'HEAD']).trim()
}

function listUntracked(top) {
  return splitNul(git(top, ['ls-files', '--others', '--exclude-standard', '-z']))
}

// Staged or modified TRACKED paths only — `--untracked-files=no` is the whole point.
function trackedDirty(top) {
  return splitNul(git(top, ['status', '--porcelain=v1', '--untracked-files=no', '-z']))
}

function staged(top) {
  return splitNul(git(top, ['diff', '--cached', '--name-only', '-z']))
}

function readSnapshot(snapshotPath, expectHead) {
  if (!existsSync(snapshotPath)) {
    fail(1, `no snapshot at ${snapshotPath} — refusing to touch untracked files without one`)
  }
  let snap
  try {
    snap = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  } catch (e) {
    fail(1, `snapshot at ${snapshotPath} is unreadable (${String(e)}) — refusing`)
  }
  if (!snap || typeof snap.head !== 'string' || !Array.isArray(snap.untracked)) {
    fail(1, `snapshot at ${snapshotPath} is malformed — refusing`)
  }
  if (expectHead && snap.head !== expectHead) {
    fail(1, `snapshot was taken at ${snap.head}, not the checkpoint ${expectHead} — stale snapshot, refusing`)
  }
  return snap
}

function assertTrackedClean(top, code, context) {
  const dirty = trackedDirty(top)
  if (dirty.length > 0) fail(code, `${context}:\n${dirty.join('\n')}`)
}

function check({ dir }) {
  const { top } = repoContext(dir)
  assertTrackedClean(top, 2, 'tracked files are staged or modified — refusing to fix on a contended worktree')
  process.stdout.write(`${JSON.stringify({ trackedClean: true, untrackedCount: listUntracked(top).length })}\n`)
}

function save({ dir }) {
  const { top, snapshotPath } = repoContext(dir)
  assertTrackedClean(top, 2, 'tracked files are staged or modified — refusing to fix on a contended worktree')
  const snap = { head: head(top), untracked: listUntracked(top) }
  mkdirSync(dirname(snapshotPath), { recursive: true })
  writeFileSync(snapshotPath, JSON.stringify(snap, null, 2))
  const branch = git(top, ['branch', '--show-current']).trim()
  process.stdout.write(`${JSON.stringify({ head: snap.head, branch, untrackedCount: snap.untracked.length })}\n`)
}

function stage({ dir, pathspecs }) {
  const { top, snapshotPath } = repoContext(dir)
  const snap = readSnapshot(snapshotPath)
  // NUL-separated pathspec file: `literal` so a snapshot path with glob characters
  // excludes exactly itself, never a sibling the fix agent created.
  const spec = ['.', ...pathspecs, ...snap.untracked.map((p) => `:(exclude,literal)${p}`)]
  git(top, ['add', '-A', '--pathspec-from-file=-', '--pathspec-file-nul'], `${spec.join('\0')}\0`)
  const preExisting = new Set(snap.untracked)
  const leaked = staged(top).filter((p) => preExisting.has(p))
  if (leaked.length > 0) {
    fail(1, `pre-existing untracked files are staged — unstage them before committing:\n${leaked.join('\n')}`)
  }
  process.stdout.write(`${JSON.stringify({ staged: staged(top), excluded: snap.untracked.length })}\n`)
}

function restore({ dir, expectHead }) {
  const { top, snapshotPath } = repoContext(dir)
  const snap = readSnapshot(snapshotPath, expectHead)
  // A failed attempt that already committed cannot be rolled back without `git reset`,
  // which the fix contract forbids — fail closed instead of sweeping around a moved HEAD.
  const current = head(top)
  if (current !== expectHead) {
    fail(1, `HEAD is ${current}, not the checkpoint ${expectHead} — the failed attempt committed; roll back manually`)
  }
  if (trackedDirty(top).length > 0) git(top, ['checkout', expectHead, '--', '.'])
  const preExisting = new Set(snap.untracked)
  const removed = []
  for (const p of listUntracked(top)) {
    if (preExisting.has(p)) continue
    const rel = relative(top, resolve(top, p))
    if (rel.startsWith('..') || isAbsolute(rel)) fail(1, `untracked path escapes the repo, refusing: ${p}`)
    rmSync(resolve(top, p), { force: true })
    removed.push(p)
  }
  assertTrackedClean(top, 1, 'tracked files are still staged or modified after rollback')
  const leftover = listUntracked(top).filter((p) => !preExisting.has(p))
  if (leftover.length > 0) {
    fail(1, `untracked files created by the failed attempt could not be removed:\n${leftover.join('\n')}`)
  }
  process.stdout.write(`${JSON.stringify({ removed, preserved: snap.untracked.length })}\n`)
}

function verify({ dir, expectHead }) {
  const { top, snapshotPath } = repoContext(dir)
  const snap = readSnapshot(snapshotPath, expectHead)
  const preExisting = new Set(snap.untracked)
  const committed = splitNul(git(top, ['diff', '--name-only', '-z', expectHead, 'HEAD'])).filter((p) =>
    preExisting.has(p),
  )
  const stagedNow = staged(top).filter((p) => preExisting.has(p))
  const missing = snap.untracked.filter((p) => !existsSync(resolve(top, p)))
  const violations = [
    ...committed.map((p) => `committed: ${p}`),
    ...stagedNow.map((p) => `staged: ${p}`),
    ...missing.map((p) => `deleted: ${p}`),
  ]
  if (violations.length > 0) {
    fail(1, `pre-existing untracked files were not left alone:\n${violations.join('\n')}`)
  }
  process.stdout.write(`${JSON.stringify({ preserved: snap.untracked.length })}\n`)
}

const cli = parseCli(process.argv.slice(2))
;({ check, save, stage, restore, verify })[cli.command](cli)
