# model-probe

Probe OpenAI-compatible gateways for their model list and per-model metadata
(context window, image/video input, reasoning, list prices, endpoint types).
Works with LiteLLM, One API, New API, OpenRouter, Google's native Gemini API,
Ollama, and generic OpenAI-compatible servers.

Runs on Node >= 22.18 (TypeScript type stripping, no build step).

## What it does

- **Model listing** — `GET {baseUrl}/models`, with automatic ±`/v1` adaptation:
  quirky gateways that hang or 404 on `/v1/models` (or serve their web console
  HTML there) are retried at the other variant, and the base URL that actually
  answered is returned. Non-local `http://` URLs additionally fall back to
  `https://` (many public gateways don't listen on :80 at all). Google's
  native Gemini list shape (`{ models: [{ name: "models/...", inputTokenLimit }] }`)
  is recognized too, and the API key is sent as both `Authorization: Bearer`
  and `x-goog-api-key`.
- **Inline metadata** — OpenRouter-style `context_length` / `architecture`,
  One API / New API `meta` fields and `supported_endpoint_types` carried by
  the `/models` list itself.
- **Gateway-wide endpoints** (one call covers every model):
  - LiteLLM `GET /model/info` and `GET /model_group/info` (server root)
  - New API-style site catalog `GET {site}/api/models/public` (no auth)
- **Per-model details** — `GET /models/{id}`, or Ollama native
  `GET /api/tags` + `POST /api/show`.
- **models.dev** — the [models.dev](https://models.dev) catalog fills any
  fields the gateway didn't report, tagged in `modelsDevFields`. Entries are
  exact per-model records. Data comes from the official SDK (`@opencode-ai/models`) with
  three sources in order: the live API; then the latest published snapshot
  served from the jsDelivr npm CDN (cached on disk per day — this keeps the
  data fresh on networks where models.dev itself is unreachable); then the
  snapshot bundled with the installed SDK, so the tier also works fully
  offline. Matched per gateway base URL against the catalog's provider list,
  cached for the session, and never blocks a probe. Disable with
  `profile: { modelsDev: false }`. Degenerate catalog limits
  (`maxTokens == contextWindow`) are clamped by `normalizeModelLimits` to
  `min(32K, ctx/4)` before they reach callers.
- **Output-token fallback** — when the gateway and catalog report no output
  limit, the caller's api flavor (`api` option / CLI `--api`) selects an output
  limit (`API_FALLBACK_LIMITS`: Anthropic/OpenAI 32K, Gemini 64K), tagged in
  `defaultedFields`. Context is never filled from the API flavor. Model metadata
  can report a default window separately from maximum capacity: for
  `context_window` + `max_context_window`, preserve both as
  `defaultContextWindow` + `contextWindow`. Missing context stays unknown.
- **Defaults** — fields nothing else answered are filled from
  `MODEL_INFO_DEFAULTS` (`image: false`, `video: false`, `reasoning: true`)
  and tagged in
  `defaultedFields`. Priority: detected > models.dev > api
  fallback > default.
  `describeProbeInfo` only renders values that differ from the defaults
  (defaulted `contextWindow` / `maxTokens` are hidden too — they carry no
  real information about the model).
- **List prices** — `cost` (USD per 1M tokens: input / output / cacheRead /
  cacheWrite) from the gateway itself (LiteLLM `input_cost_per_token` & co.,
  OpenRouter inline `pricing`) or the models.dev catalog. There is no
  default for cost — a guessed price is worse than none.
- **Developer-role probe** (opt-in) — one tiny chat completion with a
  `developer`-role message tells you whether the gateway accepts the OpenAI
  developer role. Gateways that don't (Kimi's subscription endpoint, some
  One API forks) reject it with a 400, and clients must fall back to `system`.
  An inconclusive probe defaults to `false` (`developerRoleSource: "default"`).

All fetches time out after 4s and run with bounded concurrency; everything
beyond the model list itself is best-effort.

## CLI

```sh
npm install -g model-probe

model-probe https://api.openai.com/v1 --key sk-...
model-probe http://localhost:4000          # LiteLLM, no /v1 needed
model-probe http://localhost:11434/v1 --ollama
model-probe https://openrouter.ai/api/v1 --json
```

```
Usage: model-probe <baseUrl> [options]

Options:
  --key <apiKey>     Bearer token for the gateway
  --ollama           Use Ollama native endpoints (/api/tags, /api/show)
  --api <flavor>     pi api flavor (openai-completions, openai-responses,
                     anthropic-messages, google-generative-ai) — enables
                     protocol-level fallback limits
  --developer-role   Also probe whether the gateway accepts the OpenAI
                     "developer" role (one tiny chat completion)
  --json             Print the raw result as JSON
  -h, --help         Show this help
```

## Library

```ts
import { detectModels, probeModels, describeProbeInfo } from "model-probe";

// Full detection: /models + gateway-wide + per-model + catalog.
const result = await detectModels("https://api.example.com/v1", {
	apiKey: "sk-...",
	// profile: { modelInfo: true, publicCatalog: false, ... } — tune which
	// extra endpoints are tried; defaults to trying everything.
	// ollama: true — use Ollama native endpoints instead of /models/{id}.
	// api: "openai-completions" — the pi api flavor; enables protocol-level
	//   fallback limits when nothing else knows a model's limits.
	// developerRole: true — also probe developer-role support (one tiny
	//   chat completion); result.supportsDeveloperRole is true/false, or
	//   undefined when the probe was inconclusive.
});

console.log(result.baseUrl); // the base that actually answered (±/v1 adapted)
for (const id of result.ids) {
	console.log(id, describeProbeInfo(result.models.get(id)));
}

// Just the model list:
const { ids, infoById, baseUrl } = await probeModels("http://localhost:4000");
```

### API

- `probeModels(baseUrl, apiKey?)` → `{ ids, infoById, baseUrl }`
- `detectModels(baseUrl, options?)` → `ProbeResult & { models, supportsDeveloperRole?, developerRoleSource? }`
- `probeDeveloperRole(baseUrl, apiKey?, modelId)` → `true | false | undefined`
- `fetchGatewayWideInfo(baseUrl, { apiKey?, profile?, ollama? })`
- `fetchPerModelInfo(baseUrl, ids, { apiKey?, ollama? })`
- `finalizeModelInfo(ids, maps, { modelsDev?, api? }?)` — merge metadata maps + models.dev + api fallback + defaults
- `resolveModelInfo(id, info?, modelsDev?, api?)` — the full fallback chain for one model
- `normalizeModelIdCandidates(id)` — the id normalization chain (decorated relay ids → base id)
- `normalizeModelLimits(ctx, out)` / `MAX_OUTPUT_TOKEN_CAP` — clamp degenerate catalog limits
- `API_FALLBACK_LIMITS` — protocol-level fallback limits per api flavor
- `applyModelDefaults(info?)` / `MODEL_INFO_DEFAULTS` — the default tier
- `fetchModelsDevProviders()` / `fetchModelsDevModels(providerId)` /
  `fetchModelsDevInfoForBaseUrl(baseUrl)` — the models.dev catalog tier
- `describeProbeInfo(info)` / `probeInfoSummary(info)` — formatting helpers
- `enrichLiteLLMModelInfo` / `enrichLiteLLMModelGroupInfo` /
  `enrichPublicModelInfo` / `enrichOpenAIModelDetails` /
  `enrichOllamaModelDetails` — individual metadata sources

### Types

```ts
type ModelProbeInfo = {
	contextWindow?: number; // reported capacity
	defaultContextWindow?: number; // separately reported model default
	maxTokens?: number; // max output tokens
	image?: boolean;    // accepts image input
	video?: boolean;    // accepts video input
	reasoning?: boolean;
	alwaysThinking?: boolean;
	effortOptions?: string[];
	endpointTypes?: string[]; // New API / One API supported_endpoint_types
	modelsDevFields?: Array<"contextWindow" | "defaultContextWindow" | "maxTokens" | "image" | "video" | "reasoning">; // from models.dev
	defaultedFields?: Array<"contextWindow" | "maxTokens" | "image" | "video" | "reasoning">; // api fallback / MODEL_INFO_DEFAULTS
};
```

## Model ID matching

`normalizeModelIdCandidates` provides catalog lookup candidates for decorated
relay IDs such as `bailian/deepseek-v4-pro`, `gpt-5@20250807`, and
`claude-sonnet-4-6[1m]`. It does not supply capabilities or model limits.

## License

MIT
