#!/usr/bin/env node
// Syntax-validate .claude/workflows/*.js without executing them.
//
// Workflow scripts use top-level `await`, `export const meta`, and a top-level
// `return` — none of which parse as a standalone ES module. The harness runs the
// body inside an async-function wrapper, so we wrap it the same way and compile
// with vm.Script (compile-only; nothing runs). Catches syntax errors, unbalanced
// braces, and broken template literals before a workflow ships.
//
// Scope: this is a COMPILE check only. It does NOT verify that the live harness
// injects the runtime bindings (agent/parallel/pipeline/log/phase/args) or honors
// the agent() `schema` option — the first real /iago-execute run is the integration
// test for those (the deprecated bash pipeline is retained as fallback until then).
//
// Used by .github/workflows/validate.yml and runnable locally:
//   node scripts/validate-workflows.mjs
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

const dir = '.claude/workflows'
let files
try {
  files = readdirSync(dir).filter((f) => f.endsWith('.js'))
} catch {
  console.log(`no ${dir} dir — nothing to validate`)
  process.exit(0)
}
if (files.length === 0) {
  console.log('no workflow .js files — nothing to validate')
  process.exit(0)
}

let failed = 0
for (const f of files) {
  const src = readFileSync(join(dir, f), 'utf8').replace(/export const meta/, 'const meta')
  const wrapped =
    '(async function(agent,parallel,pipeline,log,phase,args,budget,workflow){' + src + '\n})'
  try {
    new vm.Script(wrapped, { filename: f })
    console.log(`OK   ${f}`)
  } catch (e) {
    console.error(`FAIL ${f}: ${e.message}`)
    failed++
  }
}
process.exit(failed ? 1 : 0)
