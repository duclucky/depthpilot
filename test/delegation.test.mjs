import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, parseAbi } from 'viem';
import { Gateway } from '../src/gateway.mjs';
import { TokyoBotGateway } from '../src/bot-gateway.mjs';
import { validateBotConfig } from '../src/autopilot-policy.mjs';
import { initialBotState } from '../src/autopilot-policy.mjs';
import { assertDelegatedOrder, OPERATOR_ABI } from '../src/delegation.mjs';
import { encodeFunctionData } from 'viem';
import { checkAccount } from '../src/account-check.mjs';
import { readFile } from 'node:fs/promises';
const owner='0x1111111111111111111111111111111111111111',operator='0x3333333333333333333333333333333333333333',pool='0xd6cb1dd58580b84d76068ac21594219ce03aeddf';
const abi=parseAbi(['function placeOrderFor(address,bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96) payable returns (bool,uint128)']);
const plan={account:owner,operator,market:{poolAddress:pool},side:'buy',bound:'2452450000000000000000',deadline:1800000000123};
test('SDK-derived delegated IOC encodes the owner while the operator is the only sender',async()=>{
  const g=new Gateway();try{
    const tx=await g.unsigned(plan,{price:'2452400000000000000000',quantity:'4000000000000000'});
    const decoded=decodeFunctionData({abi,data:tx.data});assert.equal(decoded.functionName,'placeOrderFor');
    assert.equal(decoded.args[0],owner);assert.equal(decoded.args[1],true);assert.equal(decoded.args[4],4000000000000000n);assert.equal(decoded.args[6],2);assert.equal(tx.operator,operator);assert.equal(tx.owner,owner);assert.equal(tx.functionName,'placeOrderFor');
    g.rpc={getTransaction:async()=>({from:operator,to:pool,input:tx.data,value:0n,nonce:7})};
    await g.verifyTransaction(plan,'0xhash',tx,7);
    g.rpc={getTransaction:async()=>({from:owner,to:pool,input:tx.data,value:0n,nonce:7})};
    await assert.rejects(()=>g.verifyTransaction(plan,'0xhash',tx,7),/does not match/);
    await assert.rejects(()=>g.verifyTransaction({...plan,account:operator},'0xhash',tx,7),/owner|identity|distinct/i);
    const wrongOwner={...tx,data:encodeFunctionData({abi:OPERATOR_ABI,functionName:'placeOrderFor',args:[operator,...decoded.args.slice(1)]})};
    assert.throws(()=>assertDelegatedOrder(plan,wrongOwner),/owner|invariant/i);
    assert.throws(()=>assertDelegatedOrder({...plan,target:'1'},tx),/quantity/i);
  }finally{await g.close()}
});
test('the local linked readiness check never treats a missing permission as ready or as a wallet connection',async()=>{
  let granted=false,gas=2000000000000000000n;
  const g={market:async()=>({poolAddress:pool,marginBank:owner}),operatorPermissions:async()=>({place:granted,cancel:granted,reduce:granted}),wallet:async()=>({margin:{equity:'1000000000000000000000',marginStatus:'Healthy'}}),sdk:{client:{getPerpPosition:async()=>({size:0n}),getOwnOpenOrdersOnchain:async()=>[]}},rpc:{getChainId:async()=>50383,request:async()=> '50000259',getBytecode:async()=> '0x1234',getBalance:async()=>gas}};
  g.snapshot=async()=>({market:{poolAddress:pool,marginBank:owner,minQuantity:'4000000000000000',lotSize:'100000000000000'}});
  const denied=await checkAccount(g,owner,operator);assert.equal(denied.ready,false);assert.equal(denied.blockers[0].code,'permission');assert.equal(denied.owner,owner);assert.equal(denied.operator,operator);
  granted=true;assert.equal((await checkAccount(g,owner,operator)).ready,true);
  gas=0n;assert.equal((await checkAccount(g,owner,operator)).ready,false);
});
test('setup refuses a different network before presenting permission results',async()=>{
  await assert.rejects(()=>checkAccount({rpc:{getChainId:async()=>1},market:async()=>{throw Error('must not read a different network')}},owner,operator),/network/);
});
test('delegated fee estimation and nonce use the operator rather than the margin owner',async()=>{
  const g=new Gateway();try{
    const queried=[];g.rpc={getChainId:async()=>50383,estimateGas:async args=>{queried.push(args.account);return 100000n},getGasPrice:async()=>2n,getTransactionCount:async({address})=>{queried.push(address);return 9},getBalance:async({address})=>{queried.push(address);return 1000000n}};
    const fees=await g.browserFees(plan,{to:pool,data:'0x1234'});assert.equal(fees.nonce,9);assert.deepEqual(queried,[operator,operator,operator]);
  }finally{await g.close()}
});
test('revoked permission is rechecked before any protected key can be unlocked',async()=>{
  const c={...JSON.parse(await readFile(new URL('./fixtures/bot.config.json',import.meta.url),'utf8')),account:owner,operator};
  const a=new TokyoBotGateway(c,'does-not-contain-a-key');
  const unsigned=await a.gateway.unsigned({...plan,target:'4000000000000000'},{price:'2452400000000000000000',quantity:'4000000000000000'});await a.gateway.close();
  a.gateway={operatorPermissions:async()=>({place:false,cancel:false,reduce:false})};
  await assert.rejects(()=>a.sign({plan:{...plan,target:'4000000000000000'},unsigned,quantity:'4000000000000000',price:'2452400000000000000000'}),/operator-permission/);
});
test('linked bot observation keeps owner margin/position and operator gas separate and refuses a missing grant',async()=>{
  const c={...JSON.parse(await readFile(new URL('./fixtures/bot.config.json',import.meta.url),'utf8')),account:owner,operator};
  validateBotConfig(c);assert.throws(()=>validateBotConfig({...c,operator:'0x1234'}),/operator|identity/i);assert.throws(()=>validateBotConfig({...c,operator:owner}),/operator|distinct/i);
  const adapter=new TokyoBotGateway(c,process.cwd());await adapter.gateway.close();
  let granted=false;const seen=[];
  adapter.gateway={rpc:{getChainId:async()=>50383,request:async()=> '50000259',getBalance:async({address})=>{seen.push(address);return 800n}},snapshot:async()=>({market:{poolAddress:pool,minQuantity:'4',lotSize:'1'},snapshot:{observedAt:Date.now(),markPriceOk:true,blockTimestamp:1,blockNumber:'10',bids:[{price:'100'}],asks:[{price:'101'}]}}),wallet:async address=>{seen.push(address);return {gas:'1',margin:{equity:'1000',marginStatus:'Healthy'}}},sdk:{client:{getPerpPosition:async({account})=>{seen.push(account);return {size:0n}},getOwnOpenOrdersOnchain:async(p,a)=>{seen.push(a);return []}}},operatorPermissions:async()=>({place:granted,cancel:granted,reduce:granted})};
  const o=await adapter.observe();assert.equal(o.equity,'1000');assert.equal(o.gasBalance,'800');assert.equal(o.delegation.place,false);assert.equal(seen.filter(a=>a===owner).length,3);assert.equal(seen.filter(a=>a===operator).length,1);
  await assert.rejects(()=>adapter.prepare('open',{}),/operator.*permission/i);
});
test('complete linked preparation uses owner capacity, a delegated SDK call and operator simulation/nonce',async()=>{
  const c={...JSON.parse(await readFile(new URL('./fixtures/bot.config.json',import.meta.url),'utf8')),account:owner,operator};
  const adapter=new TokyoBotGateway(c,process.cwd()),g=adapter.gateway,seen=[];
  try{
    const raw=n=>String(BigInt(n)*10n**18n),market={poolAddress:pool,baseDecimals:18,quoteDecimals:18,minQuantity:'4000000000000000',lotSize:'100000000000000',tickSize:'10000000000000000'};
    g.snapshot=async()=>({market,snapshot:{observedAt:Date.now(),markPriceOk:true,blockTimestamp:Math.floor(Date.now()/1000),blockNumber:'100',bids:[{price:raw(2400),quantity:raw(1)}],asks:[{price:'2400100000000000000000',quantity:raw(1)}]}});
    g.wallet=async address=>{assert.equal(address,owner);return {gas:'0',margin:{equity:raw(1000),marginStatus:'Healthy'}}};
    g.account=async(m,address)=>{assert.equal(address,owner);return {capacity:{priceable:true,placeable:true,maxQuantity:raw(1)}}};
    g.sdk.client.getPerpPosition=async({account})=>{assert.equal(account,owner);return {size:0n}};
    g.sdk.client.getOwnOpenOrdersOnchain=async(p,address)=>{assert.equal(address,owner);return []};
    g.operatorPermissions=async()=>({place:true,cancel:true,reduce:true});
    g.rpc={getChainId:async()=>50383,request:async()=> '50000259',getBalance:async({address})=>{assert.equal(address,operator);return BigInt(raw(8))},estimateGas:async({account})=>{assert.equal(account,operator);return 1000000n},getGasPrice:async()=>1000000000n,getTransactionCount:async({address})=>{seen.push(address);return 7},call:async({account,data})=>{assert.equal(account,operator);assert.equal(decodeFunctionData({abi,data}).args[0],owner);return {}}};
    const order=await adapter.prepare('open',initialBotState(c));
    assert.equal(order.plan.account,owner);assert.equal(order.plan.operator,operator);assert.equal(order.unsigned.functionName,'placeOrderFor');assert.equal(order.nonce,7);assert.deepEqual(seen,[operator,operator]);assert.equal(order.observation.equity,raw(1000));
  }finally{await adapter.close()}
});
