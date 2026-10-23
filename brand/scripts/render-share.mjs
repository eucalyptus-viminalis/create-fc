// A share link for every document, with its own preview picture. Link previews (Farcaster, X, iMessage)
// never see the #section part of a link, so each document gets a real address instead, like
// createfc.org/costs: a small page with its own title and picture that forwards readers to /#costs.
//
// Writes, for each document:
//   site/next/<slug>/index.html      the share page
//   site/next/img/share/<slug>.jpg   its preview, 1200x630: the document on its own desk
//
// Run the site first (pnpm site:dev), then: pnpm share:render [site URL] [public URL]
//   site URL    where to photograph the documents (default http://localhost:5173/next/)
//   public URL  where the pages will live, for the absolute links previews need
//               (default https://createfc.org/next/; once the new site is at the root, https://createfc.org/)
// Uses your installed Chrome. Re-run it after a document changes how it looks or the site moves.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(repo, 'site', 'next');
const base = (process.argv[2] || 'http://localhost:5173/next/').replace(/\/?$/, '/');
const pub = (process.argv[3] || 'https://createfc.org/next/').replace(/\/?$/, '/');

// slug: the share address; id: the section it opens; shot: the document itself, without its desk;
// whole: show a tall document whole instead of large and cropped
const DOCS = [
  { slug: 'agent', id: 'agent', shot: '#agent .sheet',
    title: 'Let an agent set up your own Farcaster',
    desc: 'A service order for Claude Code, Codex or any agent that runs commands. It asks before spending money, and never for a seed phrase or token.' },
  { slug: 'quickstart', id: 'kit', shot: '#kit .sheet',
    title: 'Your own Farcaster in three commands',
    desc: 'The assembly manual: rent a server, sync a Snapchain read node, install the client. What you need, step by step.' },
  { slug: 'how-farcaster-works', id: 'explainers', shot: '#bayer-book .page.cover', whole: true,   // its title is at the bottom
    title: 'How Farcaster works',
    desc: 'Eleven ideas behind the node you just built, one page each, with pictures.' },
  { slug: 'costs', id: 'costs', shot: '#nc-chart svg',
    title: 'What your own Farcaster node costs',
    desc: 'About $1.30 to sync and try, about $4 a day, $105 a month. Billed by the hour until you delete it.' },
  { slug: 'troubleshooting', id: 'troubleshooting', shot: '#ts-sheet',
    title: 'Farcaster node troubleshooting',
    desc: 'Every error we hit setting up a node and client, its probable cause, and the fix.' },
  { slug: 'seed-phrases', id: 'seed', shot: '#seed .slot img',
    title: 'Seed phrase handling: the four rules',
    desc: 'The master key to your Farcaster account, and how to keep it. Download the qualification card.' },
  { slug: 'fameboy', id: 'client', shot: '#client .sheet',
    title: "fameboy: it's playtime, not scrolltime",
    desc: 'A Farcaster client that reads from your own node. Try the demo, no install needed.' },
  { slug: 'membership', id: 'finish', shot: '#nda-sheet',
    title: 'Join the Network Decentralization Authority',
    desc: 'Node in sync? Apply for membership, get your member card, and claim $5 for the server.' },
];

const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sharePage = d => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.title)} · create-fc</title>
<meta name="description" content="${esc(d.desc)}">
<link rel="canonical" href="${pub}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="create-fc">
<meta property="og:url" content="${pub}${d.slug}/">
<meta property="og:title" content="${esc(d.title)}">
<meta property="og:description" content="${esc(d.desc)}">
<meta property="og:image" content="${pub}img/share/${d.slug}.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=../#${d.id}">
<script>location.replace('../#${d.id}')</script>
</head>
<body>
<p><a href="../#${d.id}">${esc(d.title)}</a></p>
</body>
</html>
`;

fs.mkdirSync(path.join(out, 'img', 'share'), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base);
await page.waitForLoadState('networkidle');
await page.addStyleTag({ content: '.cbd, .docnav { display: none !important; } *, *::before, *::after { transition: none !important; animation: none !important; }' });
await page.waitForTimeout(1200);
const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });

for (const d of DOCS) {
  const el = page.locator(d.shot).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const png = (await el.screenshot({ type: 'png' })).toString('base64');
  // the section's own desk behind the document
  const desk = await page.evaluate(id => {
    const s = getComputedStyle(document.getElementById(id));
    return { color: s.backgroundColor, image: s.backgroundImage };
  }, d.id);
  // Wide documents fit whole. Tall ones would be too small to read in a preview, so they're shown
  // large, from the top, running off the bottom edge.
  const { width, height } = await el.boundingBox();
  const tall = !d.whole && height / width > .8;
  const img = tall
    ? 'width:780px;margin-top:44px;transform:rotate(-1.2deg);transform-origin:50% 0'
    : 'max-width:1080px;max-height:540px;transform:rotate(-1deg)';
  await card.setContent(`<!doctype html><html><body style="margin:0">
    <div style="width:1200px;height:630px;display:grid;place-items:${tall ? 'start center' : 'center'};overflow:hidden;background-color:${desk.color};background-image:${desk.image}">
      <img src="data:image/png;base64,${png}" style="${img};filter:drop-shadow(0 2px 1px rgb(0 0 0 / .18)) drop-shadow(8px 14px 22px rgb(0 0 0 / .4))">
    </div></body></html>`);
  await card.waitForTimeout(150);
  await card.screenshot({ path: path.join(out, 'img', 'share', d.slug + '.jpg'), type: 'jpeg', quality: 86 });
  fs.mkdirSync(path.join(out, d.slug), { recursive: true });
  fs.writeFileSync(path.join(out, d.slug, 'index.html'), sharePage(d));
  console.log(`wrote site/next/${d.slug}/ and site/next/img/share/${d.slug}.jpg`);
}
await browser.close();
