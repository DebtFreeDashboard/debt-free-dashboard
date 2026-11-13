/* DebtFree Dashboard — payment reminder notifications (Cloudflare Worker)
 *
 * Sends an EMPTY push to a phone at the right moment. The phone's service
 * worker writes the notification itself from what is already on the device,
 * so no debt name, amount or balance ever reaches this server.
 *
 * What it stores per phone (Workers KV, binding SUBS), and nothing else:
 *   endpoint  the push address the phone's browser gave it
 *   days      due days of the month, e.g. [5, 22]   (numbers only)
 *   cadence   'before' | 'weekly' | 'monthly'
 *   lead      1 | 3 | 7   days ahead, for 'before'
 *   tz, hour  the phone's time zone and the hour to send (default 9)
 *   sent      the local dates already sent, so nothing goes twice
 *
 *   GET  /push/key           -> {"key": "<VAPID public key>"}
 *   POST /push/subscribe     {endpoint, days, cadence, lead, tz, hour}
 *   POST /push/unsubscribe   {endpoint}
 *   cron  hourly             sends what is due this hour
 *
 * Setup (Cloudflare dashboard): a Worker with this code, a KV namespace bound
 * as SUBS, and a Cron Trigger "0 * * * *". No secrets: the signing key is
 * created on first use and kept in KV under "vapid".
 */
const ALLOWED_ORIGINS = ['https://mydebtdashboard.com'];
const PUSH_HOSTS = [/\.googleapis\.com$/, /\.push\.apple\.com$/, /\.mozilla\.com$/, /\.notify\.windows\.com$/, /\.push\.services\.mozilla\.com$/];
const SUBJECT = 'mailto:debtfreedashboard@gmail.com';

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0], 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
           'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin' };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors(origin)) });
}
const b64url = bytes => { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64url = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const r = atob(s); const o = new Uint8Array(r.length); for (let i = 0; i < r.length; i++) o[i] = r.charCodeAt(i); return o; };
async function idOf(endpoint) { return 'sub:' + b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))); }

// ── VAPID ───────────────────────────────────────────────────────────────
async function vapid(env) {
  let v = await env.SUBS.get('vapid', 'json');
  if (!v) {
    const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    const raw = await crypto.subtle.exportKey('raw', kp.publicKey);
    v = { jwk, pub: b64url(raw) };
    await env.SUBS.put('vapid', JSON.stringify(v));
  }
  return v;
}
async function vapidHeader(env, endpoint, now) {
  const v = await vapid(env);
  const aud = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64url(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT })));
  const key = await crypto.subtle.importKey('jwk', v.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return 'vapid t=' + head + '.' + body + '.' + b64url(sig) + ', k=' + v.pub;
}

// ── What to send, and when ──────────────────────────────────────────────
// Local date parts in the phone's time zone.
function localParts(now, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false, weekday: 'short' });
  const p = {}; f.formatToParts(new Date(now)).forEach(x => { p[x.type] = x.value; });
  return { y: +p.year, m: +p.month, d: +p.day, h: (+p.hour) % 24, wd: p.weekday };
}
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();          // m is 1-12
const dueOn = (y, m, day) => Math.min(day, daysIn(y, m));
function addDays(y, m, d, n) { const t = new Date(Date.UTC(y, m - 1, d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }; }

// Returns the reason to send now, or null. Exported for tests.
export function dueReason(sub, now) {
  const L = localParts(now, sub.tz || 'America/New_York');
  if (L.h !== (sub.hour == null ? 9 : sub.hour)) return null;
  const key = L.y + '-' + L.m + '-' + L.d;
  if ((sub.sent || []).includes(key)) return null;
  const days = (sub.days || []).filter(n => n >= 1 && n <= 31);
  if (sub.cadence === 'monthly') return L.d === 1 ? { key, kind: 'checkin' } : null;
  if (sub.cadence === 'weekly') return L.wd === 'Mon' ? { key, kind: 'weekly' } : null;
  // 'before': N days ahead of a due day, on the day itself, and the 1st.
  const ahead = addDays(L.y, L.m, L.d, sub.lead || 3);
  if (days.some(n => dueOn(ahead.y, ahead.m, n) === ahead.d)) return { key, kind: 'soon' };
  if (days.some(n => dueOn(L.y, L.m, n) === L.d)) return { key, kind: 'today' };
  if (L.d === 1) return { key, kind: 'checkin' };
  return null;
}

async function sendPush(env, sub, now, fetchImpl) {
  const res = await fetchImpl(sub.endpoint, { method: 'POST', headers: {
    'Authorization': await vapidHeader(env, sub.endpoint, now), 'TTL': '43200', 'Urgency': 'normal', 'Content-Length': '0' } });
  return res.status;
}

export async function runCron(env, now, fetchImpl) {
  const out = { checked: 0, sent: 0, removed: 0 };
  let cursor;
  do {
    const page = await env.SUBS.list({ prefix: 'sub:', cursor });
    for (const k of page.keys) {
      const sub = await env.SUBS.get(k.name, 'json');
      if (!sub) continue;
      out.checked++;
      const why = dueReason(sub, now);
      if (!why) continue;
      let status = 0;
      try { status = await sendPush(env, sub, now, fetchImpl); } catch (e) { status = 0; }
      if (status === 404 || status === 410) { await env.SUBS.delete(k.name); out.removed++; continue; }
      if (status >= 200 && status < 300) {
        sub.sent = [why.key].concat(sub.sent || []).slice(0, 10);
        await env.SUBS.put(k.name, JSON.stringify(sub));
        out.sent++;
      }
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// ── HTTP ────────────────────────────────────────────────────────────────
function cleanSub(b) {
  if (!b || typeof b.endpoint !== 'string' || b.endpoint.length > 1000) return null;
  let host;
  try { const u = new URL(b.endpoint); if (u.protocol !== 'https:') return null; host = u.hostname; } catch (e) { return null; }
  if (!PUSH_HOSTS.some(r => r.test(host))) return null;
  const days = Array.isArray(b.days) ? Array.from(new Set(b.days.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 31))).slice(0, 62) : [];
  const cadence = ['before', 'weekly', 'monthly'].includes(b.cadence) ? b.cadence : 'before';
  const lead = [1, 3, 7].includes(parseInt(b.lead, 10)) ? parseInt(b.lead, 10) : 3;
  let tz = typeof b.tz === 'string' ? b.tz.slice(0, 64) : 'America/New_York';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch (e) { tz = 'America/New_York'; }
  const hour = Number.isInteger(b.hour) && b.hour >= 0 && b.hour <= 23 ? b.hour : 9;
  return { endpoint: b.endpoint, days, cadence, lead, tz, hour };
}

export async function handle(request, env) {
  const origin = request.headers.get('Origin') || '';
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  if (request.method === 'GET' && url.pathname === '/push/key') return json({ key: (await vapid(env)).pub }, 200, origin);
  if (request.method !== 'POST') return json({ error: 'not_found' }, 404, origin);
  if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, 403, origin);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, origin); }
  if (url.pathname === '/push/subscribe') {
    const sub = cleanSub(body);
    if (!sub) return json({ error: 'bad_subscription' }, 400, origin);
    const id = await idOf(sub.endpoint);
    const prev = await env.SUBS.get(id, 'json');
    sub.sent = prev && prev.sent ? prev.sent : [];
    await env.SUBS.put(id, JSON.stringify(sub));
    return json({ ok: true }, 200, origin);
  }
  if (url.pathname === '/push/unsubscribe') {
    if (!body || typeof body.endpoint !== 'string') return json({ error: 'bad_request' }, 400, origin);
    await env.SUBS.delete(await idOf(body.endpoint));
    return json({ ok: true }, 200, origin);
  }
  return json({ error: 'not_found' }, 404, origin);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env, event.scheduledTime || Date.now(), fetch)); }
};
