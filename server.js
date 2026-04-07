const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// In-memory candles and trades (demo only)
let candles = [];
let trades = [];

function rand(min, max){ return Math.random() * (max - min) + min }

function initCandles(){
  let price = 100;
  const now = Math.floor(Date.now()/1000);
  for(let i=200;i>0;i--){
    const open = price;
    const close = +(open * (1 + rand(-0.02, 0.02))).toFixed(4);
    const high = Math.max(open, close) * (1 + Math.abs(rand(0, 0.008)));
    const low = Math.min(open, close) * (1 - Math.abs(rand(0, 0.008)));
    candles.push({ time: now - i, open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close });
    price = close;
  }
}

initCandles();

// Generate new candle every second (demo)
setInterval(()=>{
  const last = candles[candles.length-1];
  const open = last.close;
  const close = +(open * (1 + rand(-0.01, 0.01))).toFixed(4);
  const high = Math.max(open, close) * (1 + Math.abs(rand(0, 0.005)));
  const low = Math.min(open, close) * (1 - Math.abs(rand(0, 0.005)));
  candles.push({ time: Math.floor(Date.now()/1000), open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close });
  if(candles.length>1000) candles.shift();
}, 1000);

app.get('/api/candles', (req, res)=>{
  const limit = parseInt(req.query.limit) || 200;
  res.json(candles.slice(-limit));
});

app.get('/api/trades', (req, res)=>{
  res.json(trades);
});

app.post('/api/trade', (req, res)=>{
  const { userId = 'demo', type, amount = 1, expiry = 5 } = req.body;
  const last = candles[candles.length-1];
  const openPrice = last.close;
  const id = Date.now() + '-' + Math.floor(Math.random()*1000);
  const createdAt = Date.now();
  const expiresAt = createdAt + expiry*1000;
  const trade = { id, userId, type, amount, openPrice, createdAt, expiresAt, status: 'open' };
  trades.push(trade);

  setTimeout(()=>{
    const current = candles[candles.length-1].close;
    let win = false;
    if(type === 'buy') win = current > openPrice;
    else if(type === 'sell') win = current < openPrice;
    const payout = win ? +(amount * 1.8).toFixed(4) : 0; // demo payout 80%
    trade.status = win ? 'win' : 'lose';
    trade.closePrice = current;
    trade.payout = payout;
  }, expiry*1000 + 200);

  res.json({ ok: true, trade });
});

app.listen(PORT, ()=>{
  console.log('Server listening on port', PORT);
});
