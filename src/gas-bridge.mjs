import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createPublicClient,http,parseAbi,parseEventLogs,keccak256} from 'viem';
import {somniaShannon,hidekiTestnet,createBridgeTransfer,getBridgeNetwork} from '@somnia-chain/markets-sdk/chains';
import {readJSON,writeJSON} from './runtime.mjs';

const UNIT=10n**18n,RESERVE=UNIT/100n,MAX_FEE=UNIT/50n,MAX_AMOUNT=100n*UNIT;
const pending=record=>record&&!['delivered','reverted'].includes(record.status);
const mailboxAbi=parseAbi(['event DispatchId(bytes32 indexed messageId)','function delivered(bytes32 messageId) view returns (bool)']);
export function bridgeAmount(balance,gas,gasPrice){
 if(gas<=0n||gas>10000000n||gasPrice<=0n||gasPrice>10000000000n||gas*gasPrice>MAX_FEE)throw Error('The bridge fee is above the 0.02 STT limit. Try later.');
 const amount=balance-RESERVE-gas*gasPrice;
 if(amount<=0n)throw Error('This bot needs more STT on Shannon before it can move gas.');
 return amount>MAX_AMOUNT?MAX_AMOUNT:amount;
}
export class GasBridge{
 constructor(home,{origin,destination,now=Date.now}={}){
  this.home=home;this.now=now;
  this.origin=origin||createPublicClient({chain:somniaShannon,transport:http(undefined,{timeout:12000,retryCount:0})});
  this.destination=destination||createPublicClient({chain:hidekiTestnet,transport:http('https://api.hideki2.infra.testnet.somnia.network',{timeout:12000,retryCount:0})});
 }
 path(name){return join(this.home,'.data',name);}
 async identity(){const wallet=await readJSON(join(this.home,'.wallet/public.json'),null);if(!wallet)throw Error('Create your local bot first.');return wallet.address;}
 async networks(){if(await this.origin.getChainId()!==50312||await this.destination.getChainId()!==50383||await this.destination.request({method:'net_version'})!=='50000259')throw Error('The test networks could not be verified. No gas was moved.');}
 async status(){
  const wallet=await readJSON(join(this.home,'.wallet/public.json'),null);if(!wallet)return {address:null,shannon:null,tokyo:null,transfer:null};
  await this.networks();const address=wallet.address;
  const [shannon,tokyo]=await Promise.all([this.origin.getBalance({address}),this.destination.getBalance({address})]);
  let record=await readJSON(this.path('gas-bridge.json'),null);
  if(record&&record.address.toLowerCase()!==address.toLowerCase())throw Error('The stored gas move belongs to another bot.');
  if(pending(record)){
   let receipt;try{receipt=await this.origin.getTransactionReceipt({hash:record.hash});}catch(e){if(!/TransactionReceiptNotFound|TransactionNotFound/.test(e.name))throw e;}
   if(receipt){
    const tx=await this.origin.getTransaction({hash:record.hash}),q=record.review;
    if(tx.from.toLowerCase()!==address.toLowerCase()||tx.to?.toLowerCase()!==q.transaction.to.toLowerCase()||tx.input!==q.transaction.data||tx.value!==BigInt(q.amount)||tx.nonce!==q.transaction.nonce||tx.chainId!==50312||tx.gas!==BigInt(q.transaction.gas)||tx.gasPrice!==BigInt(q.transaction.gasPrice)||receipt.gasUsed*receipt.effectiveGasPrice>BigInt(q.feeCeiling))throw Error('The gas transaction could not be matched. Do not send it again.');
    record.receipt={status:receipt.status,blockNumber:String(receipt.blockNumber),gasUsed:String(receipt.gasUsed),effectiveGasPrice:String(receipt.effectiveGasPrice),gasCost:String(receipt.gasUsed*receipt.effectiveGasPrice)};
    if(receipt.status==='reverted')record.status='reverted';
    else{
     const events=parseEventLogs({abi:mailboxAbi,eventName:'DispatchId',logs:receipt.logs.filter(log=>log.address.toLowerCase()===getBridgeNetwork(50312).mailbox.toLowerCase())});
     if(events.length!==1)throw Error('The bridge message could not be verified. Do not send it again.');
     record.messageId=events[0].args.messageId;
     const delivered=await this.destination.readContract({address:getBridgeNetwork(50383).mailbox,abi:mailboxAbi,functionName:'delivered',args:[record.messageId]});
     record.status=delivered&&tokyo>=BigInt(record.tokyoBefore)+BigInt(record.amount)?'delivered':'origin-confirmed';
    }
    await writeJSON(this.path('gas-bridge.json'),record);
   }
  }
  return {address,shannon:String(shannon),tokyo:String(tokyo),transfer:record};
 }
 async quote(){
  const state=await this.status();if(!state.address)throw Error('Create your local bot first.');
  if(pending(state.transfer))throw Error('A gas move is still being checked. Check its status instead of sending again.');
  const address=state.address,balance=BigInt(state.shannon),gasPrice=await this.origin.getGasPrice();
  if(balance<=RESERVE)throw Error('Send test STT to your bot on Shannon first, or top it up directly on Tokyo.');
  const initialAmount=balance-RESERVE>MAX_AMOUNT?MAX_AMOUNT:balance-RESERVE;
  const initial=createBridgeTransfer({token:'STT',from:50312,to:50383,amount:initialAmount,recipient:address});
  const estimate=await this.origin.estimateGas({account:address,to:initial.bridgeStep.to,data:initial.bridgeStep.data,value:initialAmount});
  const gas=(estimate*130n+99n)/100n,amount=bridgeAmount(balance,gas,gasPrice);
  const plan=createBridgeTransfer({token:'STT',from:50312,to:50383,amount,recipient:address});
  const [nonce,confirmed,liquidity]=await Promise.all([this.origin.getTransactionCount({address,blockTag:'pending'}),this.origin.getTransactionCount({address,blockTag:'latest'}),this.destination.getBalance({address:plan.destination.router})]);
  if(nonce!==confirmed)throw Error('A transaction on Shannon is still pending. Check it before moving gas.');
  if(liquidity<amount)throw Error('The test bridge has insufficient liquidity. Try later.');
  const review={id:randomUUID(),address,from:50312,to:50383,amount:String(amount),feeCeiling:String(gas*gasPrice),reserve:String(RESERVE),shannonBefore:state.shannon,tokyoBefore:state.tokyo,expiresAt:this.now()+300000,transaction:{chainId:50312,type:'legacy',to:plan.bridgeStep.to,data:plan.bridgeStep.data,value:String(amount),gas:String(gas),gasPrice:String(gasPrice),nonce}};
  await writeJSON(this.path('gas-review.json'),review);return review;
 }
 async send(id,confirmed,sign){
  if(confirmed!==true)throw Error('Review and allow this gas move before sending.');
  const existing=await readJSON(this.path('gas-bridge.json'),null);
  if(existing&&(existing.review.id===id||pending(existing)))return this.status();
  const q=await readJSON(this.path('gas-review.json'),null),address=await this.identity();
  if(!q||q.id!==id||q.expiresAt<this.now()||q.expiresAt>this.now()+300000)throw Error('This gas review expired. Review it again.');
  if(q.address.toLowerCase()!==address.toLowerCase()||q.from!==50312||q.to!==50383)throw Error('The bot or network changed. Review again.');
  await this.networks();const amount=BigInt(q.amount),t=q.transaction,gas=BigInt(t.gas),gasPrice=BigInt(t.gasPrice);
  const plan=createBridgeTransfer({token:'STT',from:50312,to:50383,amount,recipient:address});
  if(amount<=0n||amount>MAX_AMOUNT||plan.approveStep||t.chainId!==50312||t.type!=='legacy'||t.to!==plan.bridgeStep.to||t.data!==plan.bridgeStep.data||BigInt(t.value)!==amount||q.feeCeiling!==String(gas*gasPrice)||q.reserve!==String(RESERVE))throw Error('The gas review could not be verified.');
  const [balance,nonce,latest,before,liquidity]=await Promise.all([this.origin.getBalance({address}),this.origin.getTransactionCount({address,blockTag:'pending'}),this.origin.getTransactionCount({address,blockTag:'latest'}),this.destination.getBalance({address}),this.destination.getBalance({address:plan.destination.router})]);
  bridgeAmount(balance,gas,gasPrice);
  if(balance<amount+gas*gasPrice+RESERVE||nonce!==latest||nonce!==t.nonce||liquidity<amount)throw Error('Balances or pending transactions changed. Review the gas move again.');
  await this.origin.call({account:address,to:t.to,data:t.data,value:amount,gas,gasPrice});
  const signed=await sign({...t,value:amount,gas,gasPrice},address);
  if(keccak256(signed.serializedTransaction)!==signed.hash)throw Error('The signed transaction hash did not match.');
  if(existing){await mkdir(this.path('gas-history'),{recursive:true});await writeJSON(this.path(`gas-history/${existing.review.id}.json`),existing);}
  const record={address,amount:q.amount,review:q,hash:signed.hash,tokyoBefore:String(before),status:'signed-before-broadcast',createdAt:this.now()};
  await writeJSON(this.path('gas-bridge.json'),record);
  try{const hash=await this.origin.sendRawTransaction({serializedTransaction:signed.serializedTransaction});if(hash!==signed.hash)throw Error('Hash mismatch');record.status='pending';}catch{record.status='unknown';}
  await writeJSON(this.path('gas-bridge.json'),record);return this.status();
 }
}
