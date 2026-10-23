import { randomUUID, createHash } from 'node:crypto';
import { beginIntent, settleIntent, planChild, parseExact } from './core.mjs';
import { executionReport } from './execution-report.mjs';

export function executionDigest(plan) {
  const terms={};for(const key of ['id','source','symbol','account','operator','side','target','bound','maxChild','participationBps','deadline','arrivalPrice','executionPolicy','market'])terms[key]=plan[key];
  return createHash('sha256').update(JSON.stringify(terms)).digest('hex');
}
export function authorizeExecution(run, authority, now=Date.now()) {
  if(!authority||authority.revoked||!authority.userAuthorization||authority.runId!==run.id||authority.planDigest!==executionDigest(run.plan)||authority.chainId!==50383||run.plan.source!=='live'||Date.parse(authority.expiresAt)<=now||!Number.isFinite(Date.parse(authority.expiresAt)))throw Error('Exact execution authorization required');
  if(!Number.isInteger(authority.maxOrders)||authority.maxOrders<1||authority.maxOrders>600||!/^\d+(\.\d+)?$/.test(authority.maxGasSTT)||parseExact(authority.maxGasSTT,18)<=0n||!/^\d+(\.\d+)?$/.test(authority.maxNotionalUSDso)||parseExact(authority.maxNotionalUSDso,18)<=0n||!/^\d+(\.\d+)?$/.test(authority.maxGasPriceGwei)||parseExact(authority.maxGasPriceGwei,9)<=0n)throw Error('Invalid execution authorization budget');
  return authority;
}

// One finite direction/target. Never opens an opposite order to manufacture a round trip.
export class ExecutionRunner {
  constructor({plan,id=randomUUID(),mode='observe',state,adapter,persist=async()=>{},authority,now=Date.now}) {
    if(!['observe','replay','live'].includes(mode))throw Error('Invalid execution mode');
    if(!plan.executionPolicy||plan.pending||BigInt(plan.remaining)<=0n)throw Error('An unblocked execution-policy plan is required');
    if((mode==='replay')!==(plan.source==='replay'))throw Error('Execution source does not match mode');
    this.state=state||{id,plan:structuredClone(plan),mode,status:'running',createdAt:now(),decisions:[],orders:[]};
    if(this.state.mode!==mode||executionDigest(this.state.plan)!==executionDigest(plan))throw Error('Execution state does not match plan');
    Object.assign(this,{adapter,persist,authority,now});this.busy=false;
  }
  async save(){this.state.updatedAt=this.now();await this.persist(this.state);}
  record(action,reason,details={}){this.state.decisions.push({at:this.now(),action,reason,...details});this.state.report=executionReport(this.state.plan);}
  async tick(){
    if(this.busy)throw Error('Execution tick already active');this.busy=true;
    try{return await this.step();}finally{this.busy=false;}
  }
  async step(){
    const s=this.state,p=s.plan;
    // Reconcile even after expiry/stop. A persisted signed hash is never resent.
    if(p.pending){
      if(s.mode==='replay')return this.settleReplay();
      let receipt;try{receipt=await this.adapter.receipt(p,p.pending);}catch(e){
        if(!/not found|not been found|could not be found|timeout|timed out|fetch failed/i.test(`${e.shortMessage||''} ${e.message||''}`))throw e;
        this.record('reconcile','receipt-not-confirmed',{hash:p.pending.hash});await this.save();return;
      }
      settleIntent(p,receipt);p.receipts.at(-1).confirmedAt=this.now();
      this.record('confirmed',receipt.status,{hash:receipt.hash,filled:p.receipts.at(-1).filled});
      if(receipt.status==='reverted')s.status='halted';
      else if(BigInt(p.remaining)===0n)s.status='completed';
      await this.save();return;
    }
    if(s.status!=='running')return;
    if(s.stopRequested||this.now()>=p.deadline||BigInt(p.remaining)===0n){s.status=s.stopRequested?'stopped':BigInt(p.remaining)===0n?'completed':'expired';this.record('stop',s.status);await this.save();return;}
    const data=await this.adapter.observe(p,s),child=planChild({...p,...data,now:this.now()});
    this.record(child.executable?(s.mode==='observe'?'preview':'ready'):'wait',child.reason,{child,blockNumber:data.snapshot.blockNumber});
    if(child.reason==='untradeable-remainder'){s.status='partial';await this.save();return;}
    if(!child.executable||s.mode==='observe'){await this.save();return;}
    if(s.mode==='replay'){
      beginIntent(p,{...child,id:randomUUID()});await this.save();
      return this.settleReplay();
    }
    let a=authorizeExecution(s,await this.authority?.(),this.now());
    if(s.orders.length>=a.maxOrders) return this.halt('order-budget');
    const prepared=await this.adapter.prepare(p,child);
    if(prepared.quantity!==child.quantity||prepared.price!==child.price) return this.halt('candidate-changed');
    const notional=BigInt(prepared.quantity)*BigInt(prepared.price)/10n**BigInt(p.market.baseDecimals);
    const withinBudget=authority=>s.orders.length<authority.maxOrders&&BigInt(p.gasCost)+BigInt(prepared.gasCeiling)<=parseExact(authority.maxGasSTT,18)&&BigInt(prepared.gasPrice)<=parseExact(authority.maxGasPriceGwei,9)&&s.orders.reduce((n,o)=>n+BigInt(o.notional),0n)+notional<=parseExact(authority.maxNotionalUSDso,p.market.quoteDecimals);
    if(!withinBudget(a))return this.halt('financial-budget');
    a=authorizeExecution(s,await this.authority(),this.now());
    if(!withinBudget(a))return this.halt('financial-budget');
    if(this.now()>=p.deadline||this.now()-prepared.observedAt>15000)return this.halt('candidate-expired');
    const signed=await this.adapter.sign(prepared);
    if(s.stopRequested)return this.halt('stop-before-broadcast');
    a=authorizeExecution(s,await this.authority(),this.now());
    if(!withinBudget(a)||this.now()>=p.deadline||this.now()-prepared.observedAt>15000)return this.halt('candidate-expired-or-budget-changed');
    beginIntent(p,{...child,id:randomUUID(),hash:signed.hash,unsigned:prepared.unsigned,nonce:prepared.nonce,gasCeiling:prepared.gasCeiling});
    s.orders.push({hash:signed.hash,quantity:child.quantity,price:child.price,notional:String(notional),gasCeiling:prepared.gasCeiling});
    this.record('signed','intent-persisted-before-broadcast',{hash:signed.hash});await this.save();
    try{const hash=await this.adapter.broadcast(signed);if(hash.toLowerCase()!==signed.hash.toLowerCase())throw Error('Hash mismatch');this.record('broadcast','awaiting-receipt',{hash});}
    catch{this.record('reconcile','broadcast-outcome-unknown',{hash:signed.hash});}
    await this.save();
  }
  async settleReplay(){
    const s=this.state,p=s.plan,child=p.pending;
    const requested=BigInt(child.quantity),lot=BigInt(p.market.lotSize),filled=s.orders.length===0?(requested/2n/lot*lot||requested):requested;
    const key=`synthetic-${s.id}-${s.orders.length+1}`;
    s.orders.push({hash:key,quantity:child.quantity,source:'replay'});
    settleIntent(p,{key,status:'success',fills:[{quantity:String(filled),price:child.expectedAveragePrice}],gasCost:'0',source:'replay'});
    p.receipts.at(-1).confirmedAt=this.now();this.record('simulated','partial-or-full-fill',{filled:String(filled)});
    if(BigInt(p.remaining)===0n)s.status='completed';await this.save();
  }
  async halt(reason){this.state.status='halted';this.record('halt',reason);await this.save();}
}
