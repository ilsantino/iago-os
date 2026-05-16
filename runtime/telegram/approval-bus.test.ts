import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ensureStateDirsSync, pathFor } from "../daemon/state-paths.js";
import {
	createApprovalRequest,
	listPendingApprovals,
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
			resolveApproval(approvalId, i % 2 === 0 ? "allow" : "deny", `caller-${i}`),
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
