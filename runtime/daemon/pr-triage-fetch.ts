/**
 * pr-triage-fetch — daemon-owned GitHub PR fetch + sanitize-to-scalar module.
 *
 * R1 (memory `agents-never-hold-secrets`, plan feature-pr84-r1-daemon-creds):
 * the pr-triage agent must NEVER hold a long-lived secret and NEVER make a
 * network call. The DAEMON (trusted code holding `GH_TOKEN` in its own
 * `process.env`) fetches all open PRs across Santiago's account, then reduces
 * every attacker-writable field to a small set of pre-computed scalars — the
 * `PrTriagePayload`. Only those scalars enter the agent prompt (D3/D5).
 *
 * Prompt-injection posture (scoped, NOT "zero surface"):
 *   - STRUCTURAL ELIMINATION applies to body + comments ONLY: the raw PR body
 *     and every raw comment body are reduced to the single `mentionsClaude`
 *     boolean. No attacker-authored body/comment text ever reaches the prompt.
 *   - `title`, `author`, and `url` are free-form and attacker-influenced
 *     (anyone can open a PR with a crafted title). They are NOT eliminated:
 *     they are control-stripped + length-capped (`scrubScalarField`, FIX B) and
 *     passed as delimited UNTRUSTED data the agent is told to treat as data,
 *     never instructions. That is defense-in-depth, not a zero-surface claim.
 *
 * No new deps: Node 20 global `fetch` + `AbortController`. The GraphQL query is
 * the EXACT query the agent used to run via `gh api graphql` (see the prior
 * `prompt-template.md` Step (a)); it now runs daemon-side.
 *
 * SECURITY: a thrown `FetchPrsError` carries ONLY the HTTP status (or a
 * network-error label) — NEVER the token. The sanitized payload contains only
 * the listed scalar fields — never a raw `body`, raw `comments`, or any
 * token-shaped field.
 */

import { sanitizeInjectText } from "../telegram/bot.js";

const GITHUB_GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MS_PER_DAY = 86_400_000;
const CLAUDE_LABEL = "claude-review-requested";
const CLAUDE_MENTION = "@claude";

/**
 * The EXACT GraphQL query the agent previously ran via `gh api graphql`.
 * `author:ilsantino is:pr is:open` catches every PR Santiago opened anywhere
 * (org repos included), unlike `user:` which is owner-scoped. `type: ISSUE` is
 * required for the PR search; the `... on PullRequest` inline fragment narrows
 * the nodes.
 *
 * `issueCount` is the TRUE total of open PRs across the account; `nodes` is
 * capped at the `first: 50` page (the inspected ceiling — see
 * `sanitizePrPayload`). `comments(last: 100)` (not 20): the iaGO pipeline tags
 * @claude via a PR comment that can sit well below the last 20 on a long review
 * thread, so a narrow window would miss the `mentionsClaude` signal.
 */
export const PR_TRIAGE_GRAPHQL_QUERY = `
query {
  search(query: "author:ilsantino is:pr is:open", type: ISSUE, first: 50) {
    issueCount
    nodes {
      ... on PullRequest {
        number
        title
        url
        author { login }
        reviewDecision
        createdAt
        updatedAt
        body
        labels(first: 20) { nodes { name } }
        comments(last: 100) {
          nodes {
            author { login }
            body
          }
        }
        statusCheckRollup {
          state
          contexts(first: 20) {
            nodes {
              __typename
              ... on StatusContext { state context }
              ... on CheckRun { conclusion name }
            }
          }
        }
      }
    }
  }
}`;

/** A raw PR node as returned by the GitHub GraphQL search (untrusted shape). */
export interface RawPullRequest {
	readonly number?: unknown;
	readonly title?: unknown;
	readonly url?: unknown;
	readonly author?: { readonly login?: unknown } | null;
	readonly reviewDecision?: unknown;
	readonly createdAt?: unknown;
	readonly updatedAt?: unknown;
	readonly body?: unknown;
	readonly labels?: {
		readonly nodes?: ReadonlyArray<{ readonly name?: unknown }>;
	} | null;
	readonly comments?: {
		readonly nodes?: ReadonlyArray<{
			readonly author?: { readonly login?: unknown } | null;
			readonly body?: unknown;
		}>;
	} | null;
	readonly statusCheckRollup?: {
		readonly state?: unknown;
		readonly contexts?: {
			readonly nodes?: ReadonlyArray<{
				readonly __typename?: unknown;
				readonly state?: unknown;
				readonly context?: unknown;
				readonly conclusion?: unknown;
				readonly name?: unknown;
			}>;
		} | null;
	} | null;
}

/**
 * The sanitized per-PR scalar payload. Pre-computed on the DAEMON so the agent
 * never sees a raw body/comment. NO raw `body`, NO raw `comments`, no
 * token-shaped field — only these scalars (D3/D5).
 */
export interface PrScalar {
	readonly number: number;
	readonly title: string;
	readonly url: string;
	readonly author: string;
	readonly reviewDecision: string | null;
	readonly createdAt: string | null;
	readonly updatedAt: string | null;
	readonly ageDays: number;
	readonly checksState: string | null;
	readonly anyCheckTimedOut: boolean;
	readonly mentionsClaude: boolean;
	readonly hasClaudeLabel: boolean;
}

/** The full sanitized payload injected into the agent prompt. */
export interface PrTriagePayload {
	readonly generatedAt: string;
	readonly totalCount: number;
	readonly prs: PrScalar[];
}

/**
 * Typed fetch error carrying ONLY the HTTP status (or a network-error label).
 * NEVER carries the token — the message is constructed from the status alone.
 */
export class FetchPrsError extends Error {
	readonly status: number | null;
	constructor(message: string, status: number | null) {
		super(message);
		this.name = "FetchPrsError";
		this.status = status;
	}
}

export interface FetchPrsDeps {
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
}

/**
 * Result of `fetchOpenPrs`: the ≤50 inspected PR nodes plus the TRUE total
 * open-PR count (`issueCount`) reported by the GraphQL `search`. `issueCount`
 * can exceed `nodes.length` when more than 50 PRs are open — `nodes` is capped
 * at the `first: 50` page, `issueCount` is not.
 */
export interface FetchPrsResult {
	readonly nodes: RawPullRequest[];
	readonly issueCount: number;
}

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asStringOrNull(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * FIX B (R1 dual-adversarial Important) — defense-in-depth scrub for the
 * free-form, attacker-influenced string fields (`title`, `author`, `url`).
 * Anyone can open a PR with a crafted title, and these three are the only
 * fields passed VERBATIM into the agent prompt (every other signal is reduced
 * to a boolean). This is NOT the structural-elimination guarantee that covers
 * body/comments (those collapse to `mentionsClaude`); it is a length-cap +
 * control-strip so a hostile title cannot smuggle newlines / control bytes /
 * unbounded length into the delimited untrusted-data block.
 *
 * Strips C0/C1 control chars AND newlines/CR (a delimited data field is
 * single-line by contract), then hard-caps to `cap` chars. Reuses
 * `sanitizeInjectText` (exported from the telegram bot) for the control-strip,
 * adding the newline/CR strip + length cap here.
 */
function scrubScalarField(v: unknown, cap: number): string {
	const raw = asString(v);
	if (raw.length === 0) return "";
	// `sanitizeInjectText` keeps tab/newline/CR; for a single-line delimited
	// field we additionally drop \t/\n/\r.
	const controlStripped = sanitizeInjectText(raw).sanitized.replace(
		/[\t\n\r]/g,
		" ",
	);
	return controlStripped.slice(0, cap);
}

/**
 * POST the PR-triage GraphQL query to GitHub holding `token` in the
 * `Authorization` header. Bounded by an `AbortController` timeout (default
 * 15s). On non-200 / network error throws `FetchPrsError` carrying the status
 * but NEVER the token. Returns `{ nodes, issueCount }`: `data.search.nodes`
 * (the ≤50 inspected PR array) plus `data.search.issueCount` (the TRUE total
 * open-PR count, which may exceed `nodes.length`).
 */
export async function fetchOpenPrs(
	token: string,
	deps: FetchPrsDeps = {},
): Promise<FetchPrsResult> {
	const fetchImpl = deps.fetchImpl ?? fetch;
	const timeoutMs = deps.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	if (typeof timer.unref === "function") timer.unref();
	let res: Response;
	try {
		res = await fetchImpl(GITHUB_GRAPHQL_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "iago-os-daemon",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query: PR_TRIAGE_GRAPHQL_QUERY }),
			signal: controller.signal,
		});
	} catch (err) {
		// Network / abort error. NEVER include `err` verbatim — it could echo a
		// request URL or header. Emit a token-free, status-free label.
		const label =
			err instanceof Error && err.name === "AbortError"
				? "github-graphql-fetch timed out"
				: "github-graphql-fetch network error";
		throw new FetchPrsError(label, null);
	} finally {
		clearTimeout(timer);
	}
	if (res.status !== 200) {
		// Token-free: only the numeric status enters the message.
		throw new FetchPrsError(
			`github-graphql-fetch non-200 status ${res.status}`,
			res.status,
		);
	}
	let json: unknown;
	try {
		json = await res.json();
	} catch {
		throw new FetchPrsError("github-graphql-fetch invalid JSON body", 200);
	}
	// R1 dual-adversarial round-1 Critical fix: GitHub's GraphQL API returns
	// HTTP 200 even for query-level failures (auth-scope errors, RATE_LIMITED,
	// schema drift), with body `{ data: null, errors: [...] }`. The prior code
	// only read `data.search.nodes`; on such a response `nodes` is not an array,
	// so it returned `[]` — INDISTINGUISHABLE from a genuinely empty search.
	// `makePrTriageCronPrompt` then saw `totalCount === 0` and skipped the daily
	// run with the benign `no-open-prs` reason instead of `pr-fetch-failed`,
	// silently leaving real PRs un-triaged on a transient auth/rate-limit/schema
	// failure. Detect a non-empty top-level `errors` array and require
	// `data.search.nodes` to be an array; throw `FetchPrsError` so the scheduler
	// emits `pr-fetch-failed`. Return `[]` ONLY for a valid empty `nodes` array.
	const body = json as {
		data?: { search?: { nodes?: unknown; issueCount?: unknown } } | null;
		errors?: unknown;
	} | null;
	const errors = body?.errors;
	if (Array.isArray(errors) && errors.length > 0) {
		// Token-free: surface only that the GraphQL layer reported errors, never
		// the error payload (it could echo a query fragment or header context).
		throw new FetchPrsError(
			`github-graphql-fetch query-level errors (${errors.length})`,
			200,
		);
	}
	const nodes = body?.data?.search?.nodes;
	if (!Array.isArray(nodes)) {
		// A 200 with no errors array but a missing/non-array `nodes` is a
		// malformed/unexpected shape (e.g. `data: null` without `errors`), NOT a
		// valid empty result. Throw so it surfaces as `pr-fetch-failed` rather
		// than being misread as zero open PRs.
		throw new FetchPrsError(
			"github-graphql-fetch missing or malformed data.search.nodes",
			200,
		);
	}
	const out: RawPullRequest[] = [];
	for (const node of nodes) {
		if (typeof node === "object" && node !== null) {
			out.push(node as RawPullRequest);
		}
	}
	// `issueCount` is the TRUE total open-PR count (not capped at the 50-node
	// page). Fall back to the inspected count if GitHub omits it (older schema /
	// unexpected shape) so `totalCount` never reports fewer than we inspected.
	const issueCountRaw = body?.data?.search?.issueCount;
	const issueCount =
		typeof issueCountRaw === "number" && Number.isFinite(issueCountRaw)
			? issueCountRaw
			: out.length;
	return { nodes: out, issueCount };
}

/**
 * Reduce the raw PR array to the sanitized scalar payload. ALL classification
 * signals are pre-computed HERE on the daemon (trusted code) so no raw body /
 * comment ever enters the agent prompt:
 *   - `ageDays`          = whole days since `updatedAt`
 *   - `checksState`      = `statusCheckRollup.state` (or null)
 *   - `anyCheckTimedOut` = any rollup context `conclusion === "TIMED_OUT"`
 *   - `mentionsClaude`   = case-insensitive `@claude` across ALL comment bodies
 *                          AND the PR body
 *   - `hasClaudeLabel`   = labels include `claude-review-requested`
 *
 * `title`, `author`, and `url` are the only free-form, attacker-influenced
 * fields that pass VERBATIM into the prompt — they are control-stripped +
 * length-capped via `scrubScalarField` (FIX B) and emitted inside a delimited
 * untrusted-data block, NOT as instructions (defense-in-depth, not the
 * structural-elimination guarantee that covers body/comments).
 *
 * `totalCount` is the TRUE open-PR count from GitHub's `search.issueCount`
 * (passed in by the caller), which may EXCEED `prs.length` — `prs` is capped at
 * the GraphQL `first: 50` page (the inspected ceiling). When omitted it falls
 * back to `prs.length` (legacy / direct-test callers).
 *
 * The output MUST NOT contain a raw `body`, raw `comments`, or any
 * token-shaped field — only the listed scalars (D3/D5).
 */
export function sanitizePrPayload(
	prs: RawPullRequest[],
	nowMs: number,
	totalCount: number = prs.length,
): PrTriagePayload {
	const scalars: PrScalar[] = prs.map((pr) => {
		const updatedAt = asStringOrNull(pr.updatedAt);
		const parsedUpdated =
			updatedAt !== null ? Date.parse(updatedAt) : Number.NaN;
		// Clamp to >= 0: a server-ahead `updatedAt` or local clock skew would
		// otherwise yield a negative age that renders as "age:-2d" in the summary
		// (pass#2 Minor). An unparseable/missing timestamp falls back to 0.
		const ageDays = Number.isFinite(parsedUpdated)
			? Math.max(0, Math.floor((nowMs - parsedUpdated) / MS_PER_DAY))
			: 0;

		const rollup = pr.statusCheckRollup;
		const checksState = asStringOrNull(rollup?.state);
		const contextNodes = rollup?.contexts?.nodes ?? [];
		const anyCheckTimedOut = contextNodes.some(
			(c) => asString(c?.conclusion) === "TIMED_OUT",
		);

		const commentNodes = pr.comments?.nodes ?? [];
		const bodyHasMention = asString(pr.body)
			.toLowerCase()
			.includes(CLAUDE_MENTION);
		const commentHasMention = commentNodes.some((c) =>
			asString(c?.body).toLowerCase().includes(CLAUDE_MENTION),
		);
		const mentionsClaude = bodyHasMention || commentHasMention;

		const labelNodes = pr.labels?.nodes ?? [];
		const hasClaudeLabel = labelNodes.some(
			(l) => asString(l?.name) === CLAUDE_LABEL,
		);

		const numberRaw = pr.number;
		const number = typeof numberRaw === "number" ? numberRaw : 0;

		return {
			number,
			// FIX B: free-form attacker-influenced fields — control-stripped +
			// length-capped (title 200, author 64, url 300).
			title: scrubScalarField(pr.title, 200),
			url: scrubScalarField(pr.url, 300),
			author: scrubScalarField(pr.author?.login, 64),
			reviewDecision: asStringOrNull(pr.reviewDecision),
			createdAt: asStringOrNull(pr.createdAt),
			updatedAt,
			ageDays,
			checksState,
			anyCheckTimedOut,
			mentionsClaude,
			hasClaudeLabel,
		};
	});
	return {
		generatedAt: new Date(nowMs).toISOString(),
		// FIX C: honest total from `search.issueCount` (the inspected list `prs`
		// caps at 50; `totalCount` is the true open-PR count). Never report fewer
		// than we actually inspected.
		totalCount: Math.max(totalCount, scalars.length),
		prs: scalars,
	};
}
