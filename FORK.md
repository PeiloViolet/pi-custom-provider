# pi-custom-provider

This fork preserves better-custom-provider 1.6.0's /custom-provider wizard and vendors model-probe 0.7.0 with a protocol authentication fix. Original MIT licenses remain in LICENSE and vendor/model-probe/LICENSE.

## Install on another computer

```powershell
pi install git:github.com/PeiloViolet/pi-custom-provider@v1.6.0-fix.2
```

Remove or disable the original better-custom-provider first (use `pi list` to find its exact source, then `pi remove <source>`), because both register /custom-provider. Restart Pi and run /custom-provider. Choose OpenAI-compatible, enter your endpoint and API key, then Auto-detect. Credentials stay on that computer; this repository contains no credentials or personal model configuration.

## Fix

OpenAI discovery and per-model metadata requests no longer unconditionally carry x-goog-api-key. Native Gemini endpoints ending in /v1beta retain that header. Some gateways reject a valid Bearer token when a second authentication header is present. Host imports use @earendil-works packages supplied by current Pi. Probe sources are vendored and imported relatively, so dependency updates cannot silently undo the fix.

Auto-detect fills missing endpoint-matched catalog entries by searching models.dev across providers for each selected model ID, reusing the manual Refresh metadata lookup. Recognized model families prefer the maker's entry (OpenAI, Anthropic, Google, DeepSeek, xAI, Moonshot); other matches retain the existing lookup order. models.dev is a third-party catalog, including when its entry describes a model maker.

When adding a custom provider, a catalog fallback opens a source picker. **Accept recommended** is selected initially, so Enter accepts without editing. Each source row opens the shared per-model capability menu (reasoning, image input, context, maximum output); **Done** uses that draft, while Esc discards the draft and returns to the source picker. **Skip catalog fallback** or Esc in the source picker rejects the catalog source and keeps endpoint/local-rule/default values. Effective endpoint values are included in the editor. Confirmed edits, including cleared limits, win at save time. Nothing is persisted during review. Re-probing retains its existing metadata reconciliation UI; Ollama stays on native metadata.

The capability field menu and handlers are shared by fallback review, manual entry, and Edit per model. Existing model editing still saves one field at a time and preserves unrelated headers, overrides and pricing. Manual-entry Esc discards the current draft. Catalog effort mappings and prices survive edits to unrelated fields.

**Default context** and **Maximum context** are separate. New GPT-6 Sol/Luna/Astra entries use an application default of 272,000 tokens; other models start at no more than 262,144 tokens. A known smaller capacity lowers the default. These are application defaults, not manufacturer declarations. Catalog and detected capacities remain available as Maximum context and require an explicit selection to enable the full window. Custom context accepts a token count within the known maximum; output tokens are edited separately. Unknown capacity stays unknown: protocol fallback values are not treated as advertised limits. Pi's active `contextWindow` and the extension's `maxContextWindow` capacity metadata are saved separately. Refreshing metadata preserves the current active window (including Pi's implicit 128,000-token default for older entries); a lower capacity can shrink it. Existing entries without capacity metadata show an unknown maximum until verified metadata is refreshed.

Implementation choice: keeping silent fallback offers no review; saving first and reusing the persisted editor would write an unconfirmed provider. Shared capability prompts operating on drafts let the add flow review before save, while the persisted editor keeps its existing save behavior. Source facts: `src/flows/add.ts` collects before persistence, `src/ui/prompts.ts` owns staged prompts, and `src/flows/edit.ts` edits already-persisted models.

Discovery does not guarantee accurate context/output limits. The original wizard combines detected metadata, catalogs, rules, and fallback defaults; defaults are not verified server limits. No chat protocol or model capability is inferred from a successful model-list response.

## Local installation and checks

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm test
pi install .
```

Tests require Node 22.18+ (Node 24+ recommended). For Git distribution commit package.json, package-lock.json, sources, vendor, tests and license files, then push and tag. Pi installs runtime dependencies for Git packages. npm publication is optional; the pi manifest and pi-package keyword already describe the package resources.

Upstream: https://github.com/real-wudaoshi/better-custom and https://github.com/real-wudaoshi/model-probe.
