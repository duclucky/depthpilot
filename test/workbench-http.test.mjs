import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {startServer} from '../src/server.mjs';
import {writeJSON} from '../src/runtime.mjs';

const root=fileURLToPath(new URL('../.cache/',import.meta.url));
const id='abcd1234-1234-4234-8234-123456789abc';
const input={kind:'roundtrip',quantity:'0.004',maxNotional:'40',maxGas:'0.12',cycles:1,intervalMinutes:5,holdSeconds:20};
async function fixture(){
 await mkdir(root,{recursive:true});const home=await mkdtemp(join(root,'workbench-http-'));
 const gateway={close:async()=>{},snapshot:async()=>({market:{baseDecimals:18,quoteDecimals:18,baseSymbol:'ETH',poolAddress:'0x1111111111111111111111111111111111111111',tickSize:'10000000000000000',minQuantity:'1000000000000000',lotSize:'1000000000000000'},snapshot:{source:'live',observedAt:Date.now(),blockNumber:'100',blockTimestamp:String(Math.floor(Date.now()/1000)),markPrice:'2400000000000000000000',markPriceOk:true,bids:[{price:'2400000000000000000000',quantity:'1000000000000000000'}],asks:[{price:'2400100000000000000000',quantity:'1000000000000000000'}]}})};
 const app=await startServer({home,port:0,gateway,recover:false});
 const {token}=await(await fetch(app.origin+'/api/session')).json();
 const post=(path,body,foreign=false)=>fetch(app.origin+'/api/'+path,{method:'POST',headers:{Origin:foreign?'https://evil.example':app.origin,'Content-Type':'application/json','X-DepthPilot-Token':token},body:JSON.stringify(body)});
 return {app,home,post};
}
test('market preview and portable settings work in a fresh profile without creating keys or authority',async()=>{
 const {app,home,post}=await fixture();try{
  const market=await fetch(app.origin+'/api/market');assert.equal(market.status,200);assert.equal((await market.json()).chainId,50383);
  const preview=await post('preview',{side:'buy',quantity:'0.012',maxChild:'0.004'});assert.equal(preview.status,200);assert.equal((await preview.json()).child.executable,true);
  const exported=await post('templates/export',input);assert.equal(exported.status,200);const template=await exported.json();assert.equal(template.settings.kind,'roundtrip');
  const imported=await post('templates/import',template);assert.equal(imported.status,200);assert.equal((await imported.json()).settings.quantity,'0.004');
  assert.deepEqual(await readdir(join(home,'.wallet')),[]);assert.deepEqual(await readdir(join(home,'.data/runs')),[]);
  const state=await(await fetch(app.origin+'/api/status')).json();assert.equal(state.run,null);assert.equal(state.wallet,null);
  assert.equal((await post('preview',{side:'buy',quantity:'0.004',maxChild:'0.004'},true)).status,403);
 }finally{await app.close();}
});
test('historical HTTP exports expose only reports/settings and cannot select or restart a run',async()=>{
 const {app,home}=await fixture();try{
  const meta={id,createdAt:123,version:'0.2.2',recover:true,draft:{id,kind:'roundtrip',quantity:'0.004',maxNotional:'40',maxGas:'0.12',config:{maxCycles:1,entryIntervalSec:300,holdSec:20,maxSpreadBps:5,slippageBps:10,account:'private-owner',operator:'private-operator'}}};
  await writeJSON(join(home,'.data/runs',id+'.json'),meta);await writeJSON(join(home,'.data/runs',id+'-state.json'),{mode:'live',status:'stopped',orders:[],cycles:0});
  const list=await(await fetch(app.origin+'/api/history')).json();assert.equal(list.runs[0].id,id);
  const report=await(await fetch(app.origin+'/api/report?id='+id)).json();assert.equal(report.status,'stopped');assert.ok(!JSON.stringify(report).includes('private-'));
  const settings=await(await fetch(app.origin+'/api/history/template?id='+id)).json();assert.equal(settings.settings.kind,'roundtrip');assert.ok(!JSON.stringify(settings).includes('private-'));
  assert.equal((await fetch(app.origin+'/api/report?id=../profile')).status,400);
  assert.equal((await fetch(app.origin+'/api/report?id='+id,{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  assert.equal((await(await fetch(app.origin+'/api/status')).json()).run,null);
  assert.ok(!(await readdir(join(home,'.data'))).some(x=>x.startsWith('authority-')));
 }finally{await app.close();}
});
