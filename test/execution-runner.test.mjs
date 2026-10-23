import test from 'node:test';import assert from 'node:assert/strict';
import { ExecutionRunner,executionDigest } from '../src/execution-runner.mjs';
import { executionReport } from '../src/execution-report.mjs';
import { createPlan } from '../src/core.mjs';
const market={baseDecimals:3,quoteDecimals:2,tickSize:'1',lotSize:'1',minQuantity:'4'};
const plan=()=>createPlan({id:'test',source:'live',symbol:'ETH',account:'owner',operator:'bot',market,side:'buy',target:'20',bound:'1100',arrivalPrice:'1000',maxChild:'8',participationBps:10000,executionPolicy:{maxSpreadBps:20,maxSlippageBps:10,minIntervalSec:1},now:1000,durationSec:60});
function fixture(mode='observe'){
 let time=1000,sends=0,saves=[];const p=plan();if(mode==='replay')p.source='replay';
 const data=()=>({market,snapshot:{observedAt:time,markPriceOk:true,bids:[{price:'999',quantity:'1000'}],asks:[{price:'1000',quantity:'1000'}]}});
 const adapter={observe:async()=>data(),prepare:async(p,c)=>({...c,observedAt:time,plan:p,unsigned:{},nonce:1,gasPrice:'1',gasCeiling:'100'}),sign:async()=>({hash:'0xhash',serializedTransaction:'never-persist'}),broadcast:async s=>{sends++;return s.hash},receipt:async(p,i)=>({key:i.hash,hash:i.hash,status:'success',fills:[{quantity:'4',price:'1000'}],gasCost:'80',source:'live'})};
 const authority=()=>({runId:'run',planDigest:executionDigest(p),chainId:50383,expiresAt:new Date(100000).toISOString(),userAuthorization:'test only',maxOrders:4,maxGasSTT:'0.1',maxNotionalUSDso:'100',maxGasPriceGwei:'10'});
 const options={plan:p,id:'run',mode,adapter,authority,persist:async s=>saves.push(structuredClone(s)),now:()=>time};
 return {options,adapter,advance:n=>time+=n,get sends(){return sends},get saves(){return saves},run:new ExecutionRunner(options)};
}
test('read-only live observation never signs or advances filled quantity',async()=>{const f=fixture();f.adapter.sign=()=>{throw Error('must not sign')};await f.run.tick();assert.equal(f.run.state.plan.filled,'0');assert.equal(f.sends,0);assert.equal(f.run.state.decisions[0].action,'preview');});
test('finite replay adapts after partial fill and stops exactly at target',async()=>{const f=fixture('replay');for(let i=0;i<10;i++){await f.run.tick();f.advance(1000)}assert.equal(f.run.state.status,'completed');assert.equal(f.run.state.plan.filled,'20');assert.equal(f.sends,0);assert.equal(f.run.state.plan.receipts[0].filled,'4');});
test('ambiguous send persists hash first and restart only reconciles',async()=>{const f=fixture('live');f.adapter.broadcast=async()=>{assert.ok(f.saves.at(-1).plan.pending.hash);throw Error('timeout')};await f.run.tick();assert.ok(f.run.state.plan.pending);assert.equal(JSON.stringify(f.saves).includes('never-persist'),false);const r=new ExecutionRunner({...f.options,state:structuredClone(f.run.state)});await r.tick();assert.equal(r.state.plan.filled,'4');assert.equal(r.state.plan.pending,null);assert.equal(r.state.orders.length,1);});
test('revoked or expired authority and financial ceilings stop before signing',async()=>{const f=fixture('live');f.run.authority=()=>({revoked:true});await assert.rejects(f.run.tick(),/authorization/);assert.equal(f.sends,0);const b=fixture('live');b.run.authority=()=>({...b.options.authority(),maxNotionalUSDso:'0.01'});await b.run.tick();assert.equal(b.run.state.status,'halted');assert.equal(b.sends,0);});
test('arrival benchmark is directional, actual-fill weighted, gas separate',()=>{const p=plan();Object.assign(p,{filled:'10',remaining:'10',quoteNumerator:'10050',gasCost:'3000000000000000'});assert.equal(executionReport(p).adverseSlippageBps,'50');assert.equal(executionReport({...p,side:'sell'}).adverseSlippageBps,'-50');assert.equal(executionReport(p).gasSTT,'0.003');assert.equal(executionReport(plan()).adverseSlippageBps,null);});
test('stop during signing and journal failure cannot reach broadcast',async()=>{
  const f=fixture('live');f.adapter.sign=async()=>{f.run.state.stopRequested=true;return {hash:'0xhash'}};await f.run.tick();assert.equal(f.sends,0);assert.equal(f.run.state.plan.pending,null);
  const b=fixture('live');b.run.persist=async()=>{throw Error('disk full')};await assert.rejects(b.run.tick(),/disk full/);assert.equal(b.sends,0);
});
test('replay resumes a persisted synthetic intent without duplicating or waiting for chain receipts',async()=>{
  const f=fixture('replay');let n=0;f.run.persist=async s=>{if(++n===1)throw Error('crash after in-memory intent')};await assert.rejects(f.run.tick());const r=new ExecutionRunner({...f.options,state:structuredClone(f.run.state)});await r.tick();assert.equal(r.state.plan.filled,'4');assert.equal(r.state.plan.pending,null);assert.equal(r.state.plan.receipts.length,1);
});
test('an IOC dust remainder stops partial instead of overfilling the objective',async()=>{
  const f=fixture('replay');f.run.state.plan.remaining='3';f.run.state.plan.filled='17';await f.run.tick();assert.equal(f.run.state.status,'partial');assert.equal(f.run.state.plan.remaining,'3');assert.equal(f.sends,0);
});
test('changed budget after preparation is checked again before signing',async()=>{
  const f=fixture('live');let calls=0;f.run.authority=()=>({...f.options.authority(),maxOrders:++calls===1?4:1,maxNotionalUSDso:calls===1?'100':'0.01'});await f.run.tick();assert.equal(f.sends,0);assert.equal(f.run.state.status,'halted');
});
