import {normalizePlan} from './plan-config.mjs';
import {formatExact} from './core.mjs';
// Validation only: these fixed distinct identifiers never create a wallet, plan authority or transaction.
const validationIdentity={owner:'0x1111111111111111111111111111111111111111',operator:'0x3333333333333333333333333333333333333333'};
const fields=['kind','quantity','maxNotional','maxGas','cycles','intervalMinutes','holdSeconds','maxChild','price','minutes','maxOrders','maxSpreadBps','slippageBps'];
export function planTemplate(input){
 const d=normalizePlan(input,validationIdentity),settings={kind:d.kind==='roundtrip'?'roundtrip':d.terms.side,quantity:d.quantity,maxNotional:d.maxNotional,maxGas:d.maxGas};
 if(d.kind==='roundtrip')Object.assign(settings,{cycles:d.config.maxCycles,intervalMinutes:d.config.entryIntervalSec/60,holdSeconds:d.config.holdSec,maxSpreadBps:d.config.maxSpreadBps,slippageBps:d.config.slippageBps});
 else Object.assign(settings,{maxChild:formatExact(d.terms.maxChild,18),price:formatExact(d.terms.bound,18),minutes:d.terms.durationSec/60,maxOrders:d.maxOrders,maxSpreadBps:d.terms.executionPolicy.maxSpreadBps,slippageBps:d.terms.executionPolicy.maxSlippageBps});
 return {app:'depthpilot',schema:1,network:'tokyo-50383',settings};
}
export function readTemplate(input){
 if(!input||input.app!=='depthpilot'||input.schema!==1||input.network!=='tokyo-50383'||Object.keys(input).some(k=>!['app','schema','network','settings'].includes(k))||!input.settings||Object.keys(input.settings).some(k=>!fields.includes(k)))throw Error('Use a DepthPilot settings file for Tokyo. Wallets, keys and authorization are not accepted in settings.');
 return planTemplate(input.settings).settings;
}
export function templateFromDraft(d){
 return planTemplate({kind:d.kind==='roundtrip'?'roundtrip':d.terms.side,quantity:d.quantity,maxNotional:d.maxNotional,maxGas:d.maxGas,...(d.kind==='roundtrip'?{cycles:d.config.maxCycles,intervalMinutes:d.config.entryIntervalSec/60,holdSeconds:d.config.holdSec,maxSpreadBps:d.config.maxSpreadBps,slippageBps:d.config.slippageBps}:{maxChild:formatExact(d.terms.maxChild,18),price:formatExact(d.terms.bound,18),minutes:d.terms.durationSec/60,maxOrders:d.maxOrders,maxSpreadBps:d.terms.executionPolicy?.maxSpreadBps,slippageBps:d.terms.executionPolicy?.maxSlippageBps})});
}
