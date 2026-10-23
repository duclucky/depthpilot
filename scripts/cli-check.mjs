import {spawnSync} from 'node:child_process';
const result=spawnSync(process.env.DREAMDEX_CLI||'dreamdex',['markets','--testnet','--json'],{windowsHide:true,encoding:'utf8',timeout:30000});
if(result.error||result.status!==0){console.error('Optional dreamDEX diagnostics could not run. See docs/architecture.md for the official CLI installation link.');process.exitCode=1;}
else{const data=JSON.parse(result.stdout);if(!Array.isArray(data.markets)||!data.markets.length)throw Error('The official CLI returned no markets.');console.log(JSON.stringify({command:'dreamdex markets --testnet --json',markets:data.markets.map(m=>m.symbol),scope:'Official CLI spot diagnostics on its configured testnet; Tokyo Perps execution uses the SDK.'},null,2));}
