import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

registerHooks({
 load(url, context, next) {
  if (url.endsWith('.ts')) return {
   format: 'module',
   source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')),
   shortCircuit: true,
  };
  return next(url, context);
 },
});
const { fillCatalogFallback } = await import('../src/catalog-fallback.ts');
const { finalizeModelInfo, fetchModelsDevModels } = await import('../vendor/model-probe/index.ts');
const option = (providerId, key, info = { image: true }) => ({ providerId, key, info, rank: 0 });

test('model names never override catalog lookup order', async () => {
 for (const id of ['openrouter/openai/gpt-6.1-sol', 'relay/claude-sonnet-5', 'relay/gemini-3-pro', 'custom']) {
  const first = option('first-provider', id, { image: false, contextWindow: 128000 });
  const other = option('openai', id, { image: true, contextWindow: 1000000 });
  const result = await fillCatalogFallback([id], new Map(), async () => [first, other]);
  assert.deepEqual(result.get(id), first.info);
 }
});

test('endpoint-matched catalog values win and input map is not mutated', async () => {
 const matched = new Map([['gpt-custom', { image: false, contextWindow: 1000 }]]);
 const info = await fillCatalogFallback(['gpt-custom', 'claude-custom', 'claude-custom'], matched, async id => {
  assert.equal(id, 'claude-custom');
  return [option('openrouter', id, { image: false }), option('anthropic', id)];
 });
 assert.deepEqual(info.get('gpt-custom'), matched.get('gpt-custom'));
 assert.equal(info.get('claude-custom').image, false);
 assert.equal(matched.has('claude-custom'), false);
});

test('unknown IDs and failed lookups leave defaults available', async () => {
 const info = await fillCatalogFallback(['unknown', 'unavailable'], new Map(), async id => {
  if (id === 'unavailable') throw new Error('catalog offline');
  return [];
 });
 assert.equal(info.size, 0);
});

test('fallback supplies saved image/reasoning/limits while gateway values win per field', async () => {
 const id = 'gpt-6.1-sol';
 const matched = [];
 const catalog = await fillCatalogFallback([id], new Map(), async () => [
  option('openai', id, { image: true, reasoning: true, contextWindow: 1000000, maxTokens: 64000 }),
  option('openrouter', id, { image: false }),
 ], (modelId, entry) => matched.push([modelId, entry.providerId]));
 const resolved = finalizeModelInfo([id], [new Map([[id, { maxTokens: 8192, reasoning: false }]])], {
  modelsDev: catalog, api: 'openai-responses',
 }).get(id);
 assert.equal(resolved.image, true);
 assert.equal(resolved.contextWindow, 1000000);
 assert.equal(resolved.maxTokens, 8192);
 assert.equal(resolved.reasoning, false);
 assert.ok(resolved.modelsDevFields.includes('image'));
 assert.deepEqual(matched, [[id, 'openai']]);
});

test('catalog output limits are preserved without local clamping', async () => {
 const previousFetch = globalThis.fetch;
 const models = Object.fromEntries([64000, 100000].map(output => [String(output), {
  id: String(output), limit: { context: 64000, output }, reasoning: true,
 }]));
 try {
  globalThis.fetch = async () => new Response(JSON.stringify({ fixture: { id: 'fixture', models } }), { status: 200 });
  const result = await fetchModelsDevModels('fixture');
  for (const output of [64000, 100000]) {
   assert.equal(result.get(String(output))?.contextWindow, 64000);
   assert.equal(result.get(String(output))?.maxTokens, output);
  }
 } finally {
  globalThis.fetch = previousFetch;
 }
});
