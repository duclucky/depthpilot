import test from 'node:test';import assert from 'node:assert/strict';
import {diagnosePlan} from '../src/plan-diagnosis.mjs';
test('a hung public read returns a bounded unavailable diagnosis without any signing path',async()=>{
 const snapshot={run:null,owner:'0x1111111111111111111111111111111111111111',wallet:{address:'0x3333333333333333333333333333333333333333'}};
 const gateway={rpc:{getChainId:()=>new Promise(()=>{}),getTransactionCount:()=>new Promise(()=>{})}};
 const view=await diagnosePlan({snapshot,gateway,readTimeoutMs:10});
 assert.equal(view.current,null);assert.equal(view.canResume,false);assert.equal(view.readOnly,true);assert.ok(view.issues.includes('account-check-unavailable'));
});
