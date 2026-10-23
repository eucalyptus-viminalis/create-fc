// The Network Decentralization Authority's register: a Cloudflare Worker with a D1 database.
//
//   POST /apply          NDA Form 1 from the microsite. Records the filing and returns a new member
//                        number. Filings never change each other, even with the same FID or e-mail.
//   GET  /m/:n           a member's page: what a cast embed links to. Its preview image is the card.
//   GET  /m/:n/card.png  the member card, 1200x630.
//   GET|POST /confirm    the link in a bulletin confirmation e-mail (src/bulletins.js).
//   GET|POST /unsubscribe  the link that stops bulletins.
//
// Only the name, number, enrolled date and signature are ever public. The contact stays in D1.
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import courier from '@expo-google-fonts/courier-prime/700Bold/CourierPrime_700Bold.ttf';
import archivo from '@expo-google-fonts/archivo-narrow/600SemiBold/ArchivoNarrow_600SemiBold.ttf';
import franklin from '@expo-google-fonts/libre-franklin/900Black/LibreFranklin_900Black.ttf';
import apple from '@expo-google-fonts/homemade-apple/400Regular/HomemadeApple_400Regular.ttf';
import { checkApplication, memberNo, enrolledDate } from './apply.js';
import { cardSvg, renderPng } from './card.js';
import { requestBulletins, linkPage } from './bulletins.js';

const FONTS = [courier, archivo, franklin, apple].map(b => new Uint8Array(b));
let ready;
const resvg = () => (ready ??= initWasm(wasm));

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

function cors(request, env) {
  const origin = request.headers.get('origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' };
}

const publicMember = row => ({
  number: row.id,
  no: memberNo(row.id),
  name: row.name,
  signature: row.signature,
  enrolled: enrolledDate(row.created_at),
});

async function apply(request, env) {
  const headers = cors(request, env);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Send the form as JSON.' }, 400, headers); }
  const checked = checkApplication(body);
  if (!checked.ok) return json({ error: 'Returned for correction.', errors: checked.errors }, 422, headers);
  const m = checked.member;
  // Every filing is a new member. Nothing on the form proves who owns an FID or e-mail address, so a
  // filing must never change one made before it.
  const row = await env.DB.prepare(
    `INSERT INTO members (contact, kind, name, signature, bulletins) VALUES (?1, ?2, ?3, ?4, ?5)
     RETURNING id, name, signature, created_at`,
  ).bind(m.contact, m.kind, m.name, m.signature, m.bulletins ? 1 : 0).first();
  const url = new URL(request.url), site = url.origin;
  // E-mail bulletins start only when the address confirms. (FID bulletins aren't set up yet.)
  const bulletins = m.bulletins && m.kind === 'email'
    ? await requestBulletins(env, m.contact, { origin: site, local: ['localhost', '127.0.0.1'].includes(url.hostname) })
    : null;
  return json({ ...publicMember(row), page: `${site}/m/${row.id}`, card: `${site}/m/${row.id}/card.png`, bulletins }, 200, headers);
}

const findMember = (env, n) =>
  env.DB.prepare('SELECT id, name, signature, created_at, updated_at FROM members WHERE id = ?1').bind(n).first();

async function card(request, env, ctx, n) {
  const row = await findMember(env, n);
  if (!row) return new Response('No such member.', { status: 404 });
  // One render per version of the card: the cache key includes when it last changed.
  const key = new Request(`${new URL(request.url).origin}/m/${n}/card.png?v=${encodeURIComponent(row.updated_at)}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return hit;
  await resvg();
  const m = publicMember(row);
  const png = renderPng(Resvg, cardSvg({ name: m.name, number: m.no, enrolled: m.enrolled, signature: m.signature }), FONTS);
  const res = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=3600' } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function page(request, env, n) {
  const row = await findMember(env, n);
  if (!row) return new Response('No such member.', { status: 404 });
  const m = publicMember(row), origin = new URL(request.url).origin, img = `${origin}/m/${n}/card.png`;
  const title = `${m.name}, member ${m.no} · Network Decentralization Authority`;
  const site = env.SITE_URL || 'https://createfc.org/';
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="A certified node operator. Run your own Farcaster node with create-fc.">
<meta property="og:type" content="website"><meta property="og:url" content="${origin}/m/${n}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="Run your own Farcaster node with create-fc.">
<meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(`Network Decentralization Authority member card: ${m.name}, ${m.no}, enrolled ${m.enrolled}.`)}">
<meta name="twitter:card" content="summary_large_image">
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;gap:20px;padding:24px 16px;background:#c9c7bc;font:500 16px/1.4 system-ui,sans-serif;color:#1c1c1a;text-align:center}img{width:min(900px,100%);height:auto}a{color:#24493b;font-weight:700}</style>
</head><body><img src="${img}" width="1200" height="630" alt="${esc(`Member card: ${m.name}, ${m.no}, enrolled ${m.enrolled}.`)}">
<p>Want one? <a href="${esc(site)}">Run your own Farcaster node with create-fc</a>.</p></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/apply') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
      if (request.method === 'POST') {
        // Errors keep the CORS headers, so the form can tell the visitor instead of the browser hiding it.
        try { return await apply(request, env); }
        catch (e) { console.error(e); return json({ error: "The register couldn't record that. Try again." }, 500, cors(request, env)); }
      }
      return json({ error: 'POST the form here.' }, 405);
    }
    if (url.pathname === '/confirm' || url.pathname === '/unsubscribe') {
      if (request.method === 'GET' || request.method === 'POST') return linkPage(request, env, url.pathname.slice(1));
      return new Response('Open the link from the e-mail.', { status: 405 });
    }
    const m = url.pathname.match(/^\/m\/(\d{1,9})(\/card\.png)?$/);
    if (m && request.method === 'GET') return m[2] ? card(request, env, ctx, Number(m[1])) : page(request, env, Number(m[1]));
    return new Response('Network Decentralization Authority. Nothing here.', { status: 404 });
  },
};
