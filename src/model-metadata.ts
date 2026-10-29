import { defaultContextWindow } from "./context-window.ts";
import { buildModelEntry, modelOptionsFromProbe } from "./model-entry.ts";
import type { ModelProbeInfo, ProviderApi } from "./types.ts";

export type MetaChange = { key: string; value: unknown; label: string };

export function automaticMetadataFields(info: ModelProbeInfo): Set<keyof ModelProbeInfo> {
	const defaulted = new Set<string>(info.defaultedFields ?? []);
	const fields: (keyof ModelProbeInfo)[] = ["contextWindow", "maxTokens", "image", "reasoning", "cost"];
	return new Set(fields.filter((field) => info[field] !== undefined && !defaulted.has(field)));
}

// Missing and defaulted values never erase real metadata. Only explicitly edited
// fields opt out; legacy entries without manualFields are fully automatic.
export function diffStoredModel(model: any, info: ModelProbeInfo, api?: ProviderApi): MetaChange[] {
	const manual = new Set<string>(model?.manualFields ?? []);
	const fields = automaticMetadataFields(info);
	const known = (field: keyof ModelProbeInfo) => fields.has(field);
	const patch: Record<string, unknown> = {};
	if (known("contextWindow")) {
		patch.maxContextWindow = info.contextWindow;
		if (!manual.has("context")) patch.contextWindow = defaultContextWindow(info.contextWindow, model?.api ?? api);
	}
	if (known("maxTokens") && !manual.has("maxtokens")) patch.maxTokens = info.maxTokens;
	if (known("image") && !manual.has("image")) patch.input = info.image ? ["text", "image"] : ["text"];
	if (known("reasoning") && !manual.has("reasoning")) {
		const entry = buildModelEntry(model?.id ?? "", modelOptionsFromProbe(info, { reasoning: "xhigh", image: false }));
		patch.reasoning = entry.reasoning;
		if (info.reasoning === false || info.effortOptions?.length || info.alwaysThinking === true) {
			patch.thinkingLevelMap = entry.thinkingLevelMap;
		}
	}
	if (info.cost) patch.cost = info.cost;
	const labels: Record<string, string> = {
		contextWindow: "default context", maxContextWindow: "maximum context", maxTokens: "max-out",
		input: "input", reasoning: "reasoning", thinkingLevelMap: "reasoning levels", cost: "cost",
	};
	return Object.entries(patch)
		.filter(([key, value]) => JSON.stringify(model?.[key]) !== JSON.stringify(value))
		.map(([key, value]) => ({ key, value,
			label: `${labels[key]} ${JSON.stringify(model?.[key]) ?? "unset"}→${JSON.stringify(value) ?? "unset"}` }));
}

export function applyMetaChanges(entry: any, changes: MetaChange[]): void {
	for (const { key, value } of changes) {
		if (value === undefined) delete entry[key];
		else entry[key] = value;
	}
}
