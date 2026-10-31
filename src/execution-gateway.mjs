import { TokyoBotGateway } from './bot-gateway.mjs';
import { planChild, parseExact } from './core.mjs';
import { assertDelegatedOrder } from './delegation.mjs';

// Reuse the verified operator signer and exact-receipt adapter; replace the round-trip policy only.
export class ExecutionGateway {
  constructor(plan,root){this.plan=plan;this.bot=new TokyoBotGateway({account:plan.account,operator:plan.operator},root);this.gateway=this.bot.gateway;}
  async observe(plan){
    if(await this.gateway.rpc.getChainId()!==50383||await this.gateway.rpc.request({method:'net_version'})!=='50000259')throw Error('Wrong Tokyo network');
    const data=await this.gateway.snapshot(plan.symbol);
    if(data.market.poolAddress.toLowerCase()!==plan.market.poolAddress.toLowerCase()||data.market.tickSize!==plan.market.tickSize||data.market.lotSize!==plan.market.lotSize||data.market.minQuantity!==plan.market.minQuantity)throw Error('Plan market identity or grid changed');
    const tick=BigInt(data.market.tickSize),bound=BigInt(plan.bound),price=plan.side==='buy'?bound/tick*tick:(bound+tick-1n)/tick*tick;
    const account=await this.gateway.account(data.market,plan.account,plan.side,String(price));
    if(plan.operator){const rights=await this.gateway.operatorPermissions(data.market.poolAddress,plan.account,plan.operator);if(!rights.place||!rights.cancel||!rights.reduce)return {...data,delegation:rights,capacity:{...account.capacity,placeable:false,limitedBy:'operator-permission-missing'}};}
    return {...data,capacity:account.capacity};
  }
  async prepare(plan){
    const data=await this.observe(plan),child=planChild({...plan,...data});
    if(!child.executable)throw Error(`Planner paused: ${child.reason}`);
    if(plan.operator){const rights=await this.gateway.operatorPermissions(plan.market.poolAddress,plan.account,plan.operator);if(!rights.place||!rights.cancel||!rights.reduce)throw Error('Operator permission missing');}
    const unsigned=await this.gateway.unsigned(plan,child),fees=await this.gateway.browserFees(plan,unsigned);
    if(BigInt(fees.balance)-BigInt(fees.gasLimit)*BigInt(fees.gasPrice)<parseExact('1',18))throw Error('This order would use the 1 STT reserve. Add Tokyo gas or lower the plan.');
    await this.gateway.simulate(plan,unsigned,BigInt(fees.gasLimit));
    if(await this.gateway.rpc.getTransactionCount({address:plan.operator||plan.account,blockTag:'latest'})!==fees.nonce)throw Error('Unresolved operator nonce');
    return {...child,plan,unsigned,nonce:fees.nonce,gasPrice:fees.gasPrice,gasLimit:fees.gasLimit,gasCeiling:String(BigInt(fees.gasLimit)*BigInt(fees.gasPrice))};
  }
  async sign(order){
    if(order.plan.account.toLowerCase()!==this.plan.account.toLowerCase()||order.plan.operator?.toLowerCase()!==this.plan.operator?.toLowerCase())throw Error('Execution identity changed');
    if(order.plan.operator)assertDelegatedOrder(order.plan,order.unsigned);
    return this.bot.sign(order);
  }
  broadcast(signed){return this.bot.broadcast(signed);}
  receipt(plan,pending){return this.gateway.receipt(plan,pending.hash,pending.unsigned,pending.nonce);}
  close(){return this.gateway.close();}
}
