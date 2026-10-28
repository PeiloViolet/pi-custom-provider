# pi-custom-provider

This fork preserves better-custom-provider 1.6.0's /custom-provider wizard and vendors model-probe 0.7.0 with a protocol authentication fix. Original MIT licenses remain in LICENSE and vendor/model-probe/LICENSE.

## Install on another computer

```powershell
pi install git:github.com/PeiloViolet/pi-custom-provider@v1.6.0-fix.2
```

Remove or disable the original better-custom-provider first (use `pi list` to find its exact source, then `pi remove <source>`), because both register /custom-provider. Restart Pi and run /custom-provider. Choose OpenAI-compatible, enter your endpoint and API key, then Auto-detect. Credentials stay on that computer; this repository contains no credentials or personal model configuration.

## Fix

OpenAI discovery and per-model metadata requests no longer unconditionally carry x-goog-api-key. Native Gemini endpoints ending in /v1beta retain that header. Some gateways reject a valid Bearer token when a second authentication header is present. Host imports use @earendil-works packages supplied by current Pi. Probe sources are vendored and imported relatively, so dependency updates cannot silently undo the fix.

Auto-detect now fills missing endpoint-matched catalog entries by searching models.dev across providers for each selected model ID, reusing the manual Refresh metadata lookup. Recognized model families prefer the maker's entry (OpenAI, Anthropic, Google, DeepSeek, xAI, Moonshot); other matches retain the existing lookup order. The wizard reports the selected catalog source. Endpoint-reported fields and endpoint-matched catalog entries retain priority, Ollama stays on native metadata, and missing catalog data still falls back to local rules/defaults. This also applies to re-probing models; manual entry keeps its explicit settings. models.dev is a third-party catalog, including when its entry describes a model maker.

Discovery does not guarantee accurate context/output limits. The original wizard combines detected metadata, catalogs, rules, and fallback defaults; defaults are not verified server limits. No chat protocol or model capability is inferred from a successful model-list response.

## Local installation and checks

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm test
pi install .
```

Tests require Node 22.18+ (Node 24+ recommended). For Git distribution commit package.json, package-lock.json, sources, vendor, tests and license files, then push and tag. Pi installs runtime dependencies for Git packages. npm publication is optional; the pi manifest and pi-package keyword already describe the package resources.

Upstream: https://github.com/real-wudaoshi/better-custom and https://github.com/real-wudaoshi/model-probe.
