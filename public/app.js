// Frontend: lädt grid + integrated vom Server (Netlify Function) und zeichnet Chart.
// Erwartet Response: { date, series: { integrated: [{t,v}], grid:[{t,v}] }, debug }

let chart;
let lastPayload = null;

const elDate = document.getElementById('date');
const elStatus = document.getElementById('status');
const elDebug = document.getElementById('debug');

const elShowIntegrated = document.getElementById('showIntegrated');
const elShowGrid = document.getElementById('showGrid');
const elShadeCheapest = document.getElementById('shadeCheapest');

const elKpiWindow = document.getElementById('kpiWindow');
const elKpiAvg = document.getElementById('kpiAvg');
const elKpiMinMax = document.getElementById('kpiMinMax');

function yyyy_mm_dd(d){
  const pad = (n)=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function setStatus(t){ elStatus.textContent = t; }

function toLabels(pts){
  return pts.map((p,idx)=>{
    const t = p.t;
    if(typeof t === 'string'){
      const m = t.match(/T(\d\d):(\d\d)/);
      if(m) return `${m[1]}:${m[2]}`;
      const m2 = t.match(/^(\d\d):(\d\d)/);
      if(m2) return `${m2[1]}:${m2[2]}`;
      return t;
    }
    const minutes = idx*15;
    const hh = String(Math.floor(minutes/60)).padStart(2,'0');
    const mm = String(minutes%60).padStart(2,'0');
    return `${hh}:${mm}`;
  });
}

function toValues(pts){
  return pts.map(p=>{
    const v = (typeof p.v === 'string') ? Number(p.v.replace(',','.')) : Number(p.v);
    return Number.isFinite(v) ? v : null;
  });
}

function detectIntervalMinutes(labels){
  if(labels.length < 3) return 15;
  const parse = (s)=>{
    const m = String(s).match(/^(\d{2}):(\d{2})$/);
    if(!m) return null;
    return Number(m[1])*60 + Number(m[2]);
  };
  const a = parse(labels[0]);
  const b = parse(labels[1]);
  if(a==null || b==null) return 15;
  let d = b-a; if(d<=0) d+=1440;
  return d;
}

function slidingCheapestWindow(values, windowLen){
  const n = values.length;
  if(n < windowLen) return null;
  let best = null;
  for(let i=0;i<=n-windowLen;i++){
    let sum=0;
    for(let j=0;j<windowLen;j++){
      const v = values[i+j];
      if(v==null) { sum = null; break; }
      sum += v;
    }
    if(sum==null) continue;
    const avg = sum/windowLen;
    if(best==null || avg < best.avg){ best = { start:i, end:i+windowLen, avg }; }
  }
  return best;
}

const cheapestShadePlugin = {
  id: 'cheapestShade',
  beforeDatasetsDraw(chart){
    const opts = chart?.config?.options?.plugins?.cheapestShade;
    if(!opts || !opts.enabled || opts.start==null) return;
    const { ctx, chartArea, scales } = chart;
    const x = scales.x;
    if(!x) return;

    const startPx = x.getPixelForValue(opts.start);
    const endPx = x.getPixelForValue(opts.end-1) + (x.getPixelForValue(opts.end-1) - x.getPixelForValue(opts.end-2 || opts.start)) / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(14,160,92,0.10)';
    ctx.strokeStyle = 'rgba(14,160,92,0.35)';
    ctx.lineWidth = 1;

    const left = Math.max(chartArea.left, startPx);
    const right = Math.min(chartArea.right, endPx);
    const top = chartArea.top;
    const height = chartArea.bottom - chartArea.top;

    const r = 8;
    const w = right-left;
    if(w>2){
      roundRect(ctx, left, top+4, w, height-8, r);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }
};

function roundRect(ctx, x, y, w, h, r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}

function render(payload){
  lastPayload = payload;

  const ptsIntegrated = Array.isArray(payload.series?.integrated) ? payload.series.integrated : [];
  const ptsGrid = Array.isArray(payload.series?.grid) ? payload.series.grid : [];

  const basePts = ptsIntegrated.length ? ptsIntegrated : ptsGrid;
  const labels = toLabels(basePts);

  const valuesIntegrated = ptsIntegrated.length ? toValues(ptsIntegrated) : labels.map(()=>null);
  const valuesGrid = ptsGrid.length ? toValues(ptsGrid) : labels.map(()=>null);

  const interval = detectIntervalMinutes(labels);
  const windowLen = Math.max(1, Math.round(240 / interval));
  const cheapest = slidingCheapestWindow(valuesIntegrated, windowLen);

  if(cheapest){
    const startLabel = labels[cheapest.start];
    const endLabel = labels[cheapest.end-1];
    elKpiWindow.textContent = `${startLabel}–${endLabel}`;
    elKpiAvg.textContent = `${cheapest.avg.toFixed(3)} Rp./kWh`;

    const nums = valuesIntegrated.filter(v=>v!=null);
    elKpiMinMax.textContent = nums.length ? `${Math.min(...nums).toFixed(3)} / ${Math.max(...nums).toFixed(3)} Rp./kWh` : '–';
  } else {
    elKpiWindow.textContent = '–';
    elKpiAvg.textContent = '–';
    elKpiMinMax.textContent = '–';
  }

  const datasets = [];
  if(elShowIntegrated.checked){
    datasets.push({
      label: 'integrated (Rp./kWh)',
      data: valuesIntegrated,
      borderColor: '#0b3a7a',
      backgroundColor: 'rgba(11,58,122,0.10)',
      borderWidth: 2,
      tension: 0.25,
      pointRadius: 0,
      fill: true,
    });
  }
  if(elShowGrid.checked){
    datasets.push({
      label: 'grid (Rp./kWh)',
      data: valuesGrid,
      borderColor: '#e21d2a',
      backgroundColor: 'rgba(226,29,42,0.06)',
      borderWidth: 2,
      tension: 0.25,
      pointRadius: 0,
      fill: false,
    });
  }

  const shadeEnabled = elShadeCheapest.checked && !!cheapest;

  const ctx = document.getElementById('chart');
  if(chart) chart.destroy();
  chart = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'top', labels: { color: '#0b1b2b', boxWidth: 14 } },
        tooltip: { callbacks: { label: (c)=> `${c.dataset.label}: ${Number(c.raw).toFixed(3)} Rp./kWh` } },
        cheapestShade: {
          enabled: shadeEnabled,
          start: cheapest ? cheapest.start : null,
          end: cheapest ? cheapest.end : null
        }
      },
      scales: {
        x: { ticks: { maxTicksLimit: 12, color: '#53657a' }, grid: { color: 'rgba(12,37,66,.06)' } },
        y: { ticks: { color: '#53657a' }, grid: { color: 'rgba(12,37,66,.06)' }, title: { display: true, text: 'Rp./kWh', color:'#53657a' } }
      }
    },
    plugins: [cheapestShadePlugin]
  });
}

async function load(){
  const date = elDate.value;
  setStatus('lade…');
  elDebug.textContent = '';
  try{
    const res = await fetch(`/.netlify/functions/prices?date=${encodeURIComponent(date)}`);
    const txt = await res.text();
    let payload;
    try{ payload = JSON.parse(txt); } catch { payload = { raw: txt }; }

    if(!res.ok){
      setStatus(`Fehler ${res.status}`);
      elDebug.textContent = JSON.stringify(payload, null, 2);
      return;
    }

    render(payload);
    setStatus('ok');
  } catch(e){
    setStatus('Netzwerkfehler');
    elDebug.textContent = String(e);
  }
}

elDate.value = yyyy_mm_dd(new Date());

document.getElementById('load').addEventListener('click', load);
document.getElementById('today').addEventListener('click', ()=>{ elDate.value = yyyy_mm_dd(new Date()); load(); });
document.getElementById('prev').addEventListener('click', ()=>{ const d=new Date(elDate.value); d.setDate(d.getDate()-1); elDate.value=yyyy_mm_dd(d); load(); });
document.getElementById('next').addEventListener('click', ()=>{ const d=new Date(elDate.value); d.setDate(d.getDate()+1); elDate.value=yyyy_mm_dd(d); load(); });

elShowIntegrated.addEventListener('change', ()=>{ if(lastPayload) render(lastPayload); });
elShowGrid.addEventListener('change', ()=>{ if(lastPayload) render(lastPayload); });
elShadeCheapest.addEventListener('change', ()=>{ if(lastPayload) render(lastPayload); });
