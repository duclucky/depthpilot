import {mkdir,readFile,open,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {atomicJSON} from './segmented-log.mjs';
export const APP_VERSION='0.2.2';
export function runtimeHome(){return resolve(process.env.DEPTHPILOT_HOME||join(process.env.LOCALAPPDATA||join(homedir(),'.local','share'),'DepthPilot','profiles','default'));}
export async function initializeHome(home){for(const dir of ['.data','.data/runs','.data/plans','.wallet','logs'])await mkdir(join(home,dir),{recursive:true});}
export async function readJSON(path,fallback){try{return JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function writeJSON(path,value){await atomicJSON(path,value);}
export function isAlive(pid){if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){if(e.code==='ESRCH')return false;throw e;}}
export async function claimLock(path){
  let guard;try{guard=await open(path+'.guard','wx');}catch(e){if(e.code==='EEXIST')throw Error('DepthPilot is already using this profile. Reopen its dashboard.');throw e;}
  try{
    const record=await readJSON(path,null);
    if(record){if(isAlive(record.pid))throw Error('DepthPilot is already using this profile. Reopen its dashboard.');await unlink(path);}
    const file=await open(path,'wx');await file.writeFile(JSON.stringify({pid:process.pid,startedAt:Date.now()}));await file.close();
    return async()=>{const current=await readJSON(path,null);if(current?.pid===process.pid)await unlink(path);};
  }finally{await guard.close();await unlink(path+'.guard');}
}
