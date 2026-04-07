const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;

// In-memory данные
let candles = [];
let trades = [];
const users = {
  demo: { balance: 10000, trades: [], profit: 0 }
};

const DATA_FILE = path.join(__dirname, 'data_store.json');

function saveData() {
  const payload = { candles, trades, users };
  fs.writeFile(DATA_FILE, JSON.stringify(payload), () => {});
}

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.candles?.length) candles = parsed.candles;
      if (parsed.trades) trades = parsed.trades;
      if (parsed.users) Object.assign(users, parsed.users);
    }
  } catch (e) {
    console.error('Load data error', e);
  }
}

function rand(min, max) { return Math.random() * (max - min) + min; }

function initCandles() {
  let price = 100;
  const now = Math.floor(Date.now() / 1000);
  for (let i = 200; i > 0; i--) {
    const open = price;
    const close = +(open * (1 + rand(-0.02, 0.02))).toFixed(4);
    const high = Math.max(open, close) * (1 + Math.abs(rand(0, 0.008)));
    const low = Math.min(open, close) * (1 - Math.abs(rand(0, 0.008)));
    candles.push({ time: now - i, open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close });
    price = close;
  }
}

loadData();
if (!candles.length) initCandles();

// Генерация новых свечей
setInterval(() => {
  const last = candles[candles.length - 1];
  const open = last.close;
  const close = +(open * (1 + rand(-0.01, 0.01))).toFixed(4);
  const high = Math.max(open, close) * (1 + Math.abs(rand(0, 0.005)));
  const low = Math.min(open, close) * (1 - Math.abs(rand(0, 0.005)));
  const newCandle = { time: Math.floor(Date.now() / 1000), open: +open.toFixed(4), high: +high.toFixed(4), low: +low.toFixed(4), close };
  candles.push(newCandle);
  if (candles.length > 1000) candles.shift();
  
  // Emit новая свеча
  io.emit('candles', candles.slice(-200));
  saveData();
}, 1000);

// Socket соединения
io.on('connection', (socket) => {
  console.log('Клиент подключён:', socket.id);
  
  // Init data
  socket.emit('candles', candles.slice(-200));
  socket.emit('balance', users.demo.balance);
  socket.emit('tradeUpdate', users.demo.trades);
  console.log('Init data sent to', socket.id);
  
  socket.on('openTrade', async (tradeData) => {
    const userId = 'demo';
    const { type, amount, payout, expiry } = tradeData;
    const user = users[userId];
    if (amount > user.balance) return socket.emit('error', 'Недостаточно средств');
    
    const openPrice = candles[candles.length - 1].close;
    const id = Date.now() + '-' + Math.floor(Math.random() * 1000);
    const createdAt = Date.now();
    const expiresAt = createdAt + expiry * 1000;
    
    const trade = { id, userId, type, amount, payout, openPrice, createdAt, expiresAt, status: 'open' };
    trades.push(trade);
    user.trades.push(trade);
    user.balance -= amount;
    
    io.emit('balance', user.balance);
    io.emit('tradeUpdate', user.trades);
    
    // Разрешение сделки
    setTimeout(() => {
      const currentPrice = candles[candles.length - 1].close;
      let win = false;
      if (type === 'buy') win = currentPrice > openPrice;
      else if (type === 'sell') win = currentPrice < openPrice;
      
      trade.status = win ? 'win' : 'lose';
      trade.closePrice = currentPrice;
      trade.profit = win ? +(amount * payout).toFixed(2) : -amount;
      
      if (win) {
        user.balance += amount + trade.profit;
        user.profit += trade.profit;
      }
      saveData();
      
      io.emit('balance', user.balance);
      io.emit('tradeUpdate', user.trades);
    }, expiry * 1000 + 200);
    
    socket.emit('tradeOpened', trade);
    saveData();
  });
  
  socket.on('disconnect', () => {
    console.log('Клиент отключён:', socket.id);
  });
});

// API (fallback)
app.get('/api/candles', (req, res) => {
  const limit = parseInt(req.query.limit) || 200;
  res.json(candles.slice(-limit));
});

app.get('/api/balance', (req, res) => {
  res.json({ balance: users.demo.balance });
});

app.get('/api/trades', (req, res) => {
  res.json(users.demo.trades);
});

app.post('/api/trade', (req, res) => {
  // Fallback для старого фронта
  res.json({ ok: true });
});

server.listen(PORT, () => {
  console.log('Сервер на порту', PORT);
});

