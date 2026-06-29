#!/usr/bin/env node
/**
 * Tests for check-evidence.mjs (Plan 05b Task 2).
 *
 * Fixtures are derived from the REAL runtime/PHASE-2-EVIDENCE.md and
 * runtime/PHASE-1-EVIDENCE.md templates (copied + mutated into a tmp dir) so the
 * tests track the shipped templates rather than re-encoding their structure by
 * hand. Synthetic states exercised:
 *   (a) unfilled-template      — every sentinel present       → FAIL all blocks
 *   (b) fully-filled           — sentinels gone, Garry 9/9     → PASS
 *   (c) partially-filled       — some blocks filled            → FAIL the rest
 *   (d) artifact-missing       — a bogus runtime/ path in a fence → FAIL that path
 *
 * Run from `runtime/`:
 *   node --test scripts/check-evidence.test.mjs
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseSecurityScore } from "./check-evidence.mjs";

const here = path.dirname(fileURLToPath(import.meta.url)); // runtime/scripts
const runtimeRoot = path.resolve(here, "..");
const SCRIPT = path.join(here, "check-evidence.mjs");
const SENTINEL = "<!-- TODO: paste evidence -->";

const phase2Template = readFileSync(
	path.join(runtimeRoot, "PHASE-2-EVIDENCE.md"),
	"utf8",
);
const securitySamplePath = path.join(
	runtimeRoot,
	"integration/phase-2-vps.fixtures/security-analyze-sample.txt",
);
const securitySample = readFileSync(securitySamplePath, "utf8");

const tmp = mkdtempSync(path.join(tmpdir(), "check-evidence-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// --- Fixture builders ------------------------------------------------------

/** Replace every Phase 2 sentinel with innocuous filled text. */
function fillAllSentinels(content, replacement = "exit code: 0") {
	return content.split(SENTINEL).join(replacement);
}

/** Replace the sentinel inside ONE block (matched by header prefix). */
function fillBlock(content, headerPrefix, replacement = "exit code: 0") {
	const lines = content.split("\n");
	const start = lines.findIndex((l) => l.startsWith(headerPrefix));
	assert.ok(start !== -1, `header not found: ${headerPrefix}`);
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^#{2,3}\s/.test(lines[i])) {
			end = i;
			break;
		}
	}
	for (let i = start + 1; i < end; i++) {
		lines[i] = lines[i].split(SENTINEL).join(replacement);
	}
	return lines.join("\n");
}

/** Tick the first `n` Garry-checklist boxes (scoped to the §5 section). */
function tickGarry(content, n) {
	const start = content.indexOf("## 5. Garry-impressed checklist");
	assert.ok(start !== -1, "Garry section not found");
	const end = content.indexOf("## 6.", start);
	const before = content.slice(0, start);
	const after_ = content.slice(end);
	let count = 0;
	const section = content.slice(start, end).replace(/^- \[ \]/gm, (m) => {
		if (count < n) {
			count++;
			return "- [x]";
		}
		return m;
	});
	return before + section + after_;
}

/** A fully-filled, Garry-9/9, all-blocks-present Phase 2 evidence doc. */
function fullyFilled() {
	return tickGarry(fillAllSentinels(phase2Template), 9);
}

let fixtureSeq = 0;
function writeFixture(content, label) {
	const file = path.join(tmp, `${label}-${fixtureSeq++}.md`);
	writeFileSync(file, content, "utf8");
	return file;
}

function runChecker(args) {
	const r = spawnSync(process.execPath, [SCRIPT, ...args], {
		encoding: "utf8",
	});
	return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

function passedCount(out) {
	const m = out.match(/checks passed: (\d+)/);
	return m ? Number.parseInt(m[1], 10) : -1;
}

// --- Tests -----------------------------------------------------------------

test("1. unfilled template FAILs with >=10 sentinel-present reports", () => {
	const file = writeFixture(phase2Template, "unfilled");
	const { code, out } = runChecker([file, "--phase", "2"]);
	assert.equal(code, 1);
	const unfilled = out.match(/block not filled/g) ?? [];
	assert.ok(
		unfilled.length >= 10,
		`expected >=10 unfilled-block reports, got ${unfilled.length}`,
	);
});

test("2. fully-filled PASSes with count >=10", () => {
	// Cite a REAL artifact in one block to exercise the existence-PASS branch.
	let content = fillBlock(
		phase2Template,
		"### (c)",
		"node --test ran; see runtime/deploy/cutover.sh",
	);
	content = tickGarry(fillAllSentinels(content), 9);
	const file = writeFixture(content, "filled");
	const { code, out } = runChecker([file, "--phase", "2"]);
	assert.equal(code, 0, out);
	assert.ok(passedCount(out) >= 10, `count was ${passedCount(out)}`);
	assert.match(out, /cited artifact exists: runtime\/deploy\/cutover\.sh/);
});

test("3. partial fill FAILs with exactly the unfilled blocks named", () => {
	let content = phase2Template;
	for (const h of [
		"### (a)",
		"### (b)",
		"### (c)",
		"### (d)",
		"### (e)",
		"### (f)",
		"## 4. Cutover decisions",
	]) {
		content = fillBlock(content, h);
	}
	content = tickGarry(content, 9);
	const file = writeFixture(content, "partial");
	const { code, out } = runChecker([file, "--phase", "2"]);
	assert.equal(code, 1);
	// The seven filled blocks must NOT appear as failures…
	assert.doesNotMatch(out, /block not filled.*\(a\) Build gate/);
	assert.doesNotMatch(out, /block not filled.*Cutover decisions/);
	// …and the remaining ones MUST.
	for (const id of ["(g) journalctl", "(j) NDJSON", "(m) SIGHUP"]) {
		assert.ok(out.includes(id), `expected unfilled block "${id}" in output`);
	}
});

test("4. artifact-missing FAILs and names the bogus path", () => {
	let content = fillBlock(
		phase2Template,
		"### (d)",
		"cat runtime/deploy/does-not-exist.sh",
	);
	content = tickGarry(fillAllSentinels(content), 9);
	const file = writeFixture(content, "artifact-missing");
	const { code, out } = runChecker([file, "--phase", "2"]);
	assert.equal(code, 1);
	assert.match(
		out,
		/missing cited artifact: runtime\/deploy\/does-not-exist\.sh/,
	);
});

test("5. --phase 1 uses the 6-block Phase 1 list; --phase 2 uses the >=10 list", () => {
	// Phase 1 runs against the REAL filled PHASE-1-EVIDENCE.md (I4 carry-over).
	const p1 = runChecker(["--phase", "1"]);
	assert.equal(p1.code, 0, p1.out);
	assert.match(p1.out, /6\. Rollback verification/);
	// Phase 1 must NOT pull in the Phase 2 lettered blocks.
	assert.doesNotMatch(p1.out, /\(a\) Build gate/);

	const file = writeFixture(fullyFilled(), "filled-p2");
	const p2 = runChecker([file, "--phase", "2"]);
	assert.equal(p2.code, 0, p2.out);
	assert.match(p2.out, /block filled: \(m\) SIGHUP/);
	assert.ok(passedCount(p2.out) >= 10);
});

test("6. --strict rejects a security score >2.0", () => {
	const badSample = path.join(tmp, "security-bad.txt");
	writeFileSync(
		badSample,
		"→ Overall exposure level for iago-os-v2-daemon.service: 2.5 EXPOSED\n",
		"utf8",
	);
	const file = writeFixture(fullyFilled(), "filled-strict-bad");
	const { code, out } = runChecker([
		file,
		"--phase",
		"2",
		"--strict",
		"--security-sample",
		badSample,
	]);
	assert.equal(code, 1);
	assert.match(out, /--strict:.*2\.5/);
});

test("7. --strict accepts a security score <=2.0 (05a fixture as-is)", () => {
	const file = writeFixture(fullyFilled(), "filled-strict-ok");
	const { code, out } = runChecker([
		file,
		"--phase",
		"2",
		"--strict",
		"--security-sample",
		securitySamplePath,
	]);
	assert.equal(code, 0, out);
	assert.match(out, /--strict: security score 2 OK/);
});

test("8. Garry 8/9 FAILs; 9/9 PASSes", () => {
	const eight = writeFixture(
		tickGarry(fillAllSentinels(phase2Template), 8),
		"garry-8",
	);
	const r8 = runChecker([eight, "--phase", "2"]);
	assert.equal(r8.code, 1);
	assert.match(r8.out, /Garry checklist incomplete: 8\/9/);

	const nine = writeFixture(fullyFilled(), "garry-9");
	const r9 = runChecker([nine, "--phase", "2"]);
	assert.equal(r9.code, 0, r9.out);
	assert.match(r9.out, /Garry checklist 9\/9 ticked/);
});

test("9. --strict regex extracts 2.0 + OK from the 05a fixture", () => {
	const parsed = parseSecurityScore(securitySample);
	assert.ok(parsed, "regex did not match the 05a security fixture");
	assert.equal(parsed.score, 2.0);
	assert.equal(parsed.band, "OK");
});

test("10. a prose-only path is NOT flagged as a missing artifact (C3)", () => {
	// Inject an outdated path in a PROSE paragraph (NOT a fenced block / link).
	const withProse = fullyFilled().replace(
		"## 1. Purpose",
		"## 1. Purpose\n\nLegacy note: runtime/deploy/outdated_path.sh was the old path.\n",
	);
	const file = writeFixture(withProse, "prose-path");
	const { code, out } = runChecker([file, "--phase", "2"]);
	assert.equal(code, 0, out);
	assert.doesNotMatch(out, /outdated_path/);
});
