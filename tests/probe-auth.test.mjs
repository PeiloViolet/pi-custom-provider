import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
registerHooks({load(url,context,next){if(url.endsWith('.ts'))return {format:'module',source:stripTypeScriptTypes(readFileSync(new URL(url),'utf8')),shortCircuit:true};return next(url,context);}});
const {probeModels,enrichOpenAIModelDetails}=await import('../vendor/model-probe/src/probe.ts');
test('OpenAI gateway rejects Google header; model discovery and details still work',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,headers:options.headers});if(options.headers['x-goog-api-key'])return new Response('{"error":"Invalid API key"}',{status:401});return new Response(JSON.stringify(url.endsWith('/models')?{data:[{id:'custom-model'}]}:{id:'custom-model',context_window:131072}),{status:200});};
 try{const result=await probeModels('https://gateway.example/v1','test-only');assert.deepEqual(result.ids,['custom-model']);await enrichOpenAIModelDetails('https://gateway.example/v1','test-only',result.ids);assert.equal(calls.length,2);for(const call of calls){assert.equal(call.headers.authorization,'Bearer test-only');assert.equal(call.headers['x-goog-api-key'],undefined);}}finally{globalThis.fetch=original;}
});
test('native Gemini v1beta keeps its API-key header',async()=>{const original=globalThis.fetch;let headers;globalThis.fetch=async(u,o)=>{headers=o.headers;return new Response('{"models":[{"name":"models/gemini-test"}]}',{status:200});};try{const r=await probeModels('https://generativelanguage.googleapis.com/v1beta','test-only');assert.equal(headers['x-goog-api-key'],'test-only');assert.deepEqual(r.ids,['gemini-test']);}finally{globalThis.fetch=original;}});
