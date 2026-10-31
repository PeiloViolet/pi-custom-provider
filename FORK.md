# pi-custom-provider

This fork preserves better-custom-provider 1.6.0's /custom-provider wizard and vendors model-probe 0.7.0 with a protocol authentication fix. Original MIT licenses remain in LICENSE and vendor/model-probe/LICENSE.

## Install on another computer

```powershell
pi install git:github.com/PeiloViolet/pi-custom-provider@master
```

This tracks the merged fixes on `master`. For an existing tag-pinned installation, run the same command to replace the configured ref with `master`, then run `/reload` in Pi before reopening `/custom-provider`.

Remove or disable the original better-custom-provider first (use `pi list` to find its exact source, then `pi remove <source>`), because both register /custom-provider. Restart Pi and run /custom-provider. Choose OpenAI-compatible, enter your endpoint and API key, then Auto-detect. Credentials stay on that computer; this repository contains no credentials or personal model configuration.

## Fix

OpenAI discovery and per-model metadata requests no longer unconditionally carry x-goog-api-key. Native Gemini endpoints ending in /v1beta retain that header. Some gateways reject a valid Bearer token when a second authentication header is present. Host imports use @earendil-works packages supplied by current Pi. Probe sources are vendored and imported relatively, so dependency updates cannot silently undo the fix.

Auto-detect fills missing endpoint-matched catalog entries by searching models.dev across providers for each selected model ID, reusing the Refresh model info lookup. Matches retain the catalog lookup order; no model-family table or vendor prefix promotes a provider. models.dev is a third-party catalog, including when its entry describes a model maker.

**Select models** displays model IDs only, on both custom-endpoint and catalog paths. Custom endpoints fetch the model list first and defer gateway-wide, per-model, and catalog metadata queries until after selection. Catalog paths already have directory records but still display IDs only at selection. The flow then opens one **Edit models** list for all selected models with resolved metadata and the half-capacity runtime window. It uses the same model rows as Edit per model; selecting a model directly opens the shared capability editor. There are no per-model catalog source confirmations. **Done** in the model editor keeps that draft and returns to the list; Esc discards that model's draft. **Done** in the list continues saving the provider, while Esc cancels adding. Effective endpoint values and automatically selected catalog metadata are included in the editor. Confirmed edits win at save time; resetting output tokens selects the uniform runtime fallback. Nothing is persisted during review. Refresh models automatically updates found metadata for kept models; its model list only controls adding/removing models. Ollama stays on native metadata.

The capability field menu and handlers are shared by the collected-model list, manual entry, and Edit per model. Existing model editing still saves one field at a time and preserves unrelated headers, overrides and pricing. Manual-entry Esc discards the current draft. Catalog effort mappings and prices survive edits to unrelated fields.

**Automatic and manual metadata.** All models, including existing configurations, are automatic unless a field has been explicitly edited. Refresh models and Refresh model info overwrite the fields actually found, without a keep-old-values choice or an extra apply confirmation. Missing values and runtime fallbacks do not overwrite stored metadata during ordinary refresh. Editing a field marks only that field as manual; other fields continue updating. The shared editor persists these overrides in `manualFields`. **Use automatic metadata** replaces formerly manual fields with queried values or runtime fallbacks and clears the overrides. Failed refreshes leave the overrides intact. `defaultedFields` persists runtime provenance; real query results and manual edits clear the corresponding markers.

**Queried capacity** and **Automatic runtime window** are distinct. The supported metadata contains capacity, not an independent model-default window. The parser reads the existing supported capacity fields and does not infer Codex-specific field pairs or unverified default aliases. Automatic runtime context is half the queried capacity, rounded down and at least one token; without capacity data it uses the uniform 65,536 runtime fallback. Save the active window as `contextWindow` and queried capacity as `maxContextWindow`. Obsolete default-window metadata is ignored and removed during refresh or context editing without changing a manual active window. No protocol or model-name rule selects capacity. Refresh updates automatic fields from actual metadata and preserves manual fields. The context menu has only **Automatic** and **Manual**; automatic is labeled `50%` or `runtime fallback`. Output tokens remain a separate field with a uniform 32,000 runtime fallback, and queried output limits are preserved without heuristic clamping. Codex's displayed 258K comes from its own metadata and client calculation (272,000 × 95% = 258,400); that structure is not a contract for this extension's data sources.

The add flow reviews all collected models together before saving, reusing `providerModelItems` for model rows and `promptModelMetadata` for draft editing. The persisted editor keeps its existing per-field save behavior. Source facts: `src/flows/add.ts` collects before persistence, `src/flows/shared.ts` owns the collected-model list, `src/ui/prompts.ts` owns the field editor, and `src/flows/edit.ts` edits already-persisted models.

Discovery does not guarantee accurate context/output limits. The original wizard combines detected metadata, catalogs, and fallback defaults; defaults are not verified server limits. No chat protocol or model capability is inferred from a successful model-list response.

## Local installation and checks

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm test
pi install .
```

After editing the installed extension locally, close any open provider menu and run `/reload` in Pi before reopening `/custom-provider`. Pi loads extension modules into the running process; committing files does not replace an already loaded command handler.

Tests require Node 22.18+ (Node 24+ recommended). For Git distribution commit package.json, package-lock.json, sources, vendor, tests and license files, then push and tag. Pi installs runtime dependencies for Git packages. npm publication is optional; the pi manifest and pi-package keyword already describe the package resources.

Upstream: https://github.com/real-wudaoshi/better-custom and https://github.com/real-wudaoshi/model-probe.
