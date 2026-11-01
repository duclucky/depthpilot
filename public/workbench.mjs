const $ = id => document.getElementById(id);
const text = (id, value) => { $(id).textContent = value; };
const node = (tag, content, className) => {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
};
const short = value => `${value.slice(0, 8)}…${value.slice(-6)}`;
const when = value => Number.isFinite(value) ? new Date(value).toLocaleString() : 'Not recorded';
const percent = bps => bps === null ? '—' : `${(Number(bps) / 100).toFixed(4).replace(/\.?0+$/, '')}%`;
const title = kind => kind === 'roundtrip' ? 'Buy & close rounds' : kind === 'buy' ? 'Buy ETH in smaller orders' : 'Sell ETH in smaller orders';
function exact(raw, places = 6) {
  const value = BigInt(raw), negative = value < 0n, digits = String(negative ? -value : value).padStart(19, '0');
  const fraction = digits.slice(-18).slice(0, places).replace(/0+$/, '');
  return `${negative ? '-' : ''}${digits.slice(0, -18)}${fraction ? '.' + fraction : ''}`;
}
function rows(id, items) {
  $(id).replaceChildren(...items.map(([label, value]) => {
    const row = node('div'); row.append(node('dt', label), node('dd', value)); return row;
  }));
}
function download(filename, content, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], {type}));
  const link = node('a'); link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export function initializeWorkbench({api, busy, message, applySettings, friendly}) {
  let preview = null, marketBusy = false, marketData = null;
  let offset = 0, report = null, reportId = null, journalCursor = 0, historyEpoch = 0;
  let reportBusy = false, historyBusy = false, journalBusy = null;

  function renderBook(id, levels) {
    const shown = levels.slice(0, 8), max = shown.reduce((value, level) => BigInt(level.quantity) > value ? BigInt(level.quantity) : value, 1n);
    $(id).replaceChildren(...shown.map(level => {
      const li = node('li'), line = node('div', undefined, 'depth-values');
      const price = node('span', exact(level.price, 3)), quantity = node('strong', exact(level.quantity, 6));
      line.append(price, quantity);
      const bar = node('progress'); bar.max = 1000; bar.value = Number(BigInt(level.quantity) * 1000n / max);
      bar.setAttribute('aria-label', `${exact(level.quantity, 9)} ETH at ${exact(level.price, 6)} USDso`);
      li.append(line, bar); return li;
    }));
    if (!shown.length) $(id).append(node('li', 'No visible orders.'));
  }
  function renderMarket(data) {
    marketData = data; $('market-error').hidden = true;
    text('market-source', data.fresh ? 'LIVE TOKYO · READ ONLY' : 'STALE SNAPSHOT · WAIT');
    text('market-freshness', `Block ${data.snapshot.blockNumber} · observed ${when(data.snapshot.observedAt)} · refreshes every 10 seconds while open.`);
    text('market-ask', data.snapshot.asks[0] ? exact(data.snapshot.asks[0].price, 3) + ' USDso' : 'No offers');
    text('market-bid', data.snapshot.bids[0] ? exact(data.snapshot.bids[0].price, 3) + ' USDso' : 'No bids');
    text('market-spread', data.spreadBps === null ? 'Unavailable' : percent(data.spreadBps));
    text('market-rules', `Minimum ${exact(data.market.minQuantity, 9)} ETH · step ${exact(data.market.lotSize, 9)} ETH · price tick ${exact(data.market.tickSize, 9)} USDso. Snapshot age at response: ${(data.ageMs / 1000).toFixed(1)} sec.`);
    renderBook('book-bids', data.snapshot.bids); renderBook('book-asks', data.snapshot.asks);
  }
  async function refreshMarket() {
    if (marketBusy) return;
    marketBusy = true; $('view-market').setAttribute('aria-busy', 'true');
    try { renderMarket(await api('market')); }
    catch {
      preview = null; $('lab-result').hidden = true;
      text('market-source', 'MARKET UNAVAILABLE');
      text('market-error', 'The market could not be refreshed. Try again shortly. Any prices below are from the last successful snapshot; no preview can start a trade.');
      $('market-error').hidden = false;
      text('market-freshness', marketData ? `Last successful observation: ${when(marketData.snapshot.observedAt)}. This is not a fresh quote.` : 'No market snapshot is available.');
    } finally { marketBusy = false; $('view-market').removeAttribute('aria-busy'); }
  }
  $('refresh-market').addEventListener('click', () => busy($('refresh-market'), refreshMarket));
  $('lab-side').addEventListener('change', () => text('lab-price-label', $('lab-side').value === 'sell' ? 'Minimum sell price (test USDso)' : 'Maximum buy price (test USDso)'));
  $('lab-form').addEventListener('input', () => { preview = null; $('lab-result').hidden = true; });
  $('lab-form').addEventListener('submit', event => {
    event.preventDefault();
    busy($('preview-sizing'), async () => {
      preview = null; $('lab-result').hidden = true;
      const data = await api('preview', Object.fromEntries(new FormData(event.target)));
      renderMarket(data); preview = data; const child = data.child;
      text('lab-verdict', child.executable ? `${exact(child.quantity, 9)} ETH in the next order.` : 'The bot would wait.');
      text('lab-explanation', child.executable ? `At this size, the total would take about ${data.estimatedChildren} orders if conditions stayed the same. The actual bot recalculates after every fill.` : friendly({action:'wait', reason:child.reason}));
      const reasons = {'depth-participation':'25% of available depth', 'child-cap':'Your per-order limit', remaining:'Remaining target', 'tradable-remainder':'Keeping the remainder tradeable'};
      rows('lab-metrics', [
        ['Total target', data.quantity + ' ETH'], ['Price limit', data.bound + ' USDso'],
        ['Next order', child.executable ? exact(child.quantity, 9) + ' ETH' : 'None'],
        ['Estimated average price', child.executable ? exact(child.expectedAveragePrice, 6) + ' USDso' : '—'],
        ['Sizing reason', child.executable ? child.limitingFactors.map(reason => reasons[reason] || reason).join(', ') : child.reason],
        ['Account, fees & access', 'Not checked in preview']
      ]);
      $('lab-result').hidden = false;
      $('lab-use').hidden = !child.executable;
      $('lab-result').scrollIntoView({behavior:'smooth', block:'nearest'});
    });
  });
  $('lab-use').addEventListener('click', () => {
    if (!preview?.child.executable) return;
    applySettings({kind:preview.side,quantity:preview.quantity,maxChild:preview.maxChild,price:preview.bound,maxSpreadBps:5,slippageBps:10});
    message('Preview inputs copied. Choose your budgets, finish setup and review before trading.');
  });

  $('starter-plan').addEventListener('click', () => {
    applySettings({kind:'roundtrip',quantity:'0.004',maxNotional:'40',maxGas:'0.12',cycles:1,intervalMinutes:5,holdSeconds:20,maxSpreadBps:5,slippageBps:10});
    message('One small round selected. These are editable test settings, not trading permission.');
  });
  $('save-settings').addEventListener('click', () => busy($('save-settings'), async () => {
    const template = await api('templates/export', Object.fromEntries(new FormData($('plan-form'))));
    download('depthpilot-settings.json', JSON.stringify(template, null, 2));
    message('Settings saved. The file contains no wallet, key or trading permission.');
  }));
  $('load-settings').addEventListener('click', () => $('settings-file').click());
  $('settings-file').addEventListener('change', async () => {
    const file = $('settings-file').files[0]; if (!file) return;
    try {
      if (file.size > 12000) throw Error('Choose a small DepthPilot settings file, not a profile or backup.');
      const template = JSON.parse(await file.text());
      const {settings} = await api('templates/import', template);
      applySettings(settings); message('Settings loaded. Review every limit and your account before starting a new plan.');
    } catch (error) { message(error instanceof SyntaxError ? 'This is not a valid JSON settings file.' : error.message, true); }
    finally { $('settings-file').value = ''; }
  });

  async function loadHistory(reset = true) {
    if (historyBusy) return; historyBusy = true;
    try {
      if (reset) { offset = 0; $('history-list').replaceChildren(); }
      const page = await api('history?offset=' + offset); offset = page.nextOffset;
      for (const run of page.runs) {
        const card = node('a', undefined, 'panel session-card'); card.href = '#history/' + run.id;
        card.append(node('span', run.status, 'badge'), node('h2', title(run.kind)), node('p', when(run.createdAt), 'small'));
        card.append(node('p', `${run.metrics.confirmedOrders} confirmed · ${run.metrics.gasSTT} STT used`));
        card.append(node('p', run.pending ? 'Unresolved transaction — inspect the report.' : run.liveProof ? 'Saved live receipts · View report →' : 'Saved session · View report →', 'small'));
        $('history-list').append(card);
      }
      text('history-count', `${page.total} saved session${page.total === 1 ? '' : 's'} · showing ${offset}.`);
      $('history-empty').hidden = page.total !== 0; $('more-history').hidden = offset >= page.total;
    } finally { historyBusy = false; }
  }
  $('refresh-history').addEventListener('click', () => busy($('refresh-history'), () => loadHistory()));
  $('more-history').addEventListener('click', () => busy($('more-history'), () => loadHistory(false)));
  function metric(label, value) { const item = node('div'); item.append(node('span', label), node('strong', value)); return item; }
  function renderReport(data) {
    report = data; const m = data.metrics;
    text('report-source', data.liveProof ? 'SAVED LIVE RECEIPTS · TOKYO' : 'SAVED SESSION · NO LIVE PROOF');
    text('report-title', title(data.kind) + ' · ' + data.status);
    text('report-time', `Started ${when(data.createdAt)} · last saved ${when(data.updatedAt)} · v${data.version}`);
    const warning = data.pending ? 'This run has an unresolved transaction. A stop or saved report does not prove the account is flat.' : data.ownedPositionETH && data.ownedPositionETH !== '0' ? `${data.ownedPositionETH} ETH remains in the saved bot-owned position. Check the actual account before trading again.` : data.kind !== 'roundtrip' ? 'A target plan keeps its resulting position. Completed does not mean flat.' : null;
    $('report-attention').hidden = !warning; if (warning) text('report-attention', warning);
    $('report-metrics').replaceChildren(
      metric('Confirmed fills / requested size', percent(m.fillRateBps)),
      metric('Bought / ETH', m.buyQuantity), metric('Sold / ETH', m.sellQuantity),
      metric(m.gasComplete ? 'Confirmed gas / STT' : 'Known gas / STT · incomplete', m.gasSTT), metric('Buy average / USDso', m.buyVWAP ?? '—'),
      metric('Sell average / USDso', m.sellVWAP ?? '—'),
      metric(data.kind === 'roundtrip' ? 'Rounds finished' : 'Target completion', data.kind === 'roundtrip' ? String(m.rounds) : percent(m.completionBps)),
      metric('Orders still unconfirmed', String(m.unresolvedOrders))
    );
    text('report-note', data.note + (m.arrivalSlippageBps !== null ? ` Arrival slippage: ${m.arrivalSlippageBps} bps.` : '') + ` Unresolved fee reservation: ${m.reservedGasSTT} STT.`);
    $('report-transactions').replaceChildren(...data.transactions.map(transaction => {
      const tr = node('tr');
      for (const value of [`${transaction.side} · ${transaction.status}`, `${transaction.filledETH} / ${transaction.requestedETH}`, transaction.averagePrice ?? '—', transaction.gasSTT ?? (transaction.status === 'unconfirmed' ? 'Unconfirmed' : 'Not recorded')]) tr.append(node('td', value));
      const td = node('td'), link = node('a', short(transaction.hash) + ' ↗'); link.href = transaction.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', 'View transaction ' + transaction.hash); td.append(link); tr.append(td); return tr;
    }));
    if (!data.transactions.length) { const tr = node('tr'), td = node('td', 'No submitted orders saved for this run.'); td.colSpan = 5; tr.append(td); $('report-transactions').append(tr); }
  }
  async function loadJournal(epoch) {
    if (journalBusy === epoch) return; journalBusy = epoch;
    try {
      const data = await api('history/activity?id=' + reportId + '&after=' + journalCursor);
      if (epoch !== historyEpoch) return;
      for (const event of data.entries) {
        const li = node('li'), time = node('time', when(event.at));
        li.append(time, node('strong', friendly(event)));
        if (/^0x[0-9a-f]{64}$/i.test(event.hash || '')) { const link = node('a', 'View transaction ' + short(event.hash) + ' ↗'); link.href = 'https://explorer.testnet.somnia.network/tokyo/tx/' + event.hash; link.target = '_blank'; link.rel = 'noopener noreferrer'; li.append(link); }
        const details = node('details'); details.append(node('summary', 'Technical details'), node('pre', JSON.stringify(event, null, 2))); li.append(details);
        $('report-activity').append(li);
      }
      journalCursor = data.nextCursor;
      text('report-activity-count', `Showing ${journalCursor} of ${data.total} saved decisions.`);
      $('more-report-activity').hidden = journalCursor >= data.total;
    } finally { if (journalBusy === epoch) journalBusy = null; }
  }
  async function loadReport(id, epoch) {
    report = null; reportId = id; journalCursor = 0; $('report-activity').replaceChildren();
    const data = await api('report?id=' + encodeURIComponent(id));
    if (epoch !== historyEpoch) return;
    renderReport(data); $('session-report').hidden = false;
    await loadJournal(epoch);
  }
  $('refresh-report').addEventListener('click', () => busy($('refresh-report'), async () => {
    if (reportBusy || !reportId) return; reportBusy = true;
    try { await loadReport(reportId, ++historyEpoch); } finally { reportBusy = false; }
  }));
  $('more-report-activity').addEventListener('click', () => busy($('more-report-activity'), () => loadJournal(historyEpoch)));
  $('reuse-settings').addEventListener('click', () => busy($('reuse-settings'), async () => {
    if (!report) return;
    const template = await api('history/template?id=' + report.id); applySettings(template.settings);
    message('Settings copied into a new draft. No plan was restarted and no permission was carried over.');
  }));
  $('download-session-settings').addEventListener('click', () => busy($('download-session-settings'), async () => {
    if (!report) return;
    download('depthpilot-settings.json', JSON.stringify(await api('history/template?id=' + report.id), null, 2));
  }));
  $('download-report').addEventListener('click', () => {
    if (!report) return; const r = report, m = r.metrics;
    const lines = ['# DepthPilot session report', '', `Session: ${r.id}`, `Version: ${r.version}`, `Started: ${new Date(r.createdAt).toISOString()}`, `Saved: ${new Date(r.updatedAt).toISOString()}`, `Status: ${r.status}`, `Saved live receipts: ${r.liveProof ? 'yes' : 'not established'}`, '', `Bought: ${m.buyQuantity} ETH; average ${m.buyVWAP ?? 'unavailable'} USDso`, `Sold: ${m.sellQuantity} ETH; average ${m.sellVWAP ?? 'unavailable'} USDso`, `Known confirmed gas: ${m.gasSTT} STT; complete: ${m.gasComplete}`, `Unconfirmed orders: ${m.unresolvedOrders}`, `Pending hash: ${r.pending ?? 'none saved'}`, `Saved bot-owned position: ${r.ownedPositionETH ?? 'target plans retain their resulting position'}`, '', r.note, '', '## Transactions', '', '| Action | Result | Filled ETH | Requested ETH | Average USDso | Gas STT | Receipt |', '| --- | --- | --- | --- | --- | --- | --- |', ...r.transactions.map(t => `| ${t.side} | ${t.status} | ${t.filledETH} | ${t.requestedETH} | ${t.averagePrice ?? '—'} | ${t.gasSTT ?? (t.status === 'unconfirmed' ? 'unconfirmed' : 'not recorded')} | [${t.hash}](${t.url}) |`), '', 'This export excludes wallet addresses, keys, calldata and trading authority. Public hashes can reveal accounts on the explorer.'];
    download('depthpilot-report-' + r.id + '.md', lines.join('\n'), 'text/markdown');
  });
  $('download-html-report').addEventListener('click', () => busy($('download-html-report'), async () => {
    if (!report) return;
    const id=report.id,response=await fetch('/api/report.html?id='+encodeURIComponent(id));
    if(!response.ok)throw Error('The HTML report could not be prepared. Refresh this session and try again.');
    download('depthpilot-report-'+id+'.html',await response.text(),'text/html');
    message('HTML report saved. Open it directly in a browser, even offline. Public transaction links can reveal account activity.');
  }));
  return {
    async route(name) {
      const epoch = ++historyEpoch;
      if (name === 'market') await refreshMarket();
      if (name === 'history') {
        const id = location.hash.split('/')[1];
        $('view-history').classList.toggle('has-report', Boolean(id));
        $('history-library').hidden = Boolean(id); $('session-report').hidden = true;
        if (id) await loadReport(id, epoch); else await loadHistory();
      }
    },
    poll() { if (location.hash === '#market') return refreshMarket(); }
  };
}
