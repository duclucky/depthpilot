import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../src/server.mjs';
import {writeJSON} from '../src/runtime.mjs';

const id='abcd1234-1234-4234-8234-123456789abc';
const owner='0x1111111111111111111111111111111111111111',operator='0x3333333333333333333333333333333333333333';
const hash='0x'+'a'.repeat(64);
async function fixture(){
 const root=fileURLToPath(new URL('../.cache/',import.meta.url));await mkdir(root,{recursive:true});const home=await mkdtemp(join(root,'insight-http-'));
 let reads=0;const forbidden=()=>{throw Error('A read-only view attempted a write');};
 const gateway={close:async()=>{},unsigned:forbidden,simulate:forbidden,
  rpc:{getChainId:async()=>{reads++;return 50383;},request:async()=> '50000259',getBytecode:async()=> '0x1234',getBalance:async()=>2n*10n**18n,getTransactionCount:async()=>2},
  operatorPermissions:async()=>({place:true,cancel:true,reduce:true}),wallet:async()=>({margin:{marginStatus:'Healthy',equity:'2000000000000000000'}}),
  sdk:{client:{getPerpPosition:async()=>({size:0n}),getOwnOpenOrdersOnchain:async()=>[]}},
  snapshot:async()=>({market:{poolAddress:owner,marginBank:operator,minQuantity:'4000000000000000',lotSize:'100000000000000'},snapshot:{}})};
 const app=await startServer({home,port:0,gateway,recover:false});return {app,home,gateway,reads:()=>reads};
}
async function seed(home){
 await writeJSON(join(home,'.wallet/public.json'),{address:operator});
 await writeJSON(join(home,'.data/profile.json'),{owner});
 await writeJSON(join(home,'.data/current.json'),{id});
 await writeJSON(join(home,'.data/runs',id+'.json'),{id,createdAt:1000,version:'0.3.1',draft:{kind:'roundtrip',quantity:'0.004',maxGas:'0.12',maxNotional:'40',config:{account:owner,operator,closeGasReserveSTT:'0.06',maxSpreadBps:5}}});
 await writeJSON(join(home,'.data/runs',id+'-state.json'),{status:'stopped',mode:'live',cycles:1,pending:null,cycle:null,orders:[{hash,action:'open',quantity:'4000000000000000',receipt:{hash,status:'success',source:'live',gasCost:'10000000000000000',fills:[{quantity:'4000000000000000',price:'2300000000000000000000'}]}}]});
}
test('insight is local-only, read-only and useful before any setup',async()=>{
 const {app,home,reads}=await fixture();try{
  const response=await fetch(app.origin+'/api/insight');assert.equal(response.status,200);const view=await response.json();assert.equal(view.code,'no-plan');assert.equal(reads(),0);
  assert.deepEqual(await readdir(join(home,'.wallet')),[]);assert.equal((await fetch(app.origin+'/api/insight',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 }finally{await app.close();}
});
test('fresh diagnosis observes a completed plan without restarting, renewing or writing it',async()=>{
 const {app,home}=await fixture();try{
  await seed(home);const path=join(home,'.data/runs',id+'-state.json'),before=await readFile(path,'utf8');
  const response=await fetch(app.origin+'/api/diagnosis');assert.equal(response.status,200);const view=await response.json();assert.equal(view.readOnly,true);assert.equal(view.current.position,'0');assert.equal(view.authority,'missing');assert.equal(view.canResume,false);
  assert.equal(await readFile(path,'utf8'),before);assert.ok(!(await readdir(join(home,'.data'))).some(name=>name.startsWith('authority-')||name==='worker.lock'));
 }finally{await app.close();}
});
test('HTML export returns a static receipt document with no control material',async()=>{
 const {app,home}=await fixture();try{
  await seed(home);const response=await fetch(app.origin+'/api/report.html?id='+id);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/^text\/html/);assert.match(response.headers.get('content-security-policy'),/default-src 'none'; style-src 'unsafe-inline'/);const html=await response.text();assert.match(html,/<!doctype html>/i);assert.ok(html.includes(hash));assert.match(html,/0\.004/);assert.doesNotMatch(html,/<script|\/api\/|127\.0\.0\.1|privateKey|serializedTransaction/i);assert.ok(!html.includes(owner)&&!html.includes(operator));
  const dashboard=await fetch(app.origin+'/');assert.match(dashboard.headers.get('content-security-policy'),/script-src 'self'; style-src 'self'/);
  assert.equal((await fetch(app.origin+'/api/report.html?id=../profile')).status,400);
  assert.equal((await fetch(app.origin+'/api/report.html?id='+id,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 }finally{await app.close();}
});
test('diagnosis distinguishes missing receipt, changed position, permission and read failure without mutating state',async()=>{
 const {app,home,gateway}=await fixture();try{
  await seed(home);const path=join(home,'.data/runs',id+'-state.json');
  const state=JSON.parse(await readFile(path,'utf8'));state.status='halted';state.pending=hash;state.orders[0].nonce=1;state.orders[0].unsigned={data:'stored-call'};state.orders[0].plan={market:{poolAddress:owner}};delete state.orders[0].receipt;await writeJSON(path,state);
  const before=await readFile(path,'utf8');let receiptReads=0;gateway.receipt=async()=>{receiptReads++;throw Error('Receipt not found');};
  let r=await(await fetch(app.origin+'/api/diagnosis')).json();assert.equal(r.receipt.status,'not-found');assert.equal(r.canResume,false);assert.equal(receiptReads,1);assert.equal(await readFile(path,'utf8'),before);
  gateway.receipt=async()=>({status:'success',blockNumber:123});r=await(await fetch(app.origin+'/api/diagnosis')).json();assert.equal(r.receipt.verifiedIntent,true);assert.equal(r.receipt.status,'success');assert.equal(await readFile(path,'utf8'),before);
  state.pending=null;await writeJSON(path,state);gateway.sdk.client.getPerpPosition=async()=>({size:4000000000000000n});r=await(await fetch(app.origin+'/api/diagnosis')).json();assert.ok(r.issues.includes('position-mismatch'));
  gateway.operatorPermissions=async()=>({place:false,cancel:false,reduce:false});r=await(await fetch(app.origin+'/api/diagnosis')).json();assert.ok(r.issues.includes('permission-missing'));
  gateway.rpc.getChainId=async()=>{throw Error('Network offline');};r=await(await fetch(app.origin+'/api/diagnosis')).json();assert.equal(r.current,null);assert.ok(r.issues.includes('account-check-unavailable'));assert.equal(r.canResume,false);
 }finally{await app.close();}
});
