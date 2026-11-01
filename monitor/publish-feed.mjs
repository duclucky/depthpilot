import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {spawnSync} from 'node:child_process';
// This process publishes snapshots only; it never loads a signing key.
import {buildPublicFeed} from './public-feed.mjs';import {readSegmentedLog} from '../src/segmented-log.mjs';import {claimLock,isAlive} from '../src/runtime.mjs';
const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
if(!args.includes('--data')||!args.includes('--checkout'))throw Error('Provide the private runner data directory and separate telemetry checkout');
const data=resolve(value('--data')),checkout=resolve(value('--checkout')),once=args.includes('--once'),interval=300000;
await mkdir(checkout,{recursive:true});const release=await claimLock(join(checkout,'publisher.lock'));
function git(...params){const r=spawnSync('git',params,{cwd:checkout,encoding:'utf8',windowsHide:true,timeout:60000});if(r.status!==0)throw Error('Telemetry Git operation failed. No force push or credential output was attempted.');return r.stdout.trim();}
try{
 if(git('branch','--show-current')!=='telemetry'||git('remote','get-url','origin')!=='https://github.com/duclucky/depthpilot.git')throw Error('Use the dedicated telemetry branch checkout');
 const configPath=resolve(data,'..','bot.continuous.config.json');
 while(true){
  try{
   const state=JSON.parse(await readFile(join(data,'bot-status.json'),'utf8'));
   if(!/^bot-history-[a-zA-Z0-9-]+\.json$/.test(state.historyName)||!/^bot-log-[a-zA-Z0-9-]+-index\.json$/.test(state.logIndexName))throw Error('Unexpected monitor files');
   const history=JSON.parse(await readFile(join(data,state.historyName),'utf8'));
   const first=await readSegmentedLog(data,state.logIndexName,0,1),tail=await readSegmentedLog(data,state.logIndexName,Math.max(0,first.total-60),60);
   let supervisor={};try{supervisor=JSON.parse((await readFile(join(data,'bot-supervisor.json'),'utf8')).replace(/^\uFEFF/,''));}catch{}
   const config=JSON.parse(await readFile(configPath,'utf8'));
   const feed=buildPublicFeed({config,state:{...state,...history},entries:tail.entries,totalEntries:tail.total,workerPresent:supervisor.mode==='live'&&isAlive(supervisor.workerPid)});
   await writeFile(join(checkout,'status.json'),JSON.stringify(feed,null,2)+'\n');
   git('add','--','status.json');git('commit','-m','Update read-only reference operator snapshot');git('push','origin','telemetry');
   await writeFile(join(checkout,'publisher-status.json'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,status:'published',cycles:feed.cycles,orders:feed.transactions.length})+'\n');
   console.log(JSON.stringify({at:new Date().toISOString(),status:'published',cycles:feed.cycles,orders:feed.transactions.length}));
  }catch(e){console.log(JSON.stringify({at:new Date().toISOString(),status:'unavailable',message:'Public snapshot could not be updated. Check the local publisher and Git branch.'}));if(once)throw Error('Public snapshot publication failed');}
  if(once)break;await new Promise(resolve=>setTimeout(resolve,interval));
 }
}finally{await release();}
