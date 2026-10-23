// Explainers: "how farcaster works", a booklet that handles like a real one (after AnyFlip).
// StPageFlip (vendor/page-flip) does the paper: hover a corner and it lifts, drag it and the page
// curls after your pointer with shadows, let go and it falls over or springs back. Click a page's
// outer edge to turn it. Covers are stiff card. Two-page spreads on wide screens, one page at a
// time on narrow ones. Every page has its own link (#explain-fid ...).
import { PageFlip } from '../../vendor/page-flip/page-flip.module.js';

const doc = document.getElementById('explainers');
const $ = id => doc.querySelector('#' + id);
const book = $('bayer-book');
const pages = [...book.querySelectorAll(':scope > .page')];

// Fill in the repeated shapes: 20 bytes, 6 validators, 11 storage cells.
doc.querySelector('#bayer-bytes').innerHTML = Array.from({ length: 20 }, (_, i) => `<rect x="${i * 20}" y="206" width="16" height="16" fill="${i < 4 ? '#d2301f' : '#161514'}"/>`).join('');
doc.querySelector('#bayer-ring').innerHTML = Array.from({ length: 6 }, (_, i) => { const t = i / 6 * Math.PI * 2 - Math.PI / 2; return `<circle cx="${(120 + 84 * Math.cos(t)).toFixed(1)}" cy="${(120 + 84 * Math.sin(t)).toFixed(1)}" r="13"/>`; }).join('');
doc.querySelector('#bayer-cells').innerHTML = Array.from({ length: 11 }, (_, i) => `<rect x="${34 + i * 30}" y="80" width="26" height="40" fill="${i % 3 === 1 ? '#2c55a0' : '#161514'}"/>`).join('');

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const flip = new PageFlip(book, {
  width: 540, height: 763,            // one page, A-series proportions (1 : 1.414)
  size: 'stretch', minWidth: 280, maxWidth: 540, minHeight: 396, maxHeight: 763,
  showCover: true,                    // the cover and back cover sit alone
  usePortrait: true,                  // one page at a time when there isn't room for two
  drawShadow: true, maxShadowOpacity: 0.45,
  flippingTime: reduce ? 1 : 750,
  showPageCorners: true,              // hovering a corner lifts it a little
  mobileScrollSupport: true,          // vertical swipes still scroll the site
  swipeDistance: 30,
  startZIndex: 1,
});
flip.loadFromHTML(pages);

// Contents (sidebar), dots, label and arrows all follow the page you're on.
const toc = $('bayer-toc'), tabs = $('bayer-tabs');
const name = p => p.dataset.name;
toc.innerHTML = pages.filter(p => !['explain-cover', 'explain-back'].includes(p.id)).map(p => {
  const [n, ...t] = name(p).split(' '), num = /^\d+$/.test(n);
  return `<li><a href="#${p.id}" data-id="${p.id}">${num ? `<b>${n}</b><span>${t.join(' ')}</span>` : `<b></b><span>${name(p)}</span>`}</a></li>`;
}).join('');
tabs.innerHTML = pages.map(p => `<button type="button" aria-label="${name(p)}"></button>`).join('');

// The pages on show for a given page index: its spread in landscape, itself in portrait.
function visible(i) {
  if (flip.getOrientation() === 'portrait' || i === 0 || i === pages.length - 1) return [i];
  const left = i % 2 ? i : i - 1;
  return [left, left + 1].filter(k => k < pages.length);
}
let linked = false;
function mark(i) {
  const on = visible(i);
  $('bayer-prev').disabled = i === 0;
  $('bayer-next').disabled = on.at(-1) >= pages.length - 1;
  tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', on.includes(k)));
  toc.querySelectorAll('a').forEach(a => { const k = pages.findIndex(p => p.id === a.dataset.id); on.includes(k) ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  // once the reader has turned a page, the address names the page they're on
  if (linked) { const k = on.find(k => pages[k].id !== 'explain-contents') ?? on[0]; history.replaceState(null, '', '#' + pages[k].id); }
}
flip.on('flip', e => { linked = true; mark(e.data); });
flip.on('changeOrientation', () => mark(flip.getCurrentPageIndex()));
mark(0);

const indexOf = id => pages.findIndex(p => p.id === id);
const go = i => { if (i < 0 || i >= pages.length) return; linked = true; Math.abs(i - flip.getCurrentPageIndex()) > 2 ? flip.turnToPage(i) : flip.flip(i); mark(i); };
$('bayer-prev').onclick = () => flip.flipPrev('bottom');
$('bayer-next').onclick = () => flip.flipNext('bottom');
tabs.querySelectorAll('button').forEach((b, k) => b.onclick = () => go(k));
toc.addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return;
  e.preventDefault(); go(indexOf(a.dataset.id));
  if (book.getBoundingClientRect().top < 0) book.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
// links inside the pages (the contents page)
book.addEventListener('click', e => { const a = e.target.closest('a[href^="#explain-"]'); if (!a) return; e.preventDefault(); go(indexOf(a.getAttribute('href').slice(1))); });

// Arrow keys turn pages only while the booklet is mostly on screen, and not while typing elsewhere.
let onScreen = false;
new IntersectionObserver(([e]) => { onScreen = e.intersectionRatio > .5; }, { threshold: [0, .5, 1] }).observe(book);
addEventListener('keydown', e => {
  if (!onScreen || e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowRight') flip.flipNext('bottom');
  if (e.key === 'ArrowLeft') flip.flipPrev('bottom');
});

// A link to a page (#explain-fid) opens the booklet there.
const open = () => { const i = indexOf(location.hash.slice(1)); if (i >= 0) { flip.turnToPage(i); mark(i); doc.scrollIntoView(); } };
open();
addEventListener('hashchange', open);
if (indexOf(location.hash.slice(1)) >= 0) addEventListener('load', () => doc.scrollIntoView(), { once: true });
