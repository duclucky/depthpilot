import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {BotRunner,botConfigDigest} from '../src/bot-runner.mjs';
import {initialBotState,botTotals} from '../src/autopilot-policy.mjs';
import {botGasEnvelope} from '../src/bot-gateway.mjs';
const c=JSON.parse(await readFile(new URL('./fixtures/bot.continuous.config.json',import.meta.url),'utf8'));
function fixture(){
  const now=1800000000000,s=initialBotState(c,now-86400000);Object.assign(s,{mode:'live',configDigest:botConfigDigest(c),status:'halted',cycles:16,cycle:{quantity:'4000000000000000',openedAt:now-100000},exitDeadline:now-1000,baselineEquity:'1776720000000000000'});
  const receipt={key:'known-reverted',hash:'known-reverted',status:'reverted',gasCost:'13000000000000000',fills:[]};s.orders=[{action:'close',hash:receipt.hash,receipt,notional:'9600000000000000000',gasCeiling:'15000000000000000'}];
  const observation={at:now,chainId:50383,position:s.cycle.quantity,openOrders:[],equity:'1850000000000000000',gasBalance:'8000000000000000000',marginStatus:'Healthy',markPriceOk:true,blockTimestamp:now/1000,bid:'2400000000000000000000',ask:'2400100000000000000000',minQuantity:s.cycle.quantity,lotSize:'100000000000000'};
  let saved;const adapter={observe:async()=>structuredClone(observation),receipt:async()=>structuredClone(receipt)};
  const runner=new BotRunner({config:c,state:s,adapter,live:true,now:()=>now,persist:async x=>saved=structuredClone(x),savePlan:async()=>{},authority:async()=>({untilStopped:true,userAuthorization:'explicit test resume',configDigest:botConfigDigest(c)})});
  return {runner,adapter,observation,receipt,get saved(){return saved}};
}
test('explicit continuous recovery verifies reverted close and owned position without resetting cumulative state',async()=>{
  const f=fixture(),totals=botTotals(f.runner.state);await f.runner.resumeHalted();assert.equal(f.runner.state.status,'holding');assert.equal(f.saved.cycles,16);assert.equal(f.saved.orders.length,1);assert.equal(f.saved.exitDeadline,null);assert.equal(f.saved.baselineEquity,'1776720000000000000');assert.deepEqual(botTotals(f.saved),totals);assert.equal(f.saved.events.at(-1).type,'explicit-halt-recovery');
});
test('pending hash, unknown failure, changed receipt and unrelated position cannot be released by recovery',async()=>{
  for(const change of [f=>f.runner.state.pending='unknown',f=>f.runner.state.orders[0].action='open',f=>f.receipt.status='success',f=>f.observation.position='8000000000000000',f=>f.observation.openOrders=[{}]]){const f=fixture();change(f);await assert.rejects(f.runner.resumeHalted());assert.equal(f.runner.state.status,'halted');assert.equal(f.saved,undefined);}
});
test('bot gas buffer stays inside close reserve and never changes user browser fees',()=>{
  const fees={gasLimit:'3986811',gasPrice:'6000000000',nonce:53};const result=botGasEnvelope(fees,c,'close');assert.equal(result.gasLimit,'7973622');assert.equal(fees.gasLimit,'3986811');assert.ok(BigInt(result.gasLimit)*BigInt(result.gasPrice)<=60000000000000000n);
  assert.throws(()=>botGasEnvelope({gasLimit:'7000000',gasPrice:'10000000000'},c,'close'),/reserve/);
});
