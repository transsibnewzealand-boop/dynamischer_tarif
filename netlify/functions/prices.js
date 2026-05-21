// Netlify Function v2 – nutzt den funktionierenden Endpoint aus deinem Screenshot.
//
// Endpoint (laut Screenshot):
//   GET {base}/metering_code
// Query:
//   tariff_type   = integrated | grid
//   start_timestamp (ISO, required)
//   end_timestamp   (ISO, required)
//   metering_code   (required)
//
// Response enthält:
//   publication_timestamp
//   prices: [ { start_timestamp, end_timestamp, integrated:[{value,unit}], grid:[{value,unit}] } ... ]
//
// Env Vars:
//   DST_TOKEN
//   DST_METERING_CODE
//   DST_API_BASE (optional) default https://portal.dynamische-stromtarife.ch/api/v2

const DEFAULT_BASE = 'https://portal.dynamische-stromtarife.ch/api/v2';

function isoRangeForDate(dateStr){
  // dateStr = YYYY-MM-DD
  // We will request local time +02:00 as shown in screenshot.
  // Without timezone libs, we assume Europe/Zurich offset; user can override by providing full ISO in future if needed.
  const start = `${dateStr}T00:00:00+02:00`;
  const end = `${dateStr}T23:59:59+02:00`;
  return { start, end };
}

function asBearer(token){
  // Screenshot tool might accept raw token as value; API docs often require 'Bearer <token>'.
  // We'll send Bearer always; if user already includes 'Bearer', avoid double.
  return token.toLowerCase().startsWith('bearer ') ? token : `Bearer ${token}`;
}

function extractValue(entry, tariffType){
  // entry might contain e.g. entry.integrated = [{value, unit}] OR entry.grid = [...]
  const key = tariffType;
  const arr = entry?.[key];
  if(Array.isArray(arr) && arr.length){
    const v = arr[0]?.value;
    return (typeof v === 'number') ? v : (v!=null ? Number(String(v).replace(',','.')) : null);
  }
  // sometimes can be direct value
  const v2 = entry?.value;
  return (typeof v2 === 'number') ? v2 : null;
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
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'DST_TOKEN not set in Netlify environment variables' }) };
  }
  if(!metering_code){
    return { statusCode: 500, headers: cors(), body: JSON.stringify({ error: 'DST_METERING_CODE not set in Netlify environment variables' }) };
  }

  const { start, end } = isoRangeForDate(date);

  async function fetchTariff(tariff_type){
    const u = new URL(base + '/metering_code');
    u.searchParams.set('tariff_type', tariff_type);
    u.searchParams.set('start_timestamp', start);
    u.searchParams.set('end_timestamp', end);
    u.searchParams.set('metering_code', metering_code);

    const resp = await fetch(u.toString(), {
      headers: {
        'Authorization': asBearer(token),
        'Accept': 'application/json'
      }
    });
    const text = await resp.text();
    let json=null;
    try{ json = JSON.parse(text); } catch{}
    return { ok: resp.ok, status: resp.status, url: u.toString(), json, text };
  }

  const rIntegrated = await fetchTariff('integrated');
  const rGrid = await fetchTariff('grid');

  // Build normalized series as [{t, v}] 
  function normalize(resp, tariffType){
    if(!resp.ok || !resp.json) return [];
    const prices = resp.json.prices;
    if(!Array.isArray(prices)) return [];
    return prices.map(p=>({
      t: p.start_timestamp || p.time || p.starts_at || p.start,
      v: extractValue(p, tariffType)
    })).filter(p=>p.t!=null && p.v!=null);
  }

  const out = {
    date,
    series: {
      integrated: normalize(rIntegrated, 'integrated'),
      grid: normalize(rGrid, 'grid')
    },
    debug: {
      base,
      metering_code: metering_code.slice(0,8) + '…' + metering_code.slice(-6),
      integrated: { status: rIntegrated.status, url: rIntegrated.url },
      grid: { status: rGrid.status, url: rGrid.url }
    }
  };

  const okAny = out.series.integrated.length || out.series.grid.length;
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
