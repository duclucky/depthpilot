import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts';
import {mkdir,writeFile,access} from 'node:fs/promises';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {readJSON,claimLock} from '../src/runtime.mjs';
const home=resolve(process.argv[2]||'');if(!process.argv[2])throw Error('A profile directory is required.');
await mkdir(join(home,'.wallet'),{recursive:true});
const release=await claimLock(join(home,'.wallet','create.lock'));
try{
 let wallet=await readJSON(join(home,'.wallet','public.json'),null);
 if(!wallet){
  try{await access(join(home,'.wallet','key.dpapi'));throw Error('A protected key already exists. Recover this profile before creating another bot.');}catch(e){if(e.code!=='ENOENT')throw e;}
  if(process.platform!=='win32')throw Error('This release protects keys with Windows. Use a Windows PC.');
  const key=generatePrivateKey(),address=privateKeyToAccount(key).address;
  const command="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $secret=[Console]::In.ReadToEnd().Trim(); $bytes=[Text.Encoding]::UTF8.GetBytes($secret); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))";
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:key,encoding:'utf8',windowsHide:true,timeout:15000});
  if(result.status!==0||!result.stdout.trim())throw Error('Windows could not protect your bot key. Nothing was activated.');
  await writeFile(join(home,'.wallet','key.dpapi'),result.stdout.trim(),{flag:'wx',mode:0o600});
  wallet={address,chainId:50383,createdAt:new Date().toISOString()};
  await writeFile(join(home,'.wallet','public.json'),JSON.stringify(wallet)+'\n',{flag:'wx',mode:0o600});
 }
 console.log(JSON.stringify(wallet));
}finally{await release();}
