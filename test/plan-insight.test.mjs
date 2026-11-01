import test from 'node:test';import assert from 'node:assert/strict';
import {buildPlanInsight} from '../src/plan-insight.mjs';
const now=100000;
const run=()=>({kind:'roundtrip',workerAlive:true,maxGas:'0.12',config:{maxSpreadBps:5,closeGasReserveSTT:'0.06',entryIntervalSec:300,holdSec:20},state:{status:'observing',updatedAt:now,latestObservation:{at:now,bid:'2000000000000000000000',ask:'2002000000000000000000',position:'0',gasBalance:'2000000000000000000'},orders:[]}});
test('saved spread explains its actual bid denominator and wait persists across a projected reload',()=>{
 const r=run(),entries=[{at:80000,action:'confirmed'},{at:85000,action:'wait',reason:'spread-too-wide'},{at:95000,action:'wait',reason:'spread-too-wide'}];
 const a=buildPlanInsight({run:r,entries,now});assert.equal(a.code,'spread-too-wide');assert.equal(a.wait.durationMs,15000);assert.equal(a.wait.lowerBound,false);assert.deepEqual(a.facts.find(f=>f.label==='Spread at observation'),{label:'Spread at observation',value:'10 bps'});assert.deepEqual(a,buildPlanInsight({run:structuredClone(r),entries:structuredClone(entries),now}));
});
test('truncated logs never invent an exact start; pending overrides terminal and stale worker states',()=>{
 const r=run(),entries=[{at:90000,action:'wait',reason:'spread-too-wide'}];assert.equal(buildPlanInsight({run:r,entries,truncated:true,now}).wait.lowerBound,true);
 r.workerAlive=false;r.state.status='halted';r.state.updatedAt=0;r.state.pending='0x'+'a'.repeat(64);const view=buildPlanInsight({run:r,entries,now});assert.equal(view.code,'pending');assert.equal(view.wait,null);
});
test('stale state, absent worker, terminal and empty profile remain distinct',()=>{
 const r=run();r.state.updatedAt=0;assert.equal(buildPlanInsight({run:r,now}).code,'stale-state');r.workerAlive=false;assert.equal(buildPlanInsight({run:r,now}).code,'worker-offline');r.state.status='stopped';assert.equal(buildPlanInsight({run:r,now}).code,'stopped');assert.equal(buildPlanInsight({run:null,now}).code,'no-plan');
});
test('unresolved gas reservations are not shown as spendable and unknown order cost is not zero',()=>{
 const r=run();r.state.orders=[{gasCeiling:'60000000000000000'}];const view=buildPlanInsight({run:r,now});assert.equal(view.facts.find(f=>f.label==='Unspent / unreserved fee budget').value,'0.06 STT');delete r.state.orders[0].gasCeiling;assert.ok(!buildPlanInsight({run:r,now}).facts.some(f=>f.label==='Unspent / unreserved fee budget'));
});
test('finite spread explanation uses recorded planner midpoint metric, not the roundtrip formula',()=>{
 const r=run();r.kind='finite';r.state.plan={executionPolicy:{maxSpreadBps:5},bound:'2000000000000000000000',remaining:'4000000000000000',gasCost:'0'};
 const entries=[{at:now,action:'wait',reason:'spread-too-wide',child:{constraints:{spreadBps:'9.99'}}}];const v=buildPlanInsight({run:r,entries,now});assert.equal(v.facts.find(f=>f.label==='Spread at decision').value,'9.99 bps');assert.ok(!v.facts.some(f=>f.label==='Spread at observation'));
});
test('a freshly saved retry does not make old market observations look fresh',()=>{
 const r=run();r.state.latestObservation.at=20000;
 const v=buildPlanInsight({run:r,entries:[{at:now,action:'wait',reason:'network-read-error'}],now});
 assert.equal(v.observationAgeMs,80000);assert.ok(v.facts.some(f=>f.label==='Market observation age'&&f.value.includes('80 seconds')));
});
