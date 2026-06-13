import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	claimTask,
	readClaim,
	readResolvedOutput,
	reclaimIfStale,
	writeResolvedOutput,
} from "./file-bus.js";
import { ensureStateDirsSync, pathFor } from "./state-paths.js";

let tempDir: string;

async function makePendingTask(taskId: string): Promise<void> {
	const pendingPath = path.join(pathFor("tasks/pending"), `${taskId}.json`);
	await fsp.writeFile(pendingPath, JSON.stringify({ taskId }));
}

beforeEach(async () => {
	tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "iago-file-bus-"));
	process.env.IAGO_DAEMON_STATE_ROOT = tempDir;
	ensureStateDirsSync();
});

afterEach(async () => {
	delete process.env.IAGO_DAEMON_STATE_ROOT;
	await fsp.rm(tempDir, { recursive: true, force: true });
});

describe("file-bus / claimTask", () => {
	it("first claim of a fresh task succeeds", async () => {
		await makePendingTask("t-1");
		const result = await claimTask({
			taskId: "t-1",
			ownerId: "owner-A",
			attemptId: "attempt-1",
		});
		expect(result.claimed).toBe(true);
		if (result.claimed) {
			expect(result.ownerId).toBe("owner-A");
			expect(result.attemptId).toBe("attempt-1");
			expect(path.isAbsolute(result.claimPath)).toBe(true);
		}
	});

	it("second claim of the same task returns already-claimed", async () => {
		await makePendingTask("t-2");
		const first = await claimTask({
			taskId: "t-2",
			ownerId: "owner-A",
			attemptId: "attempt-1",
		});
		expect(first.claimed).toBe(true);

		const second = await claimTask({
			taskId: "t-2",
			ownerId: "owner-B",
			attemptId: "attempt-1",
		});
		expect(second.claimed).toBe(false);
		if (!second.claimed) {
			expect(second.reason).toBe("already-claimed");
			expect(second.existingOwnerId).toBe("owner-A");
		}
	});

	it("readClaim returns the original ownerId / attemptId after a successful claim", async () => {
		await makePendingTask("t-3");
		await claimTask({
			taskId: "t-3",
			ownerId: "owner-X",
			attemptId: "attempt-7",
		});
		const claim = await readClaim("t-3");
		expect(claim).not.toBeNull();
		expect(claim?.ownerId).toBe("owner-X");
		expect(claim?.attemptId).toBe("attempt-7");
		expect(typeof claim?.claimedAt).toBe("number");
	});

	it("two concurrent claims from distinct owners — exactly one succeeds", async () => {
		await makePendingTask("t-race");
		const [a, b] = await Promise.all([
			claimTask({
				taskId: "t-race",
				ownerId: "owner-A",
				attemptId: "1",
			}),
			claimTask({
				taskId: "t-race",
				ownerId: "owner-B",
				attemptId: "1",
			}),
		]);
		const winners = [a, b].filter((r) => r.claimed === true);
		const losers = [a, b].filter((r) => r.claimed === false);
		expect(winners).toHaveLength(1);
		expect(losers).toHaveLength(1);
		const loser = losers[0];
		if (loser !== undefined && !loser.claimed) {
			expect(loser.reason).toBe("already-claimed");
		}
	});
});

describe("file-bus / writeResolvedOutput", () => {
	it("matching owner publishes atomically — temp gone, final present", async () => {
		await makePendingTask("t-4");
		await claimTask({
			taskId: "t-4",
			ownerId: "owner-A",
			attemptId: "1",
		});
		const result = await writeResolvedOutput({
			taskId: "t-4",
			ownerId: "owner-A",
			attemptId: "1",
			result: { status: "ok", value: 42 },
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.finalPath).toBe(
				path.join(pathFor("tasks/resolved"), "t-4.json"),
			);
			await expect(fsp.stat(result.finalPath)).resolves.toBeTruthy();
		}
		const tmpPath = path.join(pathFor("tasks/resolved"), ".t-4.tmp");
		await expect(fsp.stat(tmpPath)).rejects.toThrow();
	});

	it("mismatched owner returns owner-mismatch and does NOT write the final file", async () => {
		await makePendingTask("t-5");
		await claimTask({
			taskId: "t-5",
			ownerId: "owner-A",
			attemptId: "1",
		});
		const result = await writeResolvedOutput({
			taskId: "t-5",
			ownerId: "owner-IMPOSTOR",
			attemptId: "1",
			result: { hijack: true },
		});
		expect(result.ok).toBe(false);
		if (!result.ok && result.reason === "owner-mismatch") {
			expect(result.expectedOwnerId).toBe("owner-A");
		} else {
			throw new Error(`expected owner-mismatch, got ${JSON.stringify(result)}`);
		}
		const finalPath = path.join(pathFor("tasks/resolved"), "t-5.json");
		await expect(fsp.stat(finalPath)).rejects.toThrow();
	});

	it("writeResolvedOutput cleans up tmp file when atomicRename fails", async () => {
		await makePendingTask("t-tmp-cleanup");
		await claimTask({
			taskId: "t-tmp-cleanup",
			ownerId: "owner-A",
			attemptId: "1",
		});
		// Plant a directory at the final path so rename(file → dir) fails on
		// every platform; on Windows the unlink-fallback also fails.
		const finalPath = path.join(pathFor("tasks/resolved"), "t-tmp-cleanup.json");
		await fsp.mkdir(finalPath);

		await expect(
			writeResolvedOutput({
				taskId: "t-tmp-cleanup",
				ownerId: "owner-A",
				attemptId: "1",
				result: { v: 1 },
			}),
		).rejects.toThrow();

		// Tmp file MUST have been unlinked despite the rename failure.
		const tmpPath = path.join(pathFor("tasks/resolved"), ".t-tmp-cleanup.tmp");
		await expect(fsp.stat(tmpPath)).rejects.toThrow();
	});

	it("returns no-claim when no prior claim file exists", async () => {
		const result = await writeResolvedOutput({
			taskId: "t-noclaim",
			ownerId: "owner-A",
			attemptId: "1",
			result: { v: 1 },
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("no-claim");
		}
	});

	it("rename-over-existing: second write replaces published file content", async () => {
		await makePendingTask("t-overwrite");
		await claimTask({
			taskId: "t-overwrite",
			ownerId: "owner-A",
			attemptId: "1",
		});
		const r1 = await writeResolvedOutput({
			taskId: "t-overwrite",
			ownerId: "owner-A",
			attemptId: "1",
			result: { v: 1 },
		});
		expect(r1.ok).toBe(true);
		const r2 = await writeResolvedOutput({
			taskId: "t-overwrite",
			ownerId: "owner-A",
			attemptId: "1",
			result: { v: 2 },
		});
		expect(r2.ok).toBe(true);
		const out = await readResolvedOutput("t-overwrite");
		expect(out).not.toBeNull();
		const v = (out?.result as { v?: number } | undefined)?.v;
		expect(v).toBe(2);
	});

	it("readResolvedOutput round-trips a complex result (nulls, nested arrays, ISO dates)", async () => {
		await makePendingTask("t-complex");
		await claimTask({
			taskId: "t-complex",
			ownerId: "owner-A",
			attemptId: "attempt-2",
		});
		const isoDate = new Date(0).toISOString();
		const complex = {
			nullField: null,
			nestedArray: [[1, 2, 3], ["a", "b"], [{ deep: true }]],
			isoDate,
			emptyObject: {},
		};
		await writeResolvedOutput({
			taskId: "t-complex",
			ownerId: "owner-A",
			attemptId: "attempt-2",
			result: complex,
		});
		const out = await readResolvedOutput("t-complex");
		expect(out).not.toBeNull();
		expect(out?.ownerId).toBe("owner-A");
		expect(out?.attemptId).toBe("attempt-2");
		expect(out?.result).toEqual(complex);
		expect(typeof out?.completedAt).toBe("number");
	});

	it("readResolvedOutput returns null when the file is absent or malformed", async () => {
		expect(await readResolvedOutput("never-existed")).toBeNull();

		// Manually plant a malformed resolved file and assert null.
		const malformedPath = path.join(
			pathFor("tasks/resolved"),
			"t-malformed.json",
		);
		await fsp.writeFile(malformedPath, "{not valid json");
		expect(await readResolvedOutput("t-malformed")).toBeNull();

		// Plant a syntactically-valid JSON whose shape is wrong → null.
		const wrongShapePath = path.join(
			pathFor("tasks/resolved"),
			"t-wrongshape.json",
		);
		await fsp.writeFile(wrongShapePath, JSON.stringify({ unrelated: true }));
		expect(await readResolvedOutput("t-wrongshape")).toBeNull();
	});
});

describe("file-bus / reclaimIfStale", () => {
	it("returns false when no claim file exists", async () => {
		expect(await reclaimIfStale("never-claimed", 1_000)).toBe(false);
	});

	it("returns false when the claim is younger than maxAgeMs", async () => {
		await makePendingTask("t-fresh");
		await claimTask({
			taskId: "t-fresh",
			ownerId: "owner-A",
			attemptId: "1",
		});
		expect(await reclaimIfStale("t-fresh", 60_000)).toBe(false);
		// Claim file should still be present.
		const claim = await readClaim("t-fresh");
		expect(claim).not.toBeNull();
	});

	it("removes a stale claim file and returns true", async () => {
		await makePendingTask("t-stale");
		await claimTask({
			taskId: "t-stale",
			ownerId: "owner-A",
			attemptId: "1",
		});
		// maxAgeMs = 0 forces every claim to be treated as stale.
		expect(await reclaimIfStale("t-stale", 0)).toBe(true);
		expect(await readClaim("t-stale")).toBeNull();
	});

	it("recovers a 0-byte claim file (C1: crash between wx-create and write)", async () => {
		// Simulate the C1 crash window: writeClaimDurably opened the file via
		// `wx` (created a 0-byte sentinel) and crashed before writing contents.
		// reclaimIfStale MUST unlink the empty file regardless of maxAgeMs —
		// the malformed claim has no claimedAt, so the age-based path can
		// never reach it.
		const taskId = "t-zero-byte";
		await makePendingTask(taskId);
		const claimPath = path.join(pathFor("tasks/claimed"), `${taskId}.claim.json`);
		// Pre-plant an empty claim file (no contents at all).
		await fsp.writeFile(claimPath, "");
		expect((await fsp.stat(claimPath)).size).toBe(0);

		// reclaimIfStale must clear the empty sentinel so a fresh claim can
		// take the lock. maxAgeMs irrelevant because there's no claimedAt to
		// compare against.
		expect(await reclaimIfStale(taskId, 60_000)).toBe(true);
		await expect(fsp.stat(claimPath)).rejects.toThrow();
	});

	it("recovers a malformed (non-JSON) claim file (C1)", async () => {
		const taskId = "t-malformed-claim";
		await makePendingTask(taskId);
		const claimPath = path.join(pathFor("tasks/claimed"), `${taskId}.claim.json`);
		await fsp.writeFile(claimPath, "{partial json");

		expect(await reclaimIfStale(taskId, 60_000)).toBe(true);
		await expect(fsp.stat(claimPath)).rejects.toThrow();
	});

	it("after recovering a malformed claim, a fresh claimTask succeeds (C1 end-to-end)", async () => {
		const taskId = "t-c1-recovery";
		await makePendingTask(taskId);
		const claimPath = path.join(pathFor("tasks/claimed"), `${taskId}.claim.json`);
		await fsp.writeFile(claimPath, "");

		// First, simulate boot-recovery: reclaimIfStale clears the orphan.
		expect(await reclaimIfStale(taskId, 0)).toBe(true);

		// Now a fresh claim must succeed (lock is free, pending envelope intact).
		const result = await claimTask({
			taskId,
			ownerId: "owner-A",
			attemptId: "1",
		});
		expect(result.claimed).toBe(true);
	});
});

describe("file-bus / taskId path-traversal guard", () => {
	it("claimTask rejects taskId containing path separators", async () => {
		await expect(
			claimTask({
				taskId: "../escape",
				ownerId: "owner-A",
				attemptId: "1",
			}),
		).rejects.toThrow(TypeError);
		await expect(
			claimTask({
				taskId: "a\\b",
				ownerId: "owner-A",
				attemptId: "1",
			}),
		).rejects.toThrow(TypeError);
	});

	it("writeResolvedOutput rejects taskId containing '..'", async () => {
		await expect(
			writeResolvedOutput({
				taskId: "foo..bar",
				ownerId: "owner-A",
				attemptId: "1",
				result: {},
			}),
		).rejects.toThrow(TypeError);
	});

	it("readResolvedOutput / readClaim / reclaimIfStale reject unsafe taskIds", async () => {
		await expect(readResolvedOutput("../etc/passwd")).rejects.toThrow(TypeError);
		await expect(readClaim("a/b")).rejects.toThrow(TypeError);
		await expect(reclaimIfStale("foo\0bar", 1_000)).rejects.toThrow(TypeError);
	});
});
