import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, decodePlaceOrder, contractErrorsAbi } from '@somnia-chain/markets-sdk';
import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains';
import { createPublicClient, http, parseAbi, decodeFunctionData } from 'viem';
import { delegatedOrder, assertDelegatedOrder, readOperatorPermissions } from './delegation.mjs';
export const CHAIN_ID = 50383;
export const RPC = 'https://api.hideki2.infra.testnet.somnia.network';
export const EXPLORER = 'https://explorer.testnet.somnia.network/tokyo';
const bookAbi = parseAbi(['function getBookLevels(bool isBid,uint64 numLevels) view returns ((uint256 price,uint256 quantity)[])', 'function getOrderBookParameters() view returns (uint256,uint256,uint256)']);
const orderAbi = parseAbi(['function placeOrder(bool isBid,uint64 userData,uint256 price,uint256 quantity,uint64 expireTimestampNs,uint8 orderType,uint8 selfMatchingOption,address builder,uint96 builderFeeBpsTimes1k) payable returns (bool,uint128)']);
export const json = v => JSON.stringify(v, (_, x) => typeof x === 'bigint' ? String(x) : x);
export class Gateway {
  constructor() {
    this.sdk = new SomniaMarkets({ chain: hidekiTestnet, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql' });
    this.rpc = createPublicClient({ chain: hidekiTestnet, transport: http(RPC, { timeout: 12000, retryCount: 0 }) });
  }
  async markets() {
    if (this.rows && Date.now() - this.rowsAt < 60000) return this.rows;
    if (await this.rpc.getChainId() !== CHAIN_ID) throw new Error('Wrong RPC chain');
    const rows = await this.sdk.client.listPerpMarkets();
    this.rows = rows.filter(m => ['ETH', 'BTC'].includes(m.baseSymbol)); this.rowsAt = Date.now();
    return this.rows;
  }
  async market(symbol) {
    const m = (await this.markets()).find(m => m.baseSymbol === symbol);
    if (!m) throw new Error('Only discovered ETH/BTC perps are supported'); return m;
  }
  async snapshot(symbol) {
    const row = await this.market(symbol);
    const block = await this.rpc.getBlock();
    const [bids, asks, params, state] = await Promise.all([
      ...[true, false].map(isBid => this.rpc.readContract({ address: row.poolAddress, abi: bookAbi, functionName: 'getBookLevels', args: [isBid, 30n], blockNumber: block.number })),
      this.rpc.readContract({ address: row.poolAddress, abi: bookAbi, functionName: 'getOrderBookParameters', blockNumber: block.number }),
      this.sdk.client.getPerpState(row.poolAddress),
    ]);
    const market = { ...row, tickSize: String(params[0]), minQuantity: String(params[1]), lotSize: String(params[2]) };
    const snapshot = { bids, asks, markPrice: state.markPrice, markPriceOk: state.markPriceOk && Math.abs(Date.now() - Number(block.timestamp) * 1000) < 30000, observedAt: Date.now(), blockNumber: block.number, blockTimestamp: block.timestamp, source: 'live', depthLimit: 30 };
    return JSON.parse(json({ market, snapshot }));
  }
  async account(m, address, side, price) {
    const [capacity, margin, gas] = await Promise.all([
      this.sdk.client.getMaxPerpOrderSize({ pool: m.poolAddress, marginBank: m.marginBank, account: address, isBid: side === 'buy', price: BigInt(price), autoPull: false }),
      this.sdk.client.getMarginAccount(m.marginBank, address),
      this.rpc.getBalance({ address }),
    ]);
    return JSON.parse(json({ capacity, margin, gas }));
  }
  async wallet(address) {
    const m = await this.market('ETH');
    const [gas, margin, voucher] = await Promise.all([this.rpc.getBalance({ address }), this.sdk.client.getMarginAccount(m.marginBank, address), this.sdk.client.getPerpVoucherEligibility(m.marginBank, address)]);
    return JSON.parse(json({ address, gas, margin, voucher, chainId: CHAIN_ID }));
  }
  async unsigned(plan, child) {
    const executor = { chainId: CHAIN_ID, actor: plan.account, execute: async () => { throw new Error('Build-only executor cannot sign'); } };
    const trader = this.sdk.client.createTrader({ executor });
    const { order } = await trader.buildPlacePerpOrder({ pool: plan.market.poolAddress, isBid: plan.side === 'buy', price: BigInt(child.price), quantity: BigInt(child.quantity), orderType: 2, expireTimestampNs: BigInt(Math.floor(plan.deadline / 1000)) * 1000000000n, gas: 10000000n });
    const decoded = decodeFunctionData({ abi: orderAbi, data: order.data });
    const [isBid, , price, quantity, expiry, orderType] = decoded.args;
    if (order.chainId !== CHAIN_ID || order.to.toLowerCase() !== plan.market.poolAddress.toLowerCase() || order.value !== 0n || isBid !== (plan.side === 'buy') || price !== BigInt(child.price) || quantity !== BigInt(child.quantity) || orderType !== 2 || expiry > BigInt(plan.deadline) * 1000000n) throw new Error('Unsigned SDK order failed invariant checks');
    if (plan.side === 'buy' ? price > BigInt(plan.bound) : price < BigInt(plan.bound)) throw new Error('Encoded price exceeds user bound');
    return plan.operator?delegatedOrder(plan,order):order;
  }
  async operatorPermissions(pool,owner,operator){return readOperatorPermissions(this.rpc,pool,owner,operator);}
  async simulate(plan, order) {
    await this.rpc.call({ account: plan.operator||plan.account, to: order.to, data: order.data, value: 0n, gas: 10000000n });
    return { ok: true, at: Date.now(), note: 'eth_call only; state may change before inclusion' };
  }
  async browserFees(plan, order) {
    if (await this.rpc.getChainId() !== CHAIN_ID) throw new Error('Wrong RPC chain for browser signing');
    const signer=plan.operator||plan.account;
    const [estimated, gasPrice, nonce, balance] = await Promise.all([
      this.rpc.estimateGas({ account: signer, to: order.to, data: order.data, value: 0n, gas: 10000000n }),
      this.rpc.getGasPrice(),
      this.rpc.getTransactionCount({ address: signer, blockTag: 'pending' }),
      this.rpc.getBalance({ address: signer }),
    ]);
    const gasLimit = (estimated * 120n + 99n) / 100n;
    if (gasLimit > 10000000n) throw new Error('Estimated gas exceeds the browser testnet order limit');
    if (balance < gasLimit * gasPrice) throw new Error('Add Tokyo STT to this browser wallet for network fees');
    return { gasLimit: String(gasLimit), gasPrice: String(gasPrice), nonce };
  }
  async verifyTransaction(plan, hash, expected, expectedNonce) {
    if(plan.operator)assertDelegatedOrder(plan,expected);
    const tx = await this.rpc.getTransaction({ hash });
    if (tx.from.toLowerCase() !== (plan.operator||plan.account).toLowerCase() || tx.to?.toLowerCase() !== plan.market.poolAddress.toLowerCase() || tx.input !== expected.data || tx.value !== 0n || tx.nonce !== expectedNonce) throw new Error('Transaction does not match the stored intent and nonce');
    return tx;
  }
  async receipt(plan, hash, expected, expectedNonce) {
    const receipt = await this.rpc.getTransactionReceipt({ hash });
    await this.verifyTransaction(plan, hash, expected, expectedNonce);
    const decoded = receipt.status === 'success' ? decodePlaceOrder(receipt, plan.market.poolAddress) : { fills: [] };
    return JSON.parse(json({ key: hash, hash, status: receipt.status, blockNumber: receipt.blockNumber, orderId: decoded.orderId, fills: decoded.fills.map(f => ({ quantity: f.quantityFilled, price: f.fillPrice })), gasCost: receipt.gasUsed * receipt.effectiveGasPrice, source: 'live' }));
  }
  async close() { await this.sdk.close(); }
}
