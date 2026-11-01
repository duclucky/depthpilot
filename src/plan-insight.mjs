import {formatExact,parseExact} from './core.mjs';

const terminal=new Set(['stopped','halted','completed','expired','partial']);
const messages={
 'spread-too-wide':['Waiting for a tighter spread','The buy and sell prices must come within your spread rule.'],
 'no-depth-in-bound':['Waiting for liquidity inside your price limit','Enough visible depth must become available at an acceptable price.'],
 'below-minimum':['The next order is too small','Depth, account capacity and your size limit must permit a legal market amount.'],
 'untradeable-remainder':['A remainder cannot be placed','The remaining target is below the market minimum. Review it before creating another plan.'],
 'child-interval':['Waiting between orders','The minimum spacing after the last confirmed order must pass.'],
 'entry-cooldown':['Waiting for the next round','The entry interval must pass before another opening order.'],
 holding:['Holding until an exit check','The holding time, a stop request or an equity trigger makes an exit eligible.'],
 'equity-guard':['An equity rule was triggered','New entries are blocked. An owned position still needs an exit attempt.'],
 'entry-exit-budget':['No room for another complete round','The remaining order, trading and fee limits must cover both entry and closing. Limits do not renew.'],
 'estimated-budget':['The fee or trading estimate exceeds this plan','The proposed order and closing allowance must fit the original cumulative limits.'],
 'operator-permission-missing':['Trading access is missing','Check this bot’s Perps permission for this market on dreamDEX.'],
 'network-read-error':['Waiting for the network','A successful network read is needed before making another decision.'],
 'position-mismatch':['The position differs from the saved plan','Check the actual position and pending transactions on dreamDEX.'],
 'unowned-position':['This plan does not own the existing position','Check the account on dreamDEX before starting another plan.'],
 'unexpected-resting-order':['An unexpected open order needs review','Check open orders on dreamDEX.'],
 'fresh-tight-book':['Entry rules were met','The bot still checks account access, size, fees and the encoded order before sending.'],
 ready:['Sizing rules were met','The bot still checks the remaining transaction and fee limits.'],
 'timed-exit':['An exit is eligible','Closing still requires permission, liquidity, fees and a working network.'],
 'run-complete':['The allowed rounds are finished','Review confirmed receipts and the actual account before another plan.'],
};
const amount=value=>{try{return formatExact(value,18);}catch{return null;}};
const validTime=value=>Number.isFinite(value)&&value>=0;
const age=ms=>ms<120000?Math.floor(ms/1000)+' seconds':ms<7200000?Math.floor(ms/60000)+' minutes':Math.floor(ms/3600000)+' hours '+Math.floor(ms/60000)%60+' minutes';

// Projection only. Saved observations explain a decision; they never authorize an order.
export function buildPlanInsight({run,entries=[],truncated=false,now=Date.now()}){
 if(!run)return {code:'no-plan',title:'Your first plan starts here',next:'Set up your account and review a plan.',facts:[],wait:null,savedAt:null,ageMs:null};
 const s=run.state||{},finite=run.kind==='finite',p=s.plan||{},event=entries.at(-1)||s.lastDecision||s.decisions?.at(-1),o=s.latestObservation;
 const pending=s.pending||p.pending?.hash;
 const savedAt=validTime(s.updatedAt)?s.updatedAt:validTime(o?.at)?o.at:null;
 const ageMs=savedAt===null||savedAt>now?null:now-savedAt;
 let code=event?.reason||s.status||'starting';
 if(pending)code='pending';
 else if(run.error)code='needs-attention';
 else if(!terminal.has(s.status)&&!run.workerAlive)code='worker-offline';
 else if(!terminal.has(s.status)&&(ageMs===null||ageMs>30000))code='stale-state';
 else if(terminal.has(s.status))code=s.status;
 const special={
  pending:['Checking a submitted transaction','Wait for its receipt to be reconciled. Do not submit the same order again.'],
  'worker-offline':['The background bot is not running','Use Check current state below. Saved positions and receipts are not a fresh account check.'],
  'stale-state':['The saved decision is out of date','Wait for an updated bot observation or use Check current state below.'],
  'needs-attention':['This plan needs attention','Use Check current state below before taking action on dreamDEX.'],
  stopped:['This plan has stopped','Check the actual account if exposure or an unresolved transaction remains.'],
  completed:['The target is complete','Completed target orders retain their resulting position.'],
  partial:['This target is partly complete','Review the remainder and actual account before making another plan.'],
  expired:['The plan’s time limit has passed','Review confirmed fills and any exposure on dreamDEX.'],
  halted:['This plan paused for review','Use Check current state below. No automatic repair or restart is performed here.'],
 };
 const [title,next]=special[code]||messages[code]||(code.startsWith('planner-')?['The next size cannot be placed','Review the saved depth and size constraints. Exposure may remain.']:['The bot checked its next step','Follow the saved activity and check current state if this plan needs attention.']);
 const facts=[];
 const add=(label,value)=>{if(value!==null&&value!==undefined)facts.push({label,value:String(value)});};
 const observationAt=finite?event?.child?.observedAt??event?.at:o?.at;
 const observationAgeMs=validTime(observationAt)&&observationAt<=now?now-observationAt:null;
 if(observationAgeMs!==null)add('Market observation age',age(observationAgeMs)+' at this response');
 if(finite){
  const child=event?.child;
  add('Spread at decision',child?.constraints?.spreadBps===undefined?null:child.constraints.spreadBps+' bps');
  add('Allowed spread',p.executionPolicy?.maxSpreadBps===undefined?null:p.executionPolicy.maxSpreadBps+' bps');
  add('Price limit',amount(p.bound)===null?null:amount(p.bound)+' USDso / ETH');
  for(const [key,label] of [['depth-participation','Depth allowance'],['account-capacity','Account capacity']])add(label,child?.constraints?.[key]===undefined?null:amount(child.constraints[key])+' ETH');
  add('Target still unfilled',amount(p.remaining)===null?null:amount(p.remaining)+' ETH');
 }else if(o){
  if(/^\d+$/.test(o.bid||'')&&/^\d+$/.test(o.ask||'')&&BigInt(o.bid)>0n&&BigInt(o.ask)>=BigInt(o.bid))add('Spread at observation',formatExact((BigInt(o.ask)-BigInt(o.bid))*1000000n/BigInt(o.bid),2)+' bps');
  add('Allowed spread',run.config?.maxSpreadBps===undefined?null:run.config.maxSpreadBps+' bps');
  add('Saved position',amount(o.position)===null?null:amount(o.position)+' ETH');
  add('Bot gas at observation',amount(o.gasBalance)===null?null:amount(o.gasBalance)+' STT');
 }
 const nextAt=code==='entry-cooldown'&&validTime(s.lastEntryAt)?s.lastEntryAt+run.config.entryIntervalSec*1000:code==='holding'&&validTime(s.cycle?.openedAt)?s.cycle.openedAt+run.config.holdSec*1000:code==='child-interval'?event?.child?.nextAt:null;
 if(validTime(nextAt))add('Earliest eligible check',new Date(nextAt).toISOString());
 let gas=0n,known=true;
 if(finite){gas=BigInt(p.gasCost||0)+BigInt(p.pending?.gasCeiling||0);}
 else for(const order of s.orders||[]){const cost=order.receipt?.gasCost??order.gasCeiling;if(cost===undefined){known=false;continue;}gas+=BigInt(cost);}
 if(run.maxGas!==undefined&&known){const remaining=parseExact(run.maxGas,18)-gas;add('Unspent / unreserved fee budget',formatExact(remaining>0n?remaining:0n,18)+' STT');}
 if(!finite&&run.config?.closeGasReserveSTT)add('Reviewed closing allowance',run.config.closeGasReserveSTT+' STT (not a guaranteed fee)');
 let wait=null;
 if(['wait','pause','reconcile'].includes(event?.action)&&event?.reason===code&&validTime(event.at)&&event.at<=now){
  let first=entries.length-1;
  while(first>0&&entries[first-1].reason===code&&['wait','pause','reconcile'].includes(entries[first-1].action))first--;
  const at=entries.length?entries[first].at:event.at;
  if(validTime(at)&&at<=now)wait={since:at,durationMs:now-at,lowerBound:truncated&&first===0||entries.length===0};
 }
 return {code,title,next,facts,wait,savedAt,ageMs,observationAgeMs,workerAlive:Boolean(run.workerAlive),pending:pending||null,note:'Values explain saved decisions. Check current state for fresh account reads. An eligible check does not guarantee a fill.'};
}
