import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { Journal } from '../src/journal.mjs';
import { createPlan, beginIntent, settleIntent } from '../src/core.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
test('pending transaction survives a fresh journal and concurrent duplicate receipts count once', async () => {
  const parent = fileURLToPath(new URL('../.data/', import.meta.url));
  const { mkdir } = await import('node:fs/promises'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'test-'));
  try {
    const first = new Journal(dir);
    const p = createPlan({ id: 'persist', target: '100', side: 'buy', bound: '1100', durationSec: 60 });
    beginIntent(p, { id: 'once', quantity: '20', price: '1050', hash: '0xtx' });
    await first.save(p);
    const restarted = new Journal(dir);
    assert.equal((await restarted.get('persist')).pending.hash, '0xtx');
    const receipt = { key: '0xtx', status: 'success', fills: [{ quantity: '15', price: '1040' }] };
    await Promise.all([1, 2].map(() => restarted.update('persist', p => settleIntent(p, receipt))));
    const done = await restarted.get('persist');
    assert.equal(done.filled, '15'); assert.equal(done.receipts.length, 1); assert.equal(done.pending, null);
    await assert.rejects(() => restarted.update('persist', p => { p.filled = '90'; throw new Error('rollback'); }), /rollback/);
    assert.equal((await restarted.get('persist')).filled, '15');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
