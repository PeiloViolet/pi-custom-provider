import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// The prompts need no agent runtime or user configuration. Keep this suite
// independent of the host's installed provider/authentication state.
registerHooks({
 resolve(specifier, context, next) {
  if (specifier === '@earendil-works/pi-coding-agent') return {
   url: 'data:text/javascript,export const getAgentDir = () => "/test-only";', shortCircuit: true,
  };
  // Pi supplies this peer at runtime. For deterministic menu tests provide
  // only the key/color-independent primitives used by the real select widget.
  if (specifier === '@earendil-works/pi-tui') return {
   url: 'data:text/javascript,' + encodeURIComponent(`
    export const Key = { up: '\\u001b[A', down: '\\u001b[B', enter: '\\r', escape: '\\u001b' };
    export const matchesKey = (data, key) => data === key;
    export const truncateToWidth = text => text;
   `), shortCircuit: true,
  };
  return next(specifier, context);
 },
 load(url, context, next) {
  if (url.endsWith('.ts')) return {
   format: 'module', source: stripTypeScriptTypes(readFileSync(new URL(url), 'utf8')), shortCircuit: true,
  };
  return next(url, context);
 },
});
const { promptCatalogFallback, editModelMetadataField } = await import('../src/ui/prompts.ts');
const { buildProviderConfig, buildModelEntry, readModelOptions } = await import('../src/model-entry.ts');
const { fillCatalogFallback } = await import('../src/catalog-fallback.ts');
const { defaultContextWindow } = await import('../src/context-window.ts');
const { diffStoredModel, applyMetaChanges, automaticMetadataFields } = await import('../src/model-metadata.ts');

const native = { providerId: 'openai', key: 'gpt-test', rank: 1,
 info: { image: true, reasoning: true, contextWindow: 1000000, maxTokens: 64000,
 effortOptions: ['low', 'high'], cost: { input: 2, output: 8, cacheRead: 0.2, cacheWrite: 0 } } };
const relay = { providerId: 'relay', key: 'gpt-test', rank: 0,
 info: { image: false, reasoning: false, contextWindow: 100000, maxTokens: 4096 } };

function scriptedUi(steps, inputs = []) {
 const queue = [...steps];
 const titles = [];
 const ctx = { ui: {
  custom: async factory => {
   const step = queue.shift();
   assert.ok(step, 'unexpected extra menu');
   let result;
   let completed = false;
   const widget = factory({ requestRender() {} }, { fg: (_, text) => text, bold: text => text }, {}, value => {
    result = value; completed = true;
   });
   const rendered = widget.render(300).join('\n');
   titles.push(rendered);
   assert.ok(rendered.includes(step.title), rendered);
   if (step.contains) assert.ok(rendered.includes(step.contains), rendered);
   if (step.search) widget.handleInput(step.search);
   widget.handleInput(step.escape ? '\u001b' : '\r');
   assert.ok(completed, 'menu did not finish');
   return result;
  },
  input: async () => { assert.ok(inputs.length); return inputs.shift(); },
  notify() {},
 } };
 return { ctx, titles, done: () => { assert.equal(queue.length, 0); assert.equal(inputs.length, 0); } };
}

test('Enter accepts the maker recommendation without opening the editor', async () => {
 const ui = scriptedUi([{ title: 'Catalog fallback', contains: 'Accept recommended' }]);
 const result = await promptCatalogFallback(ui.ctx, 'gpt-test', [relay, native], native, undefined, 'openai-responses');
 assert.equal(result.selected, native);
 assert.equal(result.options, undefined);
 ui.done();
});

test('a source row opens shared fields; edited values and clearing survive final config', async () => {
 const ui = scriptedUi([
  { title: 'Catalog fallback', search: 'relay/gpt-test' },
  { title: 'Edit gpt-test', search: 'Image input' },
  { title: 'Image input', search: 'Yes - send' },
  { title: 'Edit gpt-test', search: 'Max output tokens' },
  { title: 'Edit gpt-test', search: 'Done' },
 ], ['0']);
 const detected = { maxTokens: 8192 };
 const result = await promptCatalogFallback(ui.ctx, 'gpt-test', [relay, native], native, detected, 'openai-responses');
 assert.equal(result.selected, relay);
 assert.equal(result.options.image, true);
 assert.equal(result.options.maxTokens, undefined);
 const config = buildProviderConfig('openai-responses', 'openai-responses', 'https://relay.example/v1',
  { mode: 'none' }, ['gpt-test'], { reasoning: 'xhigh', image: false }, undefined,
  new Map([['gpt-test', { ...relay.info, ...detected }]]), undefined, new Map([['gpt-test', result.options]]));
 assert.deepEqual(config.models[0].input, ['text', 'image']);
 assert.equal(config.models[0].maxTokens, undefined);
 assert.equal(config.baseUrl, 'https://relay.example/v1');
 assert.equal(config.models[0].id, 'gpt-test');
 assert.equal(relay.info.image, false);
 ui.done();
});

test('unedited fields retain effort mapping and price while a gateway limit remains visible', async () => {
 const ui = scriptedUi([
  { title: 'Catalog fallback', search: 'recommended · edit' },
  { title: 'Edit gpt-test', search: 'Done', contains: '8192' },
 ]);
 const result = await promptCatalogFallback(ui.ctx, 'gpt-test', [relay, native], native,
  { maxTokens: 8192 }, 'openai-responses');
 const entry = buildModelEntry('gpt-test', result.options);
 assert.equal(entry.maxTokens, 8192);
 assert.equal(entry.thinkingLevelMap.low, 'low');
 assert.equal(entry.thinkingLevelMap.medium, null);
 assert.deepEqual(entry.cost, native.info.cost);
 ui.done();
});

test('Esc discards draft edits and returns to fallback, whose Esc rejects the catalog', async () => {
 const ui = scriptedUi([
  { title: 'Catalog fallback', search: 'recommended · edit' },
  { title: 'Edit gpt-test', search: 'Image input' },
  { title: 'Image input', search: 'No - text' },
  { title: 'Edit gpt-test', escape: true },
  { title: 'Catalog fallback', escape: true },
 ]);
 assert.equal(await promptCatalogFallback(ui.ctx, 'gpt-test', [native], native, undefined), null);
 assert.equal(native.info.image, true);
 ui.done();
});

test('skip explicitly rejects fallback instead of accepting a default', async () => {
 const ui = scriptedUi([{ title: 'Catalog fallback', search: 'Skip catalog fallback' }]);
 const result = await fillCatalogFallback(['gpt-test'], new Map(), async () => [native], undefined,
  async (id, candidates, recommended) => (await promptCatalogFallback(ui.ctx, id, candidates, recommended))?.selected);
 assert.equal(result.has('gpt-test'), false);
 ui.done();
});

test('default context stays separate from maximum capacity through acceptance and save', () => {
 const id = 'gpt-6.1-sol';
 const capacity = { image: true, contextWindow: 1050000, maxTokens: 128000 };
 const config = buildProviderConfig('openai-responses', 'openai-responses', 'https://relay.example/v1',
  { mode: 'none' }, [id], { reasoning: 'xhigh', image: false }, undefined, new Map([[id, capacity]]));
 const model = config.models[0];
 assert.equal(model.contextWindow, 272000);
 assert.equal(model.maxContextWindow, 1050000);
 assert.equal(model.maxTokens, 128000);
 const opts = readModelOptions(model);
 assert.equal(opts.defaultContextWindow, 272000);
 assert.equal(opts.maxContextWindow, 1050000);
 assert.equal(defaultContextWindow('relay/openai/gpt-6.1-sol', 200000), 200000);
 assert.equal(defaultContextWindow('unknown', 1000000), 262144);
});

test('protocol fallback is not advertised capacity or a cap on the default context', () => {
 const config = buildProviderConfig('openai-responses', 'openai-responses', 'https://relay.example/v1',
  { mode: 'none' }, ['gpt-6.1-sol'], { reasoning: 'xhigh', image: false });
 const model = config.models[0];
 assert.equal(model.contextWindow, 272000);
 assert.equal(model.maxContextWindow, undefined);
 const opts = readModelOptions(model);
 assert.equal(opts.defaultContextWindow, 272000);
 assert.equal(opts.maxContextWindow, undefined);
 const legacy = readModelOptions({ id: 'gpt-6.1-sol', contextWindow: 258000 });
 assert.equal(legacy.contextWindow, 258000);
 assert.equal(legacy.defaultContextWindow, 272000);
 assert.equal(legacy.maxContextWindow, undefined);
});

test('context has automatic and manual modes; manual maximum survives save and can reset', async () => {
 const id = 'gpt-6.1-sol';
 const opts = readModelOptions({ id, input: ['text'], contextWindow: 272000, maxContextWindow: 1050000 });
 const ui = scriptedUi([{ title: 'Context window', search: 'Manual' }], ['1050000']);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'context'), true);
 const entry = buildModelEntry(id, opts);
 assert.equal(entry.contextWindow, 1050000);
 assert.equal(entry.maxContextWindow, 1050000);
 assert.deepEqual(entry.manualFields, ['context']);
 const restored = readModelOptions(entry);
 const reset = scriptedUi([{ title: 'Context window', search: 'Automatic' }]);
 assert.equal(await editModelMetadataField(reset.ctx, restored, 'context'), true);
 assert.equal(buildModelEntry(id, restored).contextWindow, 272000);
 assert.equal(buildModelEntry(id, restored).manualFields, undefined);
 ui.done(); reset.done();
});

test('custom context cannot exceed capacity, and Esc leaves the active window alone', async () => {
 const opts = readModelOptions({ id: 'gpt-6.1-sol', contextWindow: 272000, maxContextWindow: 1050000 });
 const ui = scriptedUi([{ title: 'Context window', search: 'Manual' }], ['2000000']);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'context'), false);
 assert.equal(opts.contextWindow, 272000);
 const cancelled = scriptedUi([{ title: 'Context window', escape: true }]);
 assert.equal(await editModelMetadataField(cancelled.ctx, opts, 'context'), false);
 assert.equal(opts.contextWindow, 272000);
 ui.done(); cancelled.done();
});

test('automatic refresh replaces any legacy window even when maximum metadata already matches', () => {
 for (const previous of [undefined, 128000, 258000, 400000, 1050000]) {
  const model = { id: 'gpt-6.1-sol', contextWindow: previous, maxContextWindow: 1050000 };
  applyMetaChanges(model, diffStoredModel(model, { contextWindow: 1050000 }));
  assert.equal(model.contextWindow, 272000);
  assert.equal(model.maxContextWindow, 1050000);
  assert.deepEqual(diffStoredModel(model, { contextWindow: 1050000 }), []);
 }
 const stringChanges = diffStoredModel('gpt-6.1-sol', { contextWindow: 1050000 });
 assert.equal(stringChanges.find(change => change.key === 'contextWindow').value, 272000);
});

test('only manually edited fields survive refresh; other metadata and capacity still update', () => {
 const model = { id: 'gpt-6.1-sol', contextWindow: 900000, maxTokens: 12345,
  manualFields: ['context', 'maxtokens'], input: ['text'] };
 applyMetaChanges(model, diffStoredModel(model, { contextWindow: 1050000, maxTokens: 128000, image: true }));
 assert.equal(model.contextWindow, 900000);
 assert.equal(model.maxTokens, 12345);
 assert.equal(model.maxContextWindow, 1050000);
 assert.deepEqual(model.input, ['text', 'image']);
 const opts = readModelOptions(model);
 assert.deepEqual(buildModelEntry(model.id, opts).manualFields, ['context', 'maxtokens']);
});

test('missing, inferred, and protocol fallback data do not erase or overwrite stored fields', () => {
 const model = { id: 'gpt-6.1-sol', contextWindow: 777777, maxTokens: 32100, input: ['text', 'image'] };
 for (const info of [{}, { contextWindow: 258000, maxTokens: 32000, defaultedFields: ['contextWindow', 'maxTokens'] },
  { image: false, inferredFields: ['image'] }]) assert.deepEqual(diffStoredModel(model, info), []);
});

test('refresh updates exact reasoning effort mappings even if reasoning was already enabled', () => {
 const model = { id: 'gpt-6.1-sol', reasoning: true, thinkingLevelMap: { high: 'old-high' } };
 applyMetaChanges(model, diffStoredModel(model, { reasoning: true, effortOptions: ['low', 'high', 'max'] }));
 assert.equal(model.thinkingLevelMap.high, 'high');
 assert.equal(model.thinkingLevelMap.max, 'max');
 assert.equal(model.thinkingLevelMap.xhigh, null);
 model.manualFields = ['reasoning'];
 assert.deepEqual(diffStoredModel(model, { reasoning: false }), []);
});

test('missing reasoning levels preserve an exact map while explicit disable clears it', () => {
 const model = { id: 'gpt-6.1-sol', reasoning: true,
  thinkingLevelMap: { low: 'low', high: 'high', xhigh: null, max: null } };
 const before = structuredClone(model.thinkingLevelMap);
 applyMetaChanges(model, diffStoredModel(model, { reasoning: true }));
 assert.deepEqual(model.thinkingLevelMap, before);
 applyMetaChanges(model, diffStoredModel(model, { reasoning: false }));
 assert.equal(model.reasoning, undefined);
 assert.equal(model.thinkingLevelMap, undefined);
 assert.equal(automaticMetadataFields({ reasoning: false }).size, 1);
 assert.equal(automaticMetadataFields({ reasoning: true, defaultedFields: ['reasoning'] }).size, 0);
});

test('legacy string model editor uses the model-specific automatic default', async () => {
 const opts = readModelOptions('gpt-6.1-sol');
 assert.equal(opts.defaultContextWindow, 272000);
 const ui = scriptedUi([{ title: 'Context window', search: 'Automatic' }]);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'context'), true);
 const model = buildModelEntry('gpt-6.1-sol', opts);
 assert.equal(model.contextWindow, 272000);
 assert.equal(model.manualFields, undefined);
 ui.done();
});

test('Esc in the reasoning provider-value prompt cancels the entire field edit', async () => {
 const opts = { reasoning: 'off', image: false };
 const ui = scriptedUi([{ title: 'Reasoning', search: 'xhigh' }], [undefined]);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'reasoning'), false);
 assert.deepEqual(opts, { reasoning: 'off', image: false });
 ui.done();
});

test('persisted model field editing preserves cost, token limits and exact thinking map', async () => {
 const model = { id: 'gpt-test', input: ['text', 'image'], reasoning: true, maxTokens: 12345,
  cost: native.info.cost, thinkingLevelMap: { high: 'custom-high', xhigh: null } };
 const opts = readModelOptions(model);
 const ui = scriptedUi([{ title: 'Image input', search: 'No - text' }]);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'image'), true);
 const entry = buildModelEntry(model.id, opts);
 assert.deepEqual(entry.input, ['text']);
 assert.equal(entry.maxTokens, 12345);
 assert.deepEqual(entry.cost, model.cost);
 assert.deepEqual(entry.thinkingLevelMap, model.thinkingLevelMap);
 ui.done();
});
