// Kit manual: ( ) boxes ticked in blue ballpoint, a server address written on the blank and
// filled into every command, Copy tabs that clip the command to the clipboard dock. Marks are kept in this browser only.
import { inkFilter } from '../../shared/paper.js';

const doc = document.getElementById('kit');
inkFilter('kit', '#151515');

// Ticks: a hand-drawn check, slightly different for every box, drawn on the pen layer above the
// photocopy. Positions come from layout offsets, so each page's tilt carries them.
let seed = 417; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const ticks = new Map();
doc.querySelectorAll('.box').forEach(b => {
  const j = () => +((rnd() - .5) * 3).toFixed(1);
  const t = document.createElement('div');
  t.innerHTML = `<svg class="tick" viewBox="0 0 26 28"><path d="M${3 + j()} ${15 + j()} Q 8 ${19 + j()} ${10 + j()} ${24 + j()} Q 14 12 ${24 + j()} ${2 + j()}"/></svg>`;
  const svg = t.firstElementChild; b.closest('.sheet').querySelector('.pen').appendChild(svg); ticks.set(b, svg);
});
function placeTicks() {
  ticks.forEach((svg, b) => {
    const sheet = b.closest('.sheet'); let x = 0, y = 0, el = b;
    while (el && el !== sheet) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    svg.style.left = (x + 1) + 'px'; svg.style.top = (y - 9) + 'px';
    svg.classList.toggle('on', b.previousElementSibling.checked);
  });
}

const KEY = 'nda1-assembly';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
let state = load();
const boxes = [...doc.querySelectorAll('input[type=checkbox][data-k]')], ip = doc.querySelector('#kit-ip');
function render() {
  const n = boxes.filter(b => b.checked).length;
  doc.querySelector('#kit-count').textContent = `${n} of ${boxes.length} steps marked`;
  const v = ip.value.trim();
  doc.querySelectorAll('.ip').forEach(s => s.textContent = v || '<address>');
  placeTicks();
}
boxes.forEach(b => { b.checked = !!state[b.dataset.k]; b.addEventListener('change', () => { state[b.dataset.k] = b.checked; save(state); render(); }); });
ip.value = state.ip || '';
ip.addEventListener('input', () => { state.ip = ip.value.trim(); save(state); render(); });
doc.querySelector('#kit-reset').addEventListener('click', () => { state = {}; save(state); boxes.forEach(b => b.checked = false); ip.value = ''; render(); });
// Copy tabs: the command is snipped out of the page and clipped to the clipboard dock.
const SNIP = { src: new URL('../../sounds/scissors-snip.wav', import.meta.url).href, start: 0, end: 0.15 };
doc.querySelectorAll('.cmd button').forEach(btn => btn.addEventListener('click', () => {
  const box = btn.closest('.cmd');
  dock.copy({ text: btn.previousElementSibling.textContent, title: box.dataset.title || 'Command', from: box, paper: '#eeede6', sound: SNIP });
}));
render();

// Lay the pages down: each gets a random tilt of 0.15°–0.6° either way and a small sideways shift,
// so the stack looks handled rather than misaligned. Never perfectly straight.
const between = (a, b) => a + Math.random() * (b - a);
doc.querySelectorAll('.sheet').forEach(sh => {
  sh.style.setProperty('--tilt', (between(.15, .6) * (Math.random() < .5 ? -1 : 1)).toFixed(2) + 'deg');
  sh.style.setProperty('--dx', between(-10, 10).toFixed(1) + 'px');
});

// Dust on the copies.
function dust() {
  doc.querySelectorAll('.sheet').forEach((s, k) => {
    seed = 417 + k * 31; const w = s.offsetWidth, h = s.offsetHeight; let d = '';
    for (let i = 0; i < 40; i++) d += `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h).toFixed(0)}" r="${(.4 + rnd() * 1.1).toFixed(2)}" fill="#2a261e" opacity="${(.25 + rnd() * .45).toFixed(2)}"/>`;
    s.querySelector('.dust').innerHTML = d;
  });
}
addEventListener('load', () => { dust(); placeTicks(); }); addEventListener('resize', () => { dust(); placeTicks(); }); dust();
document.fonts?.ready.then(placeTicks);
