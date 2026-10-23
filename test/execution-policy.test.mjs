import test from 'node:test';
import assert from 'node:assert/strict';
import { planChild } from '../src/core.mjs';
const market={baseDecimals:3,quoteDecimals:2,tickSize:'1',lotSize:'1',minQuantity:'4'};
const snapshot={observedAt:1000,markPriceOk:true,bids:[{price:'999',quantity:'1000'}],asks:[{price:'1000',quantity:'6'},{price:'1001',quantity:'1000'}]};
const args={market,snapshot,side:'buy',bound:'1100',remaining:'20',maxChild:'20',participationBps:10000,now:1000,deadline:100000,arrivalPrice:'1000',executionPolicy:{maxSpreadBps:20,maxSlippageBps:5,minIntervalSec:10}};
test('arrival boundary restricts actual encoded price and eligible liquidity',()=>{
  const c=planChild(args);assert.equal(c.price,'1000');assert.equal(c.quantity,'6');assert.equal(c.depthQuantity,'6');assert.ok(c.constraints);assert.equal(c.constraints.arrivalBound,'1000');
  const sell=planChild({...args,side:'sell',bound:'900',snapshot:{...snapshot,bids:[{price:'999',quantity:'1000'},{price:'1000',quantity:'6'}]}});assert.equal(sell.price,'1000');assert.equal(sell.quantity,'6');
});
test('spread and inter-child interval pause without creating an order',()=>{
  assert.equal(planChild({...args,snapshot:{...snapshot,bids:[{price:'990',quantity:'1000'}]}}).reason,'spread-too-wide');
  assert.equal(planChild({...args,receipts:[{confirmedAt:1000}],now:5000}).reason,'child-interval');
  assert.equal(planChild({...args,pending:{hash:'0xabc'}}).reason,'reconciliation-required');
});
test('child sizing preserves a tradable remainder under minimum/lot constraints',()=>{
  const c=planChild({...args,remaining:'8',maxChild:'6'});assert.equal(c.quantity,'4');assert.ok(c.limitingFactors.includes('tradable-remainder'));
  assert.equal(planChild({...args,remaining:'3'}).reason,'untradeable-remainder');
});
test('malformed execution policy cannot disable limits or overflow timing',()=>{
  for(const p of [{maxSpreadBps:-1},{maxSlippageBps:10000},{minIntervalSec:NaN}])assert.throws(()=>planChild({...args,executionPolicy:{...args.executionPolicy,...p}}),/execution policy/i);
});
