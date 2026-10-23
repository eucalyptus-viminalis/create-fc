// Photographs the qualification card (site/next/sections/seed/card.html) into the images the site
// shows and offers for download:
//   site/next/img/nda-card-front.png   front, flat, transparent corners
//   site/next/img/nda-card-back.png    back, flat
//   site/next/img/nda-card.png         both, tilted on the desk: the Download
// Run the site first (pnpm site:dev), then: pnpm seed-card:render [base URL]
// Uses your installed Chrome.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = f => path.join(repo, 'site', 'next', 'img', f);
const base = (process.argv[2] || 'http://localhost:5173/next/').replace(/\/?$/, '/');
const plate = base + 'sections/seed/card.html';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
const ready = async url => { await page.goto(url); await page.waitForSelector('body[data-ready]'); await page.waitForTimeout(600); };

// one card at a time, flat
await ready(plate + '?flat');
const cards = page.locator('.card');
await cards.nth(0).screenshot({ path: out('nda-card-front.png'), omitBackground: true });
await cards.nth(1).screenshot({ path: out('nda-card-back.png'), omitBackground: true });

// both, as they lie on the desk
await ready(plate);
await page.addStyleTag({ content: '.doc-seed { padding: 70px 60px 80px; display: inline-block; } .doc-seed .pair { flex-wrap: nowrap; }' });
await page.locator('.doc-seed').screenshot({ path: out('nda-card.png') });

await browser.close();
console.log('wrote site/next/img/nda-card-front.png, nda-card-back.png, nda-card.png');
