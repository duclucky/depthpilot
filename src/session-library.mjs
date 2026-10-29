import {readdir} from 'node:fs/promises';import {join} from 'node:path';
import {readJSON} from './runtime.mjs';import {formatExact,parseExact} from './core.mjs';import {readSegmentedLog} from './segmented-log.mjs';import {templateFromDraft} from './plan-template.mjs';
const validID=id=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
const hashOK=hash=>/^0x[a-f0-9]{64}$/i.test(hash||'');
const raw=value=>{if(!/^\d+$/.test(String(value??'')))throw Error('A saved report contains an invalid amount.');return BigInt(value);};
const ratio=(n,d)=>d?String(n*10000n/d):null;
export function buildSessionReport(meta,state){
 const d=meta.draft,finite=d.kind==='finite',s=state||{},p=s.plan||{},seen=new Set(),transactions=[];
 let buy=0n,sell=0n,buyQuote=0n,sellQuote=0n,gas=0n,reserved=0n,requested=0n,filled=0n,confirmed=0,unresolved=0;
 let gasComplete=true;
 for(const order of s.orders||[]){
  if(!hashOK(order.hash)||seen.has(order.hash.toLowerCase()))continue;seen.add(order.hash.toLowerCase());
  const receipt=finite?(p.receipts||[]).find(r=>(r.hash||r.key)?.toLowerCase()===order.hash.toLowerCase()):order.receipt;
  const known=receipt&&['success','reverted'].includes(receipt.status),side=finite?d.terms.side:order.action==='open'?'buy':'sell';
  let quantity=0n,quote=0n;
  if(known){
   if(receipt.hash&&receipt.hash.toLowerCase()!==order.hash.toLowerCase())throw Error('Saved receipt hash does not match the order.');
   confirmed++;requested+=raw(order.quantity);gas+=raw(receipt.gasCost??'0');if(receipt.gasCost===undefined||receipt.gasCost===null)gasComplete=false;
   if(receipt.status==='success')for(const fill of receipt.fills||[]){const q=raw(fill.quantity),price=raw(fill.price);quantity+=q;quote+=q*price;}
   if(quantity>raw(order.quantity))throw Error('Saved fills exceed the requested amount.');
   filled+=quantity;if(side==='buy'){buy+=quantity;buyQuote+=quote;}else{sell+=quantity;sellQuote+=quote;}
  }else{unresolved++;reserved+=raw(order.gasCeiling??'0');}
  transactions.push({hash:order.hash,url:'https://explorer.testnet.somnia.network/tokyo/tx/'+order.hash,side,status:known?receipt.status:'unconfirmed',source:receipt?.source==='live'?'live':'unverified',requestedETH:formatExact(order.quantity,18),filledETH:formatExact(quantity,18),averagePrice:quantity?formatExact(quote/quantity,18):null,gasSTT:known&&receipt.gasCost!==undefined&&receipt.gasCost!==null?formatExact(receipt.gasCost,18):null,blockNumber:receipt?.blockNumber===undefined?null:String(receipt.blockNumber),at:order.at??null,confirmedAt:order.confirmedAt??receipt?.confirmedAt??null});
 }
 const arrival=raw(p.arrivalPrice||'0'),numerator=buyQuote+sellQuote,adverse=(d.terms?.side==='sell'?-1n:1n)*(numerator-filled*arrival);
 const target=parseExact(d.quantity,18),metrics={gasComplete,buyQuantity:formatExact(buy,18),sellQuantity:formatExact(sell,18),buyVWAP:buy?formatExact(buyQuote/buy,18):null,sellVWAP:sell?formatExact(sellQuote/sell,18):null,gasSTT:formatExact(gas,18),reservedGasSTT:formatExact(reserved,18),fillRateBps:ratio(filled,requested),confirmedOrders:confirmed,unresolvedOrders:unresolved,sentOrders:transactions.length,rounds:finite?null:s.cycles??0,completionBps:finite?ratio(filled,target):null,remainingQuantity:finite?formatExact(target>filled?target-filled:0n,18):null,arrivalPrice:finite&&arrival?formatExact(arrival,18):null,arrivalSlippageBps:finite&&filled&&arrival?formatExact(adverse*1000000n/(filled*arrival),2):null};
 return {app:'depthpilot',schema:1,id:meta.id,version:meta.version,kind:finite?d.terms.side:'roundtrip',createdAt:meta.createdAt,updatedAt:s.updatedAt??meta.createdAt,status:s.status||'starting',liveProof:s.mode!=='read-only'&&(s.mode==='live'||p.source==='live')&&confirmed>0&&transactions.filter(t=>t.status!=='unconfirmed').every(t=>t.source==='live'),pending:s.pending||p.pending?.hash||null,ownedPositionETH:finite?null:formatExact(s.cycle?.quantity||'0',18),limits:{quantity:d.quantity,maxGasSTT:d.maxGas,maxNotionalUSDso:d.maxNotional},metrics,transactions,note:'Saved reconciled receipts; not a fresh onchain account check. VWAP excludes fees/funding. Gas is separate in STT. Positive arrival slippage means worse execution; it is not profit or loss.'};
}
export class SessionLibrary {
 constructor(home){this.directory=join(home,'.data','runs');}
 path(id,suffix=''){if(!validID(id))throw Error('Invalid session ID.');return join(this.directory,id+suffix+'.json');}
 async meta(id){const meta=await readJSON(this.path(id),null);if(!meta||meta.id!==id)throw Error('Session not found.');return meta;}
 async list(offset=0,limit=20){
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Invalid history page.');
  const names=await readdir(this.directory),metas=[];for(const name of names){const id=name.slice(0,-5);if(name.endsWith('.json')&&validID(id)){const meta=await this.meta(id);metas.push(meta);}}
  metas.sort((a,b)=>b.createdAt-a.createdAt||a.id.localeCompare(b.id));
  const runs=[];for(const meta of metas.slice(offset,offset+limit)){const report=buildSessionReport(meta,await readJSON(this.path(meta.id,'-state'),null));runs.push({id:report.id,kind:report.kind,createdAt:report.createdAt,status:report.status,metrics:report.metrics,pending:report.pending,liveProof:report.liveProof});}
  return {runs,total:metas.length,nextOffset:offset+runs.length};
 }
 async report(id){return buildSessionReport(await this.meta(id),await readJSON(this.path(id,'-state'),null));}
 async template(id){return templateFromDraft((await this.meta(id)).draft);}
 async activity(id,after=0,limit=100){
  await this.meta(id);if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('Invalid activity page.');
  try{return await readSegmentedLog(this.directory,`activity-${id}-index.json`,after,limit);}catch(e){if(e.code==='ENOENT')return {entries:[],nextCursor:0,total:0};throw e;}
 }
}
