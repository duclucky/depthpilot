import { formatExact } from './core.mjs';
// Arrival is the best executable side when the plan was saved; not an unexecuted hypothetical profit.
export function executionReport(plan) {
  const filled=BigInt(plan.filled),arrival=BigInt(plan.arrivalPrice||0),numerator=BigInt(plan.quoteNumerator);
  const adverse=(plan.side==='buy'?1n:-1n)*(numerator-filled*arrival);
  return {filled:plan.filled,remaining:plan.remaining,completionBps:String(filled*10000n/BigInt(plan.target)),averagePrice:filled?String(numerator/filled):null,arrivalPrice:arrival?String(arrival):null,adverseSlippageBps:filled&&arrival?formatExact(adverse*1000000n/(filled*arrival),2):null,shortfallQuote:filled&&arrival?String(adverse/10n**BigInt(plan.market.baseDecimals)):null,gasSTT:formatExact(plan.gasCost,18),confirmedChildren:plan.receipts.length,source:plan.source,note:'Positive slippage means worse than arrival; gas is separate in STT. Partial fills cover executed quantity only.'};
}
