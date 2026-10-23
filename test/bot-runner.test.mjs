import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keccak256, parseEther } from 'viem';
import { BotRunner, botConfigDigest } from '../src/bot-runner.mjs';
import { createPlan } from '../src/core.mjs';

const config=JSON.parse(await readFile(new URL('./fixtures/bot.config.json',import.meta.url),'utf8'));
const continuous=JSON.parse(await readFile(new URL('./fixtures/bot.continuous.config.json',import.meta.url),'utf8'));
function fixture(profile=config){
  let now=1800000000000, saved, position='0', receiptsReady=true;
  const sent=[],signed=[],plans=[];
  const adapter={
    observe:async()=>({at:now,chainId:50383,position,openOrders:[],equity:String(parseEther('1.77736')),gasBalance:String(parseEther('8')),marginStatus:'Healthy',markPriceOk:true,blockTimestamp:Math.floor(now/1000),bid:String(parseEther('2400')),ask:String(parseEther('2400.2')),minQuantity:String(parseEther('0.004')),lotSize:String(parseEther('0.0001'))}),
    prepare:async(action,state)=>{
      const quantity=action==='open'?String(parseEther('0.004')):state.cycle.quantity;
      const plan=createPlan({id:`bot-order-${state.orders.length+1}`,source:'live',side:action==='open'?'buy':'sell',target:quantity,bound:String(parseEther(action==='open'?'2403':'2397')),market:{},now});
      return {action,quantity,price:String(parseEther(action==='open'?'2403':'2397')),notional:String(parseEther('9.61')),gasCeiling:String(parseEther('0.03')),expectedAveragePrice:String(parseEther('2400.2')),plan,unsigned:{chainId:50383,value:'0',to:'0x2222222222222222222222222222222222222222',data:'0x'},nonce:state.orders.length};
    },
    sign:async order=>{signed.push(order);const serializedTransaction=`0x0${signed.length}`;return {serializedTransaction,hash:keccak256(serializedTransaction)};},
    broadcast:async signedOrder=>{sent.push(signedOrder.hash);return signedOrder.hash;},
    receipt:async order=>{if(!receiptsReady)throw Object.assign(Error('not found'),{name:'TransactionReceiptNotFoundError'});position=order.action==='open'?order.quantity:'0';return {key:order.hash,hash:order.hash,status:'success',blockNumber:'100',gasCost:String(parseEther('0.01')),fills:[{quantity:order.quantity,price:String(parseEther('2400.2'))}]};}
  };
  const options={config:profile,adapter,live:true,now:()=>now,persist:async state=>{saved=structuredClone(state);},savePlan:async plan=>plans.push(plan),authority:async()=>({configDigest:botConfigDigest(profile),userAuthorization:'approved synthetic test',expiresAt:new Date(now+3600000).toISOString()})};
  return {options,adapter,sent,signed,plans,get saved(){return saved;},advance:ms=>now+=ms,missingReceipts:()=>receiptsReady=false};
}
test('configured controller runs entry and timed exit itself and stores exact actual receipts',async()=>{
  const f=fixture(),runner=new BotRunner(f.options);
  await runner.tick();assert.equal(f.sent.length,1);assert.equal(runner.state.cycle.quantity,String(parseEther('0.004')));
  await runner.tick();assert.equal(f.sent.length,1);
  f.advance(20000);await runner.tick();assert.equal(f.sent.length,2);assert.equal(runner.state.cycle,null);assert.equal(runner.state.cycles,1);assert.equal(runner.state.orders.length,2);assert.equal(f.plans.length,2);
  await runner.tick();assert.equal(f.sent.length,2);
});
test('ambiguous broadcast is persisted before sending; restart only reconciles that same hash',async()=>{
  const f=fixture();f.missingReceipts();f.adapter.broadcast=async order=>{assert.equal(f.saved.pending,order.hash);f.sent.push(order.hash);throw Error('timeout');};
  const first=new BotRunner(f.options);await first.tick();assert.equal(f.sent.length,1);assert.equal(first.state.pending,f.sent[0]);
  const restarted=new BotRunner({...f.options,state:f.saved});await restarted.tick();f.advance(10000);await restarted.tick();
  assert.equal(f.sent.length,1);assert.equal(f.signed.length,1);assert.equal(restarted.state.orders.length,1);
});
test('persistence failure prevents broadcast and a missing approval prevents signing',async()=>{
  const f=fixture(),runner=new BotRunner({...f.options,persist:async state=>{if(state.pending)throw Error('disk full');}});
  await assert.rejects(()=>runner.tick(),/disk full/);assert.equal(f.sent.length,0);
  const g=fixture(),locked=new BotRunner({...g.options,authority:async()=>null});
  await assert.rejects(()=>locked.tick(),/authorization/);assert.equal(g.signed.length,0);assert.equal(g.sent.length,0);
});
test('dry monitoring can preview a real candidate but cannot reach the signer or broadcaster',async()=>{
  const f=fixture(),runner=new BotRunner({...f.options,live:false,authority:async()=>{throw Error('unused');}});
  const result=await runner.tick();assert.equal(result.action,'preview');assert.equal(f.signed.length,0);assert.equal(f.sent.length,0);assert.equal(runner.state.orders.length,0);
});
test('fee growth cannot consume the reserved exit budget or authorize an oversized transaction',async()=>{
  const f=fixture();f.adapter.prepare=async()=>({action:'open',quantity:String(parseEther('0.004')),notional:String(parseEther('9.61')),gasCeiling:String(parseEther('0.49')),plan:{id:'oversized'}});
  const runner=new BotRunner(f.options);const result=await runner.tick();assert.equal(result.action,'wait');assert.equal(f.signed.length,0);assert.equal(f.sent.length,0);
});
test('a changed configuration cannot resume an existing run and reset its limits',async()=>{
  const f=fixture(),runner=new BotRunner(f.options);await runner.tick();
  assert.throws(()=>new BotRunner({...f.options,config:{...config,holdSec:30},state:f.saved}),/configuration/);
});
test('one running controller completes six configured cycles without per-order operator calls',async()=>{
  const f=fixture(),runner=new BotRunner(f.options);
  for(let cycle=0;cycle<6;cycle++){
    await runner.tick();f.advance(20000);await runner.tick();f.advance(280000);
  }
  await runner.tick();assert.equal(runner.state.cycles,6);assert.equal(runner.state.status,'stopped');assert.equal(runner.state.cycle,null);assert.equal(f.sent.length,12);assert.equal(new Set(f.sent).size,12);
});
test('continuous controller survives a day boundary, closes itself and preserves cumulative reservations on restart',async()=>{
  const f=fixture(continuous),runner=new BotRunner(f.options);
  await runner.tick();assert.equal(f.sent.length,1);f.advance(20000);await runner.tick();assert.equal(f.sent.length,2);
  f.advance(86400000);const restarted=new BotRunner({...f.options,state:f.saved});await restarted.tick();
  assert.equal(f.sent.length,3);assert.equal(restarted.state.orders.length,3);assert.equal(restarted.state.baselineEquity,runner.state.baselineEquity);
  f.advance(20000);await restarted.tick();assert.equal(restarted.state.cycles,2);assert.equal(f.sent.length,4);
});
test('continuous process pauses at a quota without closing its process or resetting counters',async()=>{
 const f=fixture(continuous),runner=new BotRunner(f.options);runner.state.cycles=300;
 assert.equal((await runner.tick()).action,'pause');assert.equal(runner.state.status,'paused');assert.equal(f.sent.length,0);
 f.advance(86400000);assert.equal((await runner.tick()).action,'pause');assert.equal(runner.state.cycles,300);
});
test('a stop arriving during signing discards the signature before any broadcast or reservation',async()=>{
 const f=fixture(continuous);let requested=false;const original=f.adapter.sign;
 f.adapter.sign=async order=>{const result=await original(order);requested=true;return result;};
 const runner=new BotRunner({...f.options,shouldStop:async()=>requested});
 assert.equal((await runner.tick()).reason,'stop-before-broadcast');assert.equal(f.sent.length,0);assert.equal(runner.state.orders.length,0);
 assert.equal((await runner.tick()).action,'stop');assert.equal(runner.state.status,'stopped');
});
