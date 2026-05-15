/**
 * Core types for the iaGO-OS v2 AgentRuntime polymorphic interface.
 *
 * Sourced verbatim from:
 *   - docs/specs/iago-os-v2-vision.md § Agent Shape Taxonomy + AgentRuntime Interface
 *   - .iago/decisions/2026-05-15-agent-shape-taxonomy.md § Decision
 *
 * Named exports only. No `any`. `unknown` is restricted to the explicit
 * `AgentMessage.custom.payload` escape hatch — adapters that accept structured
 * `custom` payloads OWN their payload schema documentation on the adapter's
 * `send()` JSDoc.
 */

export type AgentShape = "pty" | "http" | "mcp" | "event" | "daemon";

export type InterfaceVersion = "v1";

export type StatusValue = "running" | "idle" | "exited" | "crashed" | "unknown";

export interface AgentHandle {
	readonly id: string;
	readonly runtime: string;
	readonly shape: AgentShape;
	readonly agentId: string;
	readonly sessionId: string;
	readonly generationToken: number;
	readonly org?: string;
	readonly parentHandleId?: string;
	readonly spawnedAt: number;
	readonly markerPath: string;
}

export interface SpawnOpts {
	readonly cwd: string;
	readonly env: Record<string, string>;
	readonly agentId: string;
	readonly sessionId: string;
	readonly org?: string;
	readonly parentHandle?: AgentHandle;
}

export interface PromptMessage {
	readonly kind: "prompt";
	readonly payload: { readonly text: string };
}

export interface ApprovalMessage {
	readonly kind: "approval";
	readonly payload: {
		readonly approvalId: string;
		readonly decision: "allow" | "deny";
	};
}

export interface AbortMessage {
	readonly kind: "abort";
	readonly payload: { readonly reason?: string };
}

export interface InjectMessage {
	readonly kind: "inject";
	readonly payload: { readonly text: string };
}

/**
 * Adapter-specific escape hatch. `payload` is `unknown` — this is the only
 * field in the discriminated union that is not a typed object. Adapters that
 * accept structured `custom` payloads OWN their payload schema and MUST
 * document it on their `send()` JSDoc.
 */
export interface CustomMessage {
	readonly kind: "custom";
	readonly payload: unknown;
}

export type AgentMessage =
	| PromptMessage
	| ApprovalMessage
	| AbortMessage
	| InjectMessage
	| CustomMessage;

export type StatusCallback = (status: StatusValue, code?: number) => void;

export interface CostEvent {
	readonly at: number;
	readonly agentId: string;
	readonly sessionId: string;
	readonly inputTokens?: number;
	readonly outputTokens?: number;
	readonly dollarsUsd?: number;
	readonly provider?: string;
	readonly model?: string;
}
