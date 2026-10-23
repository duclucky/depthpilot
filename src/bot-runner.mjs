import { createHash } from 'node:crypto';
import { keccak256 } from 'viem';
import { initialBotState, validateBotConfig, decideBot, authorizeBot, botTotals } from './autopilot-policy.mjs';
import { parseExact, beginIntent, settleIntent } from './core.mjs';
export const botConfigDigest=config=>createHash('sha256').update(JSON.stringify(config)).digest('hex');
export class BotRunner {
  constructor({config,adapter,persist,savePlan,authority,live=false,now=Date.now,state,shouldStop=async()=>false}){
    validateBotConfig(config);Object.assign(this,{config,adapter,persist,savePlan,authority,live,now});
    this.digest=botConfigDigest(config);this.state=state||initialBotState(config,now());
    if(state&&(state.configDigest!==this.digest||state.mode!==(live?'live':'read-only')))throw Error('Stored run configuration or mode differs; never reset a live run');
    this.state.configDigest=this.digest;this.state.mode=live?'live':'read-only';
    this.shouldStop=shouldStop;
  }
  event(type,detail={}){this.state.events.push({at:this.now(),type,...detail});}
  async save(){await this.persist(this.state);this.lastPersistAt=this.now();}
  async resumeHalted(){
    const s=this.state,c=this.config;
    if(!c.continuous||!this.live||s.status!=='halted'||s.pending||!s.cycle)throw Error('Only an explicitly requested continuous halted-close recovery is supported');
    authorizeBot(c,await this.authority(),this.digest,this.now());
    const entry=s.orders.at(-1);
    if(entry?.action!=='close'||entry.receipt?.status!=='reverted')throw Error('Recovery requires a known reverted closing receipt');
    const receipt=await this.adapter.receipt(entry);
    if(receipt.status!=='reverted'||receipt.hash!==entry.hash||String(receipt.gasCost)!==String(entry.receipt.gasCost))throw Error('Stored closing receipt changed; reconcile before recovery');
    const o=await this.adapter.observe(),quantity=BigInt(s.cycle.quantity),totals=botTotals(s);
    if(o.chainId!==50383||o.openOrders.length||BigInt(o.position)!==quantity||quantity<=0n||quantity>parseExact(c.quantity,18)||!o.markPriceOk||this.now()<o.at||this.now()-o.at>15000||Math.abs(this.now()-o.blockTimestamp*1000)>30000)throw Error('Fresh chain state does not match the owned closing exposure');
    if(s.orders.length+1>c.maxTransactions||totals.gas+parseExact(c.closeGasReserveSTT,18)>parseExact(c.maxGasSTT,18)||BigInt(o.gasBalance)<parseExact(c.minNativeReserveSTT,18)+parseExact(c.closeGasReserveSTT,18))throw Error('Cumulative closing budget or native reserve exhausted');
    const closingNotional=quantity*BigInt(o.bid)/10n**18n;
    if(totals.notional+closingNotional>parseExact(c.maxNotional,18))throw Error('Cumulative closing notional exhausted');
    s.status='holding';s.exitDeadline=null;s.stopRequested=false;s.latestObservation=o;delete s.finishedAt;
    this.event('explicit-halt-recovery',{reason:'verified-reverted-close-and-owned-position',previousHash:entry.hash});await this.save();
  }
  async tick(){
    const s=this.state,c=this.config;
    if(s.pending)return this.reconcile();
    if(['stopped','halted'].includes(s.status))return {action:'stop',reason:s.status};
    const observation=await this.adapter.observe();s.latestObservation=observation;
    if(s.baselineEquity===undefined)s.baselineEquity=observation.equity;
    const decision=decideBot(c,s,observation,this.now());s.lastDecision={...decision,at:this.now()};
    if(decision.action==='pause')s.status='paused';
    else if(s.status==='paused')s.status='observing';
    if(['stop','halt'].includes(decision.action)){s.status=decision.action==='halt'?'halted':'stopped';s.finishedAt=this.now();this.event(s.status,{reason:decision.reason});}
    if(c.continuous&&decision.action==='close'&&!s.exitDeadline)s.exitDeadline=this.now()+c.closeGraceSec*1000;
    if(!c.continuous||!['wait','pause'].includes(decision.action)||this.lastPersistAt===undefined||this.now()-this.lastPersistAt>=60000)await this.save();
    if(!['open','close'].includes(decision.action))return decision;
    let order;
    try{order=await this.adapter.prepare(decision.action,s,observation);}
    catch(e){if(!e.botBlocked)throw e;this.event('candidate-blocked',{reason:e.message});await this.save();return {action:'wait',reason:e.message};}
    if(order.observation)s.latestObservation=order.observation;
    if(!this.live){if(!c.continuous){this.event('read-only-candidate',{action:decision.action,quantity:order.quantity,notional:order.notional,gasCeiling:order.gasCeiling});await this.save();}return {action:'preview',reason:decision.reason,quantity:order.quantity,price:order.price,expectedAveragePrice:order.expectedAveragePrice,notional:order.notional,gasCeiling:order.gasCeiling};}
    const authority=await this.authority();authorizeBot(c,authority,this.digest,this.now());
    const totals=botTotals(s),notional=BigInt(order.notional),gas=BigInt(order.gasCeiling),reserve=decision.action==='open'?parseExact(c.closeGasReserveSTT,18):0n;
    if(gas<=0n||notional<=0n||totals.gas+gas+reserve>parseExact(c.maxGasSTT,18)||totals.notional+notional*(decision.action==='open'?21n:10n)/10n>parseExact(c.maxNotional,18)||s.orders.length+(decision.action==='open'?2:1)>c.maxTransactions){
      this.event('candidate-blocked',{reason:'estimated-budget'});await this.save();return {action:'wait',reason:'estimated-budget'};
    }
    if(c.continuous&&await this.shouldStop())s.stopRequested=true;
    if((s.hardDeadline!==null&&this.now()>=s.hardDeadline)||(decision.action==='open'&&(s.stopRequested||(s.entryDeadline!==null&&this.now()>=s.entryDeadline-c.closeGraceSec*1000)))){if(c.continuous)await this.save();return {action:'wait',reason:'deadline-or-stop-before-sign'};}
    const signed=await this.adapter.sign(order);
    if(keccak256(signed.serializedTransaction)!==signed.hash)throw Error('Signed hash mismatch');
    authorizeBot(c,await this.authority(),this.digest,this.now());
    if(c.continuous&&await this.shouldStop())s.stopRequested=true;
    if(c.continuous&&decision.action==='open'&&s.stopRequested){await this.save();return {action:'wait',reason:'stop-before-broadcast'};}
    if((s.hardDeadline!==null&&this.now()>=s.hardDeadline)||(decision.action==='open'&&(s.stopRequested||(s.entryDeadline!==null&&this.now()>=s.entryDeadline-c.closeGraceSec*1000))))throw Error('Deadline or stop request changed before broadcast');
    const entry={...order,hash:signed.hash,at:this.now(),action:decision.action};
    beginIntent(entry.plan,{id:entry.hash,quantity:entry.quantity,price:entry.price,hash:entry.hash,nonce:entry.nonce,unsigned:entry.unsigned,reservedNotional:entry.notional});
    s.orders.push(entry);s.pending=entry.hash;s.status='pending';if(decision.action==='open')s.lastEntryAt=this.now();
    this.event('signed-intent',{action:entry.action,hash:entry.hash});
    this.event('broadcast-attempt',{action:entry.action,hash:entry.hash});
    await this.save(); // Flush hash, exact call, nonce and reservations before the single send.
    try{const hash=await this.adapter.broadcast(signed);if(hash!==entry.hash)throw Error('Broadcast hash mismatch');this.event('broadcast-returned',{hash});await this.save();}
    catch{this.event('ambiguous-broadcast',{hash:entry.hash});await this.save();}
    return this.reconcile();
  }
  async reconcile(){
    const s=this.state,entry=s.orders.find(o=>o.hash===s.pending);
    if(!entry)throw Error('Pending hash has no durable order');
    let receipt;
    try{receipt=await this.adapter.receipt(entry);}
    catch{
      if((s.hardDeadline!==null&&this.now()>=s.hardDeadline)||(this.config.continuous&&this.now()-entry.at>=this.config.closeGraceSec*1000)){s.status='halted';s.finishedAt=this.now();this.event('halted',{reason:'unresolved-hash',hash:entry.hash});await this.save();return {action:'halt',reason:'unresolved-hash',hash:entry.hash};}
      return {action:'reconcile',reason:'receipt-not-confirmed',hash:entry.hash};
    }
    entry.receipt=receipt;entry.confirmedAt=this.now();entry.receiptObservedMs=entry.confirmedAt-entry.at;
    const filled=(receipt.fills||[]).reduce((sum,f)=>sum+BigInt(f.quantity),0n);
    entry.filled=String(filled);
    settleIntent(entry.plan,{...receipt,reservedNotional:entry.notional});
    if(receipt.status!=='success'){s.status='halted';s.finishedAt=this.now();}
    else if(entry.action==='open'){
      s.cycle=filled>0n?{openedAt:this.now(),quantity:String(filled),openingHash:entry.hash}:null;
      s.status=s.cycle?'holding':'observing';
    }else{
      if(!s.cycle||filled>BigInt(s.cycle.quantity))throw Error('Closing fills exceed owned exposure');
      const remaining=BigInt(s.cycle.quantity)-filled;
      if(remaining===0n){s.cycle=null;s.exitDeadline=null;s.cycles++;s.status='observing';}
      else{s.cycle.quantity=String(remaining);s.status='holding';}
    }
    s.pending=null;this.event('receipt',{hash:entry.hash,action:entry.action,status:receipt.status,filled:entry.filled});
    // Saving the product journal first leaves the durable pending hash recoverable if interrupted.
    await this.savePlan(entry.plan);await this.save();
    return {action:'confirmed',hash:entry.hash,status:receipt.status,filled:entry.filled};
  }
}
