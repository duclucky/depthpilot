import {resolve,join} from 'node:path';import {readFile} from 'node:fs/promises';
import {initializeHome,readJSON,writeJSON,claimLock,APP_VERSION} from '../src/runtime.mjs';
import {BotRunner} from '../src/bot-runner.mjs';import {TokyoBotGateway} from '../src/bot-gateway.mjs';
import {ExecutionRunner,authorizeExecution} from '../src/execution-runner.mjs';import {ExecutionGateway} from '../src/execution-gateway.mjs';
import {authorizeBot} from '../src/autopilot-policy.mjs';import {botConfigDigest} from '../src/bot-runner.mjs';
import {Journal} from '../src/journal.mjs';import {SegmentedLog} from '../src/segmented-log.mjs';import {parseExact} from '../src/core.mjs';
const home=resolve(process.argv[2]||''),id=process.argv[3];if(!process.argv[2]||!/^[-a-f0-9]{36}$/.test(id||''))throw Error('Invalid worker profile.');
await initializeHome(home);const path=name=>join(home,'.data',name),release=await claimLock(path('worker.lock'));
await writeJSON(path('worker.lock'),{pid:process.pid,runId:id,startedAt:Date.now()});
const meta=await readJSON(path(`runs/${id}.json`),null);let adapter,runner;
try{
 if(!meta||meta.version!==APP_VERSION||meta.id!==id)throw Error('Stored plan version does not match this application.');
 const authority=()=>readJSON(path(`authority-${id}.json`),null),draft=meta.draft,state=await readJSON(path(`runs/${id}-state.json`),undefined);
 if(state&&['stopped','halted','completed','expired','partial'].includes(state.status))throw Error('This plan has already stopped. It cannot be rearmed by a restart.');
 const wallet=await readJSON(join(home,'.wallet','public.json'),null),operator=draft.config?.operator||draft.plan.operator;
 if(wallet?.address.toLowerCase()!==operator.toLowerCase())throw Error('The local operator does not match this plan.');
 const stop=async()=>Boolean(await readJSON(path(`stop-${id}.json`),null));
 const log=new SegmentedLog(path('runs'),`activity-${id}`);await log.open();
 const persist=s=>{s.updatedAt=Date.now();return writeJSON(path(`runs/${id}-state.json`),s);},plans=new Journal(path('plans'));
 if(draft.kind==='roundtrip'){
  authorizeBot(draft.config,await authority(),botConfigDigest(draft.config));
  adapter=new TokyoBotGateway(draft.config,home);
  runner=new BotRunner({config:draft.config,state,adapter,live:true,authority,persist,savePlan:p=>plans.save(p),shouldStop:stop});
 }else{
  adapter=new ExecutionGateway(draft.plan,home);
  const originalPrepare=adapter.prepare.bind(adapter);adapter.prepare=async(...args)=>{const order=await originalPrepare(...args);const balance=await adapter.gateway.rpc.getBalance({address:operator});if(balance-BigInt(order.gasCeiling)<parseExact('1',18))throw Error('Operator gas reserve would be exceeded.');return order;};
  runner=new ExecutionRunner({id,plan:draft.plan,state,adapter,mode:'live',authority,persist});authorizeExecution(runner.state,await authority());
 }
 await runner.save();let interrupted=false,networkFailures=0;
 process.on('SIGTERM',()=>{interrupted=true;});process.on('SIGINT',()=>{interrupted=true;});
 while(true){
  if(interrupted||await stop())runner.state.stopRequested=true;
  let result;
  try{const before=runner.state.decisions?.length||0;result=await runner.tick();if(!result){const decision=runner.state.decisions?.at(-1);result=decision&&runner.state.decisions.length>before?decision:{action:'wait',reason:runner.state.status};}networkFailures=0;}
  catch(e){
   const transient=/Timeout|HttpRequest|Socket|ECONN|fetch failed/i.test(`${e.name} ${e.shortMessage||''} ${e.message}`);
   if(transient&&networkFailures++<10&&!runner.state.pending&&!runner.state.plan?.pending){result={action:'wait',reason:'network-read-error'};}
   else{runner.state.status='halted';result={action:'halt',reason:'needs-attention'};await writeJSON(path(`runs/${id}-error.json`),{at:Date.now(),text:'The bot paused safely. Check its position and recent transactions in dreamDEX before continuing.'});}
  }
  await runner.save();await log.append({at:Date.now(),runId:id,mode:'live',...result,observation:runner.state.latestObservation||null});
  if(['stopped','halted','completed','expired','partial'].includes(runner.state.status))break;
  await new Promise(resolve=>setTimeout(resolve,5000));
 }
 if(['stopped','completed','expired','partial'].includes(runner.state.status)){const a=await authority();a.revoked=true;await writeJSON(path(`authority-${id}.json`),a);}
}catch(e){const saved=runner?.state||await readJSON(path(`runs/${id}-state.json`),{orders:[],pending:null,cycle:null});saved.status='halted';saved.updatedAt=Date.now();await writeJSON(path(`runs/${id}-state.json`),saved);await writeJSON(path(`runs/${id}-error.json`),{at:Date.now(),text:'This plan could not continue. Your history is preserved; check the account and pending trades before starting anything else.'});process.exitCode=1;}
finally{await adapter?.close();await release();}
