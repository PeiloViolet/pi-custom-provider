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
const { preferredCatalogOption, fillCatalogFallback } = await import('../src/catalog-fallback.ts');
const { finalizeModelInfo } = await import('../vendor/model-probe/index.ts');
const option = (providerId, key, info = { image: true }) => ({ providerId, key, info, rank: 0 });

test('maker beats relay prefix and existing candidate order', () => {
 for (const [id, maker] of [
  ['openrouter/openai/gpt-6.1-sol', 'openai'],
  ['relay/claude-sonnet-5', 'anthropic'],
  ['relay/gemini-3-pro', 'google'],
 ]) {
  const native = option(maker, id);
  assert.equal(preferredCatalogOption(id, [option('openrouter', id), native]), native);
 }
});

test('unknown family or absent maker keeps established lookup order', () => {
 const relay = option('openrouter', 'custom');
 assert.equal(preferredCatalogOption('custom', [relay]), relay);
 assert.equal(preferredCatalogOption('gpt-custom', [relay]), relay);
 assert.equal(preferredCatalogOption('custom', []), undefined);
});

test('endpoint-matched catalog values win and input map is not mutated', async () => {
 const matched = new Map([['gpt-custom', { image: false, contextWindow: 1000 }]]);
 const info = await fillCatalogFallback(['gpt-custom', 'claude-custom', 'claude-custom'], matched, async id => {
  assert.equal(id, 'claude-custom');
  return [option('openrouter', id, { image: false }), option('anthropic', id)];
 });
 assert.deepEqual(info.get('gpt-custom'), matched.get('gpt-custom'));
 assert.equal(info.get('claude-custom').image, true);
 assert.equal(matched.has('claude-custom'), false);
});

test('unknown IDs and failed lookups leave local rules/defaults available', async () => {
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
  option('openrouter', id, { image: false }),
  option('openai', id, { image: true, reasoning: true, contextWindow: 1000000, maxTokens: 64000 }),
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
