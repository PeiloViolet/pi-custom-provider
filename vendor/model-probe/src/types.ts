// Best-effort model metadata detected while probing a gateway.
//
// Metadata and runtime fallbacks have these sources, highest priority first:
//   1. detected   — real data from the gateway (no tag)
//   2. models.dev — exact per-model catalog entries (listed in modelsDevFields)
//   3. runtime fallback — uniform MODEL_INFO_DEFAULTS (listed in defaultedFields)
// USD per 1M tokens — pi's ModelCostRates convention (and models.dev's).
// No default price: a guessed price is worse than none, so
// cost only ever comes from the gateway itself or the models.dev catalog.
export type ModelCostInfo = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
};

export type ModelProbeInfo = {
	contextWindow?: number; // reported model capacity (not an API default)
	defaultContextWindow?: number; // reported model default, when separately available
	maxTokens?: number; // max output tokens
	image?: boolean; // accepts image input
	video?: boolean; // accepts video input
	reasoning?: boolean;
	cost?: ModelCostInfo; // list prices, USD per 1M tokens
	alwaysThinking?: boolean; // reasoning exists but cannot be turned off
	effortOptions?: string[]; // provider reasoning-effort names (none/minimal/low/.../max)
	endpointTypes?: string[]; // New API / One API: supported_endpoint_types (chat, embeddings, ...)
	modelsDevFields?: Array<"contextWindow" | "defaultContextWindow" | "maxTokens" | "image" | "video" | "reasoning" | "cost">; // which fields came from models.dev
	defaultedFields?: Array<"contextWindow" | "maxTokens" | "image" | "video" | "reasoning" | "effortOptions">; // runtime fallbacks, never queried model facts
};

export type ProbeResult = {
	/** Model ids discovered from /models, sorted. */
	ids: string[];
	/** Metadata discovered alongside the listing (inline list fields, Ollama tags, ...). */
	infoById: Map<string, ModelProbeInfo>;
	// The base variant that actually answered /models (may differ from the
	// given baseUrl by a /v1 suffix on quirky gateways).
	baseUrl: string;
};

/**
 * Which extra endpoints to try when probing a gateway:
 * - `modelInfo`: LiteLLM /model/info
 * - `modelGroupInfo`: LiteLLM /model_group/info
 * - `publicCatalog`: New API style /api/models/public (on the site host)
 * - `perModelDetails`: per-model GET /models/{id}
 * - `modelsDev`: models.dev catalog matched by base URL (fills missing gateway fields)
 */
export interface DetectProfile {
	modelInfo?: boolean;
	modelGroupInfo?: boolean;
	publicCatalog?: boolean;
	perModelDetails?: boolean;
	modelsDev?: boolean;
}

/** Try every known metadata source. Used when no profile is given. */
export const FULL_PROFILE: Required<DetectProfile> = {
	modelInfo: true,
	modelGroupInfo: true,
	publicCatalog: true,
	perModelDetails: true,
	modelsDev: true,
};

export const PROBE_CONCURRENCY = 4;
export const PROBE_TIMEOUT_MS = 4000;
