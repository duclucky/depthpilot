import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEther } from 'viem';
import { validateBotConfig, initialBotState, decideBot, authorizeBot } from '../src/autopilot-policy.mjs';
const config=JSON.parse(await readFile(new URL('./fixtures/bot.continuous.config.json',import.meta.url),'utf8'));
function fixture(){
 const now=1800000000000,state=initialBotState(config,now);state.baselineEquity=String(parseEther('1.77'));
 const observation={at:now,chainId:50383,position:'0',openOrders:[],equity:state.baselineEquity,gasBalance:String(parseEther('8')),marginStatus:'Healthy',markPriceOk:true,blockTimestamp:Math.floor(now/1000),bid:String(parseEther('2400')),ask:String(parseEther('2400.2')),minQuantity:String(parseEther('0.004')),lotSize:String(parseEther('0.0001'))};
 return {now,state,observation};
}
test('continuous config has no time cutoff but still rejects unbounded economic exposure',()=>{
 assert.doesNotThrow(()=>validateBotConfig(config));
 for(const patch of [{maxGasSTT:'100'},{maxTransactions:Infinity},{maxNotional:'1000000'},{quantity:'1'},{minNativeReserveSTT:'0'},{durationSec:1800}])assert.throws(()=>validateBotConfig({...config,...patch}));
});
test('continuous mode selects a fresh entry after 24 hours without resetting totals or equity baseline',()=>{
 const {state,observation,now}=fixture();const later=now+86400000;
 assert.equal(state.hardDeadline,null);assert.equal(state.entryDeadline,null);
 assert.equal(decideBot(config,state,{...observation,at:later,blockTimestamp:later/1000},later).action,'open');
 assert.equal(state.baselineEquity,String(parseEther('1.77')));
});
test('continuous quota and equity guards pause entry while a requested stop exits the process',()=>{
 const {state,observation,now}=fixture();state.cycles=300;
 assert.equal(decideBot(config,state,observation,now).action,'pause');
 state.cycles=0;assert.equal(decideBot(config,state,{...observation,equity:String(parseEther('1.4'))},now).action,'pause');
 assert.equal(decideBot(config,state,{...observation,gasBalance:String(parseEther('1.01'))},now).action,'pause');
 state.stopRequested=true;assert.equal(decideBot(config,state,observation,now).action,'stop');
});
test('stop still requests a bounded exit, and a pending hash reconciles first',()=>{
 const {state,observation,now}=fixture();state.cycle={openedAt:now,quantity:String(parseEther('0.004'))};state.stopRequested=true;
 assert.equal(decideBot(config,state,{...observation,position:state.cycle.quantity},now).action,'close');
 state.exitDeadline=now-1;assert.equal(decideBot(config,state,{...observation,position:state.cycle.quantity},now).action,'halt');
 state.pending={hash:'0x'+'a'.repeat(64)};assert.equal(decideBot(config,state,observation,now).action,'reconcile');
});
test('until-stopped authority is valid only for an exact continuous profile and can be revoked',()=>{
 const authority={userAuthorization:'explicit synthetic bounded scope',configDigest:'digest',untilStopped:true};
 assert.doesNotThrow(()=>authorizeBot(config,authority,'digest',1800000000000));
 for(const a of [{...authority,revoked:true},{...authority,configDigest:'different'},{...authority,untilStopped:false}])assert.throws(()=>authorizeBot(config,a,'digest',1800000000000));
});
