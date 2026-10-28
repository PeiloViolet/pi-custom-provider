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

// Refresh capacity without opting an existing model into a larger active
// window. A lower server limit can only shrink the active window.
export function updateContextCapacity(model: { id?: string; contextWindow?: number; maxContextWindow?: number }, maximum: number): void {
	model.maxContextWindow = maximum;
	// Pi's models.json default is 128000 when the active field is omitted.
	// Preserve omission unless the server's capacity requires a smaller window.
	if ((model.contextWindow ?? 128000) > maximum) model.contextWindow = maximum;
}
