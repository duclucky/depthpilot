import test from 'node:test';
import assert from 'node:assert/strict';
import {copyInstallCommand} from '../site/onboarding.mjs';

test('copy returns the complete installation text without executing it', async () => {
  const text = '& {\n  Write-Host "Example only"\n}';
  const writes = [];
  const result = await copyInstallCommand(text, {writeText: async value => writes.push(value)});
  assert.deepEqual(writes, [text]);
  assert.equal(result.ok, true);
});

test('clipboard denial keeps a readable manual-copy instruction', async () => {
  const result = await copyInstallCommand('command', {writeText: async () => {throw Error('Permission denied');}});
  assert.equal(result.ok, false);
  assert.match(result.message, /select.*copy/i);
  assert.doesNotMatch(result.message, /Permission denied/);
});

test('unsupported clipboard does not pretend that the command was copied', async () => {
  const result = await copyInstallCommand('command', undefined);
  assert.equal(result.ok, false);
  assert.match(result.message, /select.*copy/i);
});
