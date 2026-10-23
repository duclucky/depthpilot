import { readFile, writeFile, rename, appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { botTotals } from './autopilot-policy.mjs';
import { json } from './gateway.mjs';
import { SegmentedLog, readSegmentedLog, atomicJSON } from './segmented-log.mjs';
export function publicBotStatus(config,state){
  const totals=botTotals(state);
  return {runId:state.runId,mode:state.mode,status:state.status,config,startedAt:state.startedAt,entryDeadline:state.entryDeadline,hardDeadline:state.hardDeadline,finishedAt:state.finishedAt,updatedAt:Date.now(),baselineEquity:state.baselineEquity,latestObservation:state.latestObservation,lastDecision:state.lastDecision,cycles:state.cycles,pending:state.pending,cycle:state.cycle,totals:{gas:String(totals.gas),notional:String(totals.notional)},orders:state.orders.map(o=>({hash:o.hash,action:o.action,quantity:o.quantity,price:o.price,expectedAveragePrice:o.expectedAveragePrice,notional:o.notional,at:o.at,confirmedAt:o.confirmedAt,receiptObservedMs:o.receiptObservedMs,filled:o.filled,gasCeiling:o.gasCeiling,receipt:o.receipt})),events:state.events};
}
export class BotMonitor {
  constructor(root){this.directory=join(root,'.data');this.count=0;}
  async begin(config,state){
    await mkdir(this.directory,{recursive:true});this.runId=state.runId;this.logName=`bot-log-${state.runId}-${state.mode}.jsonl`;
    if(config.continuous){this.segments=new SegmentedLog(this.directory,this.logName.slice(0,-6));this.count=await this.segments.open();await this.publish(config,state);return;}
    try{
      let text=await readFile(join(this.directory,this.logName),'utf8');
      if(text&&!text.endsWith('\n')){
        const boundary=text.lastIndexOf('\n')+1;
        // Preserve interrupted bytes for audit; only complete records are appended to again.
        await writeFile(join(this.directory,`${this.logName}.partial-${Date.now()}.txt`),text.slice(boundary),{flush:true});
        text=text.slice(0,boundary);const temp=join(this.directory,`${this.logName}.repair.tmp`);
        await writeFile(temp,text,{flush:true});await rename(temp,join(this.directory,this.logName));
      }
      this.count=text.split('\n').filter(Boolean).length;
    }catch(e){if(e.code!=='ENOENT')throw e;}
    await this.publish(config,state);
  }
  async publish(config,state){
    if(config.continuous){
      const status=publicBotStatus(config,state),{orders,events,...small}=status;
      const historyName=`bot-history-${state.runId}-${state.mode}.json`,key=`${orders.length}:${events.length}:${state.pending}`;
      if(this.historyKey!==key){await atomicJSON(join(this.directory,historyName),{orders,events});this.historyKey=key;}
      await atomicJSON(join(this.directory,'bot-status.json'),{...small,historyName,logIndexName:this.segments.indexName,logCount:this.count});return;
    }
    const temp=join(this.directory,'bot-status.json.tmp');
    await writeFile(temp,json({...publicBotStatus(config,state),logName:this.logName,logCount:this.count})+'\n',{flush:true});
    await rename(temp,join(this.directory,'bot-status.json'));
  }
  async log(config,state,result){
    const item={sequence:++this.count,at:Date.now(),mode:state.mode,result,observation:state.latestObservation};
    if(this.segments)await this.segments.append(item);else await appendFile(join(this.directory,this.logName),json(item)+'\n',{flush:true});
    await this.publish(config,state);
    return item;
  }
}
export async function readBotMonitor(root,after=0,limit=500){
  if(!Number.isSafeInteger(after)||after<0)throw Error('Invalid bot log cursor');
  let status;
  try{status=JSON.parse(await readFile(join(root,'.data/bot-status.json'),'utf8'));}catch(e){
    if(e.code!=='ENOENT')throw e;
    let recorded;try{recorded=JSON.parse(await readFile(join(root,'evidence/autonomous-monitor.json'),'utf8'));}catch(error){if(error.code==='ENOENT')return {status:null,entries:[],nextCursor:0};throw error;}
    if(recorded.source!=='verified-autonomous-tokyo-run'||!recorded.verification?.flat||!recorded.verification?.allReceiptsVerified||recorded.status?.mode!=='live'||!['stopped','halted'].includes(recorded.status.status)||recorded.status.pending!==null||!Array.isArray(recorded.entries))throw Error('Invalid recorded bot evidence');
    return {status:{...recorded.status,mode:'historical',recordedMode:'live',historical:true},entries:recorded.entries.slice(after,after+limit),nextCursor:Math.min(after+limit,recorded.entries.length),total:recorded.entries.length};
  }
  if(status.logIndexName){
    if(!/^bot-history-[a-zA-Z0-9-]+\.json$/.test(status.historyName))throw Error('Invalid bot history path');
    const history=JSON.parse(await readFile(join(root,'.data',status.historyName),'utf8'));
    return {status:{...status,...history},...await readSegmentedLog(join(root,'.data'),status.logIndexName,after,limit)};
  }
  if(!/^bot-log-[a-zA-Z0-9-]+\.jsonl$/.test(status.logName))throw Error('Invalid bot log path');
  let text='';try{text=await readFile(join(root,'.data',status.logName),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
  // A partially appended last line is retried on the next refresh, never counted as a record.
  const lines=text.split('\n');if(lines.at(-1)!=='')lines.pop();
  const all=lines.filter(Boolean).map(line=>JSON.parse(line));
  return {status,entries:all.slice(after,after+limit),nextCursor:Math.min(after+limit,all.length),total:all.length};
}
