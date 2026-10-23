import test from 'node:test';import assert from 'node:assert/strict';
import { decodeFunctionData } from 'viem';
import { ExecutionGateway } from '../src/execution-gateway.mjs';import { OPERATOR_ABI } from '../src/delegation.mjs';
import { createPlan,parseExact } from '../src/core.mjs';
const raw=x=>String(parseExact(x,18)),owner='0x1111111111111111111111111111111111111111',operator='0x3333333333333333333333333333333333333333';
const market={poolAddress:'0xd6cb1dd58580b84d76068ac21594219ce03aeddf',baseDecimals:18,quoteDecimals:18,tickSize:raw('0.01'),lotSize:raw('0.0001'),minQuantity:raw('0.004')};
test('finite adapter builds a real SDK delegated IOC with fresh owner capacity and operator nonce',async()=>{
  const p=createPlan({id:'finite',source:'live',symbol:'ETH',account:owner,operator,side:'buy',market,target:raw('0.012'),bound:raw('2405'),arrivalPrice:raw('2400.1'),maxChild:raw('0.004'),participationBps:2500,executionPolicy:{maxSpreadBps:5,maxSlippageBps:10,minIntervalSec:10}});
  const a=new ExecutionGateway(p,'no-keys-needed'),g=a.gateway;let granted=true;
  try{
    g.snapshot=async()=>({market,snapshot:{observedAt:Date.now(),markPriceOk:true,bids:[{price:raw('2400'),quantity:raw('1')}],asks:[{price:raw('2400.1'),quantity:raw('1')}]}});
    g.account=async(m,account)=>{assert.equal(account,owner);return {capacity:{priceable:true,placeable:true,maxQuantity:raw('1')}}};
    g.operatorPermissions=async()=>({place:granted,cancel:granted,reduce:granted});
    g.rpc={getChainId:async()=>50383,request:async()=> '50000259',estimateGas:async({account})=>{assert.equal(account,operator);return 1000000n},getGasPrice:async()=>6000000000n,getTransactionCount:async({address})=>{assert.equal(address,operator);return 7},getBalance:async()=>1000000000000000000n,call:async({account})=>{assert.equal(account,operator);return {}}};
    const c=await a.prepare(p),decoded=decodeFunctionData({abi:OPERATOR_ABI,data:c.unsigned.data});assert.equal(decoded.args[0],owner);assert.equal(decoded.args[4],4000000000000000n);assert.equal(c.nonce,7);assert.ok(BigInt(c.price)<=parseExact('2402.5001',18));
    granted=false;assert.equal((await a.observe(p)).capacity.limitedBy,'operator-permission-missing');await assert.rejects(a.prepare(p),/permission/);
    g.rpc.getChainId=async()=>1;await assert.rejects(a.observe(p),/network/);
  }finally{await a.close()}
});
