import { normalizeModelIdCandidates } from "../vendor/model-probe/index.ts";
import type { ModelProbeInfo } from "./types.ts";

export type CatalogOption = { providerId: string; key: string; info: ModelProbeInfo; rank: number };

// Prefer the maker's catalog entry over a relay's copy, even when the model
// ID contains a relay prefix. Unknown families keep the existing lookup order.
const MAKERS: Array<[RegExp, string]> = [
	[/^(?:gpt-|chatgpt-|o[134](?:-|$))/, "openai"],
	[/^claude-/, "anthropic"],
	[/^gemini-/, "google"],
	[/^deepseek-/, "deepseek"],
	[/^(?:grok-)/, "xai"],
	[/^kimi-/, "moonshotai"],
];

export function preferredCatalogOption(modelId: string, options: CatalogOption[]): CatalogOption | undefined {
	for (const candidate of normalizeModelIdCandidates(modelId)) {
		const bare = candidate.split("/").at(-1)!.toLowerCase();
		const maker = MAKERS.find(([pattern]) => pattern.test(bare))?.[1];
		if (maker) {
			const native = options.find((option) => option.providerId === maker);
			if (native) return native;
		}
	}
	return options[0];
}

// Endpoint-matched catalog entries retain priority. The lookup reads the shared
// cached catalog; failure or an unknown ID must never prevent adding models.
export async function fillCatalogFallback(
	ids: string[],
	endpointInfo: Map<string, ModelProbeInfo>,
	lookup: (id: string) => Promise<CatalogOption[]>,
	onMatch?: (id: string, option: CatalogOption) => void,
): Promise<Map<string, ModelProbeInfo>> {
	const result = new Map(endpointInfo);
	for (const id of new Set(ids)) {
		if (result.has(id)) continue;
		try {
			const chosen = preferredCatalogOption(id, await lookup(id));
			if (chosen) {
				result.set(id, chosen.info);
				onMatch?.(id, chosen);
			}
		} catch {
			// Continue with local rules and defaults when the catalog is unavailable.
		}
	}
	return result;
}
