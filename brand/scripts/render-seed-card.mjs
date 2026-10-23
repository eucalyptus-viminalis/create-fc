// Photographs the qualification card (site/sections/seed/card.html) into the images the site
// shows and offers for download:
//   site/img/nda-card-front.png   front, flat, transparent corners
//   site/img/nda-card-back.png    back, flat
//   site/img/nda-seed-phrase-card.zip   both sides, as the Download
// Needs zip (macOS and most Linux have it).
// Run the site first (pnpm site:dev), then: pnpm seed-card:render [base URL]
// Uses your installed Chrome.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { chromium } from 'playwright';

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = f => path.join(repo, 'site', 'img', f);
const base = (process.argv[2] || 'http://localhost:5173/').replace(/\/?$/, '/');
const plate = base + 'sections/seed/card.html';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 }, deviceScaleFactor: 2 });
const ready = async url => { await page.goto(url); await page.waitForSelector('body[data-ready]'); await page.waitForTimeout(600); };

// one card at a time, flat
await ready(plate + '?flat');
const cards = page.locator('.card');
await cards.nth(0).screenshot({ path: out('nda-card-front.png'), omitBackground: true });
await cards.nth(1).screenshot({ path: out('nda-card-back.png'), omitBackground: true });

await browser.close();

// the Download: each side, zipped, under names that make sense in a downloads folder
const tmp = fs.mkdtempSync(path.join(path.dirname(out('x')), '.zip-'));
fs.copyFileSync(out('nda-card-front.png'), path.join(tmp, 'seed-phrase-card-front.png'));
fs.copyFileSync(out('nda-card-back.png'), path.join(tmp, 'seed-phrase-card-back.png'));
fs.rmSync(out('nda-seed-phrase-card.zip'), { force: true });
execFileSync('zip', ['-qjX', out('nda-seed-phrase-card.zip'), path.join(tmp, 'seed-phrase-card-front.png'), path.join(tmp, 'seed-phrase-card-back.png')]);
fs.rmSync(tmp, { recursive: true });
console.log('wrote site/img/nda-card-front.png, nda-card-back.png, nda-seed-phrase-card.zip');
