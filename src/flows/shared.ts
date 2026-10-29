import {
	fetchGatewayWideInfo as probeGatewayWideInfo,
	fetchModelsDevInfoForBaseUrl,
	fetchModelsDevModels,
	fetchModelsDevProviders,
	fetchPerModelInfo,
	finalizeModelInfo,
	normalizeModelIdCandidates,
	probeInfoSummary,
	resolveModelInfo,
} from "../../vendor/model-probe/index.ts";
import { resolveApiKeyForProbe, serializeApiKey } from "../api-key.ts";
import { BUILTIN_PROVIDER_IDS, loadModelsConfig, MODELS_JSON_PATH, removeProviderApiKey, saveModelsConfig, saveProviderApiKey } from "../config.ts";
import { buildModelEntry, modelIdOf, modelOptionsFromProbe, readModelOptions } from "../model-entry.ts";
import { AUTO_PROBE_PROFILE } from "../presets.ts";
import { fillCatalogFallback } from "../catalog-fallback.ts";
import { contextWindowSource, automaticContextWindow } from "../context-window.ts";
import { promptModelMetadata } from "../ui/prompts.ts";
import { selectOne } from "../ui/select.ts";
import type { GatewayProbeProfile } from "../presets.ts";
import type {
	ApiKeyMode,
	CommandContext,
	ModelOptions,
	ModelProbeInfo,
	ModelsConfig,
	ProviderApi,
	ProviderStyle,
	SelectItem,
} from "../types.ts";
import { dedupe, normalizeEndpoint } from "../url.ts";

// Load config, hand the provider to a mutator, and save if it returns true.
export async function mutateProvider(
	ctx: CommandContext,
	providerId: string,
	mutate: (provider: any) => boolean | Promise<boolean>,
): Promise<boolean> {
	let config: ModelsConfig;
	try {
		config = loadModelsConfig();
	} catch (error) {
		ctx.ui.notify(`Could not read ${MODELS_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}
	const provider = config.providers?.[providerId];
	if (!provider) {
		ctx.ui.notify(`Provider "${providerId}" no longer exists.`, "warning");
		return false;
	}

	const changed = await mutate(provider);
	if (!changed) return false;

	try {
		saveModelsConfig(config);
	} catch (error) {
		ctx.ui.notify(`Could not write ${MODELS_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}
	await refreshModelRegistry(ctx);
	return true;
}

// pi reads models.json once at startup and keeps it in memory. After every
// write, reload it into the running session so added/removed models show up
// in /model immediately instead of after a restart. Best-effort: the file is
// already saved, a failed refresh must not fail the mutation.
export async function refreshModelRegistry(ctx: CommandContext): Promise<void> {
	try {
		await ctx.modelRegistry?.refresh();
	} catch {
		// The config is on disk; a stale in-memory snapshot fixes itself on
		// restart, so a refresh failure is not worth an error dialog.
	}
}

// Mutate a single model entry in place and save.
export async function mutateModel(ctx: CommandContext, providerId: string, modelId: string, mutate: (model: any) => void): Promise<boolean> {
	return mutateProvider(ctx, providerId, (p) => {
		const models = Array.isArray(p.models) ? p.models : [];
		const index = models.findIndex((m: any) => modelIdOf(m) === modelId);
		if (index === -1) return false;
		// Strings become objects so per-field knobs have somewhere to live.
		if (typeof models[index] === "string") models[index] = { id: modelId, input: ["text", "image"] };
		mutate(models[index]);
		return true;
	}).then((saved) => {
		if (saved) ctx.ui.notify(`Updated "${modelId}".`, "info");
		return saved;
	});
}

export function describeProvider(providerId: string, provider: any): string {
	const modelCount = Array.isArray(provider?.models) ? provider.models.length : 0;
	const endpoint = typeof provider?.baseUrl === "string" ? provider.baseUrl : "(no baseUrl)";
	const api = typeof provider?.api === "string" ? provider.api : "(no api)";
	return `${providerId}\n${api} • ${modelCount} model${modelCount === 1 ? "" : "s"}\n${endpoint}`;
}

export function describeProviderInline(providerId: string, provider: any): { label: string; suffix: string; searchText: string } {
	const modelCount = Array.isArray(provider?.models) ? provider.models.length : 0;
	const endpoint = typeof provider?.baseUrl === "string" ? provider.baseUrl : "(no baseUrl)";
	const api = typeof provider?.api === "string" ? provider.api : "(no api)";
	// Flag ids that collide with pi's built-in providers — merging and shared
	// auth surprise users otherwise (see BUILTIN_COLLISION_WARNING).
	const collision = BUILTIN_PROVIDER_IDS.has(providerId) ? " • ⚠ built-in id" : "";
	const suffix = ` • ${api} • ${endpoint} • ${modelCount} model${modelCount === 1 ? "" : "s"}${collision}`;
	return {
		label: providerId,
		suffix,
		searchText: `${providerId} ${api} ${endpoint} ${modelCount}`,
	};
}

export function providerModelItems(provider: any): SelectItem[] {
	const models = Array.isArray(provider?.models) ? provider.models : [];
	return models
		.map((model: any) => {
			const id = typeof model === "string" ? model.trim() : typeof model?.id === "string" ? model.id.trim() : "";
			if (!id) return null;

			const details: string[] = [];
			if (model && typeof model === "object") {
				const defaulted = new Set<string>(model.defaultedFields ?? []);
				const tag = (field: string) => defaulted.has(field) ? " [runtime fallback]" : "";
				if (model.reasoning === true) {
					const opts = readModelOptions(model);
					details.push(`reasoning:${opts.reasoning}${tag("reasoning")}${defaulted.has("effortOptions") ? " [default ceiling]" : ""}`);
				}
				if (Array.isArray(model.input) && model.input.includes("image")) details.push(`image${tag("image")}`);
				else if (defaulted.has("image")) details.push("image:off [runtime fallback]");
				if (typeof model.contextWindow === "number") {
					const source = model.manualFields?.includes("context") ? "manual"
						: model.contextWindow === automaticContextWindow(model.maxContextWindow)
							? contextWindowSource(model.maxContextWindow) : "stored";
					details.push(`context ${model.contextWindow} [${source}]`);
				}
				if (typeof model.maxContextWindow === "number") details.push(`max-context ${model.maxContextWindow}`);
				if (typeof model.maxTokens === "number") details.push(`max-out ${model.maxTokens}${tag("maxTokens")}`);
				if (model.cost && typeof model.cost === "object") details.push(`$${model.cost.input}/$${model.cost.output} per 1M`);
			}

			return {
				value: id,
				label: id,
				suffix: details.length > 0 ? ` • ${details.join(" • ")}` : "",
				searchText: `${id} ${details.join(" ")}`,
			};
		})
		.filter((item: any): item is SelectItem => item !== null);
}

// Review all collected models in the same list used by Edit per model. Opening
// a row edits a draft; only Done returns the options for provider persistence.
export async function reviewModelEntries(
	ctx: CommandContext, ids: string[], infoById: Map<string, ModelProbeInfo>, api: ProviderApi,
): Promise<Map<string, ModelOptions> | null> {
	const options = new Map(ids.map((id) => [id, modelOptionsFromProbe(
		resolveModelInfo(id, infoById.get(id), undefined, api), { reasoning: "xhigh", image: false },
	)]));
	let cursor = 0;
	while (true) {
		const items = providerModelItems({ models: ids.map((id) => buildModelEntry(id, options.get(id)!)) });
		const choice = await selectOne(ctx, "Edit models", [
			...items,
			{ value: "\u0000done", label: "Done", description: "Use these models and save the provider" },
		], { initialIndex: cursor });
		if (choice === null) return null;
		if (choice === "\u0000done") return options;
		cursor = items.findIndex((item) => item.value === choice);
		const edited = await promptModelMetadata(ctx, `Edit ${choice}`, options.get(choice)!);
		if (edited) options.set(choice, edited);
	}
}

function normalizeStoredEndpoint(provider: any): string {
	const endpoint = typeof provider?.baseUrl === "string" ? provider.baseUrl.trim() : "";
	if (!endpoint) return "";
	const stored = provider?.api;
	const api: ProviderApi =
		stored === "anthropic-messages" || stored === "openai-responses" ? stored : "openai-completions";
	try {
		return normalizeEndpoint(endpoint, api);
	} catch {
		return endpoint.replace(/\/+$/, "");
	}
}

export function findProvidersByEndpoint(config: ModelsConfig, endpoint: string): string[] {
	return Object.entries(config.providers ?? {})
		.filter(([, provider]) => normalizeStoredEndpoint(provider) === endpoint)
		.map(([providerId]) => providerId)
		.sort((a, b) => a.localeCompare(b));
}

// Delete a whole provider from the models config.
export async function removeProvider(ctx: CommandContext, providerId: string): Promise<boolean> {
	let config: ModelsConfig;
	try {
		config = loadModelsConfig();
	} catch (error) {
		ctx.ui.notify(`Could not read ${MODELS_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}
	if (!config.providers?.[providerId]) {
		ctx.ui.notify(`Provider "${providerId}" no longer exists.`, "warning");
		return false;
	}
	delete config.providers[providerId];
	try {
		saveModelsConfig(config);
	} catch (error) {
		ctx.ui.notify(`Could not write ${MODELS_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}
	await refreshModelRegistry(ctx);
	// Drop the auth.json entry along with the provider so no orphan key stays
	// behind. Best-effort: a failing auth write must not undo the deletion.
	try {
		removeProviderApiKey(providerId);
	} catch (error) {
		ctx.ui.notify(`Provider deleted, but its auth.json entry could not be removed: ${error instanceof Error ? error.message : String(error)}`, "warning");
	}
	ctx.ui.notify(`Deleted provider "${providerId}" from ${MODELS_JSON_PATH}`, "info");
	return true;
}

export async function persistProvider(ctx: CommandContext, providerId: string, providerConfig: any): Promise<boolean> {	let config: ModelsConfig;
	try {
		config = loadModelsConfig();
	} catch (error) {
		ctx.ui.notify(`Could not read ${MODELS_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}

	config.providers ||= {};
	if (config.providers[providerId]) {
		// Names are validated unique at prompt time; this only triggers if the
		// config changed underneath us. Refuse rather than overwrite.
		ctx.ui.notify(`Provider "${providerId}" already exists. Not overwriting.`, "error");
		return false;
	}

	config.providers[providerId] = providerConfig;
	try {
		saveModelsConfig(config);
	} catch (error) {
		ctx.ui.notify(`Could not write ${MODELS_JSON_PATH}: ${error instanceof Error ? error.message : String(error)}`, "error");
		return false;
	}
	await refreshModelRegistry(ctx);
	return true;
}

// Write a provider's key into auth.json (pi's official credential file, the
// one /login writes). Call AFTER persistProvider succeeds. No-op where keys
// stay inline (OMP) or nothing was entered.
export function persistApiKey(
	ctx: CommandContext,
	providerId: string,
	apiKey: { mode: ApiKeyMode; value?: string },
	style: ProviderStyle,
): boolean {
	const serialized = serializeApiKey(apiKey.mode, apiKey.value, style);
	if (!serialized) return true;
	try {
		saveProviderApiKey(providerId, serialized);
		return true;
	} catch (error) {
		ctx.ui.notify(
			`Provider saved, but the API key could not be written to auth.json: ${error instanceof Error ? error.message : String(error)}. Run "/login ${providerId}" to set it.`,
			"warning",
		);
		return false;
	}
}

export async function addModelEntriesToProvider(
	ctx: CommandContext,
	providerId: string,
	ids: string[],
	infoById?: Map<string, ModelProbeInfo>,
	// Confirmed per-model options win over resolved values, including clears.
	optionOverrides?: Map<string, ModelOptions>,
) {
	const existing = new Set<string>();
	try {
		const provider = loadModelsConfig().providers?.[providerId];
		for (const m of Array.isArray(provider?.models) ? provider.models : []) existing.add(modelIdOf(m));
	} catch {
		// fall through; mutateProvider re-reads and reports errors
	}
	const fresh = dedupe(ids).filter((id) => id && !existing.has(id));
	if (fresh.length === 0) {
		ctx.ui.notify("Nothing to add — all selected models already exist.", "info");
		return;
	}

	// Queries win; missing values use uniform runtime fallbacks. Reasoning
	// defaults on with an xhigh ceiling, and image defaults off. Provenance is
	// saved so these settings are not shown as queried model capabilities.
	// Tune per model later via Edit provider → Edit a model.
	const defaultOpts: ModelOptions = { reasoning: "xhigh", image: true };
	let detectedCount = 0;
	const saved = await mutateProvider(ctx, providerId, (p) => {
		const api = typeof p.api === "string" ? (p.api as ProviderApi) : undefined;
		const models = Array.isArray(p.models) ? p.models : [];
		for (const id of fresh) {
			const mergedInfo = resolveModelInfo(id, infoById?.get(id), undefined, api);
			if (probeInfoSummary(mergedInfo).length > 0) detectedCount++;
			const override = optionOverrides?.get(id);
			const opts = override ?? modelOptionsFromProbe(mergedInfo, defaultOpts);
			models.push(buildModelEntry(id, opts));
		}
		p.models = models;
		return true;
	});
	if (saved) {
		const detail =
			detectedCount > 0 ? ` — auto-detected metadata for ${detectedCount} model${detectedCount === 1 ? "" : "s"}` : "";
		ctx.ui.notify(`Added ${fresh.length} model${fresh.length === 1 ? "" : "s"} to "${providerId}"${detail}.`, "info");
	}
}

// Gateway-wide metadata sources: each answers for EVERY model in a single
// call (LiteLLM /model/info, /model_group/info, the site public catalog).
// Cheap enough to run before the model picker so it can show real values.
// Ollama has no gateway-wide source — its native probing is per-model.
// Thin wrapper over model-probe that resolves the api key first.
export async function fetchGatewayWideInfo(
	style: ProviderStyle,
	apiKey: { mode: ApiKeyMode; value?: string },
	baseUrl: string,
	profile: GatewayProbeProfile,
): Promise<Map<string, ModelProbeInfo>> {
	// Ollama and Gemini have no LiteLLM-style gateway-wide metadata endpoints.
	if (style === "ollama" || style === "gemini") return new Map();
	return probeGatewayWideInfo(baseUrl, { apiKey: resolveApiKeyForProbe(apiKey.mode, apiKey.value), profile });
}

export async function collectProbedModelInfo(
	ctx: CommandContext,
	style: ProviderStyle,
	apiKey: { mode: ApiKeyMode; value?: string },
	baseUrl: string,
	ids: string[],
	listInfo: Map<string, ModelProbeInfo>,
	gatewayWide?: Map<string, ModelProbeInfo>,
	modelsDev?: Map<string, ModelProbeInfo>,
	// Accepted by model-probe for compatibility; runtime fallbacks are uniform.
	api?: ProviderApi,
): Promise<Map<string, ModelProbeInfo>> {
	ctx.ui.notify("Fetching model metadata (context, max-out, image/video, reasoning) ...", "info");
	const profile = AUTO_PROBE_PROFILE;
	const resolvedKey = resolveApiKeyForProbe(apiKey.mode, apiKey.value);

	const gw = gatewayWide ?? (await fetchGatewayWideInfo(style, apiKey, baseUrl, profile));

	// Per-model details for the picked ids. Skipped when a gateway-wide source
	// already answered for everything (LiteLLM's /models/{id} has no metadata).
	let details = new Map<string, ModelProbeInfo>();
	if (style === "ollama") {
		details = await fetchPerModelInfo(baseUrl, ids, { apiKey: resolvedKey, ollama: true });
	} else if (profile.perModelDetails && gw.size === 0) {
		details = await fetchPerModelInfo(baseUrl, ids, { apiKey: resolvedKey });
	}

	// Resolve catalog fallback below gateway values. The add flow reviews the
	// complete model list after all metadata has been collected.
	const detected = new Map<string, ModelProbeInfo>();
	for (const map of [listInfo, gw, details]) {
		for (const [id, info] of map) detected.set(id, { ...detected.get(id), ...info });
	}
	const dev = profile.modelsDev && style !== "ollama"
		? await fetchAutomaticCatalogInfo(ctx, baseUrl, ids, modelsDev)
		: modelsDev;
	return finalizeModelInfo(ids, [detected], { modelsDev: dev, api });
}

// The ollama style leaves a compat object with BOTH flags false; every other
// style writes only supportsDeveloperRole. Keying on compat's presence alone
// misreads plain OpenAI-compatible providers as Ollama.
export function providerStyleOf(provider: unknown): ProviderStyle {
	if (!provider || typeof provider !== "object") return "openai";
	if ("api" in provider) {
		const api = provider.api;
		if (api === "anthropic-messages") return "anthropic";
		if (api === "google-generative-ai") return "gemini";
	}
	if ("compat" in provider && provider.compat && typeof provider.compat === "object") {
		const compat = provider.compat;
		if ("supportsDeveloperRole" in compat && "supportsReasoningEffort" in compat) {
			const developerRole = compat.supportsDeveloperRole;
			const reasoningEffort = compat.supportsReasoningEffort;
			if (developerRole === false && reasoningEffort === false) return "ollama";
		}
	}
	return "openai";
}

export type ModelsDevOption = { providerId: string; key: string; info: ModelProbeInfo; rank: number };

// Custom relay URLs rarely match a catalog provider. Reuse the manual refresh
// lookup automatically, retaining endpoint metadata above catalog values.
export async function fetchAutomaticCatalogInfo(
	ctx: CommandContext,
	baseUrl: string,
	ids: string[],
	matched?: Map<string, ModelProbeInfo>,
): Promise<Map<string, ModelProbeInfo>> {
	const endpointInfo = matched ?? await fetchModelsDevInfoForBaseUrl(baseUrl);
	return fillCatalogFallback(ids, endpointInfo, fetchModelsDevOptionsForModel, (id, option) => {
		ctx.ui.notify(`${id}: metadata from models.dev (${option.providerId}/${option.key}).`, "info");
	});
}

// Look up every models.dev catalog entry matching a model id, across all
// providers, ignoring which endpoint the local provider points at. Relay
// gateways decorate ids with prefixes (foo/openai/gpt-5.6-sol) and models.dev
// keys official-provider models without the vendor prefix (anthropic's table
// has "claude-sonnet-5") while aggregators key them with it, so every
// normalization candidate is looked up as-is and with each leading segment
// dropped. Options are ordered best-guess-first: the vendor named in the id
// wins, then providers by how often the catalog cites "vendor/key" (the
// maker's entry is cited far more than any host's copy), then catalog order.
export async function fetchModelsDevOptionsForModel(modelId: string): Promise<ModelsDevOption[]> {
	const providers = await fetchModelsDevProviders();
	const tables = new Map<string, Map<string, ModelProbeInfo>>();
	for (const provider of providers.values()) {
		tables.set(provider.id, await fetchModelsDevModels(provider.id));
	}
	// fetchModelsDevProviders only lists providers with an OpenAI-compatible
	// baseUrl; native-API makers (anthropic, google, zai, ...) are absent. The
	// rest of the catalog still cites them as "vendor/model", so every cited
	// slug without a table yet gets one loaded through fetchModelsDevModels,
	// which reads the full catalog directly.
	const referenceCounts = new Map<string, number>();
	for (const table of tables.values()) {
		for (const id of table.keys()) {
			const separator = id.indexOf("/");
			if (separator <= 0) continue;
			const vendor = id.slice(0, separator).toLowerCase();
			referenceCounts.set(vendor, (referenceCounts.get(vendor) ?? 0) + 1);
		}
	}
	for (const slug of referenceCounts.keys()) {
		if (tables.has(slug)) continue;
		const table = await fetchModelsDevModels(slug);
		if (table.size > 0) tables.set(slug, table);
	}

	const seen = new Set<string>();
	const options: ModelsDevOption[] = [];
	const collect = (providerId: string, key: string, rank: number) => {
		const dedupe = `${providerId}\0${JSON.stringify(key)}`;
		if (seen.has(dedupe)) return;
		seen.add(dedupe);
		const info = tables.get(providerId)?.get(key);
		if (info) options.push({ providerId, key, info, rank });
	};

	for (const candidate of normalizeModelIdCandidates(modelId)) {
		const segments = candidate.split("/");
		const keys = segments.length > 1 ? segments.slice(1).map((_, i) => segments.slice(i + 1).join("/")) : [candidate];
		for (const key of keys) {
			const holders = [...tables.keys()]
				.filter(providerId => tables.get(providerId)?.has(key))
				.sort(
					(a, b) =>
						(referenceCounts.get(b.toLowerCase()) ?? 0) - (referenceCounts.get(a.toLowerCase()) ?? 0) ||
						a.length - b.length,
				);
			for (const providerId of holders) collect(providerId, key, 1);
		}
		if (options.length > 0) break;
	}
	return options.sort((a, b) => a.rank - b.rank);
}
