import { execFileSync } from "node:child_process";

import { describe, expect, it } from "vitest";

// pr84 (dual-adversarial security lens): the pr-triage fallback redacts secrets
// from captured error bodies BEFORE they reach the on-disk envelope + telemetry
// NDJSON. This locks in the redaction CONTRACT used by prompt-template.md's two
// fallback paths:
//   1. literal match regardless of regex metacharacters — the prior
//      sed/BRE-escape approach leaked metachar-bearing tokens on GNU sed 4.9
//      (the Debian deploy target),
//   2. safe no-op on an empty/unset token (no spurious [REDACTED]),
//   3. redact BEFORE truncating so a token straddling the `head -c` boundary
//      cannot leak a surviving fragment.
// The bash pattern under test mirrors prompt-template.md verbatim:
//   [ -n "$TOKEN" ] && RAW="${RAW//"$TOKEN"/[REDACTED]}"; printf '%s' "$RAW" | head -c N
const REDACT_SCRIPT =
	'TOKEN="$1"; RAW="$2"; N="$3"; ' +
	'[ -n "$TOKEN" ] && RAW="${RAW//"$TOKEN"/[REDACTED]}"; ' +
	"printf '%s' \"$RAW\" | head -c \"$N\"";

function bashAvailable(): boolean {
	try {
		execFileSync("bash", ["-c", "true"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function redact(raw: string, token: string, headBytes: number): string {
	return execFileSync(
		"bash",
		["-c", REDACT_SCRIPT, "bash", token, raw, String(headBytes)],
		{ encoding: "utf8" },
	);
}

// bash-only (Linux CI + git-bash). Skips where `bash` is not on PATH so a
// Windows-without-bash dev run stays green; the Debian deploy target runs it.
describe.skipIf(!bashAvailable())(
	"pr-triage secret redaction (pr84 security)",
	() => {
		it("redacts a token containing regex metacharacters, literally", () => {
			const token = "1234:AAH.te*st-[x]^$|\\";
			const out = redact(`leak ${token} mid ${token} end`, token, 256);
			expect(out).toBe("leak [REDACTED] mid [REDACTED] end");
			expect(out).not.toContain(token);
		});

		it("is a safe no-op when the token is empty (no spurious [REDACTED])", () => {
			expect(redact("nothing to redact here", "", 256)).toBe(
				"nothing to redact here",
			);
		});

		it("redacts BEFORE truncating so a straddling token cannot leak a fragment", () => {
			const token = "SECRETTOKEN12345";
			const raw = `${"x".repeat(25)}${token}yyyy`;
			// head -c 35 would cut mid-token if truncation ran first.
			const out = redact(raw, token, 35);
			expect(out).not.toContain("SECRET");
			expect(out).toContain("[REDACTED]");
		});
	},
);
