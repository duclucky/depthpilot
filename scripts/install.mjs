import {readFile,writeFile,mkdir,copyFile,rename,lstat} from 'node:fs/promises';import {join,resolve,relative,dirname,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';import {createHash,randomUUID} from 'node:crypto';import {spawnSync,spawn} from 'node:child_process';
const source=dirname(dirname(fileURLToPath(import.meta.url))),args=process.argv.slice(2),index=args.indexOf('--destination');
const destination=resolve(index>=0?args[index+1]:join(process.env.LOCALAPPDATA,'DepthPilot','app'));
const inventory=JSON.parse(await readFile(join(source,'release.json'),'utf8'));
if(inventory.app!=='depthpilot'||inventory.schema!==1||inventory.platform!=='windows-x64'||!Array.isArray(inventory.files)||!inventory.files.length||!/^\d+\.\d+\.\d+$/.test(inventory.version))throw Error('This is not a supported DepthPilot release.');
const existing=async path=>{try{return await readFile(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
if(destination===source||destination===resolve(source,'..')||destination===dirname(destination))throw Error('Choose a separate per-user installation folder.');
const marker=await existing(join(destination,'.depthpilot-install'));
if(!marker){try{await lstat(destination);throw Error('That folder already exists and is not a DepthPilot installation. Choose an empty new folder.');}catch(e){if(e.code!=='ENOENT')throw e;}}
else if(marker.trim()!=='DepthPilot schema 1')throw Error('Unknown installation folder.');
// Copy only entries in the manifest. Never traverse paths or adopt runtime data from an archive.
const names=new Set();for(const file of inventory.files){if(typeof file.path!=='string'||file.path.includes('\\')||file.path.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p)||/[. ]$/.test(p)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))||isAbsolute(file.path)||/^(?:\.wallet|\.data|profiles|\.cache)\//.test(file.path)||names.has(file.path.toLowerCase()))throw Error('Unsafe release entry.');names.add(file.path.toLowerCase());const info=await lstat(join(source,file.path));if(!info.isFile()||info.isSymbolicLink())throw Error('Unexpected release file.');const bytes=await readFile(join(source,file.path));if(bytes.length!==file.size||createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw Error('The download is incomplete or has changed. Download a verified copy again.');}
for(const required of ['runtime/node.exe','src/server.mjs','scripts/worker.mjs','scripts/launch.vbs','scripts/launch.mjs','Open DepthPilot.bat'])if(!names.has(required.toLowerCase()))throw Error('The download is missing a required application file.');
const home=resolve(process.env.DEPTHPILOT_HOME||join(process.env.LOCALAPPDATA,'DepthPilot','profiles','default'));
const instanceText=await existing(join(home,'.data','instance.json'));
if(instanceText){const instance=JSON.parse(instanceText);try{process.kill(instance.pid,0);throw Error('DepthPilot is still open. Stop your plan, close the local app, and try installing again.');}catch(e){if(e.code!=='ESRCH')throw e;}}
await mkdir(join(destination,'versions'),{recursive:true});
if(!marker)await writeFile(join(destination,'.depthpilot-install'),'DepthPilot schema 1\n',{flag:'wx'});
const versionRoot=join(destination,'versions',inventory.version),already=await existing(join(versionRoot,'release.json'));
if(already&&createHash('sha256').update(already).digest('hex')!==createHash('sha256').update(await readFile(join(source,'release.json'))).digest('hex'))throw Error('This version is already installed with different contents. Use a new version number.');
if(!already){const stage=join(destination,'versions','.stage-'+randomUUID());await mkdir(stage);for(const file of inventory.files){await mkdir(dirname(join(stage,file.path)),{recursive:true});await copyFile(join(source,file.path),join(stage,file.path));}await copyFile(join(source,'release.json'),join(stage,'release.json'));await rename(stage,versionRoot);}
await mkdir(join(destination,'scripts'),{recursive:true});await copyFile(join(versionRoot,'Open DepthPilot.bat'),join(destination,'Open DepthPilot.bat'));await copyFile(join(versionRoot,'scripts','launch.vbs'),join(destination,'scripts','launch.vbs'));
await writeFile(join(destination,'.depthpilot-install'),'DepthPilot schema 1\n');await writeFile(join(destination,'current.txt.tmp'),inventory.version+'\n');await rename(join(destination,'current.txt.tmp'),join(destination,'current.txt'));
if(!args.includes('--no-shortcut')){
 const vbs=join(destination,'scripts','create-shortcut.vbs');await copyFile(join(versionRoot,'scripts','create-shortcut.vbs'),vbs);
 const result=spawnSync('cscript.exe',['//nologo',vbs,destination],{windowsHide:true,encoding:'utf8'});if(result.status!==0)console.log('Installed. You can open Open DepthPilot.bat from the installation folder.');
}
console.log('DepthPilot is installed. Open "Open DepthPilot.bat" whenever you want to return.');
if(!args.includes('--no-launch')){const child=spawn('wscript.exe',[join(destination,'scripts','launch.vbs')],{windowsHide:true,detached:true,stdio:'ignore'});child.unref();}
