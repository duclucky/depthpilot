import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExact, formatExact, planChild, createPlan, beginIntent, settleIntent, cancelRejectedIntent } from '../src/core.mjs';
const market = { baseDecimals: 3, quoteDecimals: 2, tickSize: '5', lotSize: '2', minQuantity: '4' };
const snapshot = { observedAt: 1000, markPriceOk: true, bids: [{ price: '1000', quantity: '100' }, { price: '990', quantity: '80' }], asks: [{ price: '1010', quantity: '100' }, { price: '1020', quantity: '100' }] };
const args = { market, snapshot, side: 'buy', bound: '1019', remaining: '200', maxChild: '80', participationBps: 2500, now: 2000, deadline: 20000, maxAgeMs: 5000 };
test('decimal parsing preserves precision and refuses silent rounding', () => {
  assert.equal(parseExact('0.000000000000000000000001', 24), 1n);
  assert.equal(formatExact(123456789123456789n, 18), '0.123456789123456789');
  assert.throws(() => parseExact('0.00001', 3), /precision/);
  assert.throws(() => parseExact('1e3', 3), /decimal/);
});
test('buy cap rounds inward and never includes depth above the cap', () => {
  const p = planChild(args);
  assert.equal(p.price, '1015'); assert.equal(p.quantity, '24');
  assert.equal(p.depthQuantity, '100'); assert.equal(p.expectedAveragePrice, '1010');
});
test('sell floor rounds inward, sorts bids and accounts for remaining quantity', () => {
  const p = planChild({ ...args, side: 'sell', bound: '991', remaining: '12' });
  assert.equal(p.price, '995'); assert.equal(p.quantity, '12');
});
test('stale book, stale mark, deadline and blocked capacity pause without orders', () => {
  assert.equal(planChild({ ...args, now: 7000 }).reason, 'stale-book');
  assert.equal(planChild({ ...args, snapshot: { ...snapshot, markPriceOk: false } }).reason, 'stale-mark');
  assert.equal(planChild({ ...args, deadline: 1000 }).reason, 'deadline');
  assert.equal(planChild({ ...args, capacity: { priceable: true, placeable: false, maxQuantity: '0', limitedBy: 'voucherBlocked' } }).reason, 'voucherBlocked');
  assert.equal(planChild({ ...args, capacity: { priceable: true, placeable: true, maxQuantity: '3' } }).reason, 'below-minimum');
});
test('plan only advances from confirmed fills and unresolved intent blocks another send', () => {
  const p = createPlan({ id: 'p1', target: '100', side: 'buy', bound: '1100', now: 1000, durationSec: 60 });
  beginIntent(p, { id: 'i1', quantity: '24', price: '1015' });
  assert.throws(() => beginIntent(p, { id: 'i2', quantity: '24' }), /unresolved/);
  settleIntent(p, { key: '0xabc', status: 'success', fills: [{ quantity: '10', price: '1010' }], gasCost: '123' });
  assert.equal(p.filled, '10'); assert.equal(p.remaining, '90');
  assert.equal(p.quoteNumerator, '10100');
  assert.equal(settleIntent(p, { key: '0xabc', status: 'success', fills: [{ quantity: '10', price: '1010' }] }), false);
  assert.equal(p.filled, '10');
  beginIntent(p, { id: 'i2', quantity: '24', price: '1015' });
  settleIntent(p, { key: '0xdef', status: 'reverted', fills: [{ quantity: '24', price: '1010' }], gasCost: '5' });
  assert.equal(p.filled, '10'); assert.equal(p.gasCost, '128');
});
test('out-of-bound or excessive fill cannot corrupt accounting; user rejection can release intent', () => {
  const p = createPlan({ id: 'p2', target: '20', side: 'sell', bound: '1000', now: 0, durationSec: 60 });
  beginIntent(p, { id: 'i1', quantity: '8', price: '1000' });
  assert.throws(() => settleIntent(p, { key: 'x', status: 'success', fills: [{ quantity: '9', price: '1000' }] }), /quantity/);
  assert.throws(() => settleIntent(p, { key: 'x', status: 'success', fills: [{ quantity: '4', price: '999' }] }), /bound/);
  assert.equal(p.filled, '0'); assert.ok(p.pending);
  cancelRejectedIntent(p, 'i1'); assert.equal(p.pending, null);
});
