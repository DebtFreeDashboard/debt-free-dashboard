/* DebtFree Dashboard — Google Play purchase verifier (Cloudflare Worker)
 *
 * The app's ONLY server. It never sees debt data: the Play app sends it a
 * purchase token and a product id, nothing else. It asks Google whether the
 * purchase is real and, if Google has not been told yet, acknowledges it.
 * Google refunds any purchase that is not acknowledged within 3 days, and the
 * acknowledgment can only come from a server holding a service-account key.
 *
 *   POST /verify   {"purchaseToken": "...", "productId": "premium_unlock"}
 *   200 {"valid": true,  "acknowledged": true}
 *   200 {"valid": false, "reason": "not_purchased" | "unknown_product" | "not_found"}
 *   4xx/5xx {"error": "..."}       (the app treats these as "try again later")
 *
 * Secrets / vars (Cloudflare dashboard → Worker → Settings → Variables):
 *   SA_EMAIL        service account email          (plain text var)
 *   SA_PRIVATE_KEY  service account private_key    (SECRET; the PEM text from the JSON key file)
 *   PACKAGE_NAME    com.mydebtdashboard.app        (plain text var)
 *
 * Nothing is stored and nothing is logged except error codes.
 */
const ALLOWED_ORIGINS = ['https://mydebtdashboard.com'];
const PRODUCTS = ['premium_unlock'];
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';

function cors(origin) {
  const ok = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors(origin)) });
}

function b64url(bytes) {
  let s = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function pemToDer(pem) {
  const body = String(pem).replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

let _token = null; // { value, exp } — reused while the isolate lives
async function accessToken(env, fetchImpl) {
  const now = Math.floor(Date.now() / 1000);
  if (_token && _token.exp - 60 > now) return _token.value;
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(enc.encode(JSON.stringify({
    iss: env.SA_EMAIL, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  })));
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(env.SA_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(header + '.' + claims));
  const assertion = header + '.' + claims + '.' + b64url(sig);
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(assertion)
  });
  if (!res.ok) throw new Error('token_' + res.status);
  const data = await res.json();
  _token = { value: data.access_token, exp: now + (data.expires_in || 3600) };
  return _token.value;
}

export async function handle(request, env, fetchImpl) {
  fetchImpl = fetchImpl || fetch;
  const origin = request.headers.get('Origin') || '';
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const url = new URL(request.url);
  if (url.pathname !== '/verify') return json({ error: 'not_found' }, 404, origin);
  if (request.method !== 'POST') return json({ error: 'method' }, 405, origin);
  if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin' }, 403, origin);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad_json' }, 400, origin); }
  const token = String((body && body.purchaseToken) || '');
  const productId = String((body && body.productId) || '');
  if (!PRODUCTS.includes(productId)) return json({ valid: false, reason: 'unknown_product' }, 200, origin);
  if (!/^[A-Za-z0-9._\-]{20,500}$/.test(token)) return json({ error: 'bad_token' }, 400, origin);
  if (!env.SA_EMAIL || !env.SA_PRIVATE_KEY || !env.PACKAGE_NAME) return json({ error: 'not_configured' }, 500, origin);

  try {
    const at = await accessToken(env, fetchImpl);
    const base = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
      encodeURIComponent(env.PACKAGE_NAME) + '/purchases/products/' + encodeURIComponent(productId) +
      '/tokens/' + encodeURIComponent(token);
    const g = await fetchImpl(base, { headers: { Authorization: 'Bearer ' + at } });
    if (g.status === 404 || g.status === 410) return json({ valid: false, reason: 'not_found' }, 200, origin);
    if (!g.ok) return json({ error: 'google_' + g.status }, 502, origin);
    const p = await g.json();
    // purchaseState: 0 purchased, 1 canceled (refunded/voided), 2 pending
    if (p.purchaseState !== 0) return json({ valid: false, reason: p.purchaseState === 2 ? 'pending' : 'not_purchased' }, 200, origin);
    if (p.acknowledgementState !== 1) {
      const a = await fetchImpl(base + ':acknowledge', { method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' }, body: '{}' });
      if (!a.ok) return json({ error: 'ack_' + a.status }, 502, origin);
    }
    return json({ valid: true, acknowledged: true }, 200, origin);
  } catch (e) {
    console.log('verify_error', String(e && e.message || e).slice(0, 60));
    return json({ error: 'server' }, 502, origin);
  }
}

export default { fetch: (request, env) => handle(request, env) };
