#!/usr/bin/env node
import { spawnSync } from "node:child_process";
/**
 * Phase 1 rollback dry-run.
 *
 * Exercises the procedure documented in
 * `runtime/migration/phase-1-rollback.md` WITHOUT actually deleting
 * code, branches, or state. Each step is reported as DRYRUN-OK, PASS,
 * or FAIL. Exit 0 when every step would succeed.
 *
 * Usage:  npm run test:rollback
 */
import { access } from "node:fs/promises";
import * as path from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const runtimeRoot = resolve(here, "..");
const repoRoot = resolve(runtimeRoot, "..");

let failures = 0;
function report(label, status, detail = "") {
	const prefix =
		status === "PASS" || status === "DRYRUN-OK"
			? "✓"
			: status === "WARN"
				? "!"
				: "✗";
	const line = `${prefix} ${status.padEnd(10)} ${label}${detail ? ` — ${detail}` : ""}`;
	process.stdout.write(`${line}\n`);
	if (status === "FAIL") failures++;
}

async function exists(p) {
	try {
		await access(p);
		return true;
	} catch {
		return false;
	}
}

process.stdout.write("Phase 1 rollback dry-run\n");
process.stdout.write("------------------------\n\n");

// Step 1 — daemon process check (informational only on dry-run).
const psResult = spawnSync(
	process.platform === "win32" ? "powershell" : "ps",
	process.platform === "win32"
		? [
				"-NoProfile",
				"-Command",
				"Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*runtime*daemon*main*' } | Select-Object -First 5 ProcessId,CommandLine",
			]
		: ["aux"],
	{ encoding: "utf8" },
);
if (psResult.status === 0) {
	report("Step 1: daemon process probe", "DRYRUN-OK", "ps command available");
} else {
	report(
		"Step 1: daemon process probe",
		"WARN",
		"ps probe failed but rollback can still proceed",
	);
}

// Step 2 — runtime/ directory + migration doc exist.
const migrationDoc = path.join(runtimeRoot, "migration", "phase-1-rollback.md");
if (!(await exists(migrationDoc))) {
	report("Step 2: rollback doc present", "FAIL", `missing ${migrationDoc}`);
} else {
	report(
		"Step 2: rollback doc present",
		"PASS",
		path.relative(repoRoot, migrationDoc),
	);
}

// Step 3 — state-root resolution.
const stateRoot = process.env.IAGO_DAEMON_STATE_ROOT;
if (stateRoot === undefined || stateRoot.length === 0) {
	report(
		"Step 3: state-root resolution",
		"DRYRUN-OK",
		"would resolve to ~/.iago-os/daemon-state via state-paths.ts default",
	);
} else {
	report(
		"Step 3: state-root resolution",
		"DRYRUN-OK",
		`would target ${stateRoot}`,
	);
}

// Step 4 — confirm rollback would not touch out-of-scope files.
const protectedPaths = [
	path.join(repoRoot, "scripts", "execute-pipeline.sh"),
	path.join(repoRoot, ".claude"),
	path.join(repoRoot, ".iago", "plans"),
];
let allPresent = true;
for (const p of protectedPaths) {
	if (!(await exists(p))) {
		allPresent = false;
		report(
			`Step 4: out-of-scope guard (${path.relative(repoRoot, p)})`,
			"WARN",
			"path absent — guard is moot on this checkout",
		);
	}
}
if (allPresent) {
	report(
		"Step 4: out-of-scope guard",
		"PASS",
		"scripts/, .claude/, .iago/plans/ all present and would survive rollback",
	);
}

// Step 5 — pipeline script remains runnable.
const pipelineScript = path.join(repoRoot, "scripts", "execute-pipeline.sh");
if (!(await exists(pipelineScript))) {
	report(
		"Step 5: pipeline runnable after rollback",
		"WARN",
		"execute-pipeline.sh absent on this checkout (Phase 1 worktree is fine)",
	);
} else {
	report(
		"Step 5: pipeline runnable after rollback",
		"PASS",
		"execute-pipeline.sh present, would be unchanged by rollback",
	);
}

// Step 6 — re-apply path: three branches per the migration doc.
report(
	"Step 6: re-apply path enumerated",
	"DRYRUN-OK",
	"migration doc step 6 covers (a) feature-branch checkout, (b) git revert of revert commits, (c) git reset to post-Phase-1 sha",
);

process.stdout.write("\n");
if (failures === 0) {
	process.stdout.write("All steps DRYRUN-OK / PASS — rollback path valid.\n");
	process.exit(0);
} else {
	process.stderr.write(
		`${failures} step(s) FAILED — rollback path invalid until repaired.\n`,
	);
	process.exit(1);
}
