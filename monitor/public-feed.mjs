import {formatExact} from '../src/core.mjs';
// Shared by the optional local publisher and deterministic privacy/receipt checks.

const hash=value=>/^0x[a-f0-9]{64}$/i.test(value||'')?value:null;
const time=value=>Number.isFinite(value)&&value>=0?value:null;
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const decimal=value=>{try{return /^-?\d+$/.test(String(value))?formatExact(value,18):null;}catch{return null;}};
const reasons={
 'equity-guard':'An equity safety rule blocks new entries. An owned position is closed when possible.',
 'fresh-tight-book':'Market and entry rules were met.',holding:'Waiting for the holding interval or an exit trigger.',
 'timed-exit':'The position is eligible for a bounded close.',
 'entry-cooldown':'Waiting between entry attempts.',
 'spread-too-wide':'Spread exceeds the configured limit.',
 'stale-market':'Waiting for fresh market data.',
 'entry-exit-budget':'The remaining limits cannot cover another entry and exit.',
 'run-complete':'The allowed rounds or time window are finished.',
 'network-read-error':'A network read could not finish; waiting before another check.',
 'receipt-not-confirmed':'A submitted transaction is waiting for receipt reconciliation.',
 'stored-signed-intent':'Checking the saved pending transaction before another action.',
 'position-mismatch':'The account position differs from the saved bot-owned exposure.',
 'unexpected-resting-order':'An unexpected open order needs review.',
 'unowned-position':'Existing exposure does not belong to the current bot cycle.',
 'user-stop':'A user stop was requested.',
 'already-finished':'The runner has stopped.',
 'unresolved-hash':'A submitted hash still needs reconciliation.',
};
const actions=new Set(['open','close','wait','pause','reconcile','confirmed','halt','stop','preview']);
const statuses=new Set(['observing','holding','pending','paused','stopped','halted','completed','expired','partial']);
export function publicReason(reason){return reasons[reason]?{code:reason,text:reasons[reason]}:{code:'other',text:'The runner recorded a step. Inspect confirmed receipts for execution evidence.'};}

// A public projection, not a dump of runtime files. No identity, intent, calldata or credentials.
export function buildPublicFeed({config,state,entries=[],totalEntries=0,workerPresent=false,now=Date.now()}){
 if(config.chainId!==50383||config.symbol!=='ETH')throw Error('Only the configured Tokyo ETH reference run may be exported');
 const transactions=[],seen=new Set();let gas=0n,notional=0n;
 for(const order of state.orders||[]){
  const id=hash(order.hash);if(!id||seen.has(id.toLowerCase()))continue;seen.add(id.toLowerCase());
  const receipt=order.receipt,confirmed=receipt&&['success','reverted'].includes(receipt.status);
  let filled=0n,numerator=0n;
  if(confirmed&&receipt.status==='success')for(const f of receipt.fills||[]){if(!/^\d+$/.test(String(f.quantity))||!/^\d+$/.test(String(f.price)))throw Error('Invalid public fill');filled+=BigInt(f.quantity);numerator+=BigInt(f.quantity)*BigInt(f.price);}
  if(filled>BigInt(order.quantity))throw Error('Public fills exceed the saved requested amount');
  if(confirmed&&receipt.gasCost!==undefined)gas+=BigInt(receipt.gasCost);
  if(/^\d+$/.test(String(order.notional)))notional+=BigInt(order.notional);
  transactions.push({hash:id,action:order.action==='open'?'open':order.action==='close'?'close':'order',status:confirmed?receipt.status:'unconfirmed',source:confirmed&&receipt.source==='live'?'saved-live-receipt':'unverified',requestedETH:decimal(order.quantity),filledETH:formatExact(filled,18),averageUSDso:filled?formatExact(numerator/filled,18):null,gasSTT:confirmed?decimal(receipt.gasCost):null,at:time(order.at),confirmedAt:time(order.confirmedAt),blockNumber:/^\d+$/.test(String(receipt?.blockNumber))?String(receipt.blockNumber):null});
 }
 const o=state.latestObservation||{},reason=publicReason(state.lastDecision?.reason);
 const decisions=entries.slice(-60).map(e=>({at:time(e.at),action:actions.has(e.result?.action||e.action)?e.result?.action||e.action:'step',...publicReason(e.result?.reason||e.reason),hash:hash(e.result?.hash||e.hash)}));
 const data={schema:1,app:'DepthPilot',network:'Tokyo testnet',chainId:50383,source:'Reference operator; separate local deployment, not a new installer session',mode:state.mode==='live'?'live':'read-only',generatedAt:now,heartbeatAt:time(state.updatedAt),observedAt:time(o.at),workerPresent:Boolean(workerPresent),status:statuses.has(state.status)?state.status:'unknown',decision:reason,cycles:count(state.cycles),pending:hash(state.pending),positionETH:decimal(o.position),botOwnedPositionETH:decimal(state.cycle?.quantity||'0'),equityUSDso:decimal(o.equity),botGasSTT:decimal(o.gasBalance),gasUsedSTT:formatExact(gas,18),limitNotionalUSDso:formatExact(notional,18),limits:{quantityETH:config.quantity,cycles:config.maxCycles,orders:config.maxTransactions,notionalUSDso:config.maxNotional,gasSTT:config.maxGasSTT,reserveSTT:config.minNativeReserveSTT,entryIntervalSec:config.entryIntervalSec,holdSec:config.holdSec,maxSpreadBps:config.maxSpreadBps,slippageBps:config.slippageBps,equityDeclineUSDso:config.stopEquityDeclineUSDso,minEquityUSDso:config.minEntryEquityUSDso},transactions,decisions,totalDecisions:count(totalEntries),note:'Periodically published local observations and saved receipts. This is not continuous uptime proof, a fresh independent account audit or PnL. The site cannot sign or control the bot.'};
 if(Buffer.byteLength(JSON.stringify(data))>512000)throw Error('Public snapshot is too large');
 return data;
}
