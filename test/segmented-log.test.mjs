import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,appendFile} from 'node:fs/promises';
import {join,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SegmentedLog,readSegmentedLog} from '../src/segmented-log.mjs';
test('segmented history pages across rotation and recovers a crashed final append without resetting sequence',async t=>{
 const base=fileURLToPath(new URL('../.cache/tests/',import.meta.url));await mkdir(base,{recursive:true});const dir=await mkdtemp(join(base,'segments-'));
 t.after(async()=>{const p=relative(base,dir);if(!p||p.startsWith('..')||isAbsolute(p))throw Error('Unsafe cleanup');await rm(dir,{recursive:true,force:true});});
 const log=new SegmentedLog(dir,'bot-log-test',3);assert.equal(await log.open(),0);
 for(let i=1;i<=7;i++)await log.append({sequence:i});
 assert.equal(log.index.segments.length,3);
 const page=await readSegmentedLog(dir,log.indexName,2,4);assert.deepEqual(page.entries.map(e=>e.sequence),[3,4,5,6]);assert.equal(page.nextCursor,6);assert.equal(page.total,7);
 await appendFile(join(dir,log.index.segments.at(-1).name),'{"sequence":8');
 const restored=new SegmentedLog(dir,'bot-log-test',3);assert.equal(await restored.open(),7);await restored.append({sequence:8});
 assert.deepEqual((await readSegmentedLog(dir,log.indexName,0,100)).entries.map(e=>e.sequence),[1,2,3,4,5,6,7,8]);
});
