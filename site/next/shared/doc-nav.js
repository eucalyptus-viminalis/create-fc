// Contents pile (shared/doc-nav.css): lays the papers out, fans them out and back, lights the one
// you point at, and keeps the document you're reading on top of the pile as you scroll.
const nav = document.querySelector('.docnav');
if (nav) {
  const pile = nav.querySelector('.dn-pile'), hit = nav.querySelector('.dn-hit'), spot = nav.querySelector('.dn-spot');
  const count = nav.querySelector('.dn-count'), cards = [...nav.querySelectorAll(':scope > a')];
  const more = nav.querySelector('.dn-more');   // Docs and GitHub, under the last paper
  const docs = cards.map(a => document.getElementById(a.hash.slice(1)));
  const messy = [-3, 4, -6, 2, 7, -2, 5, -5, 1, -4, 3];   // how each paper lies in the pile
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  let H = 64, GROW = 1.7, rows = [], hot = -1, current = 0;

  // ---- layout: where each paper sits in the pile and in the fan ----
  function layout() {
    const css = getComputedStyle(nav), n = cards.length, phone = innerWidth <= 600;
    H = parseFloat(css.getPropertyValue('--dn-h')); GROW = parseFloat(css.getPropertyValue('--dn-grow'));
    const pw = H * 2.35, ph = H * 1.6, px = 14 + pw / 2, py = 10 + H * .7;   // the pile and its centre
    nav.style.setProperty('--dn-pile-l', '14px'); nav.style.setProperty('--dn-pile-t', '10px');
    nav.style.setProperty('--dn-pile-w', `${pw}px`); nav.style.setProperty('--dn-pile-h', `${ph}px`);
    nav.style.setProperty('--dn-count-x', `${px}px`); nav.style.setProperty('--dn-count-y', `${10 + ph - 4}px`);
    const MORE = 92;   // room under the last paper for the Docs and GitHub buttons
    const step = Math.min(H * 1.25, (innerHeight - 40 - H - MORE) / (n - 1)), bend = phone ? 36 : 120;
    let right = 0;
    rows = cards.map((a, i) => {
      const img = a.querySelector('img'), w = img.naturalWidth / img.naturalHeight * H, t = i / (n - 1);
      const x = (phone ? 14 : 24) + bend * t * t, y = 20 + i * step;
      a.style.setProperty('--i', i);
      a.style.setProperty('--sx', `${px - w / 2}px`); a.style.setProperty('--sy', `${py - H / 2}px`);
      a.style.setProperty('--fx', `${x}px`); a.style.setProperty('--fy', `${y}px`);
      a.style.setProperty('--fr', `${-14 * t * t}deg`);
      right = Math.max(right, x + w * GROW + 12 + a.querySelector('.dn-label').offsetWidth);
      return { x, w, mid: y + H / 2 };
    });
    // the hit layer covers the pile and every row, out past the widest name
    Object.assign(hit.style, { width: `${Math.min(innerWidth, right + 40)}px`, height: `${rows.at(-1).mid + H / 2 + 30}px` });
    nav.style.setProperty('--dn-more-x', `${rows.at(-1).x + 20}px`);
    nav.style.setProperty('--dn-more-y', `${rows.at(-1).mid + H / 2 + 22}px`);
    nav.style.setProperty('--dn-n', n);
    order();
  }

  // ---- the pile: the current document on top, lying square; the rest in page order underneath ----
  const nameOf = a => a.querySelector('.dn-label').firstChild.textContent.trim();
  function order() {
    const n = cards.length;
    cards.forEach((a, i) => {
      a.style.zIndex = i === current ? n + 2 : n - i + 1;
      a.style.setProperty('--sr', `${i === current ? -1.5 : messy[i % messy.length]}deg`);
      if (i === current) a.setAttribute('aria-current', 'location'); else a.removeAttribute('aria-current');
    });
    count.textContent = nameOf(cards[current]);
    pile.setAttribute('aria-label', `Documents. Now reading: ${nameOf(cards[current])}`);
  }
  function setCurrent(i, animate) {
    if (i === current) return;
    current = i;
    const a = cards[i];
    if (!animate || nav.classList.contains('open') || still.matches) return order();
    // slide the paper out, put it on top while it's clear of the pile, slide it back
    a.classList.remove('surfacing'); a.getBoundingClientRect(); a.classList.add('surfacing');
    setTimeout(order, 240);
    a.addEventListener('animationend', () => a.classList.remove('surfacing'), { once: true });
  }

  // ---- the fan: which row is lit ----
  function setHot(i) {
    if (i === hot) return;
    if (hot >= 0) {
      const old = cards[hot];
      old.classList.remove('hot'); old.classList.add('cool');
      clearTimeout(old.coolTimer); old.coolTimer = setTimeout(() => old.classList.remove('cool'), 220);
    }
    hot = i;
    if (i < 0) return nav.classList.remove('aim');
    const r = rows[i];
    cards[i].classList.add('hot');
    spot.style.setProperty('--dn-x', `${r.x + r.w * GROW / 2 + 60}px`);
    spot.style.setProperty('--dn-y', `${r.mid}px`);
    spot.style.setProperty('--dn-rx', `${r.w * GROW + 260}px`);
    spot.style.setProperty('--dn-ry', `${H * GROW + 140}px`);
    nav.classList.add('aim');
  }
  // the row nearest the cursor's height; the lit row holds until the cursor is 5px past the halfway line
  function rowAt(y, sticky = true) {
    const near = rows.reduce((best, r, i) => Math.abs(r.mid - y) < Math.abs(rows[best].mid - y) ? i : best, 0);
    return sticky && hot >= 0 && near !== hot && Math.abs(rows[near].mid - y) + 10 > Math.abs(rows[hot].mid - y) ? hot : near;
  }

  let closeTimer;
  function open() { clearTimeout(closeTimer); nav.classList.add('open'); pile.setAttribute('aria-expanded', 'true'); }
  function close() { clearTimeout(closeTimer); setHot(-1); nav.classList.remove('open'); pile.setAttribute('aria-expanded', 'false'); }

  // ---- going to a document ----
  let lockUntil = 0;   // while a click's smooth scroll runs, scrolling doesn't change the current document
  function go(i) {
    setCurrent(i, false);
    close();
    lockUntil = performance.now() + 1500;
    docs[i].scrollIntoView({ behavior: still.matches ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', cards[i].hash);
  }

  // mouse: reaching the pile opens it; leaving the fan folds it back
  pile.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') { open(); setHot(rowAt(e.clientY, false)); } });
  hit.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') setHot(rowAt(e.clientY)); });
  hit.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  hit.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') closeTimer = setTimeout(close, 200); });
  // touch: tap the pile to fan out, tap a paper or its name to go, tap beside the fan to fold it back
  pile.addEventListener('click', () => nav.classList.contains('open') ? close() : open());
  hit.addEventListener('click', e => go(e.pointerType === 'mouse' && hot >= 0 ? hot : rowAt(e.clientY, false)));
  nav.querySelector('.dn-dim').addEventListener('click', close);
  // pressing on the fan mustn't take focus off the pile: that reads as leaving, and folds the fan before the click lands
  hit.addEventListener('mousedown', e => e.preventDefault());
  // keyboard: Tab onto the pile fans it out, Tab through the papers, Enter goes, Esc folds back
  pile.addEventListener('focus', () => { if (pile.matches(':focus-visible')) open(); });
  cards.forEach((a, i) => {
    a.addEventListener('focus', () => { open(); setHot(i); });
    a.addEventListener('click', e => { e.preventDefault(); go(i); });
  });
  // the buttons under the fan: reaching them keeps it open and lets the last paper go dark
  more.addEventListener('pointerenter', () => { clearTimeout(closeTimer); setHot(-1); });
  more.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') closeTimer = setTimeout(close, 200); });
  more.addEventListener('focusin', () => { open(); setHot(-1); });
  more.addEventListener('mousedown', e => e.preventDefault());
  nav.addEventListener('focusout', e => { if (!nav.contains(e.relatedTarget)) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && nav.classList.contains('open')) { close(); pile.focus(); } });

  // ---- following the page: the current document is the last one whose top has passed 35% down the window ----
  function reading() {
    const line = innerHeight * .35;
    let i = 0;
    docs.forEach((d, k) => { if (d && d.getBoundingClientRect().top <= line) i = k; });
    return i;
  }
  let queued = false;
  function track() { queued = false; if (performance.now() >= lockUntil) setCurrent(reading(), true); }
  addEventListener('scroll', () => { if (!queued) { queued = true; requestAnimationFrame(track); } }, { passive: true });
  addEventListener('scrollend', () => { lockUntil = 0; track(); });

  let resizeQueued = false;
  addEventListener('resize', () => { if (!resizeQueued) { resizeQueued = true; requestAnimationFrame(() => { resizeQueued = false; close(); layout(); }); } });

  Promise.all(cards.map(a => a.querySelector('img').decode().catch(() => {}))).then(() => {
    current = reading();
    nav.classList.add('ready');   // shown first, so the names can be measured
    layout();
  });
}
