// Financial quantities stay in raw integer units. Number is for time and display only.
export function parseExact(value, decimals) {
  const s = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error('Enter a plain non-negative decimal');
  const [whole, fraction = ''] = s.split('.');
  if (fraction.length > decimals) throw new Error(`Excess precision: at most ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
export function formatExact(value, decimals) {
  const n = BigInt(value), sign = n < 0n ? '-' : '', abs = n < 0n ? -n : n;
  if (!decimals) return `${n}`;
  const unit = 10n ** BigInt(decimals), fraction = String(abs % unit).padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${abs / unit}${fraction ? `.${fraction}` : ''}`;
}
const min = (...ns) => ns.reduce((a, b) => a < b ? a : b);
export function validateExecutionPolicy(policy) {
  if (!policy || !Number.isInteger(policy.maxSpreadBps) || policy.maxSpreadBps < 1 || policy.maxSpreadBps > 1000 || !Number.isInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 0 || policy.maxSlippageBps > 1000 || !Number.isInteger(policy.minIntervalSec) || policy.minIntervalSec < 1 || policy.minIntervalSec > 3600) throw Error('Invalid execution policy');
  return { maxSpreadBps: policy.maxSpreadBps, maxSlippageBps: policy.maxSlippageBps, minIntervalSec: policy.minIntervalSec };
}
export function planChild({ market, snapshot, side, bound, remaining, maxChild, participationBps = 2500, now = Date.now(), deadline, maxAgeMs = 15000, capacity, executionPolicy, arrivalPrice, receipts = [], pending, closingPositionSize }) {
  const constraints = {};
  const pause = (reason, extra = {}) => ({ executable: false, reason, quantity: '0', constraints, ...extra });
  if (executionPolicy) validateExecutionPolicy(executionPolicy);
  if (!['buy', 'sell'].includes(side)) throw new Error('Invalid side');
  if (pending) return pause('reconciliation-required');
  if (now >= deadline) return pause('deadline');
  if (now < snapshot.observedAt || now - snapshot.observedAt > maxAgeMs) return pause('stale-book');
  if (!snapshot.markPriceOk) return pause('stale-mark');
  if (BigInt(remaining) <= 0n) return pause('completed');
  const tick = BigInt(market.tickSize), lot = BigInt(market.lotSize), minimum = BigInt(market.minQuantity);
  if (tick <= 0n || lot <= 0n || minimum <= 0n) throw new Error('Invalid market grid');
  // A subminimum order is legal only when it closes the exact current position.
  // This context is supplied by the owned-cycle adapter, never by imported settings.
  const closing = closingPositionSize !== undefined;
  const position = closing ? BigInt(closingPositionSize) : 0n;
  const positionQuantity = position < 0n ? -position : position;
  if (closing) {
    if (position === 0n || (position > 0n ? side !== 'sell' : side !== 'buy') || BigInt(remaining) !== positionQuantity) return pause('closing-position-mismatch');
    if (positionQuantity % lot !== 0n) return pause('closing-position-off-lot');
    if (!capacity) return pause('closing-account-required');
  }
  if (!Number.isInteger(participationBps) || participationBps < 1 || participationBps > 10000) throw new Error('Invalid depth participation');
  let raw = BigInt(bound);
  if (executionPolicy) {
    const bid = BigInt(snapshot.bids[0]?.price || '0'), ask = BigInt(snapshot.asks[0]?.price || '0');
    if (bid <= 0n || ask <= 0n || ask < bid) return pause('invalid-book');
    constraints.spreadBps = formatExact((ask - bid) * 2000000n / (ask + bid),2);
    if ((ask - bid) * 20000n > BigInt(executionPolicy.maxSpreadBps) * (ask + bid)) return pause('spread-too-wide');
    if (!/^\d+$/.test(String(arrivalPrice)) || BigInt(arrivalPrice) <= 0n) throw Error('Invalid execution policy arrival price');
    const numerator = BigInt(arrivalPrice) * (10000n + (side === 'buy' ? 1n : -1n) * BigInt(executionPolicy.maxSlippageBps));
    const arrivalBound = side === 'buy' ? numerator / 10000n : (numerator + 9999n) / 10000n;
    constraints.arrivalBound = String(arrivalBound);
    raw = side === 'buy' ? min(raw, arrivalBound) : raw > arrivalBound ? raw : arrivalBound;
    const nextAt = (receipts.at(-1)?.confirmedAt ?? 0) + executionPolicy.minIntervalSec * 1000;
    if (receipts.length && now < nextAt) return pause('child-interval', { nextAt });
  }
  const price = side === 'buy' ? raw / tick * tick : (raw + tick - 1n) / tick * tick;
  if (price <= 0n) return pause('invalid-price');
  if (capacity && !capacity.priceable) return pause('stale-mark');
  const minimumExempt = closing && positionQuantity < minimum && BigInt(capacity.maxQuantity) >= positionQuantity;
  if (capacity && !capacity.placeable && !minimumExempt) return pause(capacity.limitedBy || 'account-blocked');
  const levels = (side === 'buy' ? snapshot.asks : snapshot.bids)
    .map(x => ({ price: BigInt(x.price), quantity: BigInt(x.quantity) }))
    .filter(x => x.price > 0n && x.quantity > 0n && (side === 'buy' ? x.price <= price : x.price >= price))
    .sort((a, b) => a.price === b.price ? 0 : (a.price < b.price ? -1 : 1) * (side === 'buy' ? 1 : -1));
  const depth = levels.reduce((a, x) => a + x.quantity, 0n);
  if (!depth) return pause('no-depth-in-bound');
  const ceiling = capacity ? BigInt(capacity.maxQuantity) : BigInt(remaining);
  const caps = { remaining: BigInt(remaining), 'child-cap': BigInt(maxChild), 'depth-participation': depth * BigInt(participationBps) / 10000n, ...(capacity?{'account-capacity':ceiling}:{}) };
  Object.assign(constraints, Object.fromEntries(Object.entries(caps).map(([k,v]) => [k,String(v)])), { effectiveBound: String(price), depthQuantity: String(depth) });
  const wanted = min(...Object.values(caps));
  let quantity = wanted / lot * lot;
  const limitingFactors = Object.entries(caps).filter(([,v]) => v === wanted).map(([k]) => k);
  if (executionPolicy && BigInt(remaining) < minimum) return pause('untradeable-remainder');
  if (executionPolicy && BigInt(remaining) > quantity && BigInt(remaining) - quantity < minimum) {
    quantity = (BigInt(remaining) - minimum) / lot * lot;
    limitingFactors.push('tradable-remainder');
  }
  if (quantity < minimum && !(minimumExempt && quantity === positionQuantity)) return pause('below-minimum');
  let left = quantity, numerator = 0n;
  const usedLevels = [];
  for (const l of levels) {
    const take = min(left, l.quantity); if (take <= 0n) break;
    numerator += take * l.price; left -= take;
    usedLevels.push({ price: String(l.price), quantity: String(take) });
  }
  return { executable: true, reason: 'ready', price: String(price), quantity: String(quantity), ...(closing ? { closingPositionSize: String(position) } : {}), depthQuantity: String(depth), expectedAveragePrice: String(numerator / quantity), expectedNotional: String(numerator / 10n ** BigInt(market.baseDecimals)), usedLevels, constraints, limitingFactors, accountChecked: Boolean(capacity), observedAt: snapshot.observedAt, blockNumber: snapshot.blockNumber };
}
export function createPlan({ id, target, side, bound, now = Date.now(), durationSec = 600, ...rest }) {
  if (rest.executionPolicy) rest.executionPolicy = validateExecutionPolicy(rest.executionPolicy);
  if (BigInt(target) <= 0n || BigInt(bound) <= 0n) throw new Error('Target and bound must be positive');
  if (!['buy', 'sell'].includes(side) || !Number.isFinite(durationSec) || durationSec < 30 || durationSec > 86400) throw new Error('Invalid plan parameters');
  return { ...rest, id, target: String(target), side, bound: String(bound), createdAt: now, deadline: now + durationSec * 1000, filled: '0', remaining: String(target), quoteNumerator: '0', gasCost: '0', pending: null, receipts: [], events: [], status: 'planned' };
}
export function beginIntent(plan, intent) {
  if (plan.pending) throw new Error('An unresolved intent must be reconciled first');
  if (BigInt(intent.quantity) <= 0n || BigInt(intent.quantity) > BigInt(plan.remaining)) throw new Error('Invalid child quantity');
  if (intent.price && (plan.side === 'buy' ? BigInt(intent.price) > BigInt(plan.bound) : BigInt(intent.price) < BigInt(plan.bound))) throw new Error('Child price exceeds plan bound');
  plan.pending = { ...intent, createdAt: Date.now() };
  plan.status = 'reconciliation-required';
}
export function settleIntent(plan, receipt) {
  if (plan.receipts.some(r => r.key === receipt.key)) return false;
  if (!plan.pending) throw new Error('No pending intent');
  if (!['success', 'reverted'].includes(receipt.status)) throw new Error('Unconfirmed receipt cannot settle');
  const fills = receipt.status === 'success' ? receipt.fills || [] : [];
  let quantity = 0n, numerator = 0n;
  for (const f of fills) {
    const q = BigInt(f.quantity), price = BigInt(f.price);
    if (q <= 0n || price <= 0n) throw new Error('Invalid fill quantity or price');
    if (plan.side === 'buy' ? price > BigInt(plan.bound) : price < BigInt(plan.bound)) throw new Error('Fill violated plan bound');
    quantity += q; numerator += q * price;
  }
  if (quantity > BigInt(plan.pending.quantity) || quantity > BigInt(plan.remaining)) throw new Error('Fill quantity exceeds child or plan');
  const entry = { ...receipt, fills, intentId: plan.pending.id, requested: plan.pending.quantity, filled: String(quantity), confirmedAt: Date.now() };
  plan.filled = String(BigInt(plan.filled) + quantity);
  plan.remaining = String(BigInt(plan.target) - BigInt(plan.filled));
  plan.quoteNumerator = String(BigInt(plan.quoteNumerator) + numerator);
  plan.gasCost = String(BigInt(plan.gasCost) + BigInt(receipt.gasCost || '0'));
  plan.receipts.push(entry); plan.pending = null;
  plan.status = BigInt(plan.remaining) === 0n ? 'completed' : 'paused';
  return true;
}
// Call only for a known pre-broadcast rejection. An ambiguous error must remain pending.
export function cancelRejectedIntent(plan, id) {
  if (!plan.pending || plan.pending.id !== id || plan.pending.hash) throw new Error('Cannot release a broadcast or different intent');
  plan.events.push({ type: 'rejected-before-broadcast', intentId: id, at: Date.now() });
  plan.pending = null; plan.status = 'paused';
}
