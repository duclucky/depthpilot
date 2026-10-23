import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from 'viem';
export const OPERATOR_SELECTORS=Object.freeze({place:'0x80054449',cancel:'0xe37b444b',reduce:'0x364c2587'});
export const OPERATOR_ABI=parseAbi([
  'function placeOrderFor(address owner,bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool,uint128)',
  'function isOperatorAuthorized(address owner,address operator,bytes4 selector) view returns (bool)',
]);
const selfAbi=parseAbi(['function placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96) payable returns (bool,uint128)']);
export function botIdentity(config){
  const owner=getAddress(config.account);
  let operator=owner;
  if(config.operator!==undefined){
    try{operator=getAddress(config.operator)}catch{throw Error('Invalid bot operator identity')}
    if(operator===owner)throw Error('Owner and operator must be distinct');
  }
  return {owner,operator,delegated:config.operator!==undefined};
}
export function delegatedOrder(plan,unsigned){
  const {owner,operator}=botIdentity(plan);
  if(!plan.operator)throw Error('Delegated order requires an operator');
  const decoded=decodeFunctionData({abi:selfAbi,data:unsigned.data});
  const result={...unsigned,owner,operator,functionName:'placeOrderFor',description:`Perps order for ${owner}, signed by operator ${operator}`,data:encodeFunctionData({abi:OPERATOR_ABI,functionName:'placeOrderFor',args:[owner,...decoded.args]})};
  assertDelegatedOrder(plan,result);return result;
}
export function assertDelegatedOrder(plan,unsigned){
  const {owner,operator,delegated}=botIdentity(plan);
  if(!delegated||unsigned.owner?.toLowerCase()!==owner.toLowerCase()||unsigned.operator?.toLowerCase()!==operator.toLowerCase())throw Error('Delegated owner/operator identity mismatch');
  const {functionName,args}=decodeFunctionData({abi:OPERATOR_ABI,data:unsigned.data});
  if(functionName!=='placeOrderFor')throw Error('Unsupported delegated function');
  const [encodedOwner,isBid,,price,quantity,expiry,orderType,selfMatch,builder,builderFee]=args;
  if(unsigned.chainId!==50383||unsigned.to?.toLowerCase()!==plan.market.poolAddress.toLowerCase()||BigInt(unsigned.value)!==0n||encodedOwner.toLowerCase()!==owner.toLowerCase()||isBid!==(plan.side==='buy')||quantity<=0n||orderType!==2||selfMatch!==0||BigInt(builder)!==0n||builderFee!==0n||expiry>BigInt(plan.deadline)*1000000n)throw Error('Delegated owner or encoded order invariant mismatch');
  if(plan.side==='buy'?price>BigInt(plan.bound):price<BigInt(plan.bound))throw Error('Delegated order exceeds price bound');
  if(plan.target!==undefined&&quantity>BigInt(plan.target))throw Error('Delegated quantity exceeds plan target');
  if(plan.maxChild!==undefined&&quantity>BigInt(plan.maxChild))throw Error('Delegated quantity exceeds child cap');
  return {owner,operator,quantity,price};
}
export async function readOperatorPermissions(rpc,pool,owner,operator){
  const results=await Promise.all(Object.entries(OPERATOR_SELECTORS).map(async([key,selector])=>[key,await rpc.readContract({address:pool,abi:OPERATOR_ABI,functionName:'isOperatorAuthorized',args:[getAddress(owner),getAddress(operator),selector]})]));
  return Object.fromEntries(results);
}
