import {randomUUID} from 'node:crypto';
import {getAddress} from 'viem';
import {parseExact} from './core.mjs';
import {validateBotConfig} from './autopilot-policy.mjs';
const amount=(value,name,max)=>{if(typeof value!=='string'||!/^\d+(\.\d+)?$/.test(value))throw Error(`Enter ${name} as a positive number.`);const n=parseExact(value,18);if(n<=0n||(max&&n>parseExact(max,18)))throw Error(`Check ${name}${max?`; maximum ${max}`:''}.`);return value;};
const integer=(value,name,min,max)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error(`${name} must be between ${min} and ${max}.`);return n;};
export function normalizePlan(input,identity){
  const account=getAddress(identity.owner),operator=getAddress(identity.operator);
  if(account===operator||BigInt(account)===0n||BigInt(operator)===0n)throw Error('Your trading account and local bot must be different addresses.');
  const kind=input.kind;if(!['roundtrip','buy','sell'].includes(kind))throw Error('Choose how your bot should trade.');
  const quantity=amount(input.quantity,'ETH amount',kind==='roundtrip'?'0.004':'1');
  const maxNotional=amount(input.maxNotional,'total trading limit','6000'),maxGas=amount(input.maxGas,'fees budget','6');
  if(parseExact(maxGas,18)<parseExact('0.12',18))throw Error('Allow at least 0.12 STT for opening and closing fees.');
  const guards={maxSpreadBps:integer(input.maxSpreadBps??5,'Maximum spread',1,20),slippageBps:integer(input.slippageBps??10,'Price tolerance',1,50)};
  const id=randomUUID();
  if(kind==='roundtrip'){
    const cycles=integer(input.cycles,'Number of rounds',1,300);
    const config=validateBotConfig({runId:id,continuous:true,chainId:50383,account,operator,symbol:'ETH',durationSec:null,closeGraceSec:120,pollSec:5,entryIntervalSec:integer(input.intervalMinutes,'Time between entries',1,30)*60,holdSec:integer(input.holdSeconds,'Holding time',5,120),maxCycles:cycles,maxTransactions:cycles*2,quantity,maxNotional,maxGasSTT:maxGas,maxGasPriceGwei:'10',closeGasReserveSTT:'0.06',minNativeReserveSTT:'1',...guards,participationBps:2500,stopEquityDeclineUSDso:'0.25',minEntryEquityUSDso:'1.5'});
    return {id,kind,config,maxGas,maxNotional,quantity};
  }
  const maxChild=amount(input.maxChild,'amount per order','0.004');
  if(parseExact(maxChild,18)>parseExact(quantity,18))throw Error('Amount per order cannot exceed the total ETH amount.');
  const price=amount(input.price,'price limit');
  return {id,kind:'finite',quantity,maxGas,maxNotional,maxOrders:integer(input.maxOrders,'Order limit',1,600),terms:{side:kind,target:String(parseExact(quantity,18)),maxChild:String(parseExact(maxChild,18)),bound:String(parseExact(price,18)),durationSec:integer(input.minutes,'Time limit',1,60)*60,executionPolicy:{maxSpreadBps:guards.maxSpreadBps,maxSlippageBps:guards.slippageBps,minIntervalSec:10}}};
}
