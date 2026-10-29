import type { ModelProbeInfo } from "./types.ts";

export type CatalogOption = { providerId: string; key: string; info: ModelProbeInfo; rank: number };

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
		let options: CatalogOption[];
		try {
			options = await lookup(id);
		} catch {
			// Continue with defaults when the catalog is unavailable.
			continue;
		}
		// Use the catalog lookup's order; no model-name provider preference.
		const chosen = options[0];
		if (chosen) {
			result.set(id, chosen.info);
			onMatch?.(id, chosen);
		}
	}
	return result;
}
