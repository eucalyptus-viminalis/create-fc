// Agent prompt: clicking the order ("Copy Agent Prompt to Clipboard" on hover) tears off the top
// copy and sends it to the clipboard dock (shared/clipboard-dock.js),
// and the copy underneath is now on top: white, then yellow, then pink. After the pink file copy
// the pad is empty, and stays that way until the page is reloaded.
import { dust, remember } from '../../shared/paper.js';

const doc = document.getElementById('agent');
const set = doc.querySelector('.set'), sheet = doc.querySelector('.sheet');
const ORDER = ['white', 'yellow', 'pink', 'empty'];
const PAPER = { white: '#e8e6db', yellow: '#e2d9a8', pink: '#e3c8c2' };

// Today's date, typed in.
doc.querySelector('#wo-date').textContent = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function tearOff() {
  const top = set.dataset.top || 'white', next = ORDER[ORDER.indexOf(top) + 1];
  if (top === 'empty') return;
  dock.copy({ text: doc.querySelector('#wo-prompt').textContent.trim(), title: 'Service order', from: sheet,
    paper: PAPER[top], onLift: () => { set.dataset.top = next; } });
}
// Click anywhere on the order except its boxes, signature and links; or press the overlay button.
sheet.addEventListener('click', e => { if (!e.target.closest('input, label, a, textarea, select')) tearOff(); });

// The customer's boxes stay ticked for this visitor.
remember(doc.querySelector('#wo-form'), 'work-order');
dust(sheet, doc.querySelector('.dust'), 417, 36);
