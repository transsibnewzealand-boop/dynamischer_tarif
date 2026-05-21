// Netlify Function: holt Tarife serverseitig (Token bleibt geheim).
// Liefert normalisierte Daten: { date, series: { integrated: [...], grid: [...] }, debug: {...} }
//
// Konfiguration via Netlify Environment Variables:
//   DST_TOKEN           = Bearer Token
//   DST_METERING_CODE   = z.B. CH1038...
//   DST_API_BASE        = optional, Default: https://portal.dynamische-stromtarife.ch/api/v2
//   DST_URL_TEMPLATE    = optional: vollständige URL mit Platzhaltern {date} {product} {metering_code}
//                         Beispiel: https://.../prices?filter[date]={date}&filter[product]={product}&filter[metering_code]={metering_code}
//
// Da die exakte API-Struktur je nach Umfeld variieren kann, probieren wir mehrere Templates.

const DEFAULT_BASE = 'https://portal.dynamische-stromtarife.ch/api/v2';

const DEFAULT_TEMPLATES = [
  '{base}/prices?filter[date]={date}&filter[product]={product}&filter[metering_code]={metering_code}',
  '{base}/prices?filter[date]={date}&filter[tariff_type]={product}&filter[metering_code]={metering_code}',
  '{base}/prices?filter[date]={date}&filter[product]={product}',
  '{base}/prices?filter[date]={date}&filter[tariff_type]={product}',
  '{base}/metering_points/{metering_code}/prices?filter[date]={date}&filter[product]={product}',
  '{base}/meters/{metering_code}/prices?filter[date]={date}&filter[product]={product}',
];

function fillTemplate(tpl, vars){
  return tpl
    .replaceAll('{base}', vars.base)
    .replaceAll('{date}', encodeURIComponent(vars.date))
    .replaceAll('{product}', encodeURIComponent(vars.product))
    .replaceAll('{metering_code}', encodeURIComponent(vars.metering_code || ''));
}

async function tryFetch(url, token){
  const resp = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });
  const text = await resp.text();
  let json = null;
  try{ json = JSON.parse(text); } catch{ /* keep null */ }
  return { status: resp.status, ok: resp.ok, url, text, json };
}

function pickArray(json){
  // Best effort: find an array of points
  if(Array.isArray(json)) return json;
  if(!json || typeof json !== 'object') return null;
  const keys = ['data','prices','items','result','values'];
  for(const k of keys){ if(Array.isArray(json[k])) return json[k]; }
  // search first-level arrays
  for(const k of Object.keys(json)){
    if(Array.isArray(json[k])) return json[k];
  }
  return null;
}

exports.handler = async (event) => {
  const date = event.queryStringParameters?.date;
  if(!date){
    return { statusCode: 400, headers: cors(), body: JSON.stringify({ error: 'missing ?date=YYYY-MM-DD' }) };
  }

  const token = process.env.DST_TOKEN;
  const metering_code = process.env.DST_METERING_CODE;
  const base = (process.env.DST_API_BASE || DEFAULT_BASE).replace(/\/$/, '');

  if(!token){
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'DST_TOKEN not set (Netlify → Site settings → Environment variables)' }) };
  }

  const userTpl = process.env.DST_URL_TEMPLATE;
  const templates = userTpl ? [userTpl, ...DEFAULT_TEMPLATES] : DEFAULT_TEMPLATES;

  async function fetchSeries(product){
    const attempts = [];
    for(const tpl of templates){
      const url = fillTemplate(tpl, { base, date, product, metering_code });
      const r = await tryFetch(url, token);
      attempts.push({ url: r.url, status: r.status, ok: r.ok });
      if(r.ok && r.json){
        const arr = pickArray(r.json);
        if(arr) return { ok: true, data: arr, chosen: url, attempts };
      }
    }
    return { ok: false, data: [], chosen: null, attempts };
  }

  const integrated = await fetchSeries('integrated');
  const grid = await fetchSeries('grid');

  const out = {
    date,
    series: {
      integrated: integrated.data,
      grid: grid.data
    },
    debug: {
      base,
      metering_code: metering_code ? (metering_code.slice(0,8) + '…' + metering_code.slice(-6)) : null,
      integrated: { chosen: integrated.chosen, attempts: integrated.attempts },
      grid: { chosen: grid.chosen, attempts: grid.attempts }
    }
  };

  // If both failed, return 502 so frontend shows debug
  const okAny = (integrated.ok || grid.ok);
  return {
    statusCode: okAny ? 200 : 502,
    headers: { ...cors(), 'Content-Type': 'application/json' },
    body: JSON.stringify(out)
  };
};

function cors(){
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS'
  };
}
