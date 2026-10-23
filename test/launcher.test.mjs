import test from 'node:test';import assert from 'node:assert/strict';import {mkdir,mkdtemp,copyFile,writeFile,readFile} from 'node:fs/promises';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
test('installed hidden launcher reads an LF version file and starts Node from a path containing spaces',{skip:process.platform!=='win32'},async()=>{
 const parent=fileURLToPath(new URL('../.cache/',import.meta.url));await mkdir(parent,{recursive:true});const dir=await mkdtemp(join(parent,'launcher with spaces '));
 await mkdir(join(dir,'scripts'));const version=join(dir,'versions','0.2.0');await mkdir(join(version,'runtime'),{recursive:true});await mkdir(join(version,'scripts'));
 await copyFile(process.execPath,join(version,'runtime','node.exe'));await copyFile(fileURLToPath(new URL('../scripts/launch.vbs',import.meta.url)),join(dir,'scripts','launch.vbs'));
 await writeFile(join(dir,'current.txt'),'0.2.0\n');await writeFile(join(version,'scripts','launch.mjs'),"import fs from 'node:fs';fs.writeFileSync(new URL('../launched.txt',import.meta.url),'started');");
 await promisify(execFile)('cscript.exe',['//nologo',join(dir,'scripts','launch.vbs')],{windowsHide:true,timeout:8000});assert.equal(await readFile(join(version,'launched.txt'),'utf8'),'started');
});
