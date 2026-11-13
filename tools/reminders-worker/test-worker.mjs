// node tools/reminders-worker/test-worker.mjs — the reminder worker against a fake KV and push service.
import { handle, runCron, dueReason } from './worker.mjs';
import { createPublicKey, verify } from 'node:crypto';

const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && !ok) console.log('      ' + d); };
function kv() {
  const m = new Map();
  return { m,
    get: async (k, t) => { const v = m.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); },
    put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
}
const ORIGIN = 'https://mydebtdashboard.com';
const req = (path, body, origin = ORIGIN, method = 'POST') => new Request('https://w.example' + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: body ? JSON.stringify(body) : undefined });
const EP = 'https://fcm.googleapis.com/fcm/send/abc123';
const env = { SUBS: kv() };

// key + subscribe
const key = await (await handle(req('/push/key', null, ORIGIN, 'GET'), env)).json();
ck('serves a P-256 public key, made once', /^[A-Za-z0-9_-]{87}$/.test(key.key) && (await (await handle(req('/push/key', null, ORIGIN, 'GET'), env)).json()).key === key.key);
let r = await handle(req('/push/subscribe', { endpoint: EP, days: [5, 22, 31, 40, 'x'], cadence: 'before', lead: 3, tz: 'America/New_York', hour: 9, name: 'Store Card', balance: 900 }), env);
const stored = [...env.SUBS.m.entries()].find(([k]) => k.startsWith('sub:'));
const s = JSON.parse(stored[1]);
ck('subscribe stores only endpoint, due days, cadence, lead, time zone and hour', r.status === 200
  && JSON.stringify(Object.keys(s).sort()) === JSON.stringify(['cadence', 'days', 'endpoint', 'hour', 'lead', 'sent', 'tz']) && JSON.stringify(s.days) === '[5,22,31]', stored[1]);
ck('refuses other origins', (await handle(req('/push/subscribe', { endpoint: EP, days: [5] }, 'https://evil.example'), env)).status === 403);
ck('refuses endpoints that are not push services', (await handle(req('/push/subscribe', { endpoint: 'https://evil.example/x', days: [5] }), env)).status === 400);
ck('the storage key is a hash, not the endpoint', !stored[0].includes('fcm'));

// timing — 9 AM New York on given dates (EST = UTC-5 in Nov/Dec, EDT = UTC-4 in Jun)
const at = (iso) => Date.parse(iso);
const base = { days: [5, 22, 31], cadence: 'before', lead: 3, tz: 'America/New_York', hour: 9, sent: [] };
ck('3 days before the 5th, at 9 AM local', (dueReason(base, at('2026-11-02T14:00:00Z')) || {}).kind === 'soon');
ck('not at 8 AM local', dueReason(base, at('2026-11-02T13:00:00Z')) === null);
ck('on the day', (dueReason(base, at('2026-11-22T14:00:00Z')) || {}).kind === 'today');
ck('31st in a 30-day month lands on the 30th (3 days before = 27th)', (dueReason(base, at('2026-11-27T14:00:00Z')) || {}).kind === 'soon');
ck('the 1st is a check-in', (dueReason(base, at('2026-12-01T14:00:00Z')) || {}).kind === 'checkin');
ck('a quiet day sends nothing', dueReason(base, at('2026-11-10T14:00:00Z')) === null);
ck('weekly: Mondays only', (dueReason({ ...base, cadence: 'weekly' }, at('2026-11-16T14:00:00Z')) || {}).kind === 'weekly' && dueReason({ ...base, cadence: 'weekly' }, at('2026-11-17T14:00:00Z')) === null);
ck('monthly: the 1st only', (dueReason({ ...base, cadence: 'monthly' }, at('2026-12-01T14:00:00Z')) || {}).kind === 'checkin' && dueReason({ ...base, cadence: 'monthly' }, at('2026-11-22T14:00:00Z')) === null);
ck('time zone respected (Los Angeles 9 AM = 17:00 UTC)', (dueReason({ ...base, tz: 'America/Los_Angeles' }, at('2026-11-22T17:00:00Z')) || {}).kind === 'today');

// cron: sends once, with a valid VAPID signature, empty body; drops dead endpoints
const calls = [];
const fakePush = async (url, opt) => { calls.push({ url, opt }); return new Response(null, { status: url.includes('dead') ? 410 : 201 }); };
await handle(req('/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/dead', days: [22] }), env);
let out = await runCron(env, at('2026-11-22T14:00:00Z'), fakePush);
ck('cron sends to the due phone and removes the dead one', out.sent === 1 && out.removed === 1, JSON.stringify(out));
const c = calls.find(x => x.url === EP);
const auth = c.opt.headers.Authorization;
const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/) || [];
const [h, b, sig] = jwt.split('.');
const pub = Buffer.from(k, 'base64url');
const pk = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
const ok = verify('sha256', Buffer.from(h + '.' + b), { key: pk, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
ck('VAPID header is signed with the published key, audience = push origin', ok && claims.aud === 'https://fcm.googleapis.com' && k === key.key);
ck('the push carries no body', c.opt.headers['Content-Length'] === '0' && !c.opt.body);
out = await runCron(env, at('2026-11-22T14:00:00Z'), fakePush);
ck('never twice for the same day', out.sent === 0, JSON.stringify(out));

// unsubscribe
r = await handle(req('/push/unsubscribe', { endpoint: EP }), env);
ck('unsubscribe deletes the record', r.status === 200 && ![...env.SUBS.m.keys()].some(k => k.startsWith('sub:')));

const pass = R.filter(Boolean).length;
console.log(`\n${pass}/${R.length} passed`);
process.exit(pass === R.length ? 0 : 1);
