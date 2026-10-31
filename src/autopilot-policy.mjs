import { parseExact } from './core.mjs';
import { botIdentity } from './delegation.mjs';
const raw = value => parseExact(value,18);
const answer = (action,reason) => ({action,reason});
export function validateBotConfig(c) {
  botIdentity(c);
  if(c.continuous!==undefined&&typeof c.continuous!=='boolean')throw Error('Invalid continuous mode');
  const continuous=c.continuous===true;
  if(c.chainId!==50383 || c.symbol!=='ETH' || !/^0x[0-9a-fA-F]{40}$/.test(c.account) || !/^[a-zA-Z0-9-]{1,40}$/.test(c.runId))throw Error('Invalid bot account, chain, symbol or run ID');
  if(continuous&&c.durationSec!==null)throw Error('Continuous mode requires a null duration');
  const timings=[['closeGraceSec',30,120],['pollSec',1,30],['entryIntervalSec',60,1800],['holdSec',5,120],['maxCycles',1,continuous?300:6],['maxTransactions',2,continuous?600:12],['maxSpreadBps',1,20],['slippageBps',1,50],['participationBps',1,2500]];
  if(!continuous)timings.push(['durationSec',60,1800]);
  for(const [key,min,max] of timings){
    if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw Error(`Invalid bot ${key}`);
  }
  if(c.maxTransactions<c.maxCycles*2||c.entryIntervalSec<=c.holdSec)throw Error('Entry/exit slots or timing invalid');
  if(c.closeOrderSlots!==undefined&&(!Number.isInteger(c.closeOrderSlots)||c.closeOrderSlots<1||c.closeOrderSlots>3))throw Error('Invalid closing order slots');
  for(const [key,max] of [['quantity','0.004'],['maxNotional',continuous?'6000':'150'],['maxGasSTT',continuous?'6':'0.5'],['maxGasPriceGwei','10'],['closeGasReserveSTT','0.5'],['stopEquityDeclineUSDso','0.25'],['minEntryEquityUSDso','1.77736']])if(raw(c[key])<=0n||raw(c[key])>raw(max))throw Error(`Invalid bot ${key}`);
  if(continuous&&(raw(c.minNativeReserveSTT)<raw('1')||raw(c.minNativeReserveSTT)>raw('8')))throw Error('Invalid native reserve');
  if(raw(c.closeGasReserveSTT)*2n>raw(c.maxGasSTT))throw Error('Insufficient opening and closing gas reserves');
  return c;
}
export function initialBotState(config, now=Date.now()) {
  validateBotConfig(config);
  return {runId:config.runId,startedAt:now,entryDeadline:config.continuous?null:now+config.durationSec*1000,hardDeadline:config.continuous?null:now+(config.durationSec+config.closeGraceSec)*1000,orders:[],events:[],cycles:0,pending:null,cycle:null,status:'observing'};
}
export function botTotals(state) {
  return state.orders.reduce((s,o)=>({gas:s.gas+BigInt(o.receipt?.gasCost??o.gasCeiling),notional:s.notional+BigInt(o.notional)}),{gas:0n,notional:0n});
}
export function decideBot(c,s,o,now=Date.now()) {
  const finish=(reason)=>answer(c.continuous?'pause':'stop',reason);
  if(s.pending)return answer('reconcile','stored-signed-intent');
  if(s.status==='stopped'||s.status==='halted')return answer('stop','already-finished');
  if(o.chainId!==50383)return answer('halt','wrong-chain');
  if(o.openOrders.length)return answer('halt','unexpected-resting-order');
  if(s.cycle&&BigInt(o.position)!==BigInt(s.cycle.quantity))return answer('halt','position-mismatch');
  if(!s.cycle&&BigInt(o.position)!==0n)return answer('halt','unowned-position');
  const equity=BigInt(o.equity),loss=s.baselineEquity!==undefined&&BigInt(s.baselineEquity)-equity>=raw(c.stopEquityDeclineUSDso);
  const risk=loss||equity<raw(c.minEntryEquityUSDso)||o.marginStatus!=='Healthy';
  if(s.cycle){
    if((s.hardDeadline!==null&&now>=s.hardDeadline)||(s.exitDeadline&&now>=s.exitDeadline))return answer('halt','closing-window-expired');
    if(s.stopRequested||risk||(s.entryDeadline!==null&&now>=s.entryDeadline)||now-s.cycle.openedAt>=c.holdSec*1000)return answer('close',risk?'equity-guard':'timed-exit');
    return answer('wait','holding');
  }
  if(s.stopRequested)return answer('stop','user-stop');
  if(risk)return finish('equity-guard');
  if((s.entryDeadline!==null&&now>=s.entryDeadline-c.closeGraceSec*1000)||s.cycles>=c.maxCycles)return finish('run-complete');
  if(!o.markPriceOk||now<o.at||now-o.at>15000||Math.abs(now-o.blockTimestamp*1000)>30000)return answer('wait','stale-market');
  const bid=BigInt(o.bid),ask=BigInt(o.ask),quantity=raw(c.quantity),lot=BigInt(o.lotSize);
  if(bid<=0n||ask<bid)return answer('wait','invalid-book');
  if((ask-bid)*10000n>bid*BigInt(c.maxSpreadBps))return answer('wait','spread-too-wide');
  if(quantity<BigInt(o.minQuantity)||lot<=0n||quantity%lot!==0n)return answer('halt','market-quantity-changed');
  if(s.lastEntryAt!==undefined&&now-s.lastEntryAt<c.entryIntervalSec*1000)return answer('wait','entry-cooldown');
  const {gas,notional}=botTotals(s),entryNotional=quantity*(ask*(10000n+BigInt(c.slippageBps))/10000n)/10n**18n;
  if(s.orders.length+1+(c.closeOrderSlots??1)>c.maxTransactions||notional+entryNotional*21n/10n>raw(c.maxNotional)||gas+raw(c.closeGasReserveSTT)*2n>raw(c.maxGasSTT)||BigInt(o.gasBalance)<raw(c.closeGasReserveSTT)*2n+raw(c.minNativeReserveSTT||'0'))return finish('entry-exit-budget');
  return answer('open','fresh-tight-book');
}
export function authorizeBot(config,authority,digest,now=Date.now()) {
  validateBotConfig(config);
  const current=authority&&(config.continuous&&authority.untilStopped===true||Number.isFinite(Date.parse(authority.expiresAt))&&Date.parse(authority.expiresAt)>now);
  if(!authority||authority.revoked||typeof authority.userAuthorization!=='string'||!authority.userAuthorization.trim()||authority.configDigest!==digest||!current)throw Error('Missing current explicit authorization for this exact bot configuration');
}
