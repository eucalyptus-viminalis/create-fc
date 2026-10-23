// Hero: copying the command cuts the coupon out (a scissors snip, sounds/) and clips it
// to the clipboard dock (shared/clipboard-dock.js).
import { dust } from '../../shared/paper.js';

const doc = document.getElementById('hero');
const page = doc.querySelector('.page'), coupon = doc.querySelector('.coupon'), cmd = coupon.querySelector('.cmd');
const CMD = cmd.dataset.cmd;

// One snip of the scissors (sounds/scissors-snip.wav, cut from 0.30s to 0.45s of brand/sounds/scissors-2.wav).
const SNIPS = { src: new URL('../../sounds/scissors-snip.wav', import.meta.url).href, start: 0, end: 0.15 };
dock.preload(SNIPS.src);

// a scissor-cut outline: straight-ish edges with small wobbles where the blades met
function cutPath(w, h) {
  let seed = 1937; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), pts = [], j = () => (r() - .5) * 3.2;
  for (let x = 0; x <= w; x += 22 + r() * 30) pts.push(`${x.toFixed(0)}px ${j().toFixed(1)}px`);
  for (let y = 0; y <= h; y += 22 + r() * 30) pts.push(`${(w + j()).toFixed(1)}px ${y.toFixed(0)}px`);
  for (let x = w; x >= 0; x -= 22 + r() * 30) pts.push(`${x.toFixed(0)}px ${(h + j()).toFixed(1)}px`);
  for (let y = h; y >= 0; y -= 22 + r() * 30) pts.push(`${j().toFixed(1)}px ${y.toFixed(0)}px`);
  return `polygon(${pts.join(',')})`;
}
function placeHole() {
  const hole = page.querySelector('.hole'); if (!hole) return;
  const c = coupon.getBoundingClientRect(), p = page.getBoundingClientRect(), z = page.offsetWidth / p.width;   // undo the page's tilt scale
  const w = c.width * z, h = c.height * z;
  Object.assign(hole.style, { left: (c.left - p.left) * z + 'px', top: (c.top - p.top) * z + 'px', width: w + 'px', height: h + 'px', clipPath: cutPath(w, h) });
}

// Copying cuts the coupon out of the page and clips it to the clipboard. There's one per page:
// what's left is the hole, showing the desk underneath.
cmd.addEventListener('click', () => {
  if (coupon.classList.contains('gone')) return;
  dock.copy({ text: CMD, title: 'Command 0', from: coupon, kind: 'coupon', paper: '#e2e0d4', sound: SNIPS, onLift: () => {
    page.insertAdjacentHTML('beforeend', '<div class="hole" aria-hidden="true"></div>');
    placeHole(); coupon.classList.add('gone');
  } });
});
addEventListener('resize', () => { if (coupon.classList.contains('gone')) placeHole(); });

// Remember the YES box per visitor.
const yes = coupon.querySelector('.yes input');
try { yes.checked = localStorage.getItem('hero-yes') === '1'; } catch {}
yes.addEventListener('change', () => { try { localStorage.setItem('hero-yes', yes.checked ? '1' : '0'); } catch {} });

// A torn right edge (the page came out of the magazine) and dust on the scan.
function tear() {
  let seed = 1966; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const w = page.offsetWidth, h = page.offsetHeight, edge = [];
  for (let y = 0; y < h; y += 6 + rnd() * 10) edge.push(`${(w - 3 - rnd() * 12 - (rnd() < .08 ? 6 : 0)).toFixed(1)}px ${y.toFixed(0)}px`);
  page.style.setProperty('--torn', `polygon(0 0, ${edge.join(',')}, ${w - 8}px ${h}px, 0 ${h}px)`);
}
new ResizeObserver(tear).observe(page); tear();
dust(page, doc.querySelector('.dust'), 77);

// The next page's classified ads, faintly showing through the paper.
doc.querySelector('.show').textContent = 'Classified advertising rates: 85 cents per word, minimum 10 words. Inventors! Patent your idea. Learn TV and radio servicing at home. Build your own receiver from a kit. Amazing shortwave offer. Earn money in your spare time. '.repeat(14);
