import { API_FALLBACK_LIMITS } from "../vendor/model-probe/index.ts";

// Reuse the probe's existing protocol default. Advertised model capacity can
// lower the active window; model names never select a different default.
export function defaultContextWindow(maximum?: number, api = "openai-completions"): number {
	const baseline = (API_FALLBACK_LIMITS[api] ?? API_FALLBACK_LIMITS["openai-completions"]).contextWindow;
	return maximum && maximum > 0 ? Math.min(baseline, maximum) : baseline;
}
