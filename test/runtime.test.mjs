import test from 'node:test';import assert from 'node:assert/strict';import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';import {join} from 'node:path';import {claimLock} from '../src/runtime.mjs';
test('concurrent lock acquisition has one owner and preserves a live owner',async()=>{
 const parent=fileURLToPath(new URL('../.cache/',import.meta.url));await mkdir(parent,{recursive:true});const directory=await mkdtemp(join(parent,'locks-')),path=join(directory,'worker.lock');
 const outcomes=await Promise.allSettled(Array.from({length:10},()=>claimLock(path)));const won=outcomes.filter(x=>x.status==='fulfilled');assert.equal(won.length,1);assert.equal(JSON.parse(await readFile(path,'utf8')).pid,process.pid);await assert.rejects(()=>claimLock(path),/already using/);await won[0].value();
 const again=await claimLock(path);await again();
});
