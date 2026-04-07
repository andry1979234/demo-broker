// Lightweight Charts fallback (minimal)
if (typeof window.LightweightCharts === 'undefined') {
  window.LightweightCharts = (() => {
    const createChart = (container, opts = {}) => {
      container.style.position = 'relative';
      const canvas = document.createElement('canvas');
      container.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const state = { w: container.clientWidth, h: container.clientHeight, bg: (opts.layout?.background?.color) || '#000', series: [] };
      const resize = () => {
        const d = devicePixelRatio || 1;
        state.w = container.clientWidth; state.h = container.clientHeight;
        canvas.width = state.w * d; canvas.height = state.h * d;
        canvas.style.width = `${state.w}px`; canvas.style.height = `${state.h}px`;
        ctx.setTransform(d,0,0,d,0,0); draw();
      };
      const y = (p,min,max,h)=> h - ((p-min)/((max-min)||1))*h;
      const draw = () => {
        ctx.fillStyle = state.bg; ctx.fillRect(0,0,state.w,state.h);
        state.series.forEach(s=>{
          if(!s.data.length) return;
          const hs = s.data.map(d=>d.high), ls=s.data.map(d=>d.low);
          const max=Math.max(...hs), min=Math.min(...ls), w=state.w/state.dataLength;
          const bodyW=Math.max(2,w*0.6);
          s.data.forEach((d,i)=>{
            const x=i*w+w/2;
            const yO=y(d.open,min,max,state.h), yC=y(d.close,min,max,state.h);
            const yH=y(d.high,min,max,state.h), yL=y(d.low,min,max,state.h);
            const c=d.close>=d.open?s.up:s.down;
            ctx.strokeStyle=c; ctx.beginPath(); ctx.moveTo(x,yH); ctx.lineTo(x,yL); ctx.stroke();
            ctx.fillStyle=c; const top=Math.min(yO,yC), bot=Math.max(yO,yC);
            ctx.fillRect(x-bodyW/2, top, bodyW, Math.max(1, bot-top||1));
          });
        });
      };
      resize();
      return {
        addCandlestickSeries(optsS={}) {
          const s={data:[], times:[], up:optsS.upColor||'#26a69a', down:optsS.downColor||'#ef5350'};
          state.series.push(s);
          return {
            setData(d){s.data=d; s.times=d.map(x=>x.time); state.dataLength=d.length; draw();},
            update(pt){ if(!pt)return; s.data[s.data.length-1]=pt; s.times[s.times.length-1]=pt.time; draw(); },
            priceToCoordinate(price){
              if(!s.data.length) return null;
              const highs=s.data.map(x=>x.high), lows=s.data.map(x=>x.low);
              const max=Math.max(...highs), min=Math.min(...lows);
              return y(price,min,max,state.h);
            }
          };
        },
        timeScale(){ 
          return { 
            timeToCoordinate: (time)=>{
              const s=state.series[0];
              if(!s || !s.times.length) return null;
              const idx = s.times.indexOf(time);
              if(idx===-1) return null;
              return (idx+0.5) * (state.w / s.times.length);
            },
            fitContent(){},
            subscribeVisibleTimeRangeChange(){} 
          };
        },
        applyOptions() {}
      };
    };
    return { createChart };
  })();
}

const chartContainer = document.getElementById('chart');
const chart = LightweightCharts.createChart(chartContainer, { 
  layout: { background: { color: '#05070f' }, textColor: '#cfd6e6' },
  grid: { vertLines: { color: 'rgba(255,255,255,0.05)' }, horzLines: { color: 'rgba(255,255,255,0.05)' } },
  timeScale: { timeVisible: true, secondsVisible: true, borderVisible: false },
  rightPriceScale: { borderVisible: false },
  crosshair: { mode: 1 },
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
  handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true }
});
const candleSeries = chart.addCandlestickSeries({
  upColor: '#29dca9', downColor: '#ff6b6b', borderVisible: false,
  wickUpColor: '#29dca9', wickDownColor: '#ff6b6b'
});

const overlay = document.createElement('div');
overlay.className = 'overlay-lines';
chartContainer.appendChild(overlay);

const isGhPages = window.location.hostname.includes('github.io');
const socket = !isGhPages && typeof io !== 'undefined' ? io() : null;

let balance = 10000;
let tradesHistory = [];
let currentPrice = 0;
let rawCandles = [];
let selectedTF = 1;
let localSim = null;
let firstRender = true;
let aggregatedData = [];
const MAX_POINTS = 400;
let anim = { active:false, base:null, from:0, to:0, start:0, dur:500 };

const balanceEl = document.getElementById('balance-value');
const balanceSide = document.getElementById('balance-side');
const currentPriceEl = document.getElementById('current-price');
const winrateEl = document.getElementById('winrate');
const profitEl = document.getElementById('profit');
const tradesEl = document.getElementById('trades');

const tfOptions = [
  { label: 'M1', value: 60 },
  { label: '30s', value: 30 },
  { label: '15s', value: 15 },
  { label: '5s', value: 5 },
  { label: '1s', value: 1 }
];
const tfContainer = document.getElementById('timeframes');
tfOptions.forEach(tf => {
  const btn = document.createElement('button');
  btn.className = 'tf-btn' + (tf.value === selectedTF ? ' active' : '');
  btn.textContent = tf.label;
  btn.onclick = () => setTimeframe(tf.value);
  tfContainer.appendChild(btn);
});

function setTimeframe(tf){
  selectedTF=tf;
  document.querySelectorAll('.tf-btn').forEach(b=>b.classList.toggle('active', b.textContent===tfOptions.find(t=>t.value===tf).label));
  aggregatedData=[];
  firstRender=true;
  renderCandles();
  rebuildMarkers();
}

// Data handlers
if (socket) {
  socket.on('candles', data=>{
    rawCandles = data.map(c=>({time:c.time, open:c.open, high:c.high, low:c.low, close:c.close})).slice(-MAX_POINTS);
    renderCandles();
    if(rawCandles.length) currentPrice = rawCandles[rawCandles.length-1].close;
    currentPriceEl.textContent = currentPrice.toFixed(4);
  });
  socket.on('balance', bal=>{
    balance=bal; balanceEl.textContent=balance.toFixed(2); balanceSide.textContent=balance.toFixed(2); updateStats();
  });
  socket.on('tradeUpdate', trades=>{
    tradesHistory=trades; renderTrades(); updateStats(); rebuildMarkers();
  });
  socket.on('connect_error', enableLocalSim);
  loadCandles();
  socket.on('connect', ()=>console.log('Socket connected'));
  socket.emit('init');
  setInterval(loadCandles, 1000);
} else {
  enableLocalSim();
}

async function loadCandles(){
  if(!socket) return;
  try{
    const res = await fetch('/api/candles?limit=400');
    const data = await res.json();
    rawCandles = data.map(c=>({time:c.time, open:c.open, high:c.high, low:c.low, close:c.close})).slice(-MAX_POINTS);
    renderCandles();
    if(data.length) currentPrice=data[data.length-1].close;
    currentPriceEl.textContent=currentPrice.toFixed(4);
  }catch(e){console.error(e);}
}

function aggregateCandles(src, tf){
  if(tf===1) return src;
  const res=[];
  src.forEach(c=>{
    const bucket = c.time - (c.time % tf);
    let b=res[res.length-1];
    if(!b || b.time!==bucket){
      b={time:bucket, open:c.open, high:c.high, low:c.low, close:c.close}; res.push(b);
    }else{
      b.high=Math.max(b.high,c.high); b.low=Math.min(b.low,c.low); b.close=c.close;
    }
  });
  return res;
}

function renderCandles(){
  const data = aggregateCandles(rawCandles, selectedTF);
  if(!aggregatedData.length){
    aggregatedData = data.slice(-MAX_POINTS);
    candleSeries.setData(aggregatedData);
    anim.base = aggregatedData.at(-1);
    anim.from = anim.base?.close ?? 0;
    anim.to = anim.from;
    anim.active = false;
  }else{
    const latest=data[data.length-1];
    const last=aggregatedData[aggregatedData.length-1];
    if(last && latest.time===last.time){
      const prevRendered = last.close;
      aggregatedData[aggregatedData.length-1] = { ...latest, close: prevRendered };
      anim.base = { ...latest };
      anim.from = prevRendered;
      anim.to = latest.close;
      anim.start = performance.now();
      anim.active = true;
    }else{
      // new candle: start from its open, animate to its close
      const startCandle = { ...latest, close: latest.open };
      aggregatedData.push(startCandle);
      if(aggregatedData.length>MAX_POINTS) aggregatedData.shift();
      anim.base = { ...latest };
      anim.from = startCandle.close;
      anim.to = latest.close;
      anim.start = performance.now();
      anim.active = true;
    }
  }
  if(firstRender){ chart.timeScale().fitContent(); firstRender=false; }
  renderTradeLines();
}

// Animation of last candle close
function animate(){
  const now = performance.now();
  if(anim.active && anim.base && aggregatedData.length){
    const p = Math.min(1, (now-anim.start)/anim.dur);
    const val = anim.from + (anim.to-anim.from)*p;
    const base = anim.base;
    const upd = { ...base, close: val, high: Math.max(base.high, val), low: Math.min(base.low, val) };
    aggregatedData[aggregatedData.length-1] = upd;
    candleSeries.update(upd);
    if(p>=1){
      anim.active = false;
    }
    renderTradeLines();
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Markers and lines
function rebuildMarkers(){
  const markers=[];
  tradesHistory.forEach(t=>{
    const openTime=Math.floor(t.createdAt/1000);
    const closeTime=Math.floor(t.expiresAt/1000);
    markers.push({ time: openTime, position:'belowBar', color: t.type==='buy'?'#29dca9':'#ff6b6b', shape: t.type==='buy'?'arrowUp':'arrowDown', size: 0.7, text:`${t.amount}$` });
    if(t.status!=='open'){
      markers.push({ time: closeTime, position:'aboveBar', color: t.status==='win'?'#42ff9c':'#ff6b6b', shape:'circle', size: 0.6, text: (t.status==='win'?'+':'') + (t.profit??0).toFixed(2)+'$' });
    }
  });
  candleSeries.setMarkers(markers);
  renderTradeLines();
}

function renderTradeLines(){
  overlay.innerHTML='';
  const timeScale = chart.timeScale();
  const priceToY = price => {
    const coord = candleSeries.priceToCoordinate ? candleSeries.priceToCoordinate(price) : null;
    if(coord!=null && !Number.isNaN(coord)) return coord;
    if(!aggregatedData.length) return null;
    const highs=aggregatedData.map(x=>x.high), lows=aggregatedData.map(x=>x.low);
    const max=Math.max(...highs), min=Math.min(...lows);
    const range=(max-min)||1;
    return chartContainer.clientHeight - ((price-min)/range)*chartContainer.clientHeight;
  };
  tradesHistory.forEach(t=>{
    if(t.status!=='open') return;
    const openCoord = priceToY(t.openPrice);
    const tOpen = Math.floor(t.createdAt/1000);
    const tExp = Math.floor(t.expiresAt/1000);
    let xOpen = timeScale.timeToCoordinate ? timeScale.timeToCoordinate(tOpen) : null;
    let xExp  = timeScale.timeToCoordinate ? timeScale.timeToCoordinate(tExp)  : null;
    // fallback if library not available
    if(!isFinite(xOpen) || !isFinite(xExp)){
      const len = aggregatedData.length;
      if(len>1){
        const firstT = aggregatedData[0].time;
        const lastT  = aggregatedData[len-1].time;
        const totalW = chartContainer.clientWidth;
        const pxPerSec = (lastT!==firstT) ? totalW / (lastT-firstT) : 0;
        if(!isFinite(xOpen)) xOpen = (tOpen - firstT) * pxPerSec;
        if(!isFinite(xExp))  xExp  = (tExp  - firstT) * pxPerSec;
        // clamp to visible width
        if(isFinite(xOpen)) xOpen = Math.max(0, Math.min(totalW, xOpen));
        if(isFinite(xExp))  xExp  = Math.max(0, Math.min(totalW, xExp));
      }
    }
    if(openCoord!=null){
      const line=document.createElement('div');
      line.className=`open-line ${t.type}`;
      line.style.top=`${openCoord}px`;
      line.dataset.label=`${t.type==='buy'?'ПОКУПКА':'ПРОДАЖА'} ${t.amount}$`;
      overlay.appendChild(line);
    }
    if(xExp!=null && isFinite(xExp)){
      const line=document.createElement('div');
      line.className='expiry-line';
      line.style.left=`${xExp}px`;
      overlay.appendChild(line);
    }
    if(openCoord!=null && isFinite(xOpen) && isFinite(xExp) && xExp > xOpen){
      const left=Math.max(0, xOpen);
      const right=Math.min(chartContainer.clientWidth, xExp);
      const width=Math.max(2, right-left);
      const span=document.createElement('div');
      span.className=`open-span ${t.type}`;
      span.style.top=`${openCoord-1}px`;
      span.style.left=`${left}px`;
      span.style.width=`${width}px`;
      overlay.appendChild(span);
    }
  });
}

// Buttons
document.getElementById('buy').onclick=()=>openTradeNow('buy');
document.getElementById('sell').onclick=()=>openTradeNow('sell');
document.getElementById('zoom-in').onclick=()=>chart.timeScale().zoomIn();
document.getElementById('zoom-out').onclick=()=>chart.timeScale().zoomOut();
document.getElementById('fit').onclick=()=>chart.timeScale().fitContent();

function openTradeNow(type){
  const amount=parseFloat(document.getElementById('amount').value)||10;
  const payout=0.9;
  const expiry=parseInt(document.getElementById('expiry').value);
  const trade={type,amount,payout,expiry};
  if(socket){ socket.emit('openTrade', trade); }
  else if(localSim){ localSimOpenTrade(trade); }
}

function renderTrades(){
  tradesEl.innerHTML='';
  tradesHistory.slice(-12).reverse().forEach(t=>{
    const div=document.createElement('div');
    div.className=`trade ${t.status}`;
    const expTime=Math.max(0, Math.round((t.expiresAt-Date.now())/1000));
    const statusText = t.status==='open'?`(осталось ${expTime}s)` : t.status==='win'?`+${t.profit.toFixed(2)}$` : `${t.profit.toFixed(2)}$`;
    div.innerHTML=`<span>${t.type==='buy'?'ПОКУПКА':'ПРОДАЖА'} ${t.amount}$ @ ${t.openPrice.toFixed(4)}</span><span>${statusText}</span>`;
    tradesEl.appendChild(div);
  });
}

function updateStats(){
  const wins=tradesHistory.filter(t=>t.status==='win').length;
  const total=tradesHistory.filter(t=>t.status!=='open').length;
  const winrate= total? ((wins/total)*100).toFixed(1):0;
  const profit= balance-10000;
  winrateEl.textContent=winrate+'%';
  profitEl.textContent=profit.toFixed(2);
  profitEl.parentElement.style.color= profit>=0 ? '#42ff9c' : '#ff6b6b';
}

window.addEventListener('resize', ()=> chart.applyOptions({ width: chartContainer.clientWidth, height: chartContainer.clientHeight }));
chart.timeScale().subscribeVisibleTimeRangeChange(()=>renderTradeLines());

// Local simulation
function enableLocalSim(){
  if(localSim) return;
  console.log('Local sim');
  localSim={price:120,candles:[],trades:[], rng: makeRng(getSeed())};
  initLocalCandles();
  setInterval(tickLocalCandle, 1000);
  setInterval(resolveLocalTrades, 500);
  renderTrades(); updateStats();
}

function initLocalCandles(){
  const nowTs = Date.now();
  try{
    const cached = localStorage.getItem(LS_KEY);
    const cachedTs = parseInt(localStorage.getItem(LS_TS),10);
    if(cached && cachedTs && (nowTs - cachedTs) < 3600_000){
      const parsed = JSON.parse(cached);
      if(Array.isArray(parsed) && parsed.length){
        localSim.candles = parsed;
      }
    }
  }catch(_){}
  if(!localSim.candles.length){
    let price=localSim.price;
    const now=Math.floor(Date.now()/1000);
    for(let i=200;i>0;i--){
      const open=price;
      const close=+(open*(1+randn(0,0.0012, localSim.rng))).toFixed(4);
      const high=Math.max(open,close)*(1+Math.abs(randn(0,0.0008, localSim.rng)));
      const low=Math.min(open,close)*(1-Math.abs(randn(0,0.0008, localSim.rng)));
      localSim.candles.push({time:now-i, open:+open.toFixed(4), high:+high.toFixed(4), low:+low.toFixed(4), close});
      price=close;
    }
  }
  rawCandles=localSim.candles.slice(-MAX_POINTS);
  renderCandles();
}

function tickLocalCandle(){
  const last=localSim.candles[localSim.candles.length-1];
  const open=last.close;
  const close=+(open*(1+randn(0,0.0009, localSim.rng))).toFixed(4);
  const high=Math.max(open,close)*(1+Math.abs(randn(0,0.0005, localSim.rng)));
  const low=Math.min(open,close)*(1-Math.abs(randn(0,0.0005, localSim.rng)));
  const nc={time:Math.floor(Date.now()/1000), open:+open.toFixed(4), high:+high.toFixed(4), low:+low.toFixed(4), close};
  localSim.candles.push(nc);
  if(localSim.candles.length>MAX_POINTS) localSim.candles.shift();
  rawCandles=localSim.candles.slice(-MAX_POINTS);
  currentPrice=nc.close; currentPriceEl.textContent=currentPrice.toFixed(4);
  renderCandles(); rebuildMarkers();
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(localSim.candles.slice(-MAX_POINTS)));
    localStorage.setItem(LS_TS, Date.now().toString());
  }catch(_){}
}

function localSimOpenTrade(td){
  const {type,amount,payout,expiry}=td;
  const openPrice=currentPrice || localSim.candles.at(-1).close;
  const id=Date.now()+'-'+Math.floor(Math.random()*1000);
  const createdAt=Date.now(); const expiresAt=createdAt+expiry*1000;
  const t={id,userId:'demo',type,amount,payout,openPrice,createdAt,expiresAt,status:'open'};
  localSim.trades.push(t); tradesHistory=localSim.trades;
  balance-=amount; balanceEl.textContent=balance.toFixed(2); balanceSide.textContent=balance.toFixed(2);
  renderTrades(); updateStats(); rebuildMarkers();
}

function resolveLocalTrades(){
  const now=Date.now();
  localSim.trades.forEach(t=>{
    if(t.status!=='open') return;
    if(now>=t.expiresAt){
      const cp=currentPrice || localSim.candles.at(-1).close;
      const win = t.type==='buy' ? cp>t.openPrice : cp<t.openPrice;
      t.status= win?'win':'lose';
      t.closePrice=cp;
      t.profit= win? +(t.amount*t.payout).toFixed(2) : -t.amount;
      if(win) balance+= t.amount + t.profit;
      balanceEl.textContent=balance.toFixed(2); balanceSide.textContent=balance.toFixed(2);
      renderTrades(); updateStats(); rebuildMarkers();
    }
  });
}

function randn(mu,sigma,rng=Math.random){
  let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng();
  return mu + Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v)*sigma;
}

function getSeed(){
  const now = Date.now();
  try{
    const cachedSeed = localStorage.getItem(LS_SEED);
    const cachedTs = parseInt(localStorage.getItem(LS_TS),10);
    if(cachedSeed && cachedTs && (now - cachedTs) < 3600_000){
      return parseInt(cachedSeed,10);
    }
  }catch(_){}
  const newSeed = Math.floor(Math.random()*1e9);
  try{
    localStorage.setItem(LS_SEED, newSeed.toString());
    localStorage.setItem(LS_TS, now.toString());
  }catch(_){}
  return newSeed;
}

function makeRng(seed){
  let s = seed >>> 0;
  return function(){
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const LS_KEY = 'kasper_candles_v1';
const LS_TS  = 'kasper_candles_ts_v1';
const LS_SEED = 'kasper_seed_v1';
