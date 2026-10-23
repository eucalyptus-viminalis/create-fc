// Troubleshooting: a gatefold torn from a 1970s service manual. Closed, the cover (index, block
// diagram, test points); click it and it swings open on its fold into a landscape spread carrying
// the whole chart. Commands copy to the clipboard dock. From brand/mockups/troubleshooting-pages.html (2).
import { inkFilter, dust } from '../../shared/paper.js';

const doc = document.getElementById('troubleshooting');
const stage = doc.querySelector('#ts-gate'), rig = stage.querySelector('.rig');
const cover = doc.querySelector('#ts-sheet'), leaf = doc.querySelector('#ts-leaf');
// a cleaner impression than the other documents: small type in a dense chart has to stay readable
inkFilter('ts', '#1b1a17', { wobble: 0.7, specks: 4.75, plate: 0.4, spread: 0.28, bleed: 0.4, drift: 1.25 });

const STEPS = [['0', 'Renting the Server — Command 0'], ['1', 'Syncing the Node — Command 1'], ['2', 'Installing the Client — Command 2'], ['s', 'Signing In and Posting']];
const F = [
  { s: '0', say: 'hcloud context active fails', cause: 'hcloud has no Hetzner project to talk to.', fix: 'Create a project and a Read & Write API token at console.hetzner.com. In your own terminal, run the command below and type the token when asked.', cmd: 'hcloud context create fc-node', note: 'Never paste the token into a chat or an assistant.' },
  { s: '0', err: 'volumes size limit exceeded', cause: 'Account volume cap is below the requested size. New accounts get 1024 GB.', fix: 'Keep VOLUME_GB at 1000 or less.' },
  { s: '0', err: 'error during placement (resource_unavailable)', cause: 'Server type sold out in that location.', fix: 'None needed. Command 0 tries other locations, then cpx41 (about $0.20/hr). If TYPE or LOCATION is pinned, change it or wait a few minutes.' },
  { s: '1', err: 'REMOTE HOST IDENTIFICATION HAS CHANGED', cause: 'New server was given an IP your computer remembers.', fix: 'Expected after deleting and recreating. Forget the old key and run Command 1 again.', cmd: 'ssh-keygen -R <ip>' },
  { s: '1', say: 'fc-node status:', err: "isn't answering and setup isn't running", cause: 'Setup stopped partway.', fix: 'Run Command 1 again. Finished shards are skipped; a partial shard is redone.' },
  { s: '1', say: 'Status shows hours behind; newest casts missing.', cause: 'Node is catching up after the snapshot (approx. 4–5 hours).', fix: 'Reads already work. Check fc-node status every half hour.', norm: true },
  { s: '2', err: 'fameboy: command not found', cause: 'Terminal was opened before the install added fameboy to PATH.', fix: 'Open a new terminal tab, or add ~/.local/bin to PATH.' },
  { s: '2', say: 'fameboy prints its help instead of running:', err: 'unknown command "username​" (it contains hidden characters…)', cause: 'Pasted command carried invisible characters.', fix: 'Retype the command by hand.' },
  { s: 's', say: 'fameboy login stays on', err: 'checking indexes 1-9', cause: "Phrase's first address owns no account; the node scans all 3.3 million registrations, 30–40 s per try.", fix: 'Check that the phrase is correct.' },
  { s: 's', say: 'After a cast, like or follow:', err: 'not visible on your node yet', cause: 'Read nodes relay and forget. Lost gossip means a lost message.', fix: 'Run the command again.' },
];
const esc = t => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
F.forEach((f, i) => f.no = `7-${i + 1}`);
const label = f => f.err ? f.err.replace(/[​]/g, '') : f.say;

// Table of faults, two columns with dot leaders.
const half = [STEPS.slice(0, 2), STEPS.slice(2)];
doc.querySelector('#ts-toc').innerHTML = half.map(col => `<div><div class="cols"><span>Symptom</span><span>Fault</span></div>` +
  col.map(([k, name]) => `<h3>${esc(name.split(' — ')[0])}</h3>` + F.filter(f => f.s === k).map(f =>
    `<a href="#ts-${f.no}"><span class="t">${esc(label(f).replace(/[:.]$/, ''))}</span><span class="lead"></span><span class="n">${f.no}</span></a>`).join('')).join('') + `</div>`).join('');

// The chart.
doc.querySelector('#ts-rows').innerHTML = STEPS.map(([k, name]) =>
  `<tr class="step"><th colspan="4" scope="colgroup">${esc(name)}</th></tr>` + F.filter(f => f.s === k).map(f => `
  <tr class="row" id="ts-${f.no}">
    <td class="no" data-h="No.">${f.no}</td>
    <td data-h="Symptom">${f.say ? esc(f.say) : ''}${f.err ? `<span class="err">${esc(f.err)}</span>` : ''}</td>
    <td data-h="Probable Cause">${esc(f.cause)}</td>
    <td data-h="Remedy">${esc(f.fix)}${f.cmd ? `<span class="cmd" tabindex="0" role="button" title="Click to copy" data-title="Fault ${f.no}">${esc(f.cmd)}</span>` : ''}${f.note ? `<span class="note">${esc(f.note)}</span>` : ''}${f.norm ? '<br><span class="norm">Normal Operation</span>' : ''}</td>
  </tr>`).join('')).join('');

// The cover's inside is the spread's left half: a copy of the chart (the real one sits under it).
const clone = doc.querySelector('#ts-spread').cloneNode(true);
clone.removeAttribute('id'); clone.querySelectorAll('[id]').forEach(e => { e.dataset.id = e.id; e.removeAttribute('id'); });
clone.querySelectorAll('a, [tabindex]').forEach(e => e.setAttribute('tabindex', '-1'));
doc.querySelector('#ts-clone').append(clone);

// Fixed paper, scaled to fit. Closed, the cover sits in the middle; open, the whole spread does.
// On a phone the open spread is held at the cover's size and you swipe across it.
const W = 1632, H = 1056, PAGE = 816;
function fit() {
  const avail = stage.clientWidth, open = stage.classList.contains('open');
  const pan = open && avail < 760;
  stage.classList.toggle('pan', pan);
  const s = pan ? Math.min(1, avail / PAGE) : Math.min(1, avail / (open ? W : PAGE));
  rig.style.setProperty('--s', s);
  rig.style.setProperty('--shift', open || pan ? '0px' : `${-PAGE / 2 * s}px`);
  stage.style.height = `${H * s + (open ? 0 : 10)}px`;
}
new ResizeObserver(fit).observe(stage);

const unfoldBtn = doc.querySelector('.unfold');
function setOpen(open) {
  stage.classList.toggle('open', open);
  unfoldBtn.setAttribute('aria-expanded', open);
  fit();
  if (!open) stage.scrollLeft = 0;
}
leaf.addEventListener('click', e => { if (!stage.classList.contains('open') && !e.target.closest('a, .cmd')) setOpen(true); });
doc.querySelector('.fold').addEventListener('click', () => { setOpen(false); doc.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

// Index entries open the fold-out at their row and light it.
doc.querySelector('#ts-toc').addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return; e.preventDefault(); e.stopPropagation();
  const id = a.getAttribute('href').slice(1);
  doc.querySelectorAll('tr.lit').forEach(r => r.classList.remove('lit'));
  doc.querySelectorAll(`#${id}, [data-id="${id}"]`).forEach(r => r.classList.add('lit'));
  const was = stage.classList.contains('open'); setOpen(true);
  setTimeout(() => doc.querySelector('#' + id)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), was ? 0 : 900);
});

// Click a command (or press Enter on it) to snip it out and clip it to the clipboard dock.
const SNIP = { src: new URL('../../sounds/scissors-snip.wav', import.meta.url).href, start: 0, end: 0.15 };
const copy = c => dock.copy({ text: c.textContent, title: c.dataset.title, from: c.closest('td, li') || c, paper: '#f3f1e8', sound: SNIP });
doc.addEventListener('click', e => { const c = e.target.closest('.cmd'); if (c && !c.closest('#ts-clone')) { e.stopPropagation(); copy(c); } });
doc.addEventListener('keydown', e => { const c = e.target.closest('.cmd'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); copy(c); } });

// The torn binding edge down the cover's left side, the same on every visit.
function tear() {
  let seed = 1971; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const h = cover.offsetHeight, pts = ['14px 0', '100% 0', '100% 100%', '10px 100%'];
  const left = []; for (let y = h; y > 0; y -= 6 + rnd() * 10) left.push(`${(2 + rnd() * 13 + (rnd() < .08 ? 6 : 0)).toFixed(1)}px ${y.toFixed(0)}px`);
  cover.style.setProperty('--torn', `polygon(${pts.join(',')},${left.join(',')})`);
}
tear();
doc.querySelectorAll('.dust').forEach((g, k) => dust(g.closest('.sheet, .spread'), g, 77 + k * 13, 46));
fit();
