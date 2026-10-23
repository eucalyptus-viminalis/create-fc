// Hero: copying the command cuts the coupon out of the page and clips it to the clipboard dock
// (shared/clipboard-dock.js). A bell sits in the hole; ringing it patches in a fresh coupon.
import { dust } from '../../shared/paper.js';

const doc = document.getElementById('hero');
const page = doc.querySelector('.page'), coupon = doc.querySelector('.coupon'), cmd = coupon.querySelector('.cmd');
const CMD = cmd.dataset.cmd;

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

const BELL = `<svg viewBox="0 0 120 92" aria-hidden="true"><defs><radialGradient id="hero-dome" cx="35%" cy="30%" r="80%"><stop offset="0" stop-color="#fbfbf6"/><stop offset=".45" stop-color="#c9c8bf"/><stop offset="1" stop-color="#6e6d66"/></radialGradient>
  <linearGradient id="hero-base" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3a3a36"/><stop offset="1" stop-color="#151513"/></linearGradient></defs>
  <g class="plunger"><rect x="55" y="6" width="10" height="14" rx="2" fill="#8d8c84"/><ellipse cx="60" cy="7" rx="9" ry="4" fill="#d9d8d0"/></g>
  <path d="M14 74 C14 38 34 20 60 20 S106 38 106 74 Z" fill="url(#hero-dome)"/><ellipse cx="44" cy="40" rx="14" ry="7" fill="#fff" opacity=".55" transform="rotate(-25 44 40)"/>
  <rect x="6" y="72" width="108" height="14" rx="5" fill="url(#hero-base)"/></svg>`;

cmd.addEventListener('click', () => {
  dock.copy({ text: CMD, title: 'Command 0', from: coupon, kind: 'coupon', paper: '#e2e0d4', sound: 'cut', onLift: () => {
    if (!page.querySelector('.hole')) page.insertAdjacentHTML('beforeend', `<div class="hole"><p>Coupon clipped<small>Ring for a fresh one</small></p><button type="button" class="bell" aria-label="Ring the bell: throw out the used coupon and print a new one">${BELL}</button></div>`);
    placeHole(); coupon.classList.add('gone');
    setTimeout(() => page.querySelector('.hole .bell')?.focus({ preventScroll: true }), 900);
  } });
});
page.addEventListener('click', e => {
  const bell = e.target.closest('.hole .bell'); if (!bell) return;
  dock.play('bell'); bell.classList.remove('ding'); void bell.offsetWidth; bell.classList.add('ding');
  setTimeout(() => dock.toss(), 260);                                   // out goes the used one
  setTimeout(() => {                                                    // and a new coupon is patched in
    page.querySelector('.hole').remove();
    const box = coupon.querySelector('.yes input'); if (box.checked) { box.checked = false; box.dispatchEvent(new Event('change')); }
    coupon.classList.remove('gone', 'fresh'); void coupon.offsetWidth; coupon.classList.add('fresh');
    cmd.focus({ preventScroll: true });
  }, 720);
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
