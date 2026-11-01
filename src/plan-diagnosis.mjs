import {checkAccount} from './account-check.mjs';
import {APP_VERSION} from './runtime.mjs';
import {botConfigDigest} from './bot-runner.mjs';
import {authorizeBot} from './autopilot-policy.mjs';
import {authorizeExecution,executionDigest} from './execution-runner.mjs';

const absent=e=>/TransactionReceiptNotFound|not found|not been found|could not be found/i.test(`${e.name} ${e.shortMessage||''} ${e.message}`);
async function boundedRead(operation,timeoutMs){
 let timer;
 try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Public check timed out')),timeoutMs);})]);}
 finally{clearTimeout(timer);}
}
// No signing adapter or service action is reachable from this diagnostic path.
export async function diagnosePlan({snapshot,meta,authority,stop,gateway,now=Date.now(),readTimeoutMs=20000}){
 const run=snapshot.run,s=run?.state||{},finite=run?.kind==='finite',p=s.plan||{};
 const result={readOnly:true,canResume:false,checkedAt:now,authority:'missing',versionMatch:meta?meta.version===APP_VERSION:null,stopRequested:Boolean(stop||s.stopRequested),runId:run?.id||null,current:null,receipt:null,issues:[],title:'Finish account setup',next:'Create the bot and copy your dreamDEX trading account address. This check never starts a plan.'};
 if(authority){
  result.authority=authority.revoked?'revoked':'invalid-or-expired';
  if(!authority.revoked&&meta){try{
   if(finite){if(authority.planDigest!==executionDigest(meta.draft.plan))throw Error('Different saved plan');authorizeExecution({id:meta.draft.id,plan:meta.draft.plan},authority,now);}
   else authorizeBot(meta.draft.config,authority,botConfigDigest(meta.draft.config),now);
   result.authority='current';
  }catch{ /* Display status only; never alter authority. */ }}
 }
 if(!snapshot.wallet||!snapshot.owner)return result;
 const pending=s.pending||p.pending?.hash;
 const receiptCheck=async()=>{
  if(!pending)return null;
  const entry=finite?p.pending:(s.orders||[]).find(o=>o.hash===pending);
  const plan=finite?p:entry?.plan;
  if(!entry?.unsigned||!plan||entry.nonce===undefined)return {hash:pending,status:'not-verifiable',note:'Saved intent details are incomplete. Inspect this transaction on the explorer.'};
  try{const receipt=await gateway.receipt(plan,pending,entry.unsigned,entry.nonce);return {hash:pending,status:receipt.status,verifiedIntent:true,blockNumber:String(receipt.blockNumber)};}
  catch(e){return {hash:pending,status:absent(e)?'not-found':'unavailable-or-mismatch',note:'No reconciliation or resend was performed. A missing receipt does not prove that nothing was sent.'};}
 };
 const outcomes=await Promise.allSettled([
  checkAccount(gateway,snapshot.owner,snapshot.wallet.address),
  Promise.all(['latest','pending'].map(blockTag=>gateway.rpc.getTransactionCount({address:snapshot.wallet.address,blockTag}))),
  receiptCheck(),
 ].map(operation=>boundedRead(operation,readTimeoutMs)));
 const [account,nonces,receipt]=outcomes;
 result.receipt=receipt.status==='fulfilled'?receipt.value:{status:'unavailable'};
 if(account.status!=='fulfilled'){
  result.issues.push('account-check-unavailable');result.title='The current account could not be verified';result.next='Check your network and the copied account address, then try again. Saved data is not a substitute for a fresh check.';return result;
 }
 const a=account.value;
 result.checkedAt=Date.now();
 result.current={checkedAt:a.checkedAt,chainId:a.chainId,position:a.position,openOrders:a.openOrders,equity:a.equity,gas:a.gas,permissions:a.permissions,latestNonce:nonces.status==='fulfilled'?nonces.value[0]:null,pendingNonce:nonces.status==='fulfilled'?nonces.value[1]:null};
 if(!Object.values(a.permissions).every(Boolean))result.issues.push('permission-missing');
 if(a.blockers.some(b=>b.code==='gas'))result.issues.push('low-gas');
 if(a.blockers.some(b=>b.code==='margin'))result.issues.push('margin-needs-attention');
 if(a.openOrders)result.issues.push('open-orders');
 // A finite target intentionally retains exposure; no starting-position proof is stored.
 if(!finite&&run&&!pending&&a.position!==String(s.cycle?.quantity||'0'))result.issues.push('position-mismatch');
 if(nonces.status!=='fulfilled')result.issues.push('nonce-unavailable');
 else if(nonces.value[0]!==nonces.value[1])result.issues.push('operator-has-pending-nonce');
 if(pending)result.issues.push('saved-pending-transaction');
 if(run&&!result.versionMatch)result.issues.push('different-plan-version');
 if(run&&result.authority!=='current')result.issues.push('authority-not-current');
 if(result.stopRequested)result.issues.push('stop-requested');
 if(pending){result.title=result.receipt?.verifiedIntent?'The saved transaction has a verified receipt':'A submitted transaction still needs reconciliation';result.next='No resend was performed. Follow Activity if the worker is running; otherwise inspect the transaction and account on dreamDEX before another plan.';}
 else if(result.issues.includes('position-mismatch')){result.title='The account position differs from the saved bot position';result.next='Review this exposure on dreamDEX. A new plan or local restart will not repair the mismatch.';}
 else if(result.issues.includes('permission-missing')){result.title='Perps access is missing';result.next='Use Link a Bot on dreamDEX for the same bot and market, then check again. This does not restart a plan.';}
 else if(result.issues.includes('operator-has-pending-nonce')){result.title='The bot address has a pending transaction';result.next='Wait for its result and inspect the account before another plan. No replacement transaction was sent.';}
 else if(result.issues.some(issue=>['low-gas','margin-needs-attention','open-orders','nonce-unavailable'].includes(issue))){result.title='The account has items to review';result.next='Review the checks below and manage the account on dreamDEX. This check does not move funds or change permissions.';}
 else{result.title=a.position==='0'?'No position or open order found in this account check':'A position remains in the trading account';result.next=finite?'Target plans retain their resulting position. Review it on dreamDEX before trading again.':'This check did not restart or renew anything. Creating a new plan still requires a fresh review.';}
 result.note='Public reads are sampled separately and can change. The worker remains responsible for durable receipt reconciliation. No automatic repair, signing or restart is available here.';
 return result;
}
