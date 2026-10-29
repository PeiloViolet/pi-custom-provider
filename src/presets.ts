// Probe profile: which metadata sources are tried after fetching /models.
// The wizard always probes with the full profile — every known source. The
// old per-gateway presets (LiteLLM / One API / New API / ...) only skipped
// endpoints known to be unused on a gateway. Catalog lookup supplies missing
// metadata without requiring another profile picker.
export type GatewayProbeProfile = {
	modelInfo: boolean; // LiteLLM GET /model/info (server root, one call covers every model)
	modelGroupInfo: boolean; // LiteLLM GET /model_group/info (server root, needs an api key)
	publicCatalog: boolean; // New API-style GET {site}/api/models/public (no auth)
	perModelDetails: boolean; // OpenAI GET /models/{id}
	modelsDev: boolean; // models.dev catalog matched by base URL (below detected values)
};

export const AUTO_PROBE_PROFILE: GatewayProbeProfile = {
	modelInfo: true,
	modelGroupInfo: true,
	publicCatalog: true,
	perModelDetails: true,
	modelsDev: true,
};
