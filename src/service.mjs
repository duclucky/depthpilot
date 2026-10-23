import {randomUUID,createHash} from 'node:crypto';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';
import {open,unlink} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';
import {readJSON,writeJSON,initializeHome,isAlive,APP_VERSION} from './runtime.mjs';
import {normalizePlan} from './plan-config.mjs';import {checkAccount} from './account-check.mjs';import {createPlan,parseExact} from './core.mjs';
import {botConfigDigest} from './bot-runner.mjs';import {executionDigest} from './execution-runner.mjs';import {readSegmentedLog} from './segmented-log.mjs';
const exec=promisify(execFile),root=dirname(dirname(fileURLToPath(import.meta.url)));
export class LocalService{
  constructor(home,gateway,gasBridge){this.home=home;this.gateway=gateway;this.reviews=new Map();this.gasBridge=gasBridge||{status:()=>this.gasHelper('status'),quote:()=>this.gasHelper('quote'),send:(id,confirmed)=>this.gasHelper('send',id,confirmed)};}
  async gasHelper(action,id,confirmed){
    let stdout;try{({stdout}=await exec(process.execPath,[join(root,'scripts/gas-bridge.mjs'),this.home,action,...(id?[id,confirmed===true?'confirmed':'unconfirmed']:[])],{windowsHide:true,timeout:45000,maxBuffer:100000}));}
    catch(e){if(!e.stdout)throw Error('The gas check could not finish. Check its status before trying again.');stdout=e.stdout;}
    const reply=JSON.parse(stdout);if(!reply.ok)throw Error(reply.error);return reply.result;
  }
  async reviewGas(){if(await this.isActive())throw Error('Stop and reconcile your plan before moving gas.');return this.gasBridge.quote();}
  async sendGas(id,confirmed){if(confirmed!==true)throw Error('Review and allow this gas move before sending.');if(await this.isActive())throw Error('Stop and reconcile your plan before moving gas.');return this.gasBridge.send(id,confirmed);}
  async gasPending(){const move=await readJSON(this.path('gas-bridge.json'),null);return move&&!['delivered','reverted'].includes(move.status);}
  path(name){return join(this.home,'.data',name);}
  async initialize(){await initializeHome(this.home);}
  async wallet(){return readJSON(join(this.home,'.wallet','public.json'),null);}
  async snapshot(){
    const [wallet,profile,current]=await Promise.all([this.wallet(),readJSON(this.path('profile.json'),{}),readJSON(this.path('current.json'),null)]);
    let run=null;if(current){const [meta,state,worker]=await Promise.all([readJSON(this.path(`runs/${current.id}.json`),null),readJSON(this.path(`runs/${current.id}-state.json`),null),readJSON(this.path('worker.lock'),null)]);if(meta){run={id:meta.id,kind:meta.draft.kind,config:meta.draft.config,terms:meta.draft.terms,quantity:meta.draft.quantity,maxGas:meta.draft.maxGas,maxNotional:meta.draft.maxNotional,createdAt:meta.createdAt,state,workerAlive:worker?.runId===meta.id&&isAlive(worker.pid),error:await readJSON(this.path(`runs/${current.id}-error.json`),null)};}}
    return {version:APP_VERSION,wallet,owner:profile.owner||'',account:profile.account||null,run};
  }
  async createOperator(){
    const {stdout}=await exec(process.execPath,[join(root,'scripts','create-wallet.mjs'),this.home],{windowsHide:true,timeout:25000,maxBuffer:2000});
    return JSON.parse(stdout);
  }
  async saveOwner(value){
    if(await this.isActive())throw Error('Stop and reconcile the current plan before changing its account.');
    const wallet=await this.wallet();if(!wallet)throw Error('Create your local bot first.');
    const account=await checkAccount(this.gateway,value,wallet.address);await writeJSON(this.path('profile.json'),{owner:account.owner,account});return account;
  }
  async isActive(){const {run}=await this.snapshot();return run&&(run.workerAlive||!run.state||!['stopped','halted','completed','expired','partial'].includes(run.state.status)||run.state.pending||run.state.plan?.pending||run.state.cycle);}
  async review(input){
    if(await this.gasPending())throw Error('Check your pending gas move before starting a trading plan.');
    if(await this.isActive())throw Error('Your current plan needs to finish or stop before you create another.');
    const wallet=await this.wallet(),profile=await readJSON(this.path('profile.json'),{});
    if(!wallet||!profile.owner)throw Error('Finish the account setup first.');
    const draft=normalizePlan(input,{owner:profile.owner,operator:wallet.address});
    const account=await checkAccount(this.gateway,profile.owner,wallet.address);
    if(!account.ready)throw Error(account.blockers.map(x=>x.text).join(' '));
    const {market,snapshot}=await this.gateway.snapshot('ETH');
    const quantity=parseExact(draft.quantity,18),lot=BigInt(market.lotSize);
    if(quantity<BigInt(market.minQuantity)||quantity%lot!==0n)throw Error('This ETH amount does not match the market minimum or step. Try the suggested market amount.');
    if(draft.kind==='roundtrip'){
      const reference=BigInt(snapshot.asks[0]?.price||'0');
      if(reference<=0n||quantity*reference*21n/10n/10n**18n>parseExact(draft.maxNotional,18))throw Error('The total trading limit needs room for both buying and closing this amount.');
    }else{
      const child=BigInt(draft.terms.maxChild);if(child<BigInt(market.minQuantity)||child%lot!==0n)throw Error('Amount per order must match the market minimum and step.');
      const arrivalPrice=String((draft.terms.side==='buy'?snapshot.asks:snapshot.bids)[0]?.price||0);if(BigInt(arrivalPrice)<=0n)throw Error('The market has no fresh price. Try again.');
      draft.plan=createPlan({id:draft.id,source:'live',symbol:'ETH',market,account:profile.owner,operator:wallet.address,accountSource:'linked-bot',participationBps:2500,arrivalPrice,...draft.terms});
    }
    const id=randomUUID(),expiresAt=Date.now()+300000,digest=createHash('sha256').update(JSON.stringify(draft)).digest('hex');
    const review={id,draft,account,digest,expiresAt};this.reviews.clear();this.reviews.set(id,review);return review;
  }
  async start(id,confirmed,recover=false){
    if(await this.gasPending())throw Error('Check your pending gas move before starting a trading plan.');
    if(confirmed!==true)throw Error('Review the plan and allow trading before starting.');
    if(await this.isActive())throw Error('A plan is already active or still needs reconciliation.');
    const review=this.reviews.get(id);if(!review||review.expiresAt<Date.now())throw Error('This review expired. Review your plan again.');
    const profile=await readJSON(this.path('profile.json'),{}),wallet=await this.wallet();
    if(profile.owner!==review.account.owner||wallet?.address!==review.account.operator)throw Error('Your account changed. Review the plan again.');
    const account=await checkAccount(this.gateway,profile.owner,wallet.address);if(!account.ready)throw Error(account.blockers.map(x=>x.text).join(' '));
    const {draft}=review;
    if(draft.plan&&draft.plan.deadline-Date.now()<30000)throw Error('Review this time-limited plan again before starting.');
    const authority={userAuthorization:'User explicitly reviewed and activated this exact local plan in DepthPilot',version:APP_VERSION,approvedAt:new Date().toISOString(),revoked:false,...(draft.kind==='roundtrip'?{configDigest:botConfigDigest(draft.config),untilStopped:true}:{runId:draft.id,planDigest:executionDigest(draft.plan),chainId:50383,expiresAt:new Date(draft.plan.deadline).toISOString(),maxOrders:draft.maxOrders,maxGasSTT:draft.maxGas,maxNotionalUSDso:draft.maxNotional,maxGasPriceGwei:'10'})};
    await writeJSON(this.path(`authority-${draft.id}.json`),authority);
    await writeJSON(this.path(`runs/${draft.id}.json`),{id:draft.id,draft,createdAt:Date.now(),version:APP_VERSION,recover:recover===true});
    await writeJSON(this.path('current.json'),{id:draft.id});this.reviews.clear();
    await this.launch(draft.id);return {id:draft.id};
  }
  async launch(id){
    const lock=await readJSON(this.path('worker.lock'),null);if(lock&&isAlive(lock.pid))return;
    const log=await open(join(this.home,'logs',`worker-${id}.log`),'a');
    const child=spawn(process.execPath,[join(root,'scripts','worker.mjs'),this.home,id],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd]});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
  }
  async recover(){
    const {run}=await this.snapshot();if(!run||run.workerAlive)return;
    const meta=await readJSON(this.path(`runs/${run.id}.json`),null),authority=await readJSON(this.path(`authority-${run.id}.json`),null),stop=await readJSON(this.path(`stop-${run.id}.json`),null);
    if(meta?.version===APP_VERSION&&meta.recover&&authority&&!authority.revoked&&!stop&&!['stopped','halted','completed','expired','partial'].includes(run.state?.status))await this.launch(run.id);
  }
  async stop(){const {run}=await this.snapshot();if(!run)throw Error('There is no plan to stop.');await writeJSON(this.path(`stop-${run.id}.json`),{requestedAt:Date.now()});if(!run.workerAlive&&!['stopped','halted','completed','expired','partial'].includes(run.state?.status))await this.launch(run.id);return {requested:true};}
  async activity(after=0,limit=100){const current=await readJSON(this.path('current.json'),null);if(!current)return {entries:[],nextCursor:0,total:0};try{return await readSegmentedLog(this.path('runs'),`activity-${current.id}-index.json`,after,limit);}catch(e){if(e.code==='ENOENT')return {entries:[],nextCursor:0,total:0};throw e;}}
}
