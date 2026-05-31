/**
 * pr-triage-fetch — daemon-owned GitHub PR fetch + sanitize-to-scalar module.
 *
 * R1 (memory `agents-never-hold-secrets`, plan feature-pr84-r1-daemon-creds):
 * the pr-triage agent must NEVER hold a long-lived secret and NEVER make a
 * network call. The DAEMON (trusted code holding `GH_TOKEN` in its own
 * `process.env`) fetches all open PRs across Santiago's account, then reduces
 * every attacker-writable field (raw PR body, raw comment bodies) to a small
 * set of pre-computed scalar booleans/strings — the `PrTriagePayload`. Only
 * those scalars enter the agent prompt, so the agent's entire information need
 * is met with ZERO prompt-injection surface (D3/D5).
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
 */
export const PR_TRIAGE_GRAPHQL_QUERY = `
query {
  search(query: "author:ilsantino is:pr is:open", type: ISSUE, first: 50) {
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
        comments(last: 20) {
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

function asString(v: unknown): string {
	return typeof v === "string" ? v : "";
}

function asStringOrNull(v: unknown): string | null {
	return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * POST the PR-triage GraphQL query to GitHub holding `token` in the
 * `Authorization` header. Bounded by an `AbortController` timeout (default
 * 15s). On non-200 / network error throws `FetchPrsError` carrying the status
 * but NEVER the token. Returns `data.search.nodes` (the raw PR array).
 */
export async function fetchOpenPrs(
	token: string,
	deps: FetchPrsDeps = {},
): Promise<RawPullRequest[]> {
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
	const nodes = (json as { data?: { search?: { nodes?: unknown } } })?.data
		?.search?.nodes;
	if (!Array.isArray(nodes)) {
		return [];
	}
	const out: RawPullRequest[] = [];
	for (const node of nodes) {
		if (typeof node === "object" && node !== null) {
			out.push(node as RawPullRequest);
		}
	}
	return out;
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
 * The output MUST NOT contain a raw `body`, raw `comments`, or any
 * token-shaped field — only the listed scalars (D3/D5).
 */
export function sanitizePrPayload(
	prs: RawPullRequest[],
	nowMs: number,
): PrTriagePayload {
	const scalars: PrScalar[] = prs.map((pr) => {
		const updatedAt = asStringOrNull(pr.updatedAt);
		const parsedUpdated =
			updatedAt !== null ? Date.parse(updatedAt) : Number.NaN;
		const ageDays = Number.isFinite(parsedUpdated)
			? Math.floor((nowMs - parsedUpdated) / MS_PER_DAY)
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
			title: asString(pr.title),
			url: asString(pr.url),
			author: asString(pr.author?.login),
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
		totalCount: scalars.length,
		prs: scalars,
	};
}
