// Explainers: "how farcaster works", a booklet you turn page by page. Spreads on a desk, one
// page at a time on a phone; the right-hand leaf turns like paper. Each page has its own link
// (#explain-fid ...). Arrow keys turn pages while the booklet is on screen.
const doc = document.getElementById('explainers');
const $ = id => doc.querySelector('#' + id);
const src = $('bayer-src');

// Fill in the repeated shapes: 20 bytes, 6 validators, 11 storage cells.
src.querySelector('#bayer-bytes').innerHTML = Array.from({ length: 20 }, (_, i) => `<rect x="${i * 20}" y="206" width="16" height="16" fill="${i < 4 ? '#d2301f' : '#161514'}"/>`).join('');
src.querySelector('#bayer-ring').innerHTML = Array.from({ length: 6 }, (_, i) => { const t = i / 6 * Math.PI * 2 - Math.PI / 2; return `<circle cx="${(120 + 84 * Math.cos(t)).toFixed(1)}" cy="${(120 + 84 * Math.sin(t)).toFixed(1)}" r="13"/>`; }).join('');
src.querySelector('#bayer-cells').innerHTML = Array.from({ length: 11 }, (_, i) => `<rect x="${34 + i * 30}" y="80" width="26" height="40" fill="${i % 3 === 1 ? '#2c55a0' : '#161514'}"/>`).join('');

const P = [...src.children];
const book = $('bayer-book'), L = book.querySelector('.slot.l'), R = book.querySelector('.slot.r');
const leaf = book.querySelector('.leaf'), FA = leaf.querySelector('.a'), FB = leaf.querySelector('.b');
const tabs = $('bayer-tabs'), toc = $('bayer-toc');
// Contents: every page but the covers, numbered as in the booklet.
toc.innerHTML = P.filter(p => !['explain-cover', 'explain-back'].includes(p.id)).map(p => { const [n, ...t] = p.dataset.name.split(' '); const num = /^\d+$/.test(n); return `<li><a href="#${p.id}" data-id="${p.id}">${num ? `<b>${n}</b><span>${t.join(' ')}</span>` : `<b></b><span>${p.dataset.name}</span>`}</a></li>`; }).join('');
toc.addEventListener('click', e => { const a = e.target.closest('a'); if (!a) return; e.preventDefault(); go(indexOf(a.dataset.id)); if (book.getBoundingClientRect().top < 0) book.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
const narrow = matchMedia('(max-width: 760px)');
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
// desk spreads: [left, right]; the cover sits alone on the right, the back cover alone on the left
const spreads = () => {
  if (narrow.matches) return P.map(p => [null, p]);
  const s = [[null, P[0]]];
  for (let i = 1; i < P.length - 1; i += 2) s.push([P[i], P[i + 1] || null]);
  if ((P.length - 2) % 2 === 0) s.push([P[P.length - 1], null]); else s[s.length - 1][1] = P[P.length - 1];
  return s;
};
let S = spreads(), at = 0, busy = false;
const copy = p => { if (!p) return ''; const c = p.cloneNode(true); c.removeAttribute('id'); c.querySelectorAll('[id]').forEach(e => e.removeAttribute('id')); return c.outerHTML; };
const put = (slot, p) => { slot.innerHTML = copy(p); };
// The controls, contents and address follow the page you asked for straight away, while it turns.
function mark(i, link = true) {
  const s = S[i];
  $('bayer-where').textContent = s.filter(Boolean).map(p => p.dataset.name).join('  ·  ');
  $('bayer-prev').disabled = i === 0;
  $('bayer-next').disabled = i === S.length - 1;
  tabs.querySelectorAll('button').forEach((b, k) => b.classList.toggle('on', k === i));
  toc.querySelectorAll('a').forEach(a => { const on = s.some(p => p && p.id === a.dataset.id); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  // only once the reader has turned a page: the address names the page they're on
  if (link) { const p = s[0] && s[0].id !== 'explain-contents' ? s[0] : s[1]; history.replaceState(null, '', '#' + p.id); }
}
function show(link = true) { put(L, S[at][0]); put(R, S[at][1]); mark(at, link); }
let finishTurn = null;
function go(to) {
  if (busy) finishTurn();                // clicking again mid-turn finishes the turn at once and starts the next
  if (to < 0 || to >= S.length || to === at) return;
  const fwd = to > at, from = S[at], next = S[to];
  if (narrow.matches || reduce.matches || Math.abs(to - at) > 1) { R.style.setProperty('--dx', fwd ? '24px' : '-24px'); at = to; return show(); }
  busy = true; mark(to);
  if (fwd) {   // right leaf turns over to the left
    FA.innerHTML = copy(from[1]); FB.innerHTML = copy(next[0]);
    put(R, next[1]); leaf.className = 'leaf on go-next';
  } else {     // left leaf turns back to the right
    FA.innerHTML = copy(from[0]); FB.innerHTML = copy(next[1]);
    put(L, next[0]); leaf.className = 'leaf on back-side go-prev';
  }
  // finish on animationend, or after the turn's length if the tab is in the background and never animates
  let done = false;
  const finish = finishTurn = () => { if (done) return; done = true; leaf.className = 'leaf'; at = to; busy = false; show(); };
  leaf.addEventListener('animationend', finish, { once: true }); setTimeout(finish, 520);
}
const buildTabs = () => {
  tabs.innerHTML = S.map(s => `<button type="button" aria-label="${s.filter(Boolean).map(p => p.dataset.name).join(', ')}"></button>`).join('');
  tabs.querySelectorAll('button').forEach((b, i) => b.onclick = () => go(i));
};
const indexOf = id => S.findIndex(s => s.some(p => p && p.id === id));
$('bayer-prev').onclick = () => go(at - 1);
$('bayer-next').onclick = () => go(at + 1);

// Arrow keys turn pages only while the booklet is mostly on screen, and not while typing elsewhere.
let visible = false;
new IntersectionObserver(([e]) => { visible = e.intersectionRatio > .5; }, { threshold: [0, .5, 1] }).observe(book);
addEventListener('keydown', e => {
  if (!visible || e.target.closest('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'ArrowRight') go(at + 1);
  if (e.key === 'ArrowLeft') go(at - 1);
});
book.addEventListener('click', e => { const a = e.target.closest('a[href^="#explain-"]'); if (!a) return; e.preventDefault(); const i = indexOf(a.getAttribute('href').slice(1)); if (i >= 0) go(i); });
let x0 = null; book.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
book.addEventListener('touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) go(at + (dx < 0 ? 1 : -1)); x0 = null; });
let mode = narrow.matches;
const relayout = () => { if (narrow.matches === mode) return; mode = narrow.matches; const id = (S[at][1] || S[at][0]).id; S = spreads(); buildTabs(); at = Math.max(0, indexOf(id)); show(false); };
narrow.addEventListener('change', relayout);
buildTabs();

// A link to a page (#explain-fid) opens the booklet there.
const open = () => { const i = indexOf(location.hash.slice(1)); if (i >= 0) { at = i; show(false); doc.scrollIntoView(); } };
at = 0; show(false); open();
// the page above may still be laying out (fonts, images); scroll again once it has
if (indexOf(location.hash.slice(1)) >= 0) addEventListener('load', () => doc.scrollIntoView(), { once: true });
addEventListener('hashchange', open);
