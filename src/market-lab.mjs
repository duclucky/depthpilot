import {parseExact,formatExact,planChild} from './core.mjs';
const positive=(value,name,max)=>{const raw=parseExact(String(value??''),18);if(raw<=0n||raw>parseExact(max,18))throw Error(`Check ${name}; maximum ${max} ETH.`);return raw;};
export class MarketLab {
 constructor(gateway,now=Date.now){this.gateway=gateway;this.now=now;}
 async inspect(){
  if(!this.cached||this.now()-this.cachedAt>=10000){
   if(!this.inflight)this.inflight=(async()=>{const data=await this.gateway.snapshot('ETH');this.cached=data;this.cachedAt=this.now();return data;})().finally(()=>{this.inflight=null;});
   await this.inflight;
  }
  const {market:m,snapshot:s}=this.cached;
  const market=Object.fromEntries(['baseDecimals','quoteDecimals','baseSymbol','poolAddress','tickSize','minQuantity','lotSize'].map(key=>[key,m[key]]));
  if(market.baseDecimals!==18||market.quoteDecimals!==18)throw Error('This preview currently requires the ETH market with 18-decimal base and quote units.');
  const levels=rows=>rows.slice(0,30).map(x=>({price:String(x.price),quantity:String(x.quantity)}));
  const blockAge=this.now()-Number(s.blockTimestamp)*1000;
  const snapshot={source:'live',observedAt:s.observedAt,blockNumber:String(s.blockNumber),blockTimestamp:String(s.blockTimestamp),markPrice:String(s.markPrice),markPriceOk:Boolean(s.markPriceOk)&&Number.isFinite(blockAge)&&Math.abs(blockAge)<30000,bids:levels(s.bids),asks:levels(s.asks)};
  const bid=BigInt(snapshot.bids[0]?.price||0),ask=BigInt(snapshot.asks[0]?.price||0);
  return {source:'live',chainId:50383,market,snapshot,ageMs:this.now()-s.observedAt,fresh:this.now()>=s.observedAt&&this.now()-s.observedAt<15000&&snapshot.markPriceOk,spreadBps:bid>0n&&ask>=bid?formatExact((ask-bid)*2000000n/(ask+bid),2):null,accountChecked:false};
 }
 async preview(input){
  if(!['buy','sell'].includes(input?.side))throw Error('Choose buy or sell.');
  const quantity=positive(input.quantity,'total amount','1'),maxChild=positive(input.maxChild,'amount per order','0.004');
  if(maxChild>quantity)throw Error('Amount per order cannot exceed the total.');
  const data=await this.inspect(),{market,snapshot}=data,lot=BigInt(market.lotSize),minimum=BigInt(market.minQuantity);
  if([quantity,maxChild].some(n=>n<minimum||n%lot!==0n))throw Error(`Use the market minimum ${formatExact(minimum,18)} ETH and step ${formatExact(lot,18)} ETH.`);
  const arrival=BigInt((input.side==='buy'?snapshot.asks:snapshot.bids)[0]?.price||0);
  if(arrival<=0n)throw Error('There is no executable market side to preview.');
  const bound=input.price?parseExact(String(input.price),18):input.side==='buy'?arrival*10010n/10000n:(arrival*9990n+9999n)/10000n;
  if(bound<=0n)throw Error('Enter a positive price limit.');
  const child=planChild({market,snapshot,side:input.side,bound:String(bound),remaining:String(quantity),maxChild:String(maxChild),participationBps:2500,now:this.now(),deadline:this.now()+600000,arrivalPrice:String(arrival),executionPolicy:{maxSpreadBps:5,maxSlippageBps:10,minIntervalSec:10}});
  return {...data,side:input.side,quantity:formatExact(quantity,18),maxChild:formatExact(maxChild,18),bound:formatExact(bound,18),child,estimatedChildren:child.executable?Number((quantity+BigInt(child.quantity)-1n)/BigInt(child.quantity)):null,note:'Estimate from one live snapshot. Account capacity, permission, fees and future fills are not checked. No order is sent.'};
 }
}
