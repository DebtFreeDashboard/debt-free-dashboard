// node tools/play-billing/test-worker.mjs — exercises the verifier against a fake Google.
import { handle } from './worker.mjs';
import { generateKeyPairSync, createVerify } from 'node:crypto';

const R = []; const ck = (l, ok, d) => { R.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}`); if (d && !ok) console.log('      ' + d); };
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const env = { SA_EMAIL: 'svc@proj.iam.gserviceaccount.com', SA_PRIVATE_KEY: pem.replace(/\n/g, '\\n'), PACKAGE_NAME: 'com.mydebtdashboard.app' };
const TOKEN = 'abcdefghijklmnopqrstuvwxyz.ABCDEFG-123_456';

function fakeGoogle(state) {
  const calls = [];
  const f = async (url, opt = {}) => {
    calls.push({ url, method: opt.method || 'GET' });
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = decodeURIComponent(String(opt.body).split('assertion=')[1]);
      const [h, c, s] = assertion.split('.');
      const v = createVerify('RSA-SHA256'); v.update(h + '.' + c);
      const ok = v.verify(publicKey, Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      const claims = JSON.parse(Buffer.from(c.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
      state.jwtOk = ok && claims.iss === env.SA_EMAIL && /androidpublisher/.test(claims.scope);
      return new Response(JSON.stringify({ access_token: 'AT', expires_in: 3600 }), { status: ok ? 200 : 401 });
    }
    if (opt.headers && opt.headers.Authorization !== 'Bearer AT') return new Response('{}', { status: 401 });
    if (url.endsWith(':acknowledge')) { state.acked = true; return new Response('{}', { status: state.ackStatus || 200 }); }
    if (url.includes('/purchases/products/premium_unlock/tokens/')) {
      if (state.missing) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ purchaseState: state.purchaseState, acknowledgementState: state.ack }), { status: 200 });
    }
    return new Response('{}', { status: 500 });
  };
  f.calls = calls; return f;
}
const req = (body, origin = 'https://mydebtdashboard.com', method = 'POST', path = '/verify') =>
  new Request('https://verify.example.workers.dev' + path, { method, headers: { 'Content-Type': 'application/json', Origin: origin }, body: method === 'POST' ? JSON.stringify(body) : undefined });

let st = { purchaseState: 0, ack: 0 }; let f = fakeGoogle(st);
let r = await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), env, f); let j = await r.json();
ck('new purchase: valid, and acknowledged with Google', r.status === 200 && j.valid === true && st.acked === true && st.jwtOk === true, JSON.stringify({ j, st }));
ck('CORS header returned for the site', r.headers.get('Access-Control-Allow-Origin') === 'https://mydebtdashboard.com');

st = { purchaseState: 0, ack: 1 }; f = fakeGoogle(st);
r = await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), env, f); j = await r.json();
ck('already acknowledged: valid, no second acknowledge call', j.valid === true && !st.acked && !f.calls.some(c => c.url.endsWith(':acknowledge')));

st = { purchaseState: 1, ack: 1 }; f = fakeGoogle(st);
j = await (await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), env, f)).json();
ck('refunded/canceled: not valid', j.valid === false && j.reason === 'not_purchased');

st = { purchaseState: 2, ack: 0 }; f = fakeGoogle(st);
j = await (await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), env, f)).json();
ck('pending payment: not valid yet, not acknowledged', j.valid === false && j.reason === 'pending' && !st.acked);

st = { missing: true }; f = fakeGoogle(st);
j = await (await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), env, f)).json();
ck('unknown token at Google: not valid', j.valid === false && j.reason === 'not_found');

st = { purchaseState: 0, ack: 0, ackStatus: 500 }; f = fakeGoogle(st);
r = await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), env, f);
ck('acknowledge failure surfaces as an error (app retries later)', r.status === 502);

j = await (await handle(req({ purchaseToken: TOKEN, productId: 'something_else' }), env, fakeGoogle({}))).json();
ck('other product ids refused', j.valid === false && j.reason === 'unknown_product');
r = await handle(req({ purchaseToken: '<script>', productId: 'premium_unlock' }), env, fakeGoogle({}));
ck('malformed token refused before any Google call', r.status === 400);
r = await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }, 'https://evil.example'), env, fakeGoogle({ purchaseState: 0, ack: 0 }));
ck('other websites refused', r.status === 403);
r = await handle(req(null, 'https://mydebtdashboard.com', 'OPTIONS'), env, fakeGoogle({}));
ck('CORS preflight answered', r.status === 204);
r = await handle(req(null, 'https://mydebtdashboard.com', 'GET'), env, fakeGoogle({}));
ck('GET refused', r.status === 405);
r = await handle(req({ purchaseToken: TOKEN, productId: 'premium_unlock' }), { PACKAGE_NAME: 'x' }, fakeGoogle({}));
ck('missing secrets reported, not crashed', r.status === 500);

const pass = R.filter(Boolean).length;
console.log(`\n${pass}/${R.length} passed`);
process.exit(pass === R.length ? 0 : 1);
