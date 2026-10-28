import { BUILTIN_COLLISION_WARNING, BUILTIN_PROVIDER_IDS, loadModelsConfig } from "../config.ts";
import { resolveModelInfo } from "../../vendor/model-probe/index.ts";
import { REASONING_LEVELS } from "../types.ts";
import { buildModelEntry, modelOptionsFromProbe } from "../model-entry.ts";
import type { CatalogOption } from "../catalog-fallback.ts";
import type { ModelProbeInfo } from "../types.ts";
import type { ApiKeyMode, CommandContext, ModelOptions, ProviderApi, ProviderStyle, ReasoningCeiling, SelectItem } from "../types.ts";
import { normalizeEndpoint, slugify, suggestProviderId } from "../url.ts";
import { selectOne } from "./select.ts";

export async function promptApiKey(
	ctx: CommandContext,
): Promise<{ mode: ApiKeyMode; value?: string } | null> {
	const choice = await selectOne(ctx, "API key", [
		{ value: "literal", label: "API key", description: "Stored in auth.json, like pi's own /login credentials" },
		{ value: "none", label: "None", description: "No key; a placeholder is written so the provider still loads" },
	]);
	if (!choice) return null;
	if (choice === "none") return { mode: "none" };

	const value = await ctx.ui.input("API key", "saved in auth.json under the provider id");
	if (value === undefined) return null;
	const trimmed = value.trim();
	if (!trimmed) return { mode: "none" };
	return { mode: "literal", value: trimmed };
}

function reasoningLabel(level: ReasoningCeiling): string {
	if (level === "off") return "Off - no reasoning";
	if (level === "xhigh") return "xhigh - maximum (only if the model supports it)";
	if (level === "max") return "max - maximum (only if the model supports it)";
	return `${level} - cap reasoning at ${level}`;
}

// Prompts for a reasoning ceiling. Returns null if cancelled.
export async function promptReasoning(ctx: CommandContext, current?: ReasoningCeiling): Promise<ReasoningCeiling | null> {
	const items: SelectItem[] = REASONING_LEVELS.map((level) => ({
		value: level,
		label: reasoningLabel(level),
	}));
	const initialIndex = current ? REASONING_LEVELS.indexOf(current) : 0;
	const choice = await selectOne(ctx, "Reasoning", items, { initialIndex: Math.max(0, initialIndex) });
	return (choice as ReasoningCeiling | null) ?? null;
}

// When a model is capped at xhigh or max, some providers name that level
// differently (e.g. "max"). Offer an optional override for the provider-facing string.
export async function promptCeilingProviderString(ctx: CommandContext, level: "xhigh" | "max", current?: string): Promise<string | null> {
	const value = await ctx.ui.input(
		`${level} provider value (blank = ${level})`,
		current && current !== level ? `current: ${current}` : `e.g. max (leave blank to send "${level}")`,
	);
	if (value === undefined) return null;
	return value.trim() || level;
}

export async function promptImage(ctx: CommandContext, current?: boolean): Promise<boolean | null> {
	const choice = await selectOne(ctx, "Image input", [
		{ value: "yes", label: "Yes - send text + images", description: "Sets input: [text, image]" },
		{ value: "no", label: "No - text only", description: "Sets input: [text]" },
	], { initialIndex: current === false ? 1 : 0 });
	if (!choice) return null;
	return choice === "yes";
}

// Null leaves the field unchanged. Zero resets context to its default or
// clears the output limit, as stated by each caller's placeholder.
async function promptTokenCount(ctx: CommandContext, title: string, current: number | undefined, zeroAction: string): Promise<number | null> {
	const value = await ctx.ui.input(title, `${current ? `current: ${current}` : "tokens"} (blank = keep, 0 = ${zeroAction})`);
	if (value === undefined || !value.trim()) return null;
	const cleaned = value.trim().replace(/[_,]/g, "");
	const parsed = Number(cleaned);
	if (!/^\d+$/.test(cleaned) || !Number.isSafeInteger(parsed)) {
		ctx.ui.notify("Enter a whole number of tokens.", "warning");
		return null;
	}
	return parsed;
}

export async function promptContextWindow(ctx: CommandContext, current?: number): Promise<number | null> {
	return promptTokenCount(ctx, "Custom context window (tokens)", current, "default");
}

export async function promptMaxTokens(ctx: CommandContext, current?: number): Promise<number | null> {
	return promptTokenCount(ctx, "Max output tokens", current, "clear");
}

// The same capability fields and prompts serve staged and persisted models.
export function modelMetadataItems(opts: ModelOptions): SelectItem[] {
	return [
		{ value: "reasoning", label: "Reasoning", suffix: ` • ${opts.reasoning}`, description: "Set the reasoning ceiling (off → max)" },
		{ value: "image", label: "Image input", suffix: ` • ${opts.image ? "on" : "off"}`, description: "Toggle image input (text+image vs text-only)" },
		{ value: "context", label: "Context window", suffix: ` • ${opts.contextWindow ?? "unset"}`, description: `Default context: ${opts.defaultContextWindow ?? "unknown"} • Maximum context: ${opts.maxContextWindow ?? "unknown"}. Select a window to use.` },
		{ value: "maxtokens", label: "Max output tokens", suffix: ` • ${opts.maxTokens ?? "unset"}`, description: "Max tokens this model may generate" },
	];
}

export async function editModelMetadataField(ctx: CommandContext, opts: ModelOptions, field: string): Promise<boolean> {
	if (field === "reasoning") {
		const value = await promptReasoning(ctx, opts.reasoning);
		if (value === null) return false;
		let ceilingOverrides: Partial<Record<"xhigh" | "max", string>> | undefined;
		if (value === "xhigh" || value === "max") {
			const current = opts.thinkingLevelMap?.[value];
			const mapped = await promptCeilingProviderString(ctx, value, typeof current === "string" ? current : undefined);
			if (mapped === null) return false;
			ceilingOverrides = { [value]: mapped };
		}
		const entry = buildModelEntry("draft", { ...opts, reasoning: value, thinkingLevelMap: undefined }, ceilingOverrides);
		opts.reasoning = value;
		opts.thinkingLevelMap = entry.thinkingLevelMap;
	} else if (field === "image") {
		const value = await promptImage(ctx, opts.image);
		if (value === null) return false;
		opts.image = value;
	} else if (field === "context") {
		const items: SelectItem[] = [];
		if (opts.defaultContextWindow) items.push({ value: "default", label: "Default context", suffix: ` • ${opts.defaultContextWindow}`, description: "Use the default context window" });
		if (opts.maxContextWindow && opts.maxContextWindow !== opts.defaultContextWindow) items.push({ value: "maximum", label: "Maximum context", suffix: ` • ${opts.maxContextWindow}`, description: "Enable the full advertised context capacity" });
		items.push({ value: "custom", label: "Custom context", description: "Enter a context window size" });
		const current = opts.contextWindow === opts.defaultContextWindow ? "default"
			: opts.contextWindow === opts.maxContextWindow ? "maximum" : "custom";
		const choice = await selectOne(ctx, "Context window", items, { initialIndex: Math.max(0, items.findIndex((item) => item.value === current)) });
		if (!choice) return false;
		const value = choice === "default" ? opts.defaultContextWindow
			: choice === "maximum" ? opts.maxContextWindow : await promptContextWindow(ctx, opts.contextWindow);
		if (value === null || value === undefined) return false;
		if (opts.maxContextWindow && value > opts.maxContextWindow) {
			ctx.ui.notify(`Context window cannot exceed the maximum context (${opts.maxContextWindow}).`, "warning");
			return false;
		}
		opts.contextWindow = value || opts.defaultContextWindow;
	} else if (field === "maxtokens") {
		const value = await promptMaxTokens(ctx, opts.maxTokens);
		if (value === null) return false;
		opts.maxTokens = value > 0 ? value : undefined;
	} else return false;
	return true;
}

export async function promptModelMetadata(ctx: CommandContext, title: string, initial: ModelOptions): Promise<ModelOptions | null> {
	const opts = structuredClone(initial);
	while (true) {
		const field = await selectOne(ctx, title, [
			...modelMetadataItems(opts),
			{ value: "done", label: "Done", description: "Use these settings and return" },
		]);
		if (field === null) return null;
		if (field === "done") return opts;
		await editModelMetadataField(ctx, opts, field);
	}
}

// Enter accepts the recommended source. Selecting a source row opens the
// shared editor on a draft; nothing is persisted until the provider is saved.
export async function promptCatalogFallback(
	ctx: CommandContext, id: string, candidates: CatalogOption[], recommended: CatalogOption,
	detected: ModelProbeInfo | undefined, api?: ProviderApi,
): Promise<{ selected: CatalogOption; options?: ModelOptions } | null> {
	const ordered = [recommended, ...candidates.filter((candidate) => candidate !== recommended)];
	const resolvedOptions = (candidate: CatalogOption) => modelOptionsFromProbe(
		resolveModelInfo(id, detected, new Map([[id, candidate.info]]), api),
		{ reasoning: "xhigh", image: false }, id,
	);
	const summary = (candidate: CatalogOption) => modelMetadataItems(resolvedOptions(candidate))
		.map((item) => `${item.label}${item.suffix ?? ""}${item.value === "context" ? ` (${item.description})` : ""}`).join(" • ");
	while (true) {
		const choice = await selectOne(ctx, `Catalog fallback for ${id}`, [
			{ value: "accept", label: "Accept recommended", suffix: ` • ${recommended.providerId}/${recommended.key}`, description: `${summary(recommended)}\nEnter to accept; select a source below to edit its settings.` },
			...ordered.map((candidate, index) => ({
				value: String(index), label: `${candidate.providerId}/${candidate.key}`,
				suffix: index === 0 ? " • recommended · edit" : " • edit",
				description: summary(candidate),
			})),
			{ value: "skip", label: "Skip catalog fallback", description: "Keep endpoint values; use local rules/defaults for missing fields" },
		]);
		if (choice === null || choice === "skip") return null;
		if (choice === "accept") return { selected: recommended };
		const selected = ordered[Number(choice)];
		const options = await promptModelMetadata(ctx, `Edit ${id} — ${selected.providerId}/${selected.key}`, resolvedOptions(selected));
		if (options) return { selected, options };
	}
}

// Manual model entry: type an id, land in that model's metadata menu (each
// field opens its own prompt and returns to the menu), then the next id.
// Blank enter or esc on the id prompt exits. Starting values come from
// resolveModelInfo (local rules + defaults — manual ids have no probe data).
// Returns the ids plus every model's confirmed options; null when cancelled
// with nothing entered.
export async function promptManualModels(
	ctx: CommandContext,
	style: ProviderStyle,
): Promise<{ ids: string[]; options: Map<string, ModelOptions> } | null> {
	const placeholder =
		style === "anthropic"
			? "e.g. claude-sonnet-4-5 (blank or esc to finish)"
			: style === "ollama"
				? "e.g. llama3.1:8b or qwen2.5-coder:7b (blank or esc to finish)"
				: style === "gemini"
					? "e.g. gemini-2.5-pro (blank or esc to finish)"
					: "e.g. gpt-4o-mini or qwen/qwen3-coder (blank or esc to finish)";

	const ids: string[] = [];
	const options = new Map<string, ModelOptions>();
	while (true) {
		const value = await ctx.ui.input(ids.length === 0 ? "Model id" : "Add another model id", placeholder);
		if (value === undefined) break; // esc
		const id = value.trim();
		if (!id) break; // blank enter exits
		if (ids.includes(id)) {
			ctx.ui.notify(`Model already added: ${id}`, "warning");
			continue;
		}

		const api: ProviderApi =
			style === "anthropic"
				? "anthropic-messages"
				: style === "gemini"
					? "google-generative-ai"
					: style === "openai-responses"
						? "openai-responses"
						: "openai-completions";
		const resolved = resolveModelInfo(id, undefined, undefined, api);
		const opts = modelOptionsFromProbe(resolved, { reasoning: "xhigh", image: false }, id);
		const edited = await promptModelMetadata(ctx, `Edit ${id}`, opts);
		if (!edited) continue;
		ids.push(id);
		options.set(id, edited);
	}
	return ids.length > 0 ? { ids, options } : null;
}

export async function promptProviderStyle(
	ctx: CommandContext,
): Promise<{ style: ProviderStyle; api: ProviderApi } | null> {
	const choice = await selectOne(ctx, "Provider style", [
		{ value: "openai", label: "OpenAI-compatible (Chat Completions)", description: 'api: "openai-completions" — most OpenAI-compatible servers' },
		{ value: "openai-responses", label: "OpenAI Responses API", description: 'api: "openai-responses" — the newer /responses endpoint' },
		{ value: "anthropic", label: "Anthropic-compatible", description: 'api: "anthropic-messages"' },
		{ value: "gemini", label: "Gemini (Google generative AI)", description: 'api: "google-generative-ai" — native Gemini format, baseUrl includes /v1beta' },
		{ value: "ollama", label: "Ollama-compatible", description: 'api: "openai-completions" with Ollama-specific compat defaults' },
	]);
	if (!choice) return null;

	const style = choice as ProviderStyle;
	const api: ProviderApi =
		style === "anthropic"
			? "anthropic-messages"
			: style === "openai-responses"
				? "openai-responses"
				: style === "gemini"
					? "google-generative-ai"
					: "openai-completions";
	return { style, api };
}

export async function promptEndpoint(
	ctx: CommandContext,
	style: ProviderStyle,
	api: ProviderApi,
): Promise<{ normalized: string; raw: string } | null> {
	const endpointInput = await ctx.ui.input(
		"Endpoint",
		style === "anthropic"
			? "e.g. https://api.anthropic-proxy.com/v1"
			: style === "ollama"
				? "e.g. http://localhost:11434/v1"
				: style === "gemini"
					? "e.g. https://generativelanguage.googleapis.com/v1beta"
					: style === "openai-responses"
						? "e.g. https://api.openai.com/v1"
						: "e.g. https://api.example.com/v1 or http://localhost:11434/v1",
	);
	if (endpointInput === undefined) return null;
	const raw = endpointInput.trim();
	if (!raw) {
		ctx.ui.notify("Endpoint is required.", "error");
		return null;
	}

	try {
		return { normalized: normalizeEndpoint(raw, api), raw };
	} catch (error) {
		ctx.ui.notify(`Invalid endpoint: ${error instanceof Error ? error.message : String(error)}`, "error");
		return null;
	}
}

export async function promptProviderId(ctx: CommandContext, normalizedEndpoint: string, suggestion?: string): Promise<string | null> {
	let existingIds = new Set<string>();
	try {
		existingIds = new Set(Object.keys(loadModelsConfig().providers ?? {}));
	} catch {
		// If config can't be read, persistProvider surfaces the error later.
	}

	const providerIdSuggestion = suggestion ?? suggestProviderId(normalizedEndpoint);
	const suggestionTaken = existingIds.has(providerIdSuggestion);

	while (true) {
		const providerNameInput = await ctx.ui.input(
			suggestionTaken ? "Provider name (must be unique)" : `Provider name (blank = ${providerIdSuggestion})`,
			"e.g. custom-example-com",
		);
		if (providerNameInput === undefined) return null;
		const providerId = slugify(providerNameInput.trim() || providerIdSuggestion);
		if (!providerId) {
			ctx.ui.notify("Provider name is required.", "error");
			continue;
		}

		// Provider names must be unique — never silently overwrite an existing one.
		if (existingIds.has(providerId)) {
			ctx.ui.notify(`Provider "${providerId}" already exists. Choose a different name.`, "warning");
			continue;
		}

		if (BUILTIN_PROVIDER_IDS.has(providerId)) {
			const resolved = await resolveBuiltinCollision(ctx, providerId);
			if (resolved === null) continue;
			if (existingIds.has(resolved)) {
				ctx.ui.notify(`Provider "${resolved}" already exists. Choose a different name.`, "warning");
				continue;
			}
			return resolved;
		}
		return providerId;
	}
}

// One-click way out when an id collides with a built-in provider: rename to
// "<id>-custom", keep the collision (deliberate built-in extension), or go
// back and pick another name. Returns the id to use, or null to re-prompt.
export async function resolveBuiltinCollision(ctx: CommandContext, providerId: string): Promise<string | null> {
	const suggested = `${providerId}-custom`;
	const choice = await selectOne(ctx, `"${providerId}" collides with a built-in provider`, [
		{
			value: "rename",
			label: `Use "${suggested}" instead`,
			description: "Recommended — your models and key stay fully separate from the built-in provider",
		},
		{
			value: "keep",
			label: `Keep "${providerId}"`,
			description: `Extend the built-in on purpose. ${BUILTIN_COLLISION_WARNING}`,
		},
		{ value: "back", label: "Pick another name", description: "Go back and enter a different provider name" },
	]);
	if (choice === "rename") return suggested;
	if (choice === "keep") return providerId;
	return null;
}
