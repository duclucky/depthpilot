import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { keccak256 } from 'viem';
import { planChild, parseExact } from '../src/core.mjs';
import { TokyoBotGateway, botGasEnvelope } from '../src/bot-gateway.mjs';
import { BotRunner, botConfigDigest } from '../src/bot-runner.mjs';
import { normalizePlan } from '../src/plan-config.mjs';
import { decideBot, initialBotState } from '../src/autopilot-policy.mjs';

const raw = value => String(parseExact(value, 18));
const owner = '0x1111111111111111111111111111111111111111';
const operator = '0x3333333333333333333333333333333333333333';
const market = { poolAddress: '0xd6cb1dd58580b84d76068ac21594219ce03aeddf', baseDecimals: 18, quoteDecimals: 18,
  tickSize: raw('0.01'), lotSize: raw('0.0001'), minQuantity: raw('0.004') };
function closeArgs() {
  const now = Date.now();
  return { market, snapshot: { observedAt: now, markPriceOk: true, bids: [{ price: raw('2400'), quantity: raw('1') }], asks: [{ price: raw('2400.1'), quantity: raw('1') }] },
    side: 'sell', bound: raw('2399'), remaining: raw('0.001'), maxChild: raw('0.001'), closingPositionSize: raw('0.001'),
    participationBps: 2500, now, deadline: now + 60000,
    capacity: { priceable: true, placeable: false, maxQuantity: raw('0.001'), limitedBy: 'restricted' } };
}
test('an exact owned residual close can clear only the minimum-size gate', () => {
  const args = closeArgs(), result = planChild(args);
  assert.equal(result.executable, true);
  assert.equal(result.quantity, raw('0.001'));
  assert.equal(result.closingPositionSize, raw('0.001'));
  assert.equal(planChild({ ...args, closingPositionSize: undefined }).executable, false);
  assert.equal(planChild({ ...args, capacity: { ...args.capacity, maxQuantity: '0' } }).executable, false);
  assert.equal(planChild({ ...args, capacity: { ...args.capacity, priceable: false } }).executable, false);
});
test('a residual exception cannot grow/flip exposure, round up, use a partial dust order or ignore depth', () => {
  const args = closeArgs();
  for (const change of [
    { side: 'buy' }, { remaining: raw('0.0005') }, { remaining: raw('0.002') },
    { remaining: raw('0.00105'), closingPositionSize: raw('0.00105') },
    { snapshot: { ...args.snapshot, bids: [{ price: raw('2400'), quantity: raw('0.002') }] } },
    { bound: raw('2401') },
  ]) assert.equal(planChild({ ...args, ...change }).executable, false);
  const short = planChild({ ...args, side: 'buy', bound: raw('2401'), closingPositionSize: '-1000000000000000' });
  assert.equal(short.executable, true);
  assert.equal(short.quantity, raw('0.001'));
});
test('an owned close may make a minimum-sized partial child within the original depth participation', () => {
  const args = closeArgs();
  const result = planChild({ ...args, remaining: raw('0.008'), maxChild: raw('0.008'), closingPositionSize: raw('0.008'),
    capacity: { priceable: true, placeable: true, maxQuantity: raw('0.008') },
    snapshot: { ...args.snapshot, bids: [{ price: raw('2400'), quantity: raw('0.016') }] } });
  assert.equal(result.executable, true); assert.equal(result.quantity, raw('0.004'));
});

async function fixture() {
  const config = { ...JSON.parse(await readFile(new URL('./fixtures/bot.continuous.config.json', import.meta.url), 'utf8')),
    account: owner, operator, maxCycles: 1, maxTransactions: 4, closeOrderSlots: 3 };
  const adapter = new TokyoBotGateway(config, 'fixture-no-key'), g = adapter.gateway;
  let position = 0n, partial = true, signed = 0;
  g.snapshot = async () => ({ market, snapshot: { observedAt: Date.now(), blockTimestamp: Math.floor(Date.now() / 1000), blockNumber: '100', markPriceOk: true,
    bids: [{ price: raw('2400'), quantity: raw('1') }], asks: [{ price: raw('2400.1'), quantity: raw('1') }] } });
  g.wallet = async () => ({ gas: '0', margin: { equity: raw('1000'), marginStatus: 'Healthy' } });
  g.account = async (_market, _account, side) => ({ capacity: { priceable: true, placeable: side === 'buy' || position >= BigInt(market.minQuantity),
    maxQuantity: side === 'buy' ? raw('1') : String(position), limitedBy: 'collateral' } });
  g.sdk.client.getPerpPosition = async () => ({ size: position });
  g.sdk.client.getOwnOpenOrdersOnchain = async () => [];
  g.operatorPermissions = async () => ({ place: true, cancel: true, reduce: true });
  g.rpc = { getChainId: async () => 50383, request: async () => '50000259', getBalance: async () => BigInt(raw('8')),
    estimateGas: async () => 1000000n, getGasPrice: async () => 1000000000n, getTransactionCount: async () => 0, call: async () => ({}) };
  const actualSign = order => TokyoBotGateway.prototype.sign.call(adapter, order);
  adapter.sign = async () => { signed++; const serializedTransaction = `0x${signed.toString(16).padStart(2, '0')}`; return { serializedTransaction, hash: keccak256(serializedTransaction) }; };
  adapter.broadcast = async order => order.hash;
  adapter.receipt = async order => {
    const quantity = order.action === 'close' && partial ? BigInt(raw('0.003')) : BigInt(order.quantity);
    if (order.action === 'close') partial = false;
    position += order.action === 'open' ? quantity : -quantity;
    return { key: order.hash, hash: order.hash, status: 'success', blockNumber: '100', gasCost: raw('0.001'), fills: [{ quantity: String(quantity), price: raw('2400') }] };
  };
  return { config, adapter, actualSign, setPosition: value => { position = BigInt(value); }, get signed() { return signed; } };
}
test('actual adapter and controller reconcile a partial exit then prepare the exact residual without a second entry', async () => {
  const f = await fixture();
  try {
    const run = new BotRunner({ config: f.config, adapter: f.adapter, live: true, persist: async () => {}, savePlan: async () => {},
      authority: async () => ({ configDigest: botConfigDigest(f.config), untilStopped: true, userAuthorization: 'controlled offline regression' }) });
    await run.tick(); run.state.stopRequested = true;
    await run.tick(); assert.equal(run.state.cycle.quantity, raw('0.001'));
    await run.tick(); assert.equal(run.state.cycle, null);
    assert.equal(run.state.cycles, 1); assert.equal(run.state.orders.length, 3);
    assert.equal(run.state.orders[2].quantity, raw('0.001'));
    assert.equal(run.state.orders.filter(order => order.action === 'open').length, 1);
    await run.tick(); assert.equal(run.state.status, 'stopped');
  } finally { await f.adapter.close(); }
});
test('an observed position change blocks closing before any local key is opened', async () => {
  const f = await fixture();
  try {
    f.setPosition(raw('0.004'));
    const now = Date.now();
    const order = await f.adapter.prepare('close', { status: 'holding', orders: [], stopRequested: true,
      cycle: { quantity: raw('0.004'), openedAt: now }, hardDeadline: null, exitDeadline: now + 120000 });
    f.setPosition(raw('0.003'));
    await assert.rejects(() => f.actualSign(order), /closing position changed/i);
  } finally { await f.adapter.close(); }
});
test('higher gas headroom remains capped by the selected closing reserve and reviewed total budget', async () => {
  const f = await fixture();
  try {
    const g = f.adapter.gateway;
    g.rpc.estimateGas = async request => { assert.equal(request.gas, 30000000n); return 12000000n; };
    const quote = await g.browserFees({ account: owner, operator }, { to: market.poolAddress, data: '0x' });
    assert.equal(quote.gasLimit, '14400000');
    assert.equal(botGasEnvelope(quote, { closeGasReserveSTT: '0.06' }, 'close').gasLimit, '28800000');
    assert.throws(() => botGasEnvelope({ gasLimit: '12000000', gasPrice: '6000000000' }, { closeGasReserveSTT: '0.06' }, 'close'), /reserve/);
  } finally { await f.adapter.close(); }
  const input = { kind: 'roundtrip', quantity: '0.004', intervalMinutes: 5, holdSeconds: 20, cycles: 1, maxNotional: '40', maxGas: '0.6' };
  const review = normalizePlan(input, { owner, operator });
  assert.equal(review.config.closeGasReserveSTT, '0.3'); assert.equal(review.config.maxTransactions, 4);
  assert.equal(normalizePlan({ ...input, maxGas: '0.12' }, { owner, operator }).config.closeGasReserveSTT, '0.06');
});
test('new round reviews reserve closing order slots without increasing the cumulative 600-order ceiling', () => {
  const input = { kind: 'roundtrip', quantity: '0.004', intervalMinutes: 5, holdSeconds: 20, cycles: 1, maxNotional: '40', maxGas: '0.12' };
  const { config } = normalizePlan(input, { owner, operator });
  const now = Date.now(), state = initialBotState(config, now);
  state.orders = Array.from({ length: 2 }, () => ({ notional: '0', receipt: { gasCost: '0' } }));
  const observation = { at: now, chainId: 50383, position: '0', openOrders: [], equity: raw('1000'), gasBalance: raw('8'),
    marginStatus: 'Healthy', markPriceOk: true, blockTimestamp: Math.floor(now / 1000), bid: raw('2400'), ask: raw('2400.1'), minQuantity: raw('0.004'), lotSize: raw('0.0001') };
  assert.equal(decideBot(config, state, observation, now).reason, 'entry-exit-budget');
  assert.equal(normalizePlan({ ...input, cycles: 300, maxGas: '6', maxNotional: '6000' }, { owner, operator }).config.maxTransactions, 600);
});
