import {getAddress} from 'viem';import {parseExact} from './core.mjs';
export async function checkAccount(gateway,owner,operator){
  try{owner=getAddress(owner);operator=getAddress(operator);}catch{throw Error('Enter the complete public account address copied from dreamDEX (0x followed by 40 characters).');}
  if(owner===operator||BigInt(owner)===0n)throw Error('Use your dreamDEX trading account address, not the bot address.');
  if(await gateway.rpc.getChainId()!==50383||await gateway.rpc.request({method:'net_version'})!=='50000259')throw Error('The trading network could not be verified. Try again later.');
  const code=await gateway.rpc.getBytecode({address:owner});
  if(!code||code==='0x')throw Error('This looks like a login wallet. Copy the Somnia Account selected inside dreamDEX.');
  const {market}=await gateway.snapshot('ETH');
  const [permissions,wallet,gas,position,orders]=await Promise.all([gateway.operatorPermissions(market.poolAddress,owner,operator),gateway.wallet(owner),gateway.rpc.getBalance({address:operator}),gateway.sdk.client.getPerpPosition({marginBank:market.marginBank,pool:market.poolAddress,account:owner}),gateway.sdk.client.getOwnOpenOrdersOnchain(market.poolAddress,owner)]);
  const blockers=[];
  if(!permissions.place||!permissions.cancel||!permissions.reduce)blockers.push({code:'permission',text:'Link this bot with Perps access on dreamDEX, then check again.'});
  if(wallet.margin.marginStatus!=='Healthy'||BigInt(wallet.margin.equity)<parseExact('1.5',18))blockers.push({code:'margin',text:'Your trading account needs healthy Perps margin of at least 1.5 test USDso.'});
  if(BigInt(gas)<parseExact('1.12',18))blockers.push({code:'gas',text:'Your bot needs at least 1.12 STT: 1 STT stays in reserve and the rest covers opening and closing.'});
  if(BigInt(position.size)!==0n||orders.length)blockers.push({code:'exposure',text:'This account already has a position or open orders. Manage them in dreamDEX before starting a new plan.'});
  return {owner,operator,chainId:50383,checkedAt:Date.now(),marketRules:{minimum:market.minQuantity,step:market.lotSize},permissions,equity:String(wallet.margin.equity),gas:String(gas),position:String(position.size),openOrders:orders.length,ready:blockers.length===0,blockers};
}
