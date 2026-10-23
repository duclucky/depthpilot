import {resolve,join} from 'node:path';import {readFile} from 'node:fs/promises';import {spawnSync} from 'node:child_process';
import {privateKeyToAccount} from 'viem/accounts';import {keccak256} from 'viem';
import {GasBridge} from '../src/gas-bridge.mjs';import {claimLock,initializeHome} from '../src/runtime.mjs';
const [homeArg,action,id,confirmation]=process.argv.slice(2);if(!homeArg||!['status','quote','send'].includes(action))throw Error('Invalid gas action.');
const home=resolve(homeArg);await initializeHome(home);const release=await claimLock(join(home,'.data/gas-bridge.lock'));
try{
 const bridge=new GasBridge(home);
 const sign=async(transaction,address)=>{
  const encrypted=await readFile(join(home,'.wallet/key.dpapi'),'utf8');
  const command="$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($p))";
  const unlocked=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input:encrypted,encoding:'utf8',windowsHide:true});
  if(unlocked.status!==0)throw Error('Windows could not unlock the local bot.');
  let account;try{account=privateKeyToAccount(unlocked.stdout.trim());}catch{throw Error('The protected bot key could not be decoded.');}
  if(account.address.toLowerCase()!==address.toLowerCase())throw Error('The protected bot address did not match.');
  const serializedTransaction=await account.signTransaction(transaction);return {serializedTransaction,hash:keccak256(serializedTransaction)};
 };
 const result=action==='send'?await bridge.send(id,confirmation==='confirmed',sign):await bridge[action]();console.log(JSON.stringify({ok:true,result}));
}catch(e){console.log(JSON.stringify({ok:false,error:e.shortMessage?'The test network could not complete this check. Try again.':String(e.message).slice(0,300)}));process.exitCode=1;}
finally{await release();}
