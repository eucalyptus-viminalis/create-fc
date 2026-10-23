// Photographs each document into the small pictures the contents pile uses (shared/doc-nav.js):
//   site/img/nav/<section id>.jpg   240px tall, the document's own width
// Re-run it after a document changes how it looks.
// Run the site first (pnpm site:dev), then: pnpm nav-thumbs:render [base URL]
// Uses your installed Chrome.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = path.join(repo, 'site', 'img', 'nav');
const base = (process.argv[2] || 'http://localhost:5173/').replace(/\/?$/, '/');
const HEIGHT = 240;

// what to photograph in each section: the document itself, without its desk
const SHOTS = {
  hero: '#hero .hero',
  agent: '#agent .sheet',
  kit: '#kit .sheet',
  explainers: '#bayer-book .page.cover',   // the front cover, not the open spread
  costs: '#nc-chart svg',
  troubleshooting: '#ts-sheet',
  seed: '#seed .slot img',
  client: '#client .sheet',
  finish: '#nda-sheet',
};

fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base);
await page.waitForLoadState('networkidle');
// no clipboard, no contents pile, nothing mid-animation
await page.addStyleTag({ content: '.cbd, .docnav { display: none !important; } *, *::before, *::after { transition: none !important; animation: none !important; }' });
await page.waitForTimeout(1200);

for (const [id, sel] of Object.entries(SHOTS)) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const png = await el.screenshot({ type: 'png' });
  // scale to HEIGHT in the browser, so this needs nothing but Playwright
  const jpg = await page.evaluate(async ({ src, h }) => {
    const img = new Image(); img.src = src; await img.decode();
    const c = document.createElement('canvas');
    c.height = h; c.width = Math.round(img.naturalWidth * h / img.naturalHeight);
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .84).split(',')[1];
  }, { src: 'data:image/png;base64,' + png.toString('base64'), h: HEIGHT });
  fs.writeFileSync(path.join(dir, id + '.jpg'), Buffer.from(jpg, 'base64'));
  console.log('wrote site/img/nav/' + id + '.jpg');
}
await browser.close();
