import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

// Keep real add-flow, metadata resolution, window policy, and menu rendering.
// Replace only the host dependency and external metadata sources. Cancel at
// the review screen so these tests never write provider or credential files.
const vendorUrl = new URL('../vendor/model-probe/index.ts', import.meta.url).href;
const vendorMock = 'data:text/javascript,' + encodeURIComponent(`
 export * from ${JSON.stringify(vendorUrl)};
 const fixture = () => globalThis.__addFlowFixture;
 const info = () => new Map(fixture().ids.map(id => [id, {
  contextWindow: 1050000, maxTokens: 128000, image: true, reasoning: true,
  effortOptions: ['low', 'high', 'max'], cost: { input: 2, output: 10, cacheRead: 0, cacheWrite: 0 },
 }]));
 export async function probeModels(baseUrl) {
  fixture().calls.push('list');
  return { baseUrl, ids: fixture().ids, infoById: new Map() };
 }
 export async function fetchGatewayWideInfo() { fixture().calls.push('gateway metadata'); return info(); }
 export async function fetchModelsDevInfoForBaseUrl() { fixture().calls.push('endpoint catalog'); return info(); }
 export async function fetchModelsDevModels() { fixture().calls.push('catalog models'); return info(); }
 export async function fetchModelsDevProviders() {
  fixture().calls.push('catalog providers');
  return new Map([['fixture', { id: 'fixture', name: 'Fixture provider', baseUrl: 'https://fixture.example/v1', env: [] }]]);
 }
`);
registerHooks({
 resolve(specifier, context, next) {
  if (!specifier.startsWith('file:') && specifier.endsWith('/vendor/model-probe/index.ts')) {
   return { url: vendorMock, shortCircuit: true };
  }
  if (specifier === '@earendil-works/pi-coding-agent') return {
   url: 'data:text/javascript,export const getAgentDir = () => "/test-only";', shortCircuit: true,
  };
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
const { addProviderFlow } = await import('../src/flows/add.ts');

for (const source of ['custom', 'catalog']) test(`${source}: select IDs only, then review half-capacity windows`, async () => {
 const fixture = { ids: ['gpt-6.1-sol', 'gpt-6-astra'], calls: [] };
 globalThis.__addFlowFixture = fixture;
 const steps = source === 'custom' ? [
  { title: 'Add provider', search: 'Custom endpoint' },
  { title: 'Provider style', search: 'OpenAI Responses API' },
  { title: 'API key', search: 'None' },
  { title: 'Models', search: 'Auto-detect' },
 ] : [
  { title: 'Add provider', search: 'From models.dev' },
  { title: 'models.dev providers', search: 'Fixture provider' },
  { title: 'API key', search: 'None' },
 ];
 steps.push({ title: 'Select models', toggle: true }, { title: 'Edit models', cancel: true });
 const inputs = source === 'custom' ? ['https://fixture.example/v1', 'fixture-provider'] : ['fixture-provider'];
 let selected = false;
 const ctx = { ui: {
  custom: async factory => {
   const step = steps.shift();
   assert.ok(step, 'unexpected menu');
   let completed = false;
   let result;
   const widget = factory({ requestRender() {} }, { fg: (_, text) => text, bold: text => text }, {}, value => {
    completed = true; result = value;
   });
   const rendered = widget.render(400).join('\n');
   assert.ok(rendered.includes(step.title), rendered);
   if (step.title === 'Select models') {
    for (const id of fixture.ids) assert.ok(rendered.includes(id), rendered);
    assert.doesNotMatch(rendered, /context|reasoning|max-out|runtime fallback|\$2/);
    if (source === 'custom') assert.deepEqual(fixture.calls, ['list']);
    selected = true;
   }
   if (step.title === 'Edit models') {
    assert.equal(selected, true);
    assert.match(rendered, /context 525000 \[50%\]/);
    assert.match(rendered, /max-context 1050000/);
    assert.doesNotMatch(rendered, /context 1050000 \[/);
   }
   if (step.search) widget.handleInput(step.search);
   if (step.toggle) widget.handleInput(' ');
   widget.handleInput(step.cancel ? '\u001b' : '\r');
   assert.ok(completed, rendered);
   return result;
  },
  input: async () => { assert.ok(inputs.length); return inputs.shift(); },
  notify() {},
 } };
 try {
  await addProviderFlow(ctx);
  assert.equal(steps.length, 0);
  assert.equal(inputs.length, 0);
  if (source === 'custom') assert.ok(fixture.calls.includes('gateway metadata'));
 } finally {
  delete globalThis.__addFlowFixture;
 }
});
