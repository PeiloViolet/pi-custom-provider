# pi-custom-provider

This fork preserves better-custom-provider 1.6.0's /custom-provider wizard and vendors model-probe 0.7.0 with a protocol authentication fix. Original MIT licenses remain in LICENSE and vendor/model-probe/LICENSE.

## Install on another computer

```powershell
pi install git:github.com/PeiloViolet/pi-custom-provider@v1.6.0-fix.2
```

Remove or disable the original better-custom-provider first (use `pi list` to find its exact source, then `pi remove <source>`), because both register /custom-provider. Restart Pi and run /custom-provider. Choose OpenAI-compatible, enter your endpoint and API key, then Auto-detect. Credentials stay on that computer; this repository contains no credentials or personal model configuration.

## Fix

OpenAI discovery and per-model metadata requests no longer unconditionally carry x-goog-api-key. Native Gemini endpoints ending in /v1beta retain that header. Some gateways reject a valid Bearer token when a second authentication header is present. Host imports use @earendil-works packages supplied by current Pi. Probe sources are vendored and imported relatively, so dependency updates cannot silently undo the fix.

Auto-detect fills missing endpoint-matched catalog entries by searching models.dev across providers for each selected model ID, reusing the Refresh model info lookup. Recognized model families prefer the maker's entry (OpenAI, Anthropic, Google, DeepSeek, xAI, Moonshot); other matches retain the existing lookup order. models.dev is a third-party catalog, including when its entry describes a model maker.

Adding from a custom endpoint or the catalog collects model information automatically, then opens one **Edit models** list for all selected models. It uses the same model rows as Edit per model; selecting a model directly opens the shared capability editor. There are no per-model catalog source confirmations. **Done** in the model editor keeps that draft and returns to the list; Esc discards that model's draft. **Done** in the list continues saving the provider, while Esc cancels adding. Effective endpoint values and automatically selected catalog metadata are included in the editor. Confirmed edits, including cleared limits, win at save time. Nothing is persisted during review. Refresh models automatically updates found metadata for kept models; its model list only controls adding/removing models. Ollama stays on native metadata.

The capability field menu and handlers are shared by the collected-model list, manual entry, and Edit per model. Existing model editing still saves one field at a time and preserves unrelated headers, overrides and pricing. Manual-entry Esc discards the current draft. Catalog effort mappings and prices survive edits to unrelated fields.

**Automatic and manual metadata.** All models, including existing configurations, are automatic unless a field has been explicitly edited. Refresh models and Refresh model info overwrite the fields actually found, without a keep-old-values choice or an extra apply confirmation. Missing values and protocol fallback limits do not overwrite stored metadata. Editing a field marks only that field as manual; other fields continue updating. The shared editor persists these overrides in `manualFields`. **Use automatic metadata** clears the overrides and refreshes the model. Failed refreshes leave the overrides intact.

**Default context** and **Maximum context** come only from model metadata. No protocol or model-name rule supplies a context window. When the source reports `context_window` alongside `max_context_window`, keep the former as the model default and the latter as maximum capacity; a separately named `default_context_window` is also supported. If only one context window is reported, use that model value. An explicit default is capped by a known smaller maximum. Missing context stays unknown. Save a separately reported model default as `defaultContextWindow`, active window as `contextWindow`, and maximum as `maxContextWindow`, so manual edits do not lose the model default. A capacity-only refresh preserves a known model default; a capacity-only model uses its current reported window without saving a fabricated default. Refresh updates automatic fields from actual metadata and preserves manual fields. The context menu has only **Automatic** and **Manual**; automatic can return to an unknown value while waiting for metadata. Output tokens are a separate field. Codex's displayed 258K is a different client calculation: its model metadata reports 272,000 and a 95% effective-window ratio, yielding 258,400 usable tokens. It does not establish an OpenAI protocol default.

The add flow reviews all collected models together before saving, reusing `providerModelItems` for model rows and `promptModelMetadata` for draft editing. The persisted editor keeps its existing per-field save behavior. Source facts: `src/flows/add.ts` collects before persistence, `src/flows/shared.ts` owns the collected-model list, `src/ui/prompts.ts` owns the field editor, and `src/flows/edit.ts` edits already-persisted models.

Discovery does not guarantee accurate context/output limits. The original wizard combines detected metadata, catalogs, and fallback defaults; defaults are not verified server limits. No chat protocol or model capability is inferred from a successful model-list response.

## Local installation and checks

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm test
pi install .
```

Tests require Node 22.18+ (Node 24+ recommended). For Git distribution commit package.json, package-lock.json, sources, vendor, tests and license files, then push and tag. Pi installs runtime dependencies for Git packages. npm publication is optional; the pi manifest and pi-package keyword already describe the package resources.

Upstream: https://github.com/real-wudaoshi/better-custom and https://github.com/real-wudaoshi/model-probe.
