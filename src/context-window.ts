import { normalizeModelIdCandidates } from "../vendor/model-probe/index.ts";

// Application defaults, separate from a catalog's maximum capacity. The GPT-6
// Sol/Luna/Astra default is 272K; other models start at at most 256 Ki tokens.
// Do not infer a default from a price threshold or the output-token limit.
export function defaultContextWindow(modelId: string, maximum?: number): number {
	const gpt6 = normalizeModelIdCandidates(modelId).some((candidate) =>
		/(?:^|\/)gpt-6(?:\.\d+)?-(?:sol|luna|astra)(?:-|$)/i.test(candidate));
	const initial = gpt6 ? 272000 : 262144;
	return maximum && maximum > 0 ? Math.min(initial, maximum) : initial;
}
