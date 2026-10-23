// Troubleshooting: the chart of faults, the table of faults with dot leaders, a torn binding edge
// and dust on the scan. Commands copy to the clipboard dock. From brand/mockups/troubleshooting-scan.html.
import { inkFilter, dust } from '../../shared/paper.js';

const doc = document.getElementById('troubleshooting');
const sheet = doc.querySelector('#ts-sheet');
inkFilter('ts', '#1b1a17');

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

// Click a command (or press Enter on it) to snip it out and clip it to the clipboard dock.
const SNIP = { src: new URL('../../sounds/scissors-snip.wav', import.meta.url).href, start: 0, end: 0.15 };
const copy = c => dock.copy({ text: c.textContent, title: c.dataset.title, from: c.closest('td'), paper: '#f3f1e8', sound: SNIP });
doc.addEventListener('click', e => { const c = e.target.closest('.cmd'); if (c) copy(c); });
doc.addEventListener('keydown', e => { const c = e.target.closest('.cmd'); if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); copy(c); } });

// The table of faults jumps to the row and lights it, without changing the page's address.
doc.querySelector('#ts-toc').addEventListener('click', e => {
  const a = e.target.closest('a'); if (!a) return; e.preventDefault();
  const row = doc.querySelector(a.getAttribute('href')); if (!row) return;
  doc.querySelectorAll('tr.lit').forEach(r => r.classList.remove('lit'));
  row.classList.add('lit'); row.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// The torn binding edge: a ragged clip-path down the left side, the same on every visit.
function tear() {
  let seed = 1971; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const h = sheet.offsetHeight, pts = ['14px 0', '100% 0', '100% 100%', '10px 100%'];
  const left = []; for (let y = h; y > 0; y -= 6 + rnd() * 10) left.push(`${(2 + rnd() * 13 + (rnd() < .08 ? 6 : 0)).toFixed(1)}px ${y.toFixed(0)}px`);
  sheet.style.setProperty('--torn', `polygon(${pts.join(',')},${left.join(',')})`);
}
new ResizeObserver(tear).observe(sheet); tear();
dust(sheet, sheet.querySelector('.dust'), 77, 46);
