import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEther } from 'viem';
import { validateBotConfig, decideBot, initialBotState, authorizeBot } from '../src/autopilot-policy.mjs';

const config=JSON.parse(await readFile(new URL('./fixtures/bot.config.json',import.meta.url),'utf8'));
const quantity=String(parseEther('0.004'));
function fixture(){
  const now=1800000000000, state=initialBotState(config,now);
  state.baselineEquity=String(parseEther('1.77736'));
  const observation={at:now,chainId:50383,position:'0',openOrders:[],equity:state.baselineEquity,gasBalance:String(parseEther('8')),marginStatus:'Healthy',markPriceOk:true,blockTimestamp:Math.floor(now/1000),bid:String(parseEther('2400')),ask:String(parseEther('2400.2')),minQuantity:quantity,lotSize:String(parseEther('0.0001'))};
  return {state,observation,now};
}
test('configuration rejects mainnet, oversized exposure and unbounded loop parameters',()=>{
  assert.doesNotThrow(()=>validateBotConfig(config));
  for(const patch of [{chainId:1},{quantity:'1'},{maxTransactions:11},{pollSec:0},{durationSec:Infinity},{closeGraceSec:-1},{slippageBps:1001},{maxGasSTT:'0'},{maxCycles:0},{runId:'../escape'}])assert.throws(()=>validateBotConfig({...config,...patch}));
});
test('the configured bot autonomously selects entry, timed exit, cooldown and completion',()=>{
  const {state,observation,now}=fixture();
  assert.equal(decideBot(config,state,observation,now).action,'open');
  state.cycle={openedAt:now,quantity};state.lastEntryAt=now;
  observation.position=quantity;
  assert.equal(decideBot(config,state,observation,now+19000).action,'wait');
  observation.at=now+20000;observation.blockTimestamp=Math.floor(observation.at/1000);
  assert.equal(decideBot(config,state,observation,now+20000).action,'close');
  state.cycle=null;state.cycles=1;observation.position='0';
  assert.equal(decideBot(config,state,observation,now+20000).action,'wait');
  observation.at=now+300000;observation.blockTimestamp=Math.floor(observation.at/1000);
  assert.equal(decideBot(config,state,observation,now+300000).action,'open');
  state.cycles=6;
  assert.equal(decideBot(config,state,observation,now+300000).action,'stop');
});
test('freshness, spread, unrelated exposure and external resting orders block entry',()=>{
  for(const patch of [{at:0},{markPriceOk:false},{blockTimestamp:1},{ask:String(parseEther('2500'))},{position:quantity},{openOrders:[{id:'other'}]},{equity:String(parseEther('1.4'))},{marginStatus:'Liquidatable'}]){
    const {state,observation,now}=fixture();
    assert.notEqual(decideBot(config,state,{...observation,...patch},now).action,'open');
  }
});
test('an entry reserves both an exit transaction and closing notional/gas capacity',()=>{
  for(const transactions of [
    Array.from({length:11},()=>({notional:'0',receipt:{gasCost:'0'}})),
    [{notional:String(parseEther('140')),receipt:{gasCost:'0'}}],
    [{notional:'0',receipt:{gasCost:String(parseEther('0.45'))}}]
  ]){
    const {state,observation,now}=fixture();state.orders=transactions;
    assert.notEqual(decideBot(config,state,observation,now).action,'open');
  }
});
test('equity guard and deadline stop entries but request an exit for this bot exposure',()=>{
  const {state,observation,now}=fixture();
  const loss={...observation,equity:String(parseEther('1.4'))};
  assert.equal(decideBot(config,state,loss,now).action,'stop');
  state.cycle={openedAt:now,quantity};
  assert.equal(decideBot(config,state,{...loss,position:quantity},now).action,'close');
  assert.equal(decideBot(config,state,{...observation,position:quantity},now+1800001).action,'close');
});
test('a pending signed hash always reconciles without selecting another order',()=>{
  const {state,observation,now}=fixture();state.pending={hash:'0x'+'a'.repeat(64)};
  assert.equal(decideBot(config,state,observation,now).action,'reconcile');
  state.stopRequested=true;
  assert.equal(decideBot(config,state,observation,now+1800001).action,'reconcile');
});
test('position mismatch never becomes an automatic sell or larger opening',()=>{
  const {state,observation,now}=fixture();state.cycle={openedAt:now,quantity};
  for(const position of ['0',String(parseEther('-0.004')),String(parseEther('0.008'))])assert.equal(decideBot(config,state,{...observation,position},now+20000).action,'halt');
});
test('live authorization must be explicit, unexpired and bound to the exact configuration',()=>{
  const now=1800000000000, authority={userAuthorization:'Approved bounded autonomous Tokyo test',configDigest:'digest',expiresAt:new Date(now+3600000).toISOString()};
  assert.doesNotThrow(()=>authorizeBot(config,authority,'digest',now));
  for(const a of [null,{...authority,userAuthorization:''},{...authority,configDigest:'changed'},{...authority,expiresAt:new Date(now).toISOString()}])assert.throws(()=>authorizeBot(config,a,'digest',now));
});
