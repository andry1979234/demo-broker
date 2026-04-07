const chartContainer = document.getElementById('chart');
chartContainer.style.width = '100%';
chartContainer.style.height = '360px';

const chart = LightweightCharts.createChart(chartContainer, { layout: { background: { color: '#ffffff' }, textColor: '#000' } });
const candleSeries = chart.addCandlestickSeries();

async function loadCandles(){
  const res = await fetch('/api/candles?limit=200');
  const data = await res.json();
  const mapped = data.map(c=>({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
  candleSeries.setData(mapped);
}

loadCandles();
setInterval(loadCandles, 1000);

const tradesList = document.getElementById('trades');

async function fetchTrades(){
  const res = await fetch('/api/trades');
  const data = await res.json();
  tradesList.innerHTML = '';
  data.slice().reverse().forEach(t=>{
    const li = document.createElement('li');
    const expSec = Math.max(0, Math.round((t.expiresAt - Date.now())/1000));
    li.textContent = `${t.type.toUpperCase()} ${t.amount} — open ${t.openPrice} — status ${t.status || 'open'} ${t.status==='open' ? `(exp ${expSec}s)` : `-> close ${t.closePrice} payout ${t.payout}`}`;
    tradesList.appendChild(li);
  });
}

setInterval(fetchTrades, 1000);
fetchTrades();

document.getElementById('buy').addEventListener('click', ()=>openTrade('buy'));
document.getElementById('sell').addEventListener('click', ()=>openTrade('sell'));

async function openTrade(type){
  const amount = parseFloat(document.getElementById('amount').value || '1');
  const expiry = parseInt(document.getElementById('expiry').value || '5');
  await fetch('/api/trade', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ type, amount, expiry }) });
  fetchTrades();
}
