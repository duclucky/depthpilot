import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePlan} from '../src/plan-config.mjs';
const identity={owner:'0x1111111111111111111111111111111111111111',operator:'0x3333333333333333333333333333333333333333'};
const input={kind:'roundtrip',quantity:'0.001',intervalMinutes:5,holdSeconds:20,cycles:3,maxNotional:'30',maxGas:'0.3'};
test('public plan binds the local identity and cumulatively reserves exits',()=>{
 const p=normalizePlan({...input,account:'0x2222222222222222222222222222222222222222'},identity);
 assert.equal(p.config.account,identity.owner);assert.equal(p.config.operator,identity.operator);assert.equal(p.config.maxTransactions,12);assert.equal(p.config.closeOrderSlots,3);assert.equal(p.config.continuous,true);assert.equal(p.config.durationSec,null);assert.equal(p.config.minNativeReserveSTT,'1');
});
test('invalid budgets, empty limits and unsupported strategies fail before creating authority',()=>{
 for(const patch of [{maxGas:'0.01'},{maxNotional:''},{quantity:'0.0041'},{cycles:301},{kind:'whatever'},{intervalMinutes:0},{holdSeconds:200}])assert.throws(()=>normalizePlan({...input,...patch},identity));
 assert.throws(()=>normalizePlan(input,{...identity,operator:identity.owner}));
});
test('finite target preserves side and absolute bound without promising an automatic close',()=>{
 const p=normalizePlan({kind:'buy',quantity:'0.01',maxChild:'0.001',price:'2400',minutes:10,maxOrders:12,maxNotional:'50',maxGas:'0.3'},identity);
 assert.equal(p.kind,'finite');assert.equal(p.terms.side,'buy');assert.equal(p.terms.bound,'2400000000000000000000');assert.equal(p.terms.maxChild,'1000000000000000');
});
