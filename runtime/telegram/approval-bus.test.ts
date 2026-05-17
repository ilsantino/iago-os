import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensureStateDirsSync, pathFor } from "../daemon/state-paths.js";
import {
	createApprovalRequest,
	isValidApprovalId,
	listInflightApprovals,
	listPendingApprovals,
	recoverStrandedApprovals,
	resolveApproval,
	waitForApproval,
} from "./approval-bus.js";

let tempDir: string;

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-approval-bus-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("approval-bus / createApprovalRequest", () => {
	it("writes a pending file with all expected fields", async () => {
		const before = Date.now();
		const { approvalId, pendingPath } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "handle-1",
			reason: "needs human go-ahead",
			ttlMs: 60_000,
		});
		const after = Date.now();

		expect(typeof approvalId).toBe("string");
		expect(approvalId.length).toBeGreaterThan(0);
		expect(pendingPath).toBe(
			path.join(pathFor("approvals/pending"), `${approvalId}.json`),
		);

		const raw = await fsp.readFile(pendingPath, "utf8");
		const parsed = JSON.parse(raw);
		expect(parsed.approvalId).toBe(approvalId);
		expect(parsed.agentId).toBe("agent-foo");
		expect(parsed.handleId).toBe("handle-1");
		expect(parsed.reason).toBe("needs human go-ahead");
		expect(parsed.createdAt).toBeGreaterThanOrEqual(before);
		expect(parsed.createdAt).toBeLessThanOrEqual(after);
		expect(parsed.expiresAt).toBeGreaterThanOrEqual(before + 60_000);
	});
});

describe("approval-bus / resolveApproval", () => {
	it("happy path: pending file deleted, resolved file present, decision data correct", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		const before = Date.now();
		const result = await resolveApproval(approvalId, "allow", "santiago");
		const after = Date.now();

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");

		const pendingPath = path.join(
			pathFor("approvals/pending"),
			`${approvalId}.json`,
		);
		await expect(fsp.access(pendingPath)).rejects.toBeDefined();

		const resolvedRaw = await fsp.readFile(result.resolvedPath, "utf8");
		const decision = JSON.parse(resolvedRaw);
		expect(decision.approvalId).toBe(approvalId);
		expect(decision.decision).toBe("allow");
		expect(decision.resolvedBy).toBe("santiago");
		expect(decision.resolvedAt).toBeGreaterThanOrEqual(before);
		expect(decision.resolvedAt).toBeLessThanOrEqual(after);
	});

	it("returns already-resolved when called twice on the same id", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		const first = await resolveApproval(approvalId, "allow", "santiago");
		expect(first.ok).toBe(true);

		const second = await resolveApproval(approvalId, "deny", "santiago");
		expect(second.ok).toBe(false);
		if (!second.ok) {
			expect(second.reason).toBe("already-resolved");
		}
	});

	it("returns not-found when the approvalId was never created", async () => {
		const result = await resolveApproval(
			"00000000-0000-0000-0000-000000000000",
			"allow",
			"santiago",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("not-found");
		}
	});
});

describe("approval-bus / waitForApproval", () => {
	it("returns the decision once resolveApproval is called concurrently", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		const start = Date.now();
		const [waitResult] = await Promise.all([
			waitForApproval(approvalId, 1000, 25),
			(async () => {
				await new Promise((r) => setTimeout(r, 50));
				await resolveApproval(approvalId, "allow", "santiago");
			})(),
		]);
		const elapsed = Date.now() - start;

		expect(elapsed).toBeLessThan(1000);
		expect("decision" in waitResult).toBe(true);
		if ("decision" in waitResult) {
			expect(waitResult.decision).toBe("allow");
			expect(waitResult.approvalId).toBe(approvalId);
			expect(waitResult.resolvedBy).toBe("santiago");
		}
	});

	it("returns { timedOut: true } after timeoutMs elapses", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		const start = Date.now();
		const result = await waitForApproval(approvalId, 150, 25);
		const elapsed = Date.now() - start;

		expect("timedOut" in result).toBe(true);
		if ("timedOut" in result) {
			expect(result.timedOut).toBe(true);
		}
		expect(elapsed).toBeGreaterThanOrEqual(140);
	});

	it("pending file persists after timeout (ghost-detection invariant)", async () => {
		const { approvalId, pendingPath } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		await waitForApproval(approvalId, 100, 25);

		// The pending file must still exist — ghost detection relies on it.
		const stat = await fsp.stat(pendingPath).catch(() => null);
		expect(stat).not.toBeNull();
	});

	it("caller can resolve after timeout to clean up orphan pending file", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		await waitForApproval(approvalId, 100, 25);

		// Caller-cleanup pattern: deny with a system-timeout sentinel.
		const cleanup = await resolveApproval(approvalId, "deny", "system-timeout");
		expect(cleanup.ok).toBe(true);
	});
});

describe("approval-bus / listPendingApprovals", () => {
	it("returns all written-but-unresolved approvals", async () => {
		const { approvalId: a } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-a",
			reason: "deploy?",
		});
		const { approvalId: b } = await createApprovalRequest({
			agentId: "agent-bar",
			handleId: "h-b",
			reason: "rollback?",
		});
		const { approvalId: c } = await createApprovalRequest({
			agentId: "agent-baz",
			handleId: "h-c",
			reason: "purge cache?",
		});

		await resolveApproval(b, "allow", "santiago");

		const pending = await listPendingApprovals();
		const ids = new Set(pending.map((p) => p.approvalId));
		expect(ids.has(a)).toBe(true);
		expect(ids.has(c)).toBe(true);
		expect(ids.has(b)).toBe(false);
		expect(pending).toHaveLength(2);
	});

	it("returns empty array when the pending dir is empty", async () => {
		const pending = await listPendingApprovals();
		expect(pending).toEqual([]);
	});
});

describe("approval-bus / concurrent resolveApproval", () => {
	it("exactly one of N concurrent resolves succeeds", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		const N = 10;
		const calls = Array.from({ length: N }, (_, i) =>
			resolveApproval(
				approvalId,
				i % 2 === 0 ? "allow" : "deny",
				`caller-${i}`,
			),
		);
		const results = await Promise.all(calls);

		const oks = results.filter((r) => r.ok === true);
		const fails = results.filter((r) => r.ok === false);
		expect(oks.length).toBe(1);
		expect(fails.length).toBe(N - 1);
		for (const f of fails) {
			if (!f.ok) {
				expect(f.reason).toBe("already-resolved");
			}
		}
	});
});

// PR45 CRITICAL — approvalId validation closes path-traversal surface
describe("approval-bus / approvalId validation (PR45 security fix)", () => {
	it("isValidApprovalId accepts UUID v4 format from crypto.randomUUID()", () => {
		expect(isValidApprovalId("11111111-2222-4333-8444-555555555555")).toBe(
			true,
		);
		expect(isValidApprovalId("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(
			true,
		);
	});

	it("isValidApprovalId rejects path-traversal payloads", () => {
		expect(isValidApprovalId("../../agents/foo")).toBe(false);
		expect(isValidApprovalId("../../etc/passwd")).toBe(false);
		expect(isValidApprovalId("foo/bar")).toBe(false);
		expect(isValidApprovalId("foo\\bar")).toBe(false);
		expect(isValidApprovalId("..")).toBe(false);
	});

	it("isValidApprovalId rejects non-UUID strings", () => {
		expect(isValidApprovalId("abc123")).toBe(false);
		expect(isValidApprovalId("")).toBe(false);
		expect(isValidApprovalId("xyz")).toBe(false);
		expect(
			isValidApprovalId("11111111-2222-4333-8444-555555555555.extra"),
		).toBe(false);
		// UUID with NUL byte
		expect(isValidApprovalId("11111111-2222-4333-8444-555555555555\0")).toBe(
			false,
		);
	});

	it("isValidApprovalId rejects non-string inputs", () => {
		expect(isValidApprovalId(undefined)).toBe(false);
		expect(isValidApprovalId(null)).toBe(false);
		expect(isValidApprovalId(123)).toBe(false);
		expect(isValidApprovalId({})).toBe(false);
	});

	it("resolveApproval('../../agents/foo', ...) returns invalid-id WITHOUT touching the filesystem", async () => {
		const result = await resolveApproval(
			"../../agents/foo",
			"allow",
			"santiago",
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("invalid-id");
		}
		// Confirm: no file was created outside approvals/
		const escapedPath = path.join(pathFor("agents"), "foo.json");
		await expect(fsp.access(escapedPath)).rejects.toBeDefined();
	});

	it("resolveApproval('not-a-uuid', ...) returns invalid-id", async () => {
		const result = await resolveApproval("abc123", "allow", "santiago");
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("invalid-id");
		}
	});
});

// PR45 HIGH (Codex) — no-strand approval resolution
describe("approval-bus / no-strand resolution (PR45 Codex HIGH fix)", () => {
	it("happy path: inflight file is removed after resolved is durably written", async () => {
		const { approvalId } = await createApprovalRequest({
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
		});

		const result = await resolveApproval(approvalId, "allow", "santiago");
		expect(result.ok).toBe(true);

		const inflightPath = path.join(
			pathFor("approvals/pending"),
			"..",
			"inflight",
			`${approvalId}.json`,
		);
		// inflight directory may not even exist or may be empty
		await expect(fsp.access(inflightPath)).rejects.toBeDefined();
	});

	it("listInflightApprovals returns empty when no crashed approvals exist", async () => {
		const result = await listInflightApprovals();
		expect(result).toEqual([]);
	});

	it("listInflightApprovals surfaces stranded inflight files for boot recovery", async () => {
		// Simulate a crash between phases (a) and (b) by creating an inflight
		// file directly. The previous-impl strand-window bug would have lost
		// this approval entirely.
		const approvalId = "33333333-4444-4555-8666-777777777777";
		const inflightDir = path.join(
			pathFor("approvals/pending"),
			"..",
			"inflight",
		);
		await fsp.mkdir(inflightDir, { recursive: true });
		const inflightPath = path.join(inflightDir, `${approvalId}.json`);
		const envelope = {
			approvalId,
			agentId: "agent-foo",
			handleId: "h-1",
			reason: "deploy?",
			createdAt: Date.now(),
		};
		await fsp.writeFile(inflightPath, JSON.stringify(envelope), "utf8");

		const recovered = await listInflightApprovals();
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.approvalId).toBe(approvalId);
		expect(recovered[0]?.agentId).toBe("agent-foo");
	});
});

// PR48 HIGH (Codex) — dual-presence + inflight-only stranded recovery
//
// Codex flagged that the `atomicRename` claim primitive can leave the
// approvalId in a stranded state if the daemon crashes between
// `link(2)` (publishes inflight) and `unlink(2)` (removes pending).
// The crash leaves a hardlink pair (pending + inflight both refer to
// the same inode) with no `resolved` file. A fresh `resolveApproval`
// call arriving in this state would, in the pre-fix implementation,
// fail the strict CLAIM rename with EEXIST, observe inflight, poll
// vainly for the never-coming resolved file, and finally return
// `already-resolved` — silently absorbing the user's new decision.
//
// The fix: (a) `resolveApproval` itself rolls forward when it observes
// a stranded inflight by taking ownership and publishing the current
// caller's decision; (b) `recoverStrandedApprovals()` reconciles
// dual-presence + inflight-only states at daemon boot before the
// Telegram bot resumes polling.
describe("approval-bus / dual-presence stranded recovery (PR48 Codex HIGH)", () => {
	const inflightSubdir = (): string =>
		path.join(pathFor("approvals/pending"), "..", "inflight");

	async function simulateDualPresence(approvalId: string): Promise<{
		pendingPath: string;
		inflightPath: string;
	}> {
		// Build a real hardlink pair the same way a mid-CLAIM crash would.
		const envelope = {
			approvalId,
			agentId: "agent-foo",
			handleId: "h-stranded",
			reason: "needs human go-ahead",
			createdAt: Date.now(),
		};
		const pendingPath = path.join(
			pathFor("approvals/pending"),
			`${approvalId}.json`,
		);
		await fsp.mkdir(path.dirname(pendingPath), { recursive: true });
		await fsp.writeFile(pendingPath, JSON.stringify(envelope), "utf8");
		const dir = inflightSubdir();
		await fsp.mkdir(dir, { recursive: true });
		const inflightPath = path.join(dir, `${approvalId}.json`);
		await fsp.link(pendingPath, inflightPath);
		return { pendingPath, inflightPath };
	}

	async function simulateInflightOnly(approvalId: string): Promise<string> {
		const envelope = {
			approvalId,
			agentId: "agent-foo",
			handleId: "h-stranded",
			reason: "needs human go-ahead",
			createdAt: Date.now(),
		};
		const dir = inflightSubdir();
		await fsp.mkdir(dir, { recursive: true });
		const inflightPath = path.join(dir, `${approvalId}.json`);
		await fsp.writeFile(inflightPath, JSON.stringify(envelope), "utf8");
		return inflightPath;
	}

	it("resolveApproval rolls forward when pending + inflight both exist (no resolved)", async () => {
		const approvalId = "44444444-1111-4222-8333-444444444444";
		const { pendingPath, inflightPath } =
			await simulateDualPresence(approvalId);

		// Pre-conditions
		await expect(fsp.access(pendingPath)).resolves.toBeUndefined();
		await expect(fsp.access(inflightPath)).resolves.toBeUndefined();

		const result = await resolveApproval(approvalId, "allow", "santiago");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");

		// Post: resolved file exists with our decision
		const resolvedRaw = await fsp.readFile(result.resolvedPath, "utf8");
		const decision = JSON.parse(resolvedRaw);
		expect(decision.approvalId).toBe(approvalId);
		expect(decision.decision).toBe("allow");
		expect(decision.resolvedBy).toBe("santiago");

		// Post: pending hardlink cleaned up, inflight cleaned up
		await expect(fsp.access(pendingPath)).rejects.toBeDefined();
		await expect(fsp.access(inflightPath)).rejects.toBeDefined();
	});

	it("resolveApproval rolls forward when only inflight exists (CLAIM-then-crash)", async () => {
		const approvalId = "55555555-1111-4222-8333-555555555555";
		const inflightPath = await simulateInflightOnly(approvalId);

		const result = await resolveApproval(approvalId, "deny", "santiago");

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error("expected ok");

		const resolvedRaw = await fsp.readFile(result.resolvedPath, "utf8");
		const decision = JSON.parse(resolvedRaw);
		expect(decision.decision).toBe("deny");
		expect(decision.resolvedBy).toBe("santiago");

		// inflight cleaned up after resolved committed
		await expect(fsp.access(inflightPath)).rejects.toBeDefined();
	});

	it("recoverStrandedApprovals unlinks inflight hardlink on dual-presence; pending preserved", async () => {
		const approvalId = "66666666-1111-4222-8333-666666666666";
		const { pendingPath, inflightPath } =
			await simulateDualPresence(approvalId);

		const report = await recoverStrandedApprovals();

		expect(report.cleaned).toContain(approvalId);
		expect(report.republished).toEqual([]);
		expect(report.resolvedSurvived).toEqual([]);
		expect(report.failed).toEqual([]);

		// pending preserved for re-broadcast
		await expect(fsp.access(pendingPath)).resolves.toBeUndefined();
		// inflight hardlink removed
		await expect(fsp.access(inflightPath)).rejects.toBeDefined();

		// The recovered pending must be re-resolvable through the normal CLAIM path
		const followUp = await resolveApproval(approvalId, "allow", "santiago");
		expect(followUp.ok).toBe(true);
	});

	it("recoverStrandedApprovals re-publishes inflight-only entries back to pending", async () => {
		const approvalId = "77777777-1111-4222-8333-777777777777";
		const inflightPath = await simulateInflightOnly(approvalId);

		const report = await recoverStrandedApprovals();

		expect(report.republished).toContain(approvalId);
		expect(report.cleaned).toEqual([]);
		expect(report.resolvedSurvived).toEqual([]);
		expect(report.failed).toEqual([]);

		// inflight gone, pending restored with the same envelope
		await expect(fsp.access(inflightPath)).rejects.toBeDefined();
		const pendingPath = path.join(
			pathFor("approvals/pending"),
			`${approvalId}.json`,
		);
		const raw = await fsp.readFile(pendingPath, "utf8");
		const env = JSON.parse(raw);
		expect(env.approvalId).toBe(approvalId);
		expect(env.handleId).toBe("h-stranded");

		// And it must still be resolvable through the normal CLAIM path
		const followUp = await resolveApproval(approvalId, "deny", "santiago");
		expect(followUp.ok).toBe(true);
	});

	it("recoverStrandedApprovals cleans inflight when resolved already exists; resolved wins", async () => {
		const approvalId = "88888888-1111-4222-8333-888888888888";
		const { pendingPath, inflightPath } =
			await simulateDualPresence(approvalId);

		// Pretend a prior resolved write committed before the crash but the
		// inflight cleanup never ran.
		const resolvedDir = pathFor("approvals/resolved");
		await fsp.mkdir(resolvedDir, { recursive: true });
		const resolvedPath = path.join(resolvedDir, `${approvalId}.json`);
		const decision = {
			approvalId,
			decision: "allow",
			resolvedBy: "santiago",
			resolvedAt: Date.now(),
		};
		await fsp.writeFile(resolvedPath, JSON.stringify(decision), "utf8");

		const report = await recoverStrandedApprovals();

		expect(report.resolvedSurvived).toContain(approvalId);
		expect(report.cleaned).toEqual([]);
		expect(report.republished).toEqual([]);

		await expect(fsp.access(inflightPath)).rejects.toBeDefined();
		await expect(fsp.access(pendingPath)).rejects.toBeDefined();
		await expect(fsp.access(resolvedPath)).resolves.toBeUndefined();

		// Subsequent resolveApproval is correctly rejected as already-resolved
		const followUp = await resolveApproval(approvalId, "deny", "santiago");
		expect(followUp.ok).toBe(false);
		if (!followUp.ok) {
			expect(followUp.reason).toBe("already-resolved");
		}
	});

	it("recoverStrandedApprovals is idempotent — second run is a no-op", async () => {
		const approvalId = "99999999-1111-4222-8333-999999999999";
		await simulateInflightOnly(approvalId);

		const first = await recoverStrandedApprovals();
		expect(first.republished).toContain(approvalId);

		const second = await recoverStrandedApprovals();
		expect(second.republished).toEqual([]);
		expect(second.cleaned).toEqual([]);
		expect(second.resolvedSurvived).toEqual([]);
		expect(second.failed).toEqual([]);
	});

	it("recoverStrandedApprovals returns empty report when inflight dir is absent", async () => {
		// Fresh tempDir already calls ensureStateDirsSync which creates
		// approvals/pending and approvals/resolved but NOT approvals/inflight
		// (the inflight subdir is created lazily by createApprovalRequest's
		// flow). Confirm graceful no-op.
		const dir = inflightSubdir();
		await fsp.rm(dir, { recursive: true, force: true });

		const report = await recoverStrandedApprovals();
		expect(report).toEqual({
			republished: [],
			cleaned: [],
			resolvedSurvived: [],
			failed: [],
		});
	});
});

// PR45 IMPORTANT — listPendingApprovals must surface malformed files
describe("approval-bus / listPendingApprovals malformed-file handling (PR45)", () => {
	it("logs to stderr and skips malformed JSON files (no silent loss)", async () => {
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		// Good entry
		const { approvalId: good } = await createApprovalRequest({
			agentId: "agent-good",
			handleId: "h-good",
			reason: "deploy?",
		});

		// Malformed entry: bogus filename (not UUID)
		const badPath = path.join(pathFor("approvals/pending"), "not-a-uuid.json");
		await fsp.writeFile(badPath, "not valid json {", "utf8");

		// Half-written entry: UUID name but corrupt JSON
		const halfWritten = "99999999-8888-4777-8666-555555555555";
		const halfPath = path.join(
			pathFor("approvals/pending"),
			`${halfWritten}.json`,
		);
		await fsp.writeFile(halfPath, "{ partial", "utf8");

		const pending = await listPendingApprovals();
		expect(pending).toHaveLength(1);
		expect(pending[0]?.approvalId).toBe(good);
		expect(errSpy).toHaveBeenCalled();
		// Confirm at least one error mentions skip / malformed / parse
		const allLogs = errSpy.mock.calls.map((c) => String(c[0])).join("\n");
		expect(allLogs).toMatch(/skip|malformed|parse|non-UUID/i);
	});
});
