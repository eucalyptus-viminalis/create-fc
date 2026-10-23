// Seed phrase safety: the qualification card, front and back, as a 1940s first-aid certificate.
// Type your name on the dim line; it's kept in this browser. The date is typed in for you.
import { inkFilter, dust } from '../../shared/paper.js';

const doc = document.getElementById('seed');
inkFilter('seed-1', '#1d1a16', { wobble: .8, specks: 4.6, plate: .42, spread: .3, bleed: .45, drift: 1.4 });
inkFilter('seed-2', '#b0302a', { wobble: .8, specks: 4.6, plate: .35, spread: .3, bleed: .45, drift: 1.4 });

const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
doc.querySelectorAll('.typed.date').forEach(d => { d.textContent = today; });

const name = doc.querySelector('.typed[contenteditable]');
try { name.textContent = localStorage.getItem('nda-qual-name') || ''; } catch {}
name.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
name.addEventListener('input', () => { try { localStorage.setItem('nda-qual-name', name.textContent.slice(0, 32)); } catch {} });

// Each card is fixed card stock, scaled to fit beside the other or, when narrow, on its own.
const pair = doc.querySelector('.pair');
new ResizeObserver(() => {
  const w = pair.clientWidth, s = w >= 520 * 2 + 56 ? 1 : Math.min(1, w / 530);
  pair.style.setProperty('--s', s);
}).observe(pair);

doc.querySelectorAll('.card').forEach((c, k) => dust(c, c.querySelector('.dust'), 31 + k * 17, 26));
