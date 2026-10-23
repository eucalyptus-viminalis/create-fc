// Seed phrase safety: the operator training card. Click (or Enter) turns it over; on the back,
// tick the four checks in pencil and type your name. Ticks and name are kept in this browser.
const doc = document.getElementById('seed');
const card = doc.querySelector('#tc-card');
const front = doc.querySelector('#tc-front').innerHTML, back = doc.querySelector('#tc-back').innerHTML;
const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });

// A face, with the other side's print showing faintly through the card.
function face(html, other, cls = '') {
  const el = document.createElement('div'); el.className = 'face ' + cls; el.innerHTML = html;
  const ghost = document.createElement('div'); ghost.innerHTML = other;
  const through = ghost.querySelector('.content'); through.querySelectorAll('[id], [contenteditable]').forEach(e => { e.removeAttribute('id'); e.removeAttribute('contenteditable'); });
  el.querySelector('.show').append(through);
  el.querySelectorAll('.show').forEach(s => s.setAttribute('aria-hidden', 'true'));
  el.querySelectorAll('.typed.date').forEach(d => { d.textContent = today; });
  return el;
}
const inner = document.createElement('div'); inner.className = 'in';
const F = face(front, back), B = face(back, front, 'b');
inner.append(F, B); card.append(inner);

const KEY = 'nda-card-4';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = st => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
const st = load();

// The back's checks: pencil ticks, remembered.
B.querySelectorAll('.checks li').forEach((li, i) => {
  li.setAttribute('role', 'checkbox'); li.tabIndex = -1;
  const set = on => { li.classList.toggle('on', on); li.setAttribute('aria-checked', on); };
  set(!!st['c' + i]);
  li.addEventListener('click', e => { e.stopPropagation(); const on = !li.classList.contains('on'); set(on); st['c' + i] = on; save(st); });
  li.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); li.click(); } });
});
// The operator line: typed in, remembered.
const name = B.querySelector('.typed[contenteditable]');
name.textContent = st.operator || '';
name.addEventListener('click', e => e.stopPropagation());
name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
name.addEventListener('input', () => { st.operator = name.textContent.slice(0, 40); save(st); });

// Turning it over. Only the side facing you can be tabbed to.
function turn(toBack = !card.classList.contains('back')) {
  card.classList.toggle('back', toBack);
  F.inert = toBack; B.inert = !toBack;
  B.querySelectorAll('.checks li').forEach(li => { li.tabIndex = toBack ? 0 : -1; });
  card.setAttribute('aria-label', toBack ? 'Training card, back: four checks. Press to turn it over' : 'Training card. Press to turn it over');
}
turn(false);
card.addEventListener('click', () => turn());
card.addEventListener('keydown', e => { if (e.target === card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); turn(); } });
doc.querySelector('.flip').addEventListener('click', () => turn());

// Scale the card to its column, never up.
const fitBox = card.parentElement;
new ResizeObserver(() => fitBox.style.setProperty('--s', Math.min(1, fitBox.clientWidth / 580))).observe(fitBox);
