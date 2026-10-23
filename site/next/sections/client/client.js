// The client: fameboy as a 1995 magazine ad. Three screens, each a colour edition of fameboy
// (editions.js); the centre one runs the real boot sequence (home.js boot()); "Try it now"
// links to the hosted @fameboyclear, by URL and QR code. From brand/mockups/client-ad/round-3.html.
import { inkFilter } from '../../shared/paper.js';
import './editions.js';

const doc = document.getElementById('client');
inkFilter('client', '#1c1c1a');

// The page is a fixed 760 x 1000 sheet, scaled to fit, never up.
const fit = doc.querySelector('#cl-fit');
new ResizeObserver(() => {
  const s = Math.min(1, fit.clientWidth / 760);
  fit.firstElementChild.style.transform = `scale(${s})`; fit.style.height = `${1000 * s}px`;
}).observe(fit);

// "brisk" weather icon from home.js, drawn on its 16×16 pixel grid
const BRISK = ["................","................","...##...........","..#..#..........","......#.........","#######.........","................",".#########......","..........#.....","...........#....","..........#.....",".########.......","................","................","................","................"];
doc.querySelector('#cl-wx').innerHTML = BRISK.flatMap((r, y) => [...r].map((c, x) => c === '#' ? `<rect x="${x}" y="${y}" width="1" height="1" fill="#1c1c1a"/>` : '')).join('');
doc.querySelector('#cl-bars').innerHTML = [3,2,2,1,1,1,2,4,6,7,8,8,9,10,11,7,7,8,8,7,6,5,4,3].map((v, i) => `<i class="${i > 14 ? 'later' : ''}" style="height:${v * 9}%"></i>`).join('');

// The loading screen, as in home.js boot(): the c blinks while the node answers, then the
// name lights up 46 ms a letter. ?lit holds it lit (for screenshots).
const L = [...doc.querySelectorAll('.boot .word span')], st = doc.querySelector('#cl-status');
const wait = ms => new Promise(r => setTimeout(r, ms));
const lit = () => { L.forEach(l => l.classList.add('on')); st.textContent = '91.99.76.223 · in sync'; };
if (new URLSearchParams(location.search).has('lit') || matchMedia('(prefers-reduced-motion: reduce)').matches) lit();
else (async function run() {
  L.forEach(l => l.classList.remove('on')); st.textContent = 'connecting to this node';
  for (let i = 0; i < 8; i++) { L[0].classList.toggle('on', i % 2 === 0); await wait(260); }
  L[0].classList.add('on'); st.textContent = '91.99.76.223 · in sync';
  for (let i = 1; i < L.length; i++) { await wait(46); L[i].classList.add('on'); }
  await wait(4600); run();
})();

// Dust and a hair or two, as the scanner glass caught them.
(() => { let seed = 77; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let out = ''; for (let i = 0; i < 40; i++) out += `<circle cx="${(rnd() * 760).toFixed(0)}" cy="${(rnd() * 1000).toFixed(0)}" r="${(.4 + rnd() * 1.1).toFixed(2)}" fill="#2a261e" opacity="${(.25 + rnd() * .45).toFixed(2)}"/>`;
  for (let i = 0; i < 2; i++) { const x = rnd() * 760, y = rnd() * 1000; out += `<path d="M${x} ${y}q${12 + rnd() * 20} ${-8 + rnd() * 16} ${30 + rnd() * 30} ${-4 + rnd() * 10}" stroke="#2a261e" stroke-width=".6" fill="none" opacity=".35"/>`; }
  doc.querySelector('.dust').innerHTML = out; })();

