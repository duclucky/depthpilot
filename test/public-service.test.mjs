import test from 'node:test';import assert from 'node:assert/strict';import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {LocalService} from '../src/service.mjs';import {startServer} from '../src/server.mjs';import {readJSON} from '../src/runtime.mjs';import {botConfigDigest} from '../src/bot-runner.mjs';
import {get} from 'node:http';
const owner='0x1111111111111111111111111111111111111111',operator='0x3333333333333333333333333333333333333333';
const parent=fileURLToPath(new URL('../.cache/',import.meta.url));
async function home(){await mkdir(parent,{recursive:true});return mkdtemp(join(parent,'qa-'));}
function gateway(){let rights=true;return {setRights:x=>{rights=x;},rpc:{getChainId:async()=>50383,request:async()=> '50000259',getBytecode:async()=> '0x1234',getBalance:async()=>2n*10n**18n},market:async()=>({poolAddress:owner,marginBank:operator}),operatorPermissions:async()=>({place:rights,cancel:rights,reduce:rights}),wallet:async()=>({margin:{marginStatus:'Healthy',equity:'1000000000000000000000'}}),sdk:{client:{getPerpPosition:async()=>({size:0n}),getOwnOpenOrdersOnchain:async()=>[]}},snapshot:async()=>({market:{poolAddress:owner,baseDecimals:18,quoteDecimals:18,minQuantity:'1000000000000000',lotSize:'100000000000000',tickSize:'10000000000000000'},snapshot:{asks:[{price:'2400000000000000000000'}],bids:[{price:'2399000000000000000000'}]}}),close:async()=>{}};}
const input={kind:'roundtrip',quantity:'0.001',intervalMinutes:5,holdSeconds:20,cycles:3,maxNotional:'30',maxGas:'0.3'};
test('review checks the selected exit reserve before issuing any plan or authority',async()=>{
 const h=await home(),g=gateway(),s=new LocalService(h,g);await s.initialize();await writeFile(join(h,'.wallet/public.json'),JSON.stringify({address:operator}));await s.saveOwner(owner);
 g.rpc.getBalance=async()=>1200000000000000000n;
 await assert.rejects(()=>s.review(input),/1.3 STT/);assert.equal((await s.snapshot()).run,null);assert.equal(s.reviews.size,0);
});
test('a fresh user has no inherited wallet, proof, plan or trading authority',async()=>{const s=new LocalService(await home(),gateway());await s.initialize();const state=await s.snapshot();assert.equal(state.wallet,null);assert.equal(state.run,null);assert.equal(state.owner,'');await assert.rejects(()=>s.review(input),/setup/);});
test('activation requires review, confirmation and fresh permission; stop preserves authority until reconciliation',async()=>{
 const h=await home(),g=gateway(),s=new LocalService(h,g);await s.initialize();await writeFile(join(h,'.wallet/public.json'),JSON.stringify({address:operator}));await s.saveOwner(owner);
 const r=await s.review(input);let launches=0;s.launch=async()=>{launches++;};
 await assert.rejects(()=>s.start(r.id,false),/allow trading/);g.setRights(false);await assert.rejects(()=>s.start(r.id,true),/Link this bot/);assert.equal(launches,0);
 g.setRights(true);await s.start(r.id,true);assert.equal(launches,1);const a=await readJSON(s.path(`authority-${r.draft.id}.json`));assert.equal(a.configDigest,botConfigDigest(r.draft.config));assert.equal(a.revoked,false);
 await assert.rejects(()=>s.review(input),/current plan/);await s.stop();assert.ok(await readJSON(s.path(`stop-${r.draft.id}.json`)));assert.equal((await readJSON(s.path(`authority-${r.draft.id}.json`))).revoked,false);
});
test('HTTP rejects foreign origins, missing tokens, private paths and account writes without a local session',async()=>{
 const app=await startServer({home:await home(),port:0,gateway:gateway(),recover:false});try{
  const session=await (await fetch(app.origin+'/api/session')).json();assert.ok(session.token);
  const post=(headers,body={})=>fetch(app.origin+'/api/operator',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
  assert.equal((await post({Origin:'https://foreign.example','X-DepthPilot-Token':session.token})).status,403);
  assert.equal((await post({Origin:app.origin})).status,403);
  assert.equal((await fetch(app.origin+'/.wallet/key.dpapi')).status,404);
  assert.equal((await fetch(app.origin+'/',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,200);
  assert.equal((await fetch(app.origin+'/api/status',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
  const foreignHostStatus=await new Promise((resolve,reject)=>{get(app.origin+'/api/health',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(foreignHostStatus,403);
  const state=await (await fetch(app.origin+'/api/status')).json();assert.equal(state.wallet,null);assert.equal(state.run,null);
 }finally{await app.close();}
});
test('local operator creation is idempotent and isolated without returning its private key',{skip:process.platform!=='win32'},async()=>{
 const a=new LocalService(await home(),gateway()),b=new LocalService(await home(),gateway());await a.initialize();await b.initialize();
 const first=await a.createOperator(),again=await a.createOperator(),other=await b.createOperator();assert.equal(first.address,again.address);assert.notEqual(first.address,other.address);
 assert.deepEqual(Object.keys(first).sort(),['address','chainId','createdAt']);const encrypted=await readFile(join(a.home,'.wallet/key.dpapi'),'utf8');assert.ok(encrypted.length>80);assert.ok(!/^0x[0-9a-f]{64}$/i.test(encrypted));
});
