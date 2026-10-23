import {readFile,open,appendFile} from 'node:fs/promises';import {join,dirname} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {spawn,execFile} from 'node:child_process';
import {runtimeHome,initializeHome,readJSON,isAlive,claimLock} from '../src/runtime.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),home=runtimeHome();await initializeHome(home);
let release;
try{
 for(let attempt=0;attempt<100;attempt++){try{release=await claimLock(join(home,'.data','launcher.lock'));break;}catch(e){if(!/already using this profile/.test(e.message)||attempt===99)throw e;await new Promise(resolve=>setTimeout(resolve,300));}}
 const homeId=createHash('sha256').update(home.toLowerCase()).digest('hex');
 async function instance(){const record=await readJSON(join(home,'.data','instance.json'),null);if(!record||record.homeId!==homeId)return null;const url=new URL(record.url);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('The saved dashboard address is invalid.');try{const health=await(await fetch(url.origin+'/api/health',{signal:AbortSignal.timeout(1500)})).json();return health.app==='depthpilot'&&health.instanceId===record.instanceId&&health.homeId===homeId?record:null;}catch{return null;}}
 let running=await instance();
 if(!running){
  const prior=await readJSON(join(home,'.data','instance.json'),null);if(prior&&isAlive(prior.pid))throw Error('A local application is still using this profile. Check its dashboard before restarting.');
  const log=await open(join(home,'logs','application.log'),'a');
  const child=spawn(process.execPath,[join(root,'src','server.mjs')],{cwd:root,windowsHide:true,detached:true,stdio:['ignore',log.fd,log.fd],env:{...process.env,DEPTHPILOT_HOME:home}});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();await log.close();
  const until=Date.now()+25000;while(Date.now()<until){running=await instance();if(running)break;await new Promise(resolve=>setTimeout(resolve,300));}
  if(!running)throw Error('The local app did not become ready. See application.log in this profile.');
 }
 await appendFile(join(home,'logs','launcher.log'),JSON.stringify({at:new Date().toISOString(),action:'dashboard-ready',pid:running.pid,url:running.url})+'\n');
 if(!process.argv.includes('--no-open')){const browser=execFile('rundll32.exe',['url.dll,FileProtocolHandler',running.url],{windowsHide:true});browser.on('error',()=>{});browser.unref();}
 console.log(JSON.stringify({url:running.url,pid:running.pid}));
}catch(e){await appendFile(join(home,'logs','launcher.log'),JSON.stringify({at:new Date().toISOString(),error:String(e.message).slice(0,400)})+'\n');process.exitCode=1;}
finally{await release?.();}
