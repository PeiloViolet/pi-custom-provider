import { applyModelDefaults } from "../vendor/model-probe/index.ts";
import { automaticContextWindow } from "./context-window.ts";
import { buildModelEntry, modelOptionsFromProbe } from "./model-entry.ts";
import type { ModelProbeInfo } from "./types.ts";

export type MetaChange = { key: string; value: unknown; label: string };

export function automaticMetadataFields(info: ModelProbeInfo): Set<keyof ModelProbeInfo> {
	const defaulted = new Set<string>(info.defaultedFields ?? []);
	const fields: (keyof ModelProbeInfo)[] = ["contextWindow", "maxTokens", "image", "reasoning", "cost"];
	return new Set(fields.filter((field) => info[field] !== undefined && !defaulted.has(field)));
}

// Missing and defaulted values never erase real metadata. Only explicitly edited
// fields opt out; legacy entries without manualFields are fully automatic.
export function diffStoredModel(model: any, info: ModelProbeInfo, resetManual = false): MetaChange[] {
	const previousManual = new Set<string>(model?.manualFields ?? []);
	const manual = resetManual ? new Set<string>() : previousManual;
	if (resetManual) info = applyModelDefaults(info);
	const fields = automaticMetadataFields(info);
	if (resetManual) {
		for (const field of previousManual) {
			if (field === "maxtokens") fields.add("maxTokens");
			else if (field === "image" || field === "reasoning") fields.add(field);
		}
	}
	const known = (field: keyof ModelProbeInfo) => fields.has(field);
	const patch: Record<string, unknown> = {};
	if (known("contextWindow")) patch.maxContextWindow = info.contextWindow;
	// Remove obsolete extension metadata without interpreting its value.
	if (model?.defaultContextWindow !== undefined) patch.defaultContextWindow = undefined;
	if (known("contextWindow") || (resetManual && previousManual.has("context"))) {
		const maximum = known("contextWindow") ? info.contextWindow : model?.maxContextWindow;
		if (!manual.has("context")) patch.contextWindow = automaticContextWindow(maximum);
	}
	if (known("maxTokens") && !manual.has("maxtokens")) patch.maxTokens = info.maxTokens;
	if (known("image") && !manual.has("image")) patch.input = info.image ? ["text", "image"] : ["text"];
	if (known("reasoning") && !manual.has("reasoning")) {
		const entry = buildModelEntry(model?.id ?? "", modelOptionsFromProbe(info, { reasoning: "xhigh", image: false }));
		patch.reasoning = entry.reasoning;
		if (info.reasoning === false || info.effortOptions?.length || info.alwaysThinking === true || (resetManual && previousManual.has("reasoning"))) {
			patch.thinkingLevelMap = entry.thinkingLevelMap;
		}
	}
	if (info.cost) patch.cost = info.cost;
	const defaulted = new Set<string>(model?.defaultedFields ?? []);
	for (const field of fields) {
		const manualKey = field === "contextWindow" ? "context" : field === "maxTokens" ? "maxtokens" : field;
		if (!manual.has(manualKey)) {
			if (info.defaultedFields?.some(key => key === field)) defaulted.add(field);
			else defaulted.delete(field);
		}
	}
	if (known("reasoning") && !manual.has("reasoning") && (info.reasoning === false || info.effortOptions?.length || info.alwaysThinking)) {
		defaulted.delete("effortOptions");
	}
	if ("thinkingLevelMap" in patch && info.reasoning === true && !info.effortOptions?.length && !info.alwaysThinking) {
		defaulted.add("effortOptions");
	}
	if (resetManual) patch.manualFields = undefined;
	if (JSON.stringify([...defaulted]) !== JSON.stringify(model?.defaultedFields ?? [])) {
		patch.defaultedFields = defaulted.size ? [...defaulted] : undefined;
	}
	const labels: Record<string, string> = {
		contextWindow: "context", defaultContextWindow: "obsolete context metadata", maxContextWindow: "maximum context", maxTokens: "max-out",
		input: "input", reasoning: "reasoning", thinkingLevelMap: "reasoning levels", cost: "cost", defaultedFields: "runtime fallbacks", manualFields: "manual fields",
	};
	return Object.entries(patch)
		.filter(([key, value]) => JSON.stringify(model?.[key]) !== JSON.stringify(value))
		.map(([key, value]) => ({ key, value,
			label: `${labels[key]} ${JSON.stringify(model?.[key]) ?? "unset"}→${JSON.stringify(value) ?? "unset"}` }));
}

// Persist only the edited field and its provenance. Read-time fallbacks for
// other missing legacy fields must not acquire saved markers without values.
export function applyModelFieldEdit(entry: any, edited: any, field: string): void {
	const keys = field === "reasoning" ? ["reasoning", "thinkingLevelMap"]
		: field === "context" ? ["contextWindow", "defaultContextWindow", "maxContextWindow"]
		: [field === "image" ? "input" : "maxTokens"];
	for (const key of [...keys, "manualFields"]) {
		if (edited[key] === undefined) delete entry[key];
		else entry[key] = edited[key];
	}
	const sourceKeys = field === "reasoning" ? ["reasoning", "effortOptions"]
		: [field === "context" ? "contextWindow" : field === "maxtokens" ? "maxTokens" : field];
	const defaulted = new Set<string>(entry.defaultedFields ?? []);
	for (const key of sourceKeys) {
		if (edited.defaultedFields?.includes(key)) defaulted.add(key);
		else defaulted.delete(key);
	}
	if (defaulted.size) entry.defaultedFields = [...defaulted];
	else delete entry.defaultedFields;
}

export function applyMetaChanges(entry: any, changes: MetaChange[]): void {
	for (const { key, value } of changes) {
		if (value === undefined) delete entry[key];
		else entry[key] = value;
	}
}
