import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Gateway, json, MAX_ORDER_GAS } from './gateway.mjs';
import { createPlan, planChild, parseExact } from './core.mjs';
import { decideBot } from './autopilot-policy.mjs';
import { botIdentity, assertDelegatedOrder } from './delegation.mjs';

function blocked(reason){throw Object.assign(Error(reason),{botBlocked:true});}
// A wider standalone-bot envelope mitigates gas-estimate drift. Actual total caps still apply.
export function botGasEnvelope(fees,config,action){
  const original=BigInt(fees.gasLimit),price=BigInt(fees.gasPrice);
  if(original<=0n||price<=0n)blocked('invalid-gas-envelope');
  let cap=MAX_ORDER_GAS;
  if(action==='close'){const reserveCap=parseExact(config.closeGasReserveSTT,18)/price;if(reserveCap<cap)cap=reserveCap;}
  if(original>cap)blocked('estimated-gas-exceeds-close-reserve');
  const buffered=original*2n;return {...fees,gasLimit:String(buffered<cap?buffered:cap)};
}
export class TokyoBotGateway {
  constructor(config,root){this.config=config;this.root=root;this.gateway=new Gateway();}
  async observe(){
    const g=this.gateway,c=this.config;
    const identity=botIdentity(c);
    if(await g.rpc.getChainId()!==50383||await g.rpc.request({method:'net_version'})!=='50000259')throw Error('Wrong Tokyo network');
    const {market,snapshot}=await g.snapshot(c.symbol);
    const [wallet,position,openOrders]=await Promise.all([g.wallet(c.account),g.sdk.client.getPerpPosition({marginBank:market.marginBank,pool:market.poolAddress,account:c.account}),g.sdk.client.getOwnOpenOrdersOnchain(market.poolAddress,c.account)]);
    this.market=market;this.snapshot=snapshot;
    const delegation=identity.delegated?await g.operatorPermissions(market.poolAddress,identity.owner,identity.operator):undefined;
    const gasBalance=identity.delegated?String(await g.rpc.getBalance({address:identity.operator})):wallet.gas;
    return {at:snapshot.observedAt,chainId:50383,owner:identity.owner,operator:identity.operator,delegation,position:String(position.size),openOrders,equity:wallet.margin.equity,gasBalance,marginStatus:wallet.margin.marginStatus,markPriceOk:snapshot.markPriceOk,blockTimestamp:Number(snapshot.blockTimestamp),blockNumber:String(snapshot.blockNumber),bid:snapshot.bids[0]?.price||'0',ask:snapshot.asks[0]?.price||'0',minQuantity:market.minQuantity,lotSize:market.lotSize};
  }
  async prepare(action,state){
    const g=this.gateway,c=this.config,observation=await this.observe();
    if(c.operator&&(!observation.delegation.place||!observation.delegation.cancel||!observation.delegation.reduce))blocked('operator-permission-missing');
    if(decideBot(c,state,observation,Date.now()).action!==action)blocked('market-or-account-changed');
    const market=this.market,snapshot=this.snapshot,side=action==='open'?'buy':'sell',quantity=action==='open'?String(parseExact(c.quantity,18)):state.cycle.quantity;
    const best=BigInt(side==='buy'?observation.ask:observation.bid),tick=BigInt(market.tickSize);
    const bound=best*(side==='buy'?10000n+BigInt(c.slippageBps):10000n-BigInt(c.slippageBps))/10000n;
    const price=side==='buy'?bound/tick*tick:(bound+tick-1n)/tick*tick;
    const account=await g.account(market,c.account,side,String(price));
    const deadline=state.exitDeadline||state.hardDeadline;
    const durationSec=deadline===null?60:Math.min(60,Math.floor((deadline-Date.now())/1000));
    if(durationSec<30)blocked('closing-window-ending');
    const plan=createPlan({id:`bot-${c.runId}-${state.orders.length+1}`,source:'live',symbol:c.symbol,market,account:c.account,...(c.operator?{operator:c.operator}:{}),...(action==='close'?{closingPositionSize:observation.position}:{}),accountSource:c.operator?'linked-bot':'local-bot',side,target:quantity,bound:String(bound),maxChild:quantity,participationBps:c.participationBps,durationSec});
    const child=planChild({...plan,market,snapshot,capacity:account.capacity});
    if(!child.executable||(action==='open'&&child.quantity!==quantity))blocked(`planner-${child.reason}-${child.quantity}`);
    const unsigned=await g.unsigned(plan,child),fees=botGasEnvelope(await g.browserFees(plan,unsigned),c,action);
    if(BigInt(fees.gasPrice)>parseExact(c.maxGasPriceGwei,9))blocked('gas-price-above-cap');
    const nonce=await g.rpc.getTransactionCount({address:c.operator||c.account,blockTag:'latest'});
    if(nonce!==fees.nonce)blocked('unresolved-account-nonce');
    const gasLimit=BigInt(fees.gasLimit),gasPrice=BigInt(fees.gasPrice);
    if(c.continuous&&BigInt(observation.gasBalance)-gasLimit*gasPrice<parseExact(c.minNativeReserveSTT,18))blocked('native-reserve');
    await g.rpc.call({account:c.operator||c.account,to:unsigned.to,data:unsigned.data,value:0n,gas:gasLimit,gasPrice});
    if(Date.now()-snapshot.observedAt>15000)blocked('candidate-became-stale');
    return JSON.parse(json({action,quantity:child.quantity,price:child.price,notional:BigInt(child.quantity)*BigInt(child.price)/10n**18n,expectedAveragePrice:child.expectedAveragePrice,previewAt:snapshot.observedAt,observation,plan,unsigned,nonce,gasLimit,gasPrice,gasCeiling:gasLimit*gasPrice}));
  }
  async sign(order){
    if(order.plan.closingPositionSize!==undefined){
      const [position,orders]=await Promise.all([
        this.gateway.sdk.client.getPerpPosition({marginBank:order.plan.market.marginBank,pool:order.plan.market.poolAddress,account:order.plan.account}),
        this.gateway.sdk.client.getOwnOpenOrdersOnchain(order.plan.market.poolAddress,order.plan.account),
      ]);
      const expected=BigInt(order.plan.closingPositionSize),quantity=BigInt(order.quantity),absolute=expected<0n?-expected:expected;
      if(position.size!==expected||orders.length||quantity<=0n||quantity>absolute||(expected>0n?order.plan.side!=='sell':order.plan.side!=='buy'))blocked('closing position changed; reconcile before signing');
    }
    if(this.config.operator){
      const encoded=assertDelegatedOrder(order.plan,order.unsigned);
      if(encoded.quantity!==BigInt(order.quantity)||encoded.price!==BigInt(order.price))throw Error('Delegated candidate encoding differs from reviewed quantity or price');
      if(order.plan.account.toLowerCase()!==this.config.account.toLowerCase()||order.plan.operator.toLowerCase()!==this.config.operator.toLowerCase())throw Error('Configured owner/operator mismatch');
      const grants=await this.gateway.operatorPermissions(order.plan.market.poolAddress,this.config.account,this.config.operator);
      if(!grants.place||!grants.cancel||!grants.reduce)blocked('operator-permission-missing');
    }
    // A standalone bot never enables the local HTTP signing policy.
    try{await access(join(this.root,'.data/authorization.json'));throw Error('Disable HTTP local signing before using the autonomous runner');}catch(e){if(e.code!=='ENOENT')throw e;}
    const publicWallet=JSON.parse(await readFile(join(this.root,'.wallet/public.json'),'utf8'));
    if(publicWallet.mode==='demo'||publicWallet.address.toLowerCase()!==(this.config.operator||this.config.account).toLowerCase())throw Error('A matching protected local test wallet is required');
    const encrypted=await readFile(join(this.root,'.wallet/key.dpapi'),'utf8');
    const command="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))";
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:encrypted,encoding:'utf8',windowsHide:true});
    if(result.status!==0)throw Error('Protected wallet could not be unlocked');
    let account;try{account=privateKeyToAccount(result.stdout.trim());}catch{throw Error('Protected wallet could not be decoded');}
    if(account.address.toLowerCase()!==(this.config.operator||this.config.account).toLowerCase())throw Error('Protected wallet mismatch');
    const serializedTransaction=await account.signTransaction({chainId:50383,type:'legacy',to:order.unsigned.to,data:order.unsigned.data,value:0n,gas:BigInt(order.gasLimit),gasPrice:BigInt(order.gasPrice),nonce:order.nonce});
    return {serializedTransaction,hash:keccak256(serializedTransaction)};
  }
  async broadcast(signed){return this.gateway.rpc.sendRawTransaction({serializedTransaction:signed.serializedTransaction});}
  async receipt(order){return this.gateway.receipt(order.plan,order.hash,order.unsigned,order.nonce);}
  async close(){await this.gateway.close();}
}
