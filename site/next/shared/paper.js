// Shared by every document on the page: the photocopy and paper effects, as SVG filters,
// plus dust specks and A4 scaling. Each section still picks its own fonts, colours and layout.
//
//   filter: url(#paper-tooth)      paper grain, for a background <rect>
//   filter: url(#paper-blotch)     uneven paper tone, for a background <rect>
//   filter: url(#paper-stamp)      a rubber stamp's gaps and wobble
//   filter: url(#ink-<name>)       photocopied print in one ink colour; register more with inkFilter()

const NS = 'http://www.w3.org/2000/svg';
const defs = (() => {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<defs>
    <filter id="paper-tooth" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="4" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 .35  0 0 0 0 .31  0 0 0 0 .24  0 0 0 -1.6 1.05"/>
    </filter>
    <filter id="paper-blotch" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.006 0.011" numOctaves="3" seed="9" result="b"/>
      <feColorMatrix in="b" type="matrix" values="0 0 0 0 .45  0 0 0 0 .4  0 0 0 0 .28  0 0 0 -1.4 .78"/>
    </filter>
    <filter id="paper-stamp" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="13" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.3" result="gaps"/>
      <feComposite in="SourceGraphic" in2="gaps" operator="in" result="s"/>
      <feTurbulence type="turbulence" baseFrequency="0.03" numOctaves="1" seed="3" result="w"/>
      <feDisplacementMap in="s" in2="w" scale="1.4" xChannelSelector="R" yChannelSelector="G"/>
    </filter>
    <symbol id="cfc-mark" viewBox="0 0 194 124"><path d="M0 42a2 2 0 0 1 2-2h40a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2ZM70 2a2 2 0 0 1 2-2h120a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2h-28v38a2 2 0 0 1-2 2h-18v38a2 2 0 0 1-2 2h-40a2 2 0 0 1-2-2V82a2 2 0 0 1 2-2h18V44H72a2 2 0 0 1-2-2Z"/></symbol>
  </defs>`;
  document.body.prepend(svg);
  return svg.firstElementChild;
})();

// Photocopied ink: the edges wobble, toner is patchy and specks drop out. One filter per colour.
// opts lightens the effect: wobble, specks (higher = fewer dropouts), plate (wet-ink opacity), spread.
export function inkFilter(name, color, { wobble = 0.9, specks = 4.25, plate = 0.5, spread = 0.35, bleed = 0.5, drift = 1.6 } = {}) {
  if (document.getElementById('ink-' + name)) return;
  defs.insertAdjacentHTML('beforeend', `
    <filter id="ink-${name}" x="-1%" y="-1%" width="102%" height="102%" color-interpolation-filters="sRGB">
      <feTurbulence type="turbulence" baseFrequency="0.018" numOctaves="1" seed="2" result="wobble"/>
      <feDisplacementMap in="SourceGraphic" in2="wobble" scale="${wobble}" xChannelSelector="R" yChannelSelector="G" result="sheet"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="speck"/>
      <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 -6 0 ${specks}" result="holes"/>
      <feComposite in="sheet" in2="holes" operator="in" result="worn"/>
      <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -0.4 -0.4 -0.4 0 1.15" result="dark"/>
      <feComposite in="dark" in2="SourceAlpha" operator="in" result="linework"/>
      <feTurbulence type="turbulence" baseFrequency="0.008" numOctaves="2" seed="7" result="drift"/>
      <feDisplacementMap in="linework" in2="drift" scale="${drift}" xChannelSelector="R" yChannelSelector="G" result="wet"/>
      <feMorphology in="wet" operator="dilate" radius="${spread}" result="gain"/>
      <feGaussianBlur in="gain" stdDeviation="${bleed}" result="bleed"/>
      <feFlood flood-color="${color}" flood-opacity="${plate}"/>
      <feComposite in2="bleed" operator="in" result="plate"/>
      <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="21" result="mottle"/>
      <feColorMatrix in="mottle" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 2.2 0 0 -0.6" result="heavy"/>
      <feComposite in="plate" in2="heavy" operator="in" result="patchy"/>
      <feMerge><feMergeNode in="patchy"/><feMergeNode in="worn"/></feMerge>
    </filter>`);
}
inkFilter('black', '#1c1c1a');

// Dust specks on a scanned sheet. `group` is an SVG <g> inside the sheet's paper layer.
export function dust(sheet, group, seed = 417, count = 40) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const draw = () => {
    s = seed; const w = sheet.offsetWidth, h = sheet.offsetHeight; let d = '';
    for (let i = 0; i < count; i++) d += `<circle cx="${(rnd() * w).toFixed(0)}" cy="${(rnd() * h).toFixed(0)}" r="${(.4 + rnd() * 1.1).toFixed(2)}" fill="#2a261e" opacity="${(.25 + rnd() * .45).toFixed(2)}"/>`;
    group.innerHTML = d;
  };
  draw(); addEventListener('load', draw);
}

// A fixed-size page (A4 at 96 dpi by default) scaled down to fit its frame, never up.
// Sets --s on the frame; size the frame's height with calc(<page height> * var(--s)).
export function fitPage(frame, width = 794) {
  const fit = () => frame.style.setProperty('--s', Math.min(1, frame.clientWidth / width));
  new ResizeObserver(fit).observe(frame); fit();
}

// Remember a form's fields in this browser only. Storage can be missing (private windows).
export function remember(form, prefix) {
  for (const el of form.querySelectorAll('input, select, textarea')) {
    if (el.type === 'date' || !el.name) continue;
    const key = `${prefix}:${el.name}`, prop = el.type === 'checkbox' ? 'checked' : 'value';
    try { const v = localStorage.getItem(key); if (v !== null) el[prop] = prop === 'checked' ? v === '1' : v; } catch {}
    el.addEventListener('input', () => { try { localStorage.setItem(key, prop === 'checked' ? (el.checked ? '1' : '0') : el.value); } catch {} });
  }
}
