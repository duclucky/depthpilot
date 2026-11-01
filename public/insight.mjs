const $=id=>document.getElementById(id);
const text=(id,value)=>{$(id).textContent=value;};
const when=value=>Number.isFinite(value)?new Date(value).toLocaleString():'Not recorded';
const age=ms=>ms<120000?Math.floor(ms/1000)+' seconds':ms<7200000?Math.floor(ms/60000)+' minutes':Math.floor(ms/3600000)+' hours '+Math.floor(ms/60000)%60+' minutes';
const amount=raw=>{try{const n=BigInt(raw),negative=n<0n,s=String(negative?-n:n).padStart(19,'0'),f=s.slice(-18).replace(/0+$/,'');return (negative?'-':'')+s.slice(0,-18)+(f?'.'+f:'');}catch{return 'Not recorded';}};
function rows(id,items){$(id).replaceChildren(...items.map(([label,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);return row;}));}
const issues={
 'permission-missing':'Perps permission is missing for this market.',
 'low-gas':'Bot gas is below the setup minimum. An actual plan can need more for its closing allowance.',
 'margin-needs-attention':'Perps margin is not healthy enough for a new entry.',
 'open-orders':'Open orders are present. Review them on dreamDEX.',
 'position-mismatch':'The observed position differs from the saved bot-owned position.',
 'nonce-unavailable':'The bot’s transaction count could not be checked.',
 'operator-has-pending-nonce':'The bot address has a transaction that has not reached the latest confirmed count.',
 'saved-pending-transaction':'The plan has a saved transaction to reconcile. No resend was performed.',
 'different-plan-version':'This plan was created by another app version. It will not be resumed from this screen.',
 'authority-not-current':'The local trading permission is missing, revoked or no longer valid.',
 'stop-requested':'A stop request is saved. This check does not cancel it.',
};
export function initializeInsight({api,busy,message}){
 let currentRun=null,epoch=0;
 return {
  async refresh(snapshot){
   const runId=snapshot.run?.id||null;
   if(runId!==currentRun){currentRun=runId;$('diagnosis-result').hidden=true;text('diagnosis-status','Reads the account and pending receipt. It does not trade, restart or change your limits.');}
   if(location.hash!=='#run')return;
   const request=++epoch;
   try{
    const view=await api('insight');if(request!==epoch||view.runId&&view.runId!==currentRun)return;
    text('insight-title',view.title);text('insight-next',view.next);
    rows('insight-facts',view.facts.map(item=>[item.label,item.value]));
    text('insight-age',view.savedAt===null?'No decision observation recorded.':`Saved ${when(view.savedAt)} · ${view.ageMs===null?'clock could not be verified':age(view.ageMs)+' old'}.`);
    text('insight-wait',view.wait?`${view.wait.lowerBound?'Observed for at least':'Current reason observed for'} ${age(view.wait.durationMs)}, since ${when(view.wait.since)}. This records decisions, not uninterrupted uptime.`:'No continuous waiting interval established from saved decisions.');
    $('insight-wait').hidden=!view.wait;
   }catch{text('insight-title','Saved decision could not be read');text('insight-next','Try refreshing Activity. The data below may be older.');rows('insight-facts',[]);$('insight-wait').hidden=true;text('insight-age','Freshness unavailable.');}
  },
  bind(){
   $('check-diagnosis').addEventListener('click',()=>busy($('check-diagnosis'),async()=>{
    $('diagnosis-result').hidden=true;text('diagnosis-status','Checking Tokyo account, transaction counts and any saved pending receipt…');
    try{
     const data=await api('diagnosis');
     if(data.runId!==currentRun){text('diagnosis-status','The current plan changed. Refresh Activity and check again.');return;}
     text('diagnosis-title',data.title);text('diagnosis-next',data.next);text('diagnosis-status',`Checked ${when(data.checkedAt)} · read only · no restart or resend.`);
     const a=data.current;
     rows('diagnosis-facts',[
      ['Local trading permission',data.authority],['Saved stop request',data.stopRequested?'Present':'None recorded'],
      ...(a?[
       ['Network','Tokyo · '+a.chainId],['Position at check',amount(a.position)+' ETH'],['Open orders',String(a.openOrders)],
       ['Equity at check',amount(a.equity)+' test USDso'],['Bot gas at check',amount(a.gas)+' STT'],
       ['Market access',Object.values(a.permissions).every(Boolean)?'Perps granted':'Incomplete'],
       ['Transaction counts · confirmed / pending',`${a.latestNonce??'Unknown'} / ${a.pendingNonce??'Unknown'}`],
      ]:[]),...(data.receipt?[['Pending receipt check',data.receipt.status]]:[]),
     ]);
     $('diagnosis-issues').replaceChildren(...data.issues.map(code=>{const li=document.createElement('li');li.textContent=issues[code]||'The account check could not finish.';return li;}));
     text('diagnosis-note',data.note||'This observation cannot start a plan.');$('diagnosis-result').hidden=false;
    }catch(error){text('diagnosis-status','The check could not finish. No action was taken.');message(error.message,true);}
   }));
  },
 };
}
