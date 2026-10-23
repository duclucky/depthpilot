import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';
import {startServer} from '../src/server.mjs';
import {GasBridge,bridgeAmount} from '../src/gas-bridge.mjs';import {writeJSON,readJSON,initializeHome} from '../src/runtime.mjs';import {LocalService} from '../src/service.mjs';
import {keccak256,encodeEventTopics,parseAbi} from 'viem';import {getBridgeNetwork} from '@somnia-chain/markets-sdk/chains';
const parent=fileURLToPath(new URL('../.cache/',import.meta.url));
test('installed setup can inspect test gas without trading or revealing a key',async()=>{
 await mkdir(parent,{recursive:true});const home=await mkdtemp(join(parent,'gas-ui-'));
 const app=await startServer({home,port:0,recover:false,gateway:{close:async()=>{}},gasBridge:{status:async()=>({address:'0x1111111111111111111111111111111111111111',shannon:'1150000000000000000',tokyo:'0',transfer:null})}});
 try{const response=await fetch(app.origin+'/api/gas');assert.equal(response.status,200);const data=await response.json();assert.equal(data.shannon,'1150000000000000000');assert.equal(data.tokyo,'0');assert.equal(data.transfer,null);assert.equal(data.privateKey,undefined);}finally{await app.close();}
});

const operator='0x1111111111111111111111111111111111111111',U=10n**18n;
async function fixture(){
 await mkdir(parent,{recursive:true});const home=await mkdtemp(join(parent,'gas-core-'));await initializeHome(home);await writeJSON(join(home,'.wallet/public.json'),{address:operator});
 const state={signs:0,broadcasts:0,delivered:false,receipt:null,balance:115n*U/100n,tokyo:0n,nonce:0,now:1000000};
 const origin={getChainId:async()=>50312,getBalance:async()=>state.balance,getGasPrice:async()=>6000000000n,estimateGas:async()=>200000n,getTransactionCount:async()=>state.nonce,call:async()=>({}),sendRawTransaction:async()=>{state.broadcasts++;if(state.ambiguous)throw Error('Network disconnected');return keccak256('0x1234');},getTransactionReceipt:async()=>{if(!state.receipt){const e=Error('No receipt');e.name='TransactionReceiptNotFoundError';throw e;}return state.receipt;},getTransaction:async()=>{const q=await readJSON(join(home,'.data/gas-review.json'));return {from:operator,to:q.transaction.to,input:q.transaction.data,value:BigInt(q.amount),nonce:q.transaction.nonce,chainId:50312,gas:BigInt(q.transaction.gas),gasPrice:BigInt(q.transaction.gasPrice),...state.txOverride};}};
 const destination={getChainId:async()=>50383,request:async()=>state.networkId||'50000259',getBalance:async({address})=>address.toLowerCase()===operator.toLowerCase()?state.tokyo:1000n*U,readContract:async()=>state.delivered};
 const bridge=new GasBridge(home,{origin,destination,now:()=>state.now});
 const sign=async()=>{state.signs++;return {serializedTransaction:'0x1234',hash:keccak256('0x1234')};};
 return {home,state,bridge,sign};
}
test('bridge amount reserves source fees and rejects an excessive fee envelope',()=>{
 assert.equal(bridgeAmount(115n*U/100n,260000n,6000000000n),113844n*10n**13n);
 assert.throws(()=>bridgeAmount(U,4000000n,6000000000n),/fee/);assert.throws(()=>bridgeAmount(U/100n,260000n,6000000000n),/more STT/);
 assert.equal(bridgeAmount(1000n*U,260000n,6000000000n),100n*U);
});
test('the observed first-use bridge envelope leaves enough Tokyo gas and a Shannon reserve',()=>{
 assert.equal(bridgeAmount(115n*U/100n,1686722n,6000000000n),1129879668000000000n);
});
test('review binds a same-address native Shannon-to-Tokyo move and network identity',async()=>{
 const {bridge,state}=await fixture();const q=await bridge.quote();assert.equal(q.address,operator);assert.equal(q.from,50312);assert.equal(q.to,50383);assert.equal(q.feeCeiling,'1560000000000000');assert.equal(q.reserve,'10000000000000000');assert.equal(q.transaction.value,q.amount);assert.equal(state.signs,0);state.networkId='50000258';await assert.rejects(()=>bridge.quote(),/networks/);
});
test('missing confirmation, expired review and altered recipient calldata never sign',async()=>{
 const {bridge,state,sign,home}=await fixture();const q=await bridge.quote();await assert.rejects(()=>bridge.send(q.id,false,sign),/allow/);state.now=q.expiresAt+1;await assert.rejects(()=>bridge.send(q.id,true,sign),/expired/);state.now=q.expiresAt-1;q.transaction.data='0x1234';await writeJSON(join(home,'.data/gas-review.json'),q);await assert.rejects(()=>bridge.send(q.id,true,sign),/verified/);assert.equal(state.signs,0);assert.equal(state.broadcasts,0);
});
test('a saved intent and ambiguous send cannot be signed or broadcast again',async()=>{
 const {bridge,state,sign,home}=await fixture();state.ambiguous=true;const q=await bridge.quote();const result=await bridge.send(q.id,true,sign);assert.equal(result.transfer.status,'unknown');const record=await readJSON(join(home,'.data/gas-bridge.json'));assert.equal(record.hash,keccak256('0x1234'));assert.equal(record.serializedTransaction,undefined);await bridge.send(q.id,true,sign);assert.equal(state.signs,1);assert.equal(state.broadcasts,1);await assert.rejects(()=>bridge.quote(),/still being checked/);
});
test('delivery requires a bound successful receipt, bridge message and destination balance',async()=>{
 const {bridge,state,sign}=await fixture(),q=await bridge.quote();await bridge.send(q.id,true,sign);
 state.receipt={status:'success',blockNumber:123n,gasUsed:200000n,effectiveGasPrice:6000000000n,logs:[{address:getBridgeNetwork(50312).mailbox,data:'0x',topics:encodeEventTopics({abi:parseAbi(['event DispatchId(bytes32 indexed messageId)']),eventName:'DispatchId',args:{messageId:'0x'+'42'.repeat(32)}})}]};
 state.delivered=true;let status=await bridge.status();assert.equal(status.transfer.status,'origin-confirmed');state.tokyo=BigInt(q.amount);status=await bridge.status();assert.equal(status.transfer.status,'delivered');assert.equal(status.transfer.receipt.gasCost,'1200000000000000');await bridge.send(q.id,true,sign);assert.equal(state.broadcasts,1);
});
test('a receipt from another sender is rejected without a retry',async()=>{
 const {bridge,state,sign}=await fixture(),q=await bridge.quote();await bridge.send(q.id,true,sign);state.receipt={status:'reverted',logs:[],blockNumber:1n,gasUsed:1n,effectiveGasPrice:1n};state.txOverride={from:'0x2222222222222222222222222222222222222222'};await assert.rejects(()=>bridge.status(),/matched/);assert.equal(state.broadcasts,1);
});
test('gas changes require explicit confirmation and an inactive trading plan',async()=>{
 const {home}=await fixture();let sends=0;const service=new LocalService(home,{}, {send:async()=>{sends++;},quote:async()=>({})});service.isActive=async()=>false;await assert.rejects(()=>service.sendGas('id',false),/allow/);service.isActive=async()=>true;await assert.rejects(()=>service.sendGas('id',true),/Stop and reconcile/);assert.equal(sends,0);
 await writeJSON(join(home,'.data/gas-bridge.json'),{status:'unknown'});await assert.rejects(()=>service.review({}),/pending gas/);await assert.rejects(()=>service.start('id',true),/pending gas/);
});
