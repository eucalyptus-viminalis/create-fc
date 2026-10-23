// Finish: NDA Form 1. Sends the application to the register (register/, a Cloudflare Worker),
// which records it and returns the next member number; then the page is stamped and the card issued.
import { inkFilter, dust, fitPage, remember } from '../../shared/paper.js';

const doc = document.getElementById('finish');
const $ = id => doc.querySelector('#' + id);
const form = $('nda-form'), contact = $('nda-contact'), status = $('nda-status');
inkFilter('nda-green', '#24493b');
fitPage($('nda-fit'));
dust($('nda-sheet'), $('nda-dust'), 1966);

// Where the register lives. A local `pnpm dev` in register/ while the site runs on localhost.
const REGISTER = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? `http://${location.hostname}:8787`
  : document.querySelector('meta[name="nda-register"]')?.content || '';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const stampDate = d => `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
$('nda-date').textContent = stampDate(new Date());   // always today; not something you fill in

// Item 1 takes an FID or an e-mail address. The register checks it again.
const kindOf = v => /^\d{1,10}$/.test(v) && +v > 0 ? 'fid' : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? 'email' : null;
contact.addEventListener('input', () => { if (kindOf(contact.value.trim())) $('nda-c-contact').classList.remove('bad'); });

// Item 2 signs the form and names the card; left blank, you're "anon". Item 1 never appears on
// either: it can be an e-mail address, and the card is public.
const card = $('nda-card');
const operator = () => $('nda-name').value.trim() || 'anon';
function fillCard() {
  $('nda-sign').textContent = operator();
  if (card.classList.contains('issued')) return;   // an issued card shows what was filed
  $('nda-m-name').textContent = operator();
  $('nda-m-sig').textContent = operator();
  $('nda-m-no').textContent = 'Assigned on approval'; $('nda-m-date').textContent = 'Pending';
}
// 2a "I will remain anonymous" is ticked while item 2 is blank. Typing a name unticks it; ticking it
// again clears the name. It isn't saved or sent: it only ever says whether item 2 is blank.
const name = $('nda-name'), anon = $('nda-anon');
name.addEventListener('input', () => { anon.checked = !name.value.trim(); fillCard(); });
anon.addEventListener('change', () => {
  if (anon.checked) { name.value = ''; name.dispatchEvent(new Event('input')); }   // the input event also clears the saved draft
  else if (!name.value.trim()) name.focus();                                       // unticked with no name yet: go and type one
});
name.addEventListener('blur', () => { if (!name.value.trim()) anon.checked = true; });   // left without a name: still anonymous

const submit = doc.querySelector('button.submit');
const after = [...doc.querySelectorAll('.after')];
for (const b of after) b.addEventListener('click', e => { if (b.hasAttribute('aria-disabled')) e.preventDefault(); });
$('nda-print').addEventListener('click', e => { if (!e.currentTarget.hasAttribute('aria-disabled')) print(); });

// Once filed, the form shows what was sent and can't be changed: editing it afterwards would only
// make it disagree with the card. Filings from before the answers were kept show item 1 as on file.
function lock(m) {
  const f = m.filed;
  contact.value = f ? f.contact : '';
  if (!f) contact.placeholder = 'On file with the Authority';
  name.value = f ? f.name : (m.name === 'anon' ? '' : m.name);
  anon.checked = !name.value;
  form.elements.sync.checked = form.elements.cast.checked = true;
  if (f) form.elements.bulletins.checked = f.bulletins;
  for (const el of form.querySelectorAll('input')) { if (el.type === 'text') el.readOnly = true; else el.disabled = true; }
  for (const el of form.querySelectorAll('.cell.bad')) el.classList.remove('bad');
  form.classList.add('filed');
}

// Testing on localhost: "Revoke membership" forgets this browser's filing and draft, so the form can
// be filed again. The register keeps its record: filing again with the same item 1 gets the same number.
const LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const forgetDraft = () => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('nda-form-1:')) localStorage.removeItem(k); } catch {} };
$('nda-revoke').addEventListener('click', () => {
  try { localStorage.removeItem('nda-member'); } catch {}
  forgetDraft();
  location.reload();
});

// Stamp the page and issue the card from what the register sent back.
function issue(m, animate = true) {
  $('nda-s-recv-date').textContent = m.enrolled;
  $('nda-s-recv').classList.add('on');
  setTimeout(() => $('nda-s-appr').classList.add('on'), animate ? 380 : 0);
  card.classList.add('issued');
  $('nda-m-name').textContent = m.name;
  $('nda-m-sig').textContent = m.signature;
  $('nda-sign').textContent = m.signature;
  $('nda-m-no').textContent = m.no;
  $('nda-m-date').textContent = m.enrolled;
  submit.textContent = 'Filed ✓'; submit.disabled = true;
  lock(m);
  $('nda-revoke').hidden = !LOCAL;
  for (const b of after) { b.removeAttribute('aria-disabled'); b.removeAttribute('title'); b.removeAttribute('tabindex'); }
  $('nda-cast').href = 'https://farcaster.xyz/~/compose?text=' + encodeURIComponent(`I run my own Farcaster node. Network Decentralization Authority, member ${m.no}.`)
    + '&embeds[]=' + encodeURIComponent(m.page);
}

const say = (text, ok = false) => { status.className = 'status' + (ok ? ' ok' : ''); status.textContent = text; };
const FIELD = { contact: 'nda-c-contact', certify: 'nda-c-cert', name: 'nda-c-name', signature: 'nda-c-name' };

form.addEventListener('submit', async e => {
  e.preventDefault();
  const v = contact.value.trim(), k = kindOf(v);
  const certify = { sync: form.elements.sync.checked, cast: form.elements.cast.checked };
  const signature = operator();
  const bad = { contact: !k, certify: !(certify.sync && certify.cast) };
  for (const [f, isBad] of Object.entries(bad)) $(FIELD[f]).classList.toggle('bad', isBad);
  if (Object.values(bad).some(Boolean)) {
    say('Returned for correction: see the items marked in red.');
    (bad.contact ? contact : form.querySelector('#nda-c-cert input:not(:checked)')).focus();
    return;
  }
  if (!REGISTER) return say("The Authority's office isn't open yet. Try again soon.");

  submit.disabled = true; say('Filing with the Authority…', true);
  try {
    const res = await fetch(REGISTER + '/apply', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contact: v, name: operator(), signature, certify, bulletins: form.elements.bulletins.checked }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 422 && data.errors) {
      for (const f of Object.keys(data.errors)) $(FIELD[f])?.classList.add('bad');
      submit.disabled = false;
      return say('Returned for correction: see the items marked in red.');
    }
    if (!res.ok) throw new Error(data.error || res.statusText);
    const filed = { contact: v, name: name.value.trim(), bulletins: form.elements.bulletins.checked };
    const m = { ...data, filed };
    try { localStorage.setItem('nda-member', JSON.stringify(m)); } catch {}
    forgetDraft();   // what was sent is kept with the filing now
    issue(m);
    say(`Approved. Welcome to the Authority, ${data.name}. You are member ${data.no}.`, true);
  } catch {
    submit.disabled = false;
    say("Couldn't reach the Authority. Check your connection and submit again.");
  }
});

remember(form, 'nda-form-1');
anon.checked = !name.value.trim(); fillCard();

// Already a member in this browser: show the issued card.
try { const m = JSON.parse(localStorage.getItem('nda-member')); if (m?.no) issue(m, false); } catch {}
