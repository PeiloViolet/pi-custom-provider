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
const { editModelMetadataField } = await import('../src/ui/prompts.ts');
const { buildProviderConfig, buildModelEntry, readModelOptions } = await import('../src/model-entry.ts');
const { reviewModelEntries } = await import('../src/flows/shared.ts');
const { defaultContextWindow } = await import('../src/context-window.ts');
const { resolveModelInfo, normalizeModelIdCandidates } = await import('../vendor/model-probe/index.ts');
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

test('all collected models appear together; Done accepts without per-model prompts', async () => {
 const ui = scriptedUi([{ title: 'Edit models', search: 'Done', contains: 'gpt-second' }]);
 const result = await reviewModelEntries(ui.ctx, ['gpt-test', 'gpt-second'],
  new Map([['gpt-test', native.info], ['gpt-second', relay.info]]), 'openai-responses');
 assert.equal(result.size, 2);
 assert.equal(result.get('gpt-test').image, true);
 assert.equal(result.get('gpt-second').image, false);
 assert.equal(ui.titles.length, 1);
 ui.done();
});

test('a model row directly opens shared fields; edits survive returning to list and saving', async () => {
 const ui = scriptedUi([
  { title: 'Edit models', search: 'gpt-test' },
  { title: 'Edit gpt-test', search: 'Image input' },
  { title: 'Image input', search: 'Yes - send' },
  { title: 'Edit gpt-test', search: 'Max output tokens' },
  { title: 'Edit gpt-test', search: 'Done' },
  { title: 'Edit models', search: 'Done', contains: 'image' },
 ], ['0']);
 const info = new Map([['gpt-test', { ...relay.info, maxTokens: 8192 }]]);
 const options = await reviewModelEntries(ui.ctx, ['gpt-test'], info, 'openai-responses');
 const config = buildProviderConfig('openai-responses', 'openai-responses', 'https://relay.example/v1',
  { mode: 'none' }, ['gpt-test'], { reasoning: 'xhigh', image: false }, undefined, info, undefined, options);
 assert.deepEqual(config.models[0].input, ['text', 'image']);
 assert.equal(config.models[0].maxTokens, undefined);
 assert.deepEqual(config.models[0].manualFields, ['image', 'maxtokens']);
 assert.equal(relay.info.image, false);
 ui.done();
});

test('unedited fields retain exact effort mapping, gateway limits and prices', async () => {
 const ui = scriptedUi([
  { title: 'Edit models', search: 'gpt-test' },
  { title: 'Edit gpt-test', search: 'Done', contains: '8192' },
  { title: 'Edit models', search: 'Done' },
 ]);
 const result = await reviewModelEntries(ui.ctx, ['gpt-test'],
  new Map([['gpt-test', { ...native.info, maxTokens: 8192 }]]), 'openai-responses');
 const entry = buildModelEntry('gpt-test', result.get('gpt-test'));
 assert.equal(entry.maxTokens, 8192);
 assert.equal(entry.thinkingLevelMap.low, 'low');
 assert.equal(entry.thinkingLevelMap.medium, null);
 assert.deepEqual(entry.cost, native.info.cost);
 ui.done();
});

test('Esc discards only the current model draft and returns to the common list', async () => {
 const ui = scriptedUi([
  { title: 'Edit models', search: 'gpt-test' },
  { title: 'Edit gpt-test', search: 'Image input' },
  { title: 'Image input', search: 'No - text' },
  { title: 'Edit gpt-test', escape: true },
  { title: 'Edit models', search: 'Done' },
 ]);
 const result = await reviewModelEntries(ui.ctx, ['gpt-test'], new Map([['gpt-test', native.info]]), 'openai-responses');
 assert.equal(result.get('gpt-test').image, true);
 assert.equal(result.get('gpt-test').manualFields, undefined);
 ui.done();
});

test('Esc in the common model list cancels adding without accepting drafts', async () => {
 const ui = scriptedUi([{ title: 'Edit models', escape: true }]);
 assert.equal(await reviewModelEntries(ui.ctx, ['gpt-test'], new Map([['gpt-test', native.info]]), 'openai-responses'), null);
 ui.done();
});

test('all model names reuse existing protocol defaults, capped by known model capacity', () => {
 const ids = ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-5.6-luna', 'claude-sonnet-4-6', 'gemini-2.5-pro', 'unknown'];
 const protocols = [['openai', 'openai-completions', 258000], ['openai-responses', 'openai-responses', 258000],
  ['anthropic', 'anthropic-messages', 200000], ['gemini', 'google-generative-ai', 1048576]];
 for (const [style, api, baseline] of protocols) {
  assert.equal(defaultContextWindow(undefined, api), baseline);
  for (const maximum of [undefined, 64000, 200000, 1050000]) {
   const info = maximum === undefined ? undefined : new Map(ids.map(id => [id, { contextWindow: maximum }]));
   const config = buildProviderConfig(style, api, 'https://relay.example/v1',
    { mode: 'none' }, ids, { reasoning: 'xhigh', image: false }, undefined, info);
   for (const model of config.models) {
    const expected = Math.min(baseline, maximum ?? Infinity);
    assert.equal(model.contextWindow, expected, `${api}: ${model.id}`);
    assert.equal(model.maxContextWindow, maximum);
    assert.equal(readModelOptions(model, api).defaultContextWindow, expected);
    const fresh = { contextWindow: maximum ?? 1050000 };
    const stored = { ...model, contextWindow: 777777 };
    applyMetaChanges(stored, diffStoredModel(stored, fresh, api));
    assert.equal(stored.contextWindow, Math.min(baseline, fresh.contextWindow));
    const manual = { ...model, contextWindow: 12345, manualFields: ['context'] };
    applyMetaChanges(manual, diffStoredModel(manual, fresh, api));
    assert.equal(manual.contextWindow, 12345);
   }
  }
 }
});

test('review and Automatic context editing use the selected protocol default', async () => {
 for (const [api, baseline] of [['openai-responses', 258000], ['anthropic-messages', 200000], ['google-generative-ai', 1048576]]) {
  const ui = scriptedUi([{ title: 'Edit models', search: 'Done' }]);
  const options = await reviewModelEntries(ui.ctx, ['any-model'], new Map(), api);
  const opts = options.get('any-model');
  assert.equal(opts.contextWindow, baseline);
  assert.equal(opts.defaultContextWindow, baseline);
  assert.equal(opts.maxContextWindow, undefined);
  ui.done();
  const saved = buildModelEntry('any-model', { ...opts, contextWindow: 12345, manualFields: ['context'] });
  const reopened = readModelOptions(saved, api);
  const reset = scriptedUi([{ title: 'Context window', search: 'Automatic' }]);
  assert.equal(await editModelMetadataField(reset.ctx, reopened, 'context'), true);
  assert.equal(buildModelEntry('any-model', reopened).contextWindow, baseline);
  assert.equal(reopened.manualFields, undefined);
  reset.done();
 }
});

test('model API overrides provider API when reopening or refreshing context', () => {
 const model = { id: 'gpt-test', api: 'anthropic-messages', contextWindow: 258000, maxContextWindow: 1050000 };
 assert.equal(readModelOptions(model, 'openai-completions').defaultContextWindow, 200000);
 applyMetaChanges(model, diffStoredModel(model, { contextWindow: 1050000 }, 'openai-completions'));
 assert.equal(model.contextWindow, 200000);
});

test('model names supply no capability or capacity metadata', () => {
 for (const id of ['gpt-5.6-luna', 'gpt-6-astra', 'claude-sonnet-4-6', 'deepseek-v4-pro']) {
  const info = resolveModelInfo(id);
  assert.equal(info.contextWindow, undefined);
  assert.equal(info.maxTokens, undefined);
  assert.equal(info.image, false);
  assert.equal(info.video, false);
  assert.equal(info.reasoning, true);
  assert.deepEqual(new Set(info.defaultedFields), new Set(['image', 'video', 'reasoning']));
 }
});

test('decorated model IDs still normalize for online catalog matching', () => {
 assert.ok(normalizeModelIdCandidates('relay/openai/gpt-6.1-sol@20260101').includes('gpt-6.1-sol'));
 assert.ok(normalizeModelIdCandidates('claude-sonnet-4-6[1m]').includes('claude-sonnet-4-6'));
});

test('default context stays separate from maximum capacity through acceptance and save', () => {
 const id = 'gpt-6.1-sol';
 const capacity = { image: true, contextWindow: 1050000, maxTokens: 128000 };
 const config = buildProviderConfig('openai-responses', 'openai-responses', 'https://relay.example/v1',
  { mode: 'none' }, [id], { reasoning: 'xhigh', image: false }, undefined, new Map([[id, capacity]]));
 const model = config.models[0];
 assert.equal(model.contextWindow, 258000);
 assert.equal(model.maxContextWindow, 1050000);
 assert.equal(model.maxTokens, 128000);
 const opts = readModelOptions(model);
 assert.equal(opts.defaultContextWindow, 258000);
 assert.equal(opts.maxContextWindow, 1050000);
 assert.equal(defaultContextWindow(200000), 200000);
 assert.equal(defaultContextWindow(1000000), 258000);
 assert.equal(defaultContextWindow(), 258000);
});

test('protocol fallback is not advertised capacity or a cap on the default context', () => {
 const config = buildProviderConfig('openai-responses', 'openai-responses', 'https://relay.example/v1',
  { mode: 'none' }, ['gpt-6.1-sol'], { reasoning: 'xhigh', image: false });
 const model = config.models[0];
 assert.equal(model.contextWindow, 258000);
 assert.equal(model.maxContextWindow, undefined);
 const opts = readModelOptions(model);
 assert.equal(opts.defaultContextWindow, 258000);
 assert.equal(opts.maxContextWindow, undefined);
 const legacy = readModelOptions({ id: 'gpt-6.1-sol', contextWindow: 258000 });
 assert.equal(legacy.contextWindow, 258000);
 assert.equal(legacy.defaultContextWindow, 258000);
 assert.equal(legacy.maxContextWindow, undefined);
});

test('context has automatic and manual modes; manual maximum survives save and can reset', async () => {
 const id = 'gpt-6.1-sol';
 const opts = readModelOptions({ id, input: ['text'], contextWindow: 258000, maxContextWindow: 1050000 });
 const ui = scriptedUi([{ title: 'Context window', search: 'Manual' }], ['1050000']);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'context'), true);
 const entry = buildModelEntry(id, opts);
 assert.equal(entry.contextWindow, 1050000);
 assert.equal(entry.maxContextWindow, 1050000);
 assert.deepEqual(entry.manualFields, ['context']);
 const restored = readModelOptions(entry);
 const reset = scriptedUi([{ title: 'Context window', search: 'Automatic' }]);
 assert.equal(await editModelMetadataField(reset.ctx, restored, 'context'), true);
 assert.equal(buildModelEntry(id, restored).contextWindow, 258000);
 assert.equal(buildModelEntry(id, restored).manualFields, undefined);
 ui.done(); reset.done();
});

test('custom context cannot exceed capacity, and Esc leaves the active window alone', async () => {
 const opts = readModelOptions({ id: 'gpt-6.1-sol', contextWindow: 300000, maxContextWindow: 1050000 });
 const ui = scriptedUi([{ title: 'Context window', search: 'Manual' }], ['2000000']);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'context'), false);
 assert.equal(opts.contextWindow, 300000);
 const cancelled = scriptedUi([{ title: 'Context window', escape: true }]);
 assert.equal(await editModelMetadataField(cancelled.ctx, opts, 'context'), false);
 assert.equal(opts.contextWindow, 300000);
 ui.done(); cancelled.done();
});

test('automatic refresh replaces any legacy window even when maximum metadata already matches', () => {
 for (const previous of [undefined, 128000, 258000, 400000, 1050000]) {
  const model = { id: 'gpt-6.1-sol', contextWindow: previous, maxContextWindow: 1050000 };
  applyMetaChanges(model, diffStoredModel(model, { contextWindow: 1050000 }));
  assert.equal(model.contextWindow, 258000);
  assert.equal(model.maxContextWindow, 1050000);
  assert.deepEqual(diffStoredModel(model, { contextWindow: 1050000 }), []);
 }
 const stringChanges = diffStoredModel('gpt-6.1-sol', { contextWindow: 1050000 });
 assert.equal(stringChanges.find(change => change.key === 'contextWindow').value, 258000);
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

test('missing and protocol fallback data do not erase or overwrite stored fields', () => {
 const model = { id: 'gpt-6.1-sol', contextWindow: 777777, maxTokens: 32100, input: ['text', 'image'] };
 for (const info of [{}, { contextWindow: 258000, maxTokens: 32000, defaultedFields: ['contextWindow', 'maxTokens'] },
  { image: false, defaultedFields: ['image'] }]) assert.deepEqual(diffStoredModel(model, info), []);
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

test('legacy string model editor uses the common automatic default', async () => {
 const opts = readModelOptions('gpt-6.1-sol');
 assert.equal(opts.defaultContextWindow, 258000);
 const ui = scriptedUi([{ title: 'Context window', search: 'Automatic' }]);
 assert.equal(await editModelMetadataField(ui.ctx, opts, 'context'), true);
 const model = buildModelEntry('gpt-6.1-sol', opts);
 assert.equal(model.contextWindow, 258000);
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
