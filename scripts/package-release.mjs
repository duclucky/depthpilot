import {readFile,writeFile,mkdir,readdir,lstat,copyFile} from 'node:fs/promises';import {join,dirname,relative,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {APP_VERSION} from '../src/runtime.mjs';
import {zipDirectory} from './zip.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),label=process.env.DEPTHPILOT_BUILD_LABEL||'candidate';if(!/^[a-zA-Z0-9-]+$/.test(label))throw Error('Invalid build label.');const out=join(root,'release',label);await mkdir(out,{recursive:true});
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(pkg.version!==APP_VERSION)throw Error('Synchronize the application and package versions first.');
const stamp=Date.now(),stage=join(root,'.cache',`release-${stamp}`),windows=join(stage,`DepthPilot-${pkg.version}`),source=join(stage,`depthpilot-source-${pkg.version}`);
await mkdir(windows,{recursive:true});await mkdir(source,{recursive:true});
const files=['package.json','package-lock.json','.gitignore','README.md','LICENSE','SECURITY.md','CONTRIBUTING.md','Open DepthPilot.bat','install.ps1'];
async function walk(folder,prefix=''){const rows=[];for(const entry of await readdir(folder,{withFileTypes:true})){const name=prefix+entry.name,info=await lstat(join(folder,entry.name));if(info.isSymbolicLink())throw Error('Symbolic links are not supported in a release.');if(info.isDirectory())rows.push(...await walk(join(folder,entry.name),name+'/'));else rows.push(name);}return rows;}
for(const folder of ['src','public','scripts','docs'])for(const name of await walk(join(root,folder)))files.push(folder+'/'+name);
for(const file of files){const data=await readFile(join(root,file));if(/C:[\\/]hackathon|BEGIN (?:RSA |EC )?PRIVATE KEY|0x[a-fA-F0-9]{64}["']/i.test(data.toString()))throw Error(`Unexpected private deployment material in ${file}`);for(const target of [windows,source]){await mkdir(dirname(join(target,file)),{recursive:true});await copyFile(join(root,file),join(target,file));}}
for(const folder of ['test','.github'])for(const name of await walk(join(root,folder))){await mkdir(dirname(join(source,folder,name)),{recursive:true});await copyFile(join(root,folder,name),join(source,folder,name));}
for(const name of await walk(join(root,'node_modules'))){await mkdir(dirname(join(windows,'node_modules',name)),{recursive:true});await copyFile(join(root,'node_modules',name),join(windows,'node_modules',name));}
await mkdir(join(windows,'runtime'),{recursive:true});
const shaText=await(await fetch(`https://nodejs.org/dist/${process.version}/SHASUMS256.txt`,{signal:AbortSignal.timeout(25000)})).text();
const runtimeHash=createHash('sha256').update(await readFile(process.execPath)).digest('hex');
const expected=shaText.split('\n').find(line=>line.trim().endsWith('win-x64/node.exe'))?.split(/\s+/)[0];
if(process.platform!=='win32'||process.arch!=='x64'||!expected||runtimeHash!==expected)throw Error('The Node runtime does not match the official Windows x64 checksum.');
await copyFile(process.execPath,join(windows,'runtime','node.exe'));await copyFile(join(dirname(process.execPath),'LICENSE'),join(windows,'runtime','LICENSE'));
const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8')),dependencies=[];let notices='DepthPilot third-party notices\n\nNode runtime: '+process.version+'; official SHA-256 '+runtimeHash+'\nSee runtime/LICENSE.\n';
for(const [location,entry] of Object.entries(lock.packages)){if(!location.startsWith('node_modules/'))continue;const name=location.slice('node_modules/'.length);dependencies.push({name,version:entry.version,license:entry.license||'See package notices',resolved:entry.resolved,integrity:entry.integrity});const packageDir=join(root,location);for(const f of await readdir(packageDir))if(/^(?:licen[cs]e|copying|notice)(?:[.\-_].*)?$/i.test(f)){if((await lstat(join(packageDir,f))).isFile())notices+='\n\n--- '+name+' '+entry.version+' / '+f+' ---\n'+await readFile(join(packageDir,f),'utf8');}}
await writeFile(join(windows,'THIRD-PARTY-NOTICES.txt'),notices);await writeFile(join(windows,'DEPENDENCIES.json'),JSON.stringify({runtime:{version:process.version,sha256:runtimeHash,source:`https://nodejs.org/dist/${process.version}/win-x64/node.exe`},dependencies},null,2)+'\n');
await writeFile(join(source,'THIRD-PARTY-NOTICES.txt'),notices);await writeFile(join(source,'DEPENDENCIES.json'),JSON.stringify({dependencies},null,2)+'\n');
const inventory=[];for(const name of await walk(windows)){const b=await readFile(join(windows,name));inventory.push({path:name,size:b.length,sha256:createHash('sha256').update(b).digest('hex')});}
await writeFile(join(windows,'release.json'),JSON.stringify({app:'depthpilot',version:pkg.version,schema:1,platform:'windows-x64',files:inventory},null,2)+'\n');
const sums=[];
for(const [folder,name] of [[windows,`DepthPilot-${pkg.version}-windows-x64.zip`],[source,`depthpilot-${pkg.version}-source.zip`]]){
 const archive=join(out,name);try{await lstat(archive);throw Error('An archive already exists; preserve it and use a new build output directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
 await zipDirectory(folder,folder===windows?`DepthPilot-${pkg.version}`:`depthpilot-source-${pkg.version}`,archive);sums.push(createHash('sha256').update(await readFile(archive)).digest('hex')+'  '+name);
}
await writeFile(join(out,'SHA256SUMS.txt'),sums.join('\n')+'\n');console.log(JSON.stringify({version:pkg.version,stage,windows,source,files:inventory.length,dependencies:dependencies.length,archives:sums},null,2));
