#!/usr/bin/env node
/**
 * check-evidence.mjs — Phase 1 / Phase 2 acceptance-gate evidence checker.
 *
 * Scans a RENDERED evidence file (Santiago fills the template, then runs this
 * script) and verifies every required block is present, every cited artifact
 * path exists, and the Garry-impressed checklist is fully ticked. This script
 * IS the Phase 2 acceptance gate (master-prompt criterion #7 — the verification
 * path): without a passing run on a filled-in evidence file, the phase is not
 * done.
 *
 * Usage:
 *   node scripts/check-evidence.mjs [<evidence.md>] [--phase 1|2] [--strict] \
 *        [--security-sample <path>]
 *
 *   --phase 2  (default)  Check PHASE-2-EVIDENCE.md (or the given file) against
 *                         the Phase 2 block list + `<!-- TODO: paste evidence -->`
 *                         sentinel.
 *   --phase 1             Check PHASE-1-EVIDENCE.md against the Phase 1 block
 *                         list + the legacy `PASTE-…` sentinel.
 *   --strict              ALSO assert the `systemd-analyze security` exposure
 *                         score is ≤ 2.0 and the band word is OK/SAFE. The score
 *                         is read from block (h) of the RENDERED evidence file by
 *                         DEFAULT — NOT a bundled fixture. (Defaulting to a known-
 *                         good fixture would green-pass --strict regardless of the
 *                         live score actually pasted into block (h).) Pass an
 *                         explicit anonymized live capture via
 *                         --security-sample <path> to parse that file instead.
 *                         --strict is OPT-IN: the default acceptance run only
 *                         checks block (h)'s sentinel was replaced, because a
 *                         legitimately-accepted higher band (documented in block
 *                         (h)) must not hard-fail the default gate.
 *
 * Exit code: 0 = PASS, 1 = FAIL (any check failed), 2 = could not read the file.
 *
 * Design decisions (carried from the Plan 05 / 05b stress test):
 *
 *  - C2 (sentinel-replacement, not content-regex): "block is filled" is signalled
 *    by ZERO occurrences of the block's sentinel — for Phase 2 the unique HTML
 *    comment `<!-- TODO: paste evidence -->` (never produced by any tool output),
 *    for Phase 1 the legacy `PASTE-…` token. We do NOT enforce content meaning —
 *    that is the human PR reviewer's job.
 *  - C3 (fenced + link-target path scan only): cited-artifact existence is checked
 *    ONLY for paths inside ```fenced code blocks``` and `[text](path)` link
 *    targets — NEVER prose. Outdated paths mentioned in prose would otherwise
 *    yield false "missing artifact" failures.
 *  - I1 (shared security-score regex): SECURITY_SCORE_REGEX + parseSecurityScore
 *    are exported so runtime/integration/phase-2-vps.test.ts (e2e test 2) parses
 *    the LIVE `systemd-analyze security` output with the exact same regex — no
 *    drift between the fixture parse and the live parse.
 *  - I4 (--phase 1 block list matches the real file): the Phase 1 block list is
 *    the six sections actually present in PHASE-1-EVIDENCE.md; covered by
 *    check-evidence.test.mjs case 5.
 *
 * Cited-artifact path patterns: runtime/{deploy,migration,agents,scripts,daemon}/…
 * — resolved against the repo root (derived from THIS script's location, so the
 * check is cwd-independent), then `fs.existsSync`. (Only repo-root `runtime/…`
 * citations are existence-checked; cwd-relative forms like `scripts/foo.mjs`
 * after a `cd runtime` and glob forms like `deploy/*.sh` are a documented C3
 * limitation — not existsSync-resolvable.)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // runtime/scripts
const runtimeRoot = resolve(here, ".."); // runtime/
const repoRoot = resolve(here, "..", ".."); // repo root (parent of runtime/)

// --- Sentinels ------------------------------------------------------------

const PHASE2_SENTINEL = "<!-- TODO: paste evidence -->";
// Non-global so .test() has no lastIndex state to carry between calls.
const PHASE1_SENTINEL_RE = /PASTE-[A-Za-z0-9-]+/;

// --- Security-score regex (I1/I8 — shared with phase-2-vps.test.ts) --------

/**
 * Multiline (the score line may be preceded by a `→` glyph or color codes).
 * Group 1 = numeric exposure score (0.0 ↔ 10.0, LOWER is better). Group 2 = the
 * systemd-analyze band word.
 */
export const SECURITY_SCORE_REGEX =
	/Overall exposure level [^:]*:\s*(\d+\.\d+)\s+(UNSAFE|DANGEROUS|EXPOSED|MEDIUM|OK|SAFE)/m;
export const SECURITY_SCORE_MAX = 2.0;
// Bands consistent with the ≤2.0 strict TARGET. systemd-analyze maps score
// 1.0–5.0 to "OK" and <1.0 to "SAFE", so a ≤2.0 score is ALWAYS OK/SAFE; "MEDIUM"
// (5.0–7.5) can never co-occur with the ≤2.0 cap, so it is NOT a safe band here
// (keeping it would be a dead, unreachable allowance in runStrict).
export const SECURITY_SAFE_BANDS = new Set(["OK", "SAFE"]);

// Live post-cutover acceptance (opt-in e2e test 2). LOOSER than the strict TARGET:
// the shipped unit ships no SystemCallFilter, so a real capture realistically lands
// in the OK band (~3–5), documented in block (h) as accepted-for-Phase-2. Reject
// only the EXPOSED/UNSAFE/DANGEROUS bands (score ≳ 7.5 — the OpenClaw 9.6 class).
export const SECURITY_LIVE_ACCEPTED_MAX = 5.0;
export const SECURITY_REJECT_BANDS = new Set([
	"EXPOSED",
	"UNSAFE",
	"DANGEROUS",
]);

/**
 * Parse a `systemd-analyze security` capture. Returns
 * `{ score, band }` or `null` when the score line is absent.
 */
export function parseSecurityScore(text) {
	const match = SECURITY_SCORE_REGEX.exec(text);
	if (!match) return null;
	return { score: Number.parseFloat(match[1]), band: match[2] };
}

/**
 * Live-capture acceptance used by the opt-in VPS e2e (test 2). The `--strict`
 * gate enforces the hard ≤2.0 TARGET; THIS is the looser accepted-for-Phase-2
 * posture for the real, un-hardened unit (block (h)). A hard ≤2.0 assertion in
 * the e2e would be strictly stronger than the documented acceptance criterion
 * and would false-FAIL on the legitimately-accepted band.
 */
export function isAcceptedLiveScore(
	{ score, band },
	max = SECURITY_LIVE_ACCEPTED_MAX,
) {
	return score <= max && !SECURITY_REJECT_BANDS.has(band);
}

// --- Per-phase configuration ----------------------------------------------

const PHASE_CONFIG = {
	1: {
		defaultFile: resolve(runtimeRoot, "PHASE-1-EVIDENCE.md"),
		// The six evidence sections actually present in PHASE-1-EVIDENCE.md (I4).
		requiredBlocks: [
			{ id: "1. TypeScript build gate", header: "### 1." },
			{ id: "2. Vitest with coverage", header: "### 2." },
			{ id: "3. Hello-world integration test", header: "### 3." },
			{ id: "4. Manual hello-world terminal log", header: "### 4." },
			{ id: "5. Telemetry NDJSON sample", header: "### 5." },
			{ id: "6. Rollback verification", header: "### 6." },
		],
		sentinel: { kind: "regex", value: PHASE1_SENTINEL_RE, label: "PASTE-…" },
		garryExpected: 9,
	},
	2: {
		defaultFile: resolve(runtimeRoot, "PHASE-2-EVIDENCE.md"),
		// 13 lettered evidence blocks (§2 a–m) + the §4 cutover-decisions block.
		// The (m) SIGHUP-reload block (Plan 06 cross-ref) and the (j) NDJSON
		// telemetry block (04b cross-ref) are REQUIRED for Phase 2.
		requiredBlocks: [
			{ id: "(a) Build gate", header: "### (a)" },
			{ id: "(b) Vitest with coverage", header: "### (b)" },
			{ id: "(c) test-cutover.mjs dry-run", header: "### (c)" },
			{ id: "(d) Real cutover terminal log", header: "### (d)" },
			{ id: "(e) Real rollback terminal log", header: "### (e)" },
			{ id: "(f) Telegram screenshot", header: "### (f)" },
			{ id: "(g) journalctl clean startup", header: "### (g)" },
			{ id: "(h) systemd-analyze security score", header: "### (h)" },
			{ id: "(i) systemd-creds decrypt length", header: "### (i)" },
			{ id: "(j) NDJSON telemetry excerpt", header: "### (j)" },
			{ id: "(k) Single daemon process", header: "### (k)" },
			{ id: "(l) OpenClaw is gone", header: "### (l)" },
			{ id: "(m) SIGHUP credential reload", header: "### (m)" },
			{
				id: "(§4) Cutover decisions cross-reference",
				header: "## 4. Cutover decisions",
			},
		],
		sentinel: {
			kind: "literal",
			value: PHASE2_SENTINEL,
			label: PHASE2_SENTINEL,
		},
		garryExpected: 9,
		// §3 (failure-path) and §6 (sign-off) are otherwise enforced ONLY by the
		// every-checkbox count — so DELETING either section (or gutting its boxes)
		// leaves zero unticked boxes and the gate would silently PASS. Require each
		// section's header AND a minimum checkbox count so absence or gutting is a
		// HARD FAIL. (minBoxes = the shipped box counts: §3 has 5 failure-path
		// boxes, §6 has 2 sign-off boxes.)
		requiredCheckboxSections: [
			{ id: "§3 failure-path checklist", header: "## 3.", minBoxes: 5 },
			{ id: "§6 sign-off checklist", header: "## 6.", minBoxes: 2 },
		],
	},
};

// --- Markdown helpers ------------------------------------------------------

/** A markdown header line (## or ###, not deeper #### which we never use here). */
function isHeaderLine(line) {
	return /^#{2,3}\s/.test(line);
}

/**
 * Locate a markdown region whose opening header line satisfies `predicate`.
 * The region spans from that header up to (but excluding) the next ## / ###
 * header, or end-of-file. Returns `{ headerLine, text }` or `null`.
 */
function findRegion(lines, predicate) {
	const startIdx = lines.findIndex(
		(line) => isHeaderLine(line) && predicate(line),
	);
	if (startIdx === -1) return null;
	let endIdx = lines.length;
	for (let i = startIdx + 1; i < lines.length; i++) {
		if (isHeaderLine(lines[i])) {
			endIdx = i;
			break;
		}
	}
	return {
		headerLine: lines[startIdx],
		// Exclude the header line itself from the body (so a `[ ]` in the
		// header does not count toward the Garry checklist, etc.).
		text: lines.slice(startIdx + 1, endIdx).join("\n"),
	};
}

/** True when `text` still contains the (unreplaced) sentinel. */
function hasSentinel(text, sentinel) {
	return sentinel.kind === "literal"
		? text.includes(sentinel.value)
		: sentinel.value.test(text);
}

/**
 * Count the Garry-impressed checklist boxes. Scoped to the section whose header
 * contains "Garry-impressed checklist" so the §3 failure-path and §6 sign-off
 * checkboxes (which share the `- [ ]` syntax) are NOT counted.
 */
function checkGarry(lines, expected) {
	const region = findRegion(lines, (line) =>
		line.includes("Garry-impressed checklist"),
	);
	if (!region) {
		return { ok: false, ticked: 0, total: 0, detail: "section not found" };
	}
	let ticked = 0;
	let unticked = 0;
	for (const line of region.text.split("\n")) {
		if (/^\s*-\s+\[[xX]\]/.test(line)) ticked++;
		else if (/^\s*-\s+\[ \]/.test(line)) unticked++;
	}
	const total = ticked + unticked;
	const ok = unticked === 0 && total === expected;
	let detail = "";
	if (!ok) {
		const missing = expected - total;
		detail = `${ticked}/${expected} ticked, ${unticked} unticked${
			missing > 0 ? `, ${missing} box(es) missing` : ""
		}`;
	}
	return { ok, ticked, total, expected, detail };
}

// A fenced-code-block opener: ≤3 spaces of indent + a run of ≥3 backticks or
// ≥3 tildes, optionally followed by an info string (captured separately so a
// backtick opener carrying a backtick in its info string is rejected, per
// CommonMark). A closer is the same but with ONLY whitespace after the run.
const FENCE_OPEN_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^(\s*)(`{3,}|~{3,})\s*$/;

/**
 * Per-line fenced-code-block classification, shared (DRY) by checkAllCheckboxes
 * and extractCitedPaths so the two can never disagree about what is "in a fence"
 * and a stray/unbalanced fence can never silently INVERT in-fence state for the
 * rest of the document (the naive `inFence = !inFence` toggle did exactly that —
 * one stray ``` flipped every later line, skipping all trailing `- [ ]` boxes and
 * cited paths = a false-PASS on incomplete evidence).
 *
 * CommonMark-ish: an opener is matched, its marker char (backtick or tilde), run
 * length and indent recorded, and it is closed ONLY by a later line with the SAME
 * marker char, a run length ≥ the opener's, indent ≤ the opener's, and nothing
 * but whitespace after the run. Tilde fences and list-indented fences are
 * recognized too.
 *
 * FAIL-SAFE (bias to BLOCK): an opening fence with NO matching closer — a
 * stray/unbalanced backtick pasted into terminal evidence — is treated as
 * NON-fenced from the opener onward, so genuinely-unticked `- [ ]` boxes after it
 * are still COUNTED. The gate must never false-PASS incomplete evidence.
 *
 * Returns one classification per line:
 *   "marker" — a fence opener or closer line (skipped by BOTH consumers)
 *   "fenced" — content strictly inside a properly-closed fence
 *   "text"   — prose, AND any unclosed-fence tail
 */
function classifyFenceLines(rawLines) {
	// CRLF normalization: the evidence files ship with \r\n endings, so a line
	// split on "\n" keeps a trailing \r. FENCE_OPEN_RE's `(.*)$` cannot consume
	// that \r (JS `.` excludes \r and `$` does not match before it), so EVERY
	// fence would be misread as a non-opener and nothing would ever be "fenced"
	// (the old `/^```/` test was \r-tolerant; this stricter scan is not). Strip a
	// trailing \r for classification only — `cls` still indexes 1:1 with the
	// caller's raw array, so consumers keep using their own (possibly \r-tailed)
	// lines unchanged.
	const lines = rawLines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
	const cls = new Array(lines.length).fill("text");
	let i = 0;
	while (i < lines.length) {
		const open = FENCE_OPEN_RE.exec(lines[i]);
		const isOpener =
			open !== null &&
			open[1].length <= 3 &&
			// A backtick opener may not carry a backtick in its info string.
			!(open[2].startsWith("`") && open[3].includes("`"));
		if (!isOpener) {
			i++;
			continue;
		}
		const indent = open[1].length;
		const marker = open[2][0];
		const runLen = open[2].length;
		let close = -1;
		for (let j = i + 1; j < lines.length; j++) {
			const c = FENCE_CLOSE_RE.exec(lines[j]);
			if (
				c !== null &&
				c[2][0] === marker &&
				c[2].length >= runLen &&
				c[1].length <= indent
			) {
				close = j;
				break;
			}
		}
		if (close === -1) {
			// Unclosed/stray opener → fail-safe: leave it (and the rest) as "text".
			i++;
			continue;
		}
		cls[i] = "marker";
		cls[close] = "marker";
		for (let k = i + 1; k < close; k++) cls[k] = "fenced";
		i = close + 1;
	}
	return cls;
}

/**
 * EVERY `- [ ]` markdown task checkbox in the rendered file must be ticked. The
 * Garry checklist is counted separately (checkGarry, exact 9/9); this catches the
 * §3 failure-path (5) and §6 sign-off (2) `- [ ]` boxes that share the syntax.
 * Lines strictly inside a properly-closed fenced code block are skipped (via the
 * shared classifyFenceLines, mirroring extractCitedPaths) so a literal `- [ ]`
 * inside pasted terminal/markdown output never false-FAILs the gate — while an
 * unclosed/stray fence is classified "text" (fail-safe), so trailing real boxes
 * after it are still COUNTED (bias to BLOCK incomplete evidence).
 * (The `### (x) — `[ ]`` per-block status headers are operator-facing visual
 * progress markers, ticked by hand but not gate-enforced — both Phase 1 and
 * Phase 2 use them and the gate treats neither phase's headers as a hard gate.)
 */
function checkAllCheckboxes(content) {
	const lines = content.split("\n");
	const cls = classifyFenceLines(lines);
	const unticked = [];
	for (let i = 0; i < lines.length; i++) {
		if (cls[i] !== "text") continue;
		if (/^\s*-\s+\[ \]/.test(lines[i])) unticked.push(lines[i].trim());
	}
	return { ok: unticked.length === 0, unticked };
}

/**
 * Required-checkbox-section guard. checkAllCheckboxes only flags UNTICKED boxes,
 * so a deleted (or fully gutted) §3 failure-path / §6 sign-off section leaves
 * ZERO unticked boxes and would silently PASS the gate. Assert each configured
 * section's HEADER is present AND it carries at least `minBoxes` task checkboxes
 * (ticked or not), so removing or emptying the section is a HARD FAIL.
 */
function checkRequiredCheckboxSections(lines, sections) {
	const passes = [];
	const failures = [];
	for (const sec of sections) {
		const region = findRegion(lines, (line) => line.startsWith(sec.header));
		if (!region) {
			failures.push(
				`missing required section: ${sec.id} (expected a header starting with "${sec.header}")`,
			);
			continue;
		}
		let count = 0;
		for (const line of region.text.split("\n")) {
			if (/^\s*-\s+\[[ xX]\]/.test(line)) count++;
		}
		if (count < sec.minBoxes) {
			failures.push(
				`required section gutted: ${sec.id} has ${count} checkbox(es), expected ≥ ${sec.minBoxes}`,
			);
		} else {
			passes.push(
				`required section present: ${sec.id} (${count} checkbox(es))`,
			);
		}
	}
	return { passes, failures };
}

// --- Cited-artifact path extraction (C3) -----------------------------------

const ARTIFACT_PATH_RE =
	/runtime\/(?:deploy|migration|agents|scripts|daemon)\/[A-Za-z0-9._/-]+/g;

/**
 * Extract cited artifact paths from ONLY fenced code blocks and `[text](path)`
 * link targets (C3). Prose is deliberately ignored. Uses the shared
 * classifyFenceLines so an unbalanced/stray fence cannot invert in-fence state
 * (it would otherwise start treating prose as fenced — or fenced as prose — and
 * silently drop cited paths from the existence check).
 */
function extractCitedPaths(content) {
	const found = new Set();
	const lines = content.split("\n");
	const cls = classifyFenceLines(lines);
	for (let i = 0; i < lines.length; i++) {
		if (cls[i] !== "fenced") continue;
		for (const m of lines[i].matchAll(ARTIFACT_PATH_RE)) found.add(m[0]);
	}
	// Link targets anywhere in the doc.
	for (const link of content.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
		for (const m of link[1].matchAll(ARTIFACT_PATH_RE)) found.add(m[0]);
	}
	return [...found];
}

/**
 * Strip trailing punctuation / slash / ellipsis so existsSync resolves cleanly.
 * Terminal output frequently prints `path...done` / `path…`; the artifact regex
 * (its char class includes `.`) over-matches the ellipsis (and any following
 * word) into a nonexistent path, so cut at the FIRST run of ≥3 dots before the
 * punctuation/slash trim (a real `..` parent-dir component, only 2 dots, is left
 * intact). A real path followed by an ellipsis then resolves instead of
 * false-FAILing.
 */
function cleanPath(p) {
	return p
		.replace(/\.{3,}.*$/, "")
		.replace(/[).,;:]+$/, "")
		.replace(/\/+$/, "");
}

// --- Strict mode (security score) ------------------------------------------

function runStrict({ content, securitySample }) {
	let text;
	let source;
	if (securitySample) {
		// Explicit live/anonymized capture supplied by the operator.
		source = securitySample;
		try {
			text = readFileSync(securitySample, "utf8");
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			return {
				ok: false,
				detail: `--strict: cannot read security sample ${securitySample}: ${message}`,
			};
		}
	} else {
		// DEFAULT: parse the score straight out of block (h) of the RENDERED
		// evidence file — never a bundled known-good fixture (which would
		// green-pass --strict regardless of the live score in block (h)).
		source = "block (h) of the evidence file";
		const region = findRegion(content.split("\n"), (line) =>
			line.startsWith("### (h)"),
		);
		if (!region) {
			return {
				ok: false,
				detail:
					"--strict: block (h) (systemd-analyze security score) not found in the evidence file",
			};
		}
		text = region.text;
	}
	// Scan EVERY `Overall exposure level …` line in the source, not just the
	// first. block (h) may hold a before/after pair pasted side-by-side; the gate
	// must fail if ANY line is over-exposed, regardless of paste ORDER — a
	// single-match parse would green-pass an UNSAFE line sitting behind an OK one.
	const scoreRe = new RegExp(SECURITY_SCORE_REGEX.source, "gm");
	const parsedAll = [...text.matchAll(scoreRe)].map((m) => ({
		score: Number.parseFloat(m[1]),
		band: m[2],
	}));
	if (parsedAll.length === 0) {
		return {
			ok: false,
			detail:
				`--strict: security-score regex did not match ${source}.\n` +
				`    expected: ${SECURITY_SCORE_REGEX}\n` +
				`    saw:\n${text
					.trim()
					.split("\n")
					.map((l) => `      ${l}`)
					.join("\n")}`,
		};
	}
	const problems = [];
	for (const { score, band } of parsedAll) {
		if (!(score <= SECURITY_SCORE_MAX)) {
			problems.push(`score ${score} exceeds target ${SECURITY_SCORE_MAX}`);
		}
		if (!SECURITY_SAFE_BANDS.has(band)) {
			problems.push(`band ${band} not in {OK, SAFE}`);
		}
	}
	if (problems.length) {
		return {
			ok: false,
			detail: `--strict: ${[...new Set(problems)].join("; ")} (${source})`,
		};
	}
	// Report the worst (highest) score for transparency.
	const worst = parsedAll.reduce((a, b) => (b.score > a.score ? b : a));
	const note = parsedAll.length > 1 ? ` (${parsedAll.length} score lines)` : "";
	return {
		ok: true,
		detail: `--strict: security score ${worst.score} ${worst.band} (≤ ${SECURITY_SCORE_MAX}) from ${source}${note}`,
	};
}

// --- Core check ------------------------------------------------------------

/**
 * Run all checks against `content`. Returns
 * `{ passes: string[], failures: string[] }`.
 */
export function checkEvidence(
	content,
	{ phase = "2", strict = false, securitySample } = {},
) {
	const config = PHASE_CONFIG[phase];
	if (!config) {
		return {
			passes: [],
			failures: [`unknown --phase ${phase} (expected 1 or 2)`],
		};
	}
	const lines = content.split("\n");
	const passes = [];
	const failures = [];

	// (1) Required blocks present + filled.
	for (const block of config.requiredBlocks) {
		const region = findRegion(lines, (line) => line.startsWith(block.header));
		if (!region) {
			failures.push(
				`missing section: ${block.id} (expected a header starting with "${block.header}")`,
			);
			continue;
		}
		if (hasSentinel(region.text, config.sentinel)) {
			failures.push(
				`block not filled (sentinel "${config.sentinel.label}" present): ${block.id}`,
			);
		} else {
			passes.push(`block filled: ${block.id}`);
		}
	}

	// (2) Garry-impressed checklist fully ticked.
	const garry = checkGarry(lines, config.garryExpected);
	if (garry.ok) {
		passes.push(`Garry checklist ${garry.ticked}/${garry.total} ticked`);
	} else {
		failures.push(`Garry checklist incomplete: ${garry.detail}`);
	}

	// (2b) Every OTHER task checkbox (§3 failure-path, §6 sign-off) ticked too —
	// a full Garry section alone is not "every checkbox is [x]".
	const boxes = checkAllCheckboxes(content);
	if (boxes.ok) {
		passes.push("all task checkboxes ticked");
	} else {
		failures.push(
			`unticked task checkbox(es) remain: ${boxes.unticked.length}${
				boxes.unticked[0] ? ` — e.g. "${boxes.unticked[0]}"` : ""
			}`,
		);
	}

	// (2c) Required checkbox-sections present + not gutted. checkAllCheckboxes only
	// flags UNTICKED boxes, so DELETING §3 (failure-path) or §6 (sign-off) leaves
	// zero unticked boxes and would silently PASS — assert each required section's
	// header is present AND carries at least its minimum checkbox count.
	if (config.requiredCheckboxSections) {
		const sections = checkRequiredCheckboxSections(
			lines,
			config.requiredCheckboxSections,
		);
		passes.push(...sections.passes);
		failures.push(...sections.failures);
	}

	// (3) Cited artifacts exist (fenced blocks + link targets only — C3).
	for (const cited of extractCitedPaths(content)) {
		const abs = resolve(repoRoot, cleanPath(cited));
		if (existsSync(abs)) {
			passes.push(`cited artifact exists: ${cited}`);
		} else {
			failures.push(`missing cited artifact: ${cited} (resolved ${abs})`);
		}
	}

	// (4) Strict security-score parse — from block (h) of THIS rendered file by
	// default, or an explicit --security-sample capture if supplied.
	if (strict) {
		const strictResult = runStrict({ content, securitySample });
		if (strictResult.ok) passes.push(strictResult.detail);
		else failures.push(strictResult.detail);
	}

	return { passes, failures };
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv) {
	const opts = { phase: "2", strict: false, file: null, securitySample: null };
	// A value-taking flag must be FOLLOWED by a value, never another flag and
	// never end-of-argv — otherwise `argv[++i]` is `undefined` and the flag fails
	// OPEN (e.g. a dangling `--security-sample` silently dropped its path). Fail
	// CLOSED instead so a typo'd/incomplete flag is surfaced, not swallowed.
	const requireValue = (i, flag) => {
		const value = argv[i + 1];
		if (value === undefined || value.startsWith("--")) {
			throw new Error(`${flag} requires a value`);
		}
		return value;
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--strict") {
			opts.strict = true;
		} else if (arg === "--phase") {
			opts.phase = requireValue(i, "--phase");
			i++;
		} else if (arg.startsWith("--phase=")) {
			opts.phase = arg.slice("--phase=".length);
		} else if (arg === "--security-sample") {
			opts.securitySample = requireValue(i, "--security-sample");
			i++;
		} else if (arg.startsWith("--security-sample=")) {
			// The equals-form must fail CLOSED on an EMPTY value exactly like the
			// space-separated form — an empty string is falsy and would silently
			// fall back to parsing block (h) (a value-takes-no-value escape hatch).
			const value = arg.slice("--security-sample=".length);
			if (value === "") {
				throw new Error("--security-sample requires a value");
			}
			opts.securitySample = value;
		} else if (arg.startsWith("--")) {
			throw new Error(`unknown flag: ${arg}`);
		} else {
			opts.file = arg;
		}
	}
	return opts;
}

function main() {
	let opts;
	try {
		opts = parseArgs(process.argv.slice(2));
	} catch (err) {
		process.stderr.write(`FAIL: ${err.message}\n`);
		process.exit(2);
	}

	const config = PHASE_CONFIG[opts.phase];
	if (!config) {
		process.stderr.write(
			`FAIL: unknown --phase ${opts.phase} (expected 1 or 2)\n`,
		);
		process.exit(2);
	}

	const target = opts.file
		? resolve(process.cwd(), opts.file)
		: config.defaultFile;

	let content;
	try {
		content = readFileSync(target, "utf8");
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		process.stderr.write(`FAIL: could not read ${target}: ${message}\n`);
		process.exit(2);
	}

	const { passes, failures } = checkEvidence(content, {
		phase: opts.phase,
		strict: opts.strict,
		securitySample: opts.securitySample,
	});

	const out = process.stdout;
	if (failures.length === 0) {
		out.write(`PASS — ${target} (phase ${opts.phase})\n`);
		for (const p of passes) out.write(`  ✓ ${p}\n`);
		out.write(`checks passed: ${passes.length}\n`);
		process.exit(0);
	}

	out.write(`FAIL — ${target} (phase ${opts.phase})\n`);
	for (const f of failures) out.write(`  ✗ ${f}\n`);
	out.write(
		`checks passed: ${passes.length}, failed: ${failures.length}\nFill every block (replace the sentinel with real evidence), tick all\nGarry boxes, and ensure every cited artifact path exists.\n`,
	);
	process.exit(1);
}

// Run the CLI only when invoked directly — importing this module (e.g. from
// phase-2-vps.test.ts for the shared security-score helper) must NOT exit.
const invokedDirectly =
	process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
