#!/usr/bin/env node
/**
 * Phase 1 evidence-template gate.
 *
 * Greps `runtime/PHASE-1-EVIDENCE.md` for the `PASTE-` sentinel. If any
 * placeholders remain, exits non-zero so a CI gate (Phase 2's
 * runtime-checks workflow) can block merge until Santiago fills the
 * template in the PR description.
 *
 * Usage:  npm run check:evidence
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "..", "PHASE-1-EVIDENCE.md");

try {
	const raw = await readFile(target, "utf8");
	const placeholders = raw.match(/PASTE-[A-Za-z0-9-]+/g) ?? [];
	if (placeholders.length > 0) {
		// Deduplicate so the operator sees each unique sentinel once.
		const unique = Array.from(new Set(placeholders));
		process.stderr.write(
			`FAIL: ${target} still contains ${placeholders.length} PASTE- placeholder(s) ` +
				`(${unique.length} unique):\n`,
		);
		for (const p of unique) {
			process.stderr.write(`  - ${p}\n`);
		}
		process.stderr.write(
			"\nReplace every PASTE- block with actual evidence from Santiago's box.\n" +
				"See `runtime/PHASE-1-EVIDENCE.md` § Capture procedure.\n",
		);
		process.exit(1);
	}
	process.stdout.write(
		`OK: ${target} contains no PASTE- placeholders — evidence template filled.\n`,
	);
	process.exit(0);
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	process.stderr.write(`FAIL: could not read ${target}: ${message}\n`);
	process.exit(2);
}
