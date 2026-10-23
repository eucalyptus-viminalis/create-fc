// Costs: a 1950s printed slide chart (after R.K. LeBlond's "Machining Calculator"). Drag the white
// slide behind the card; it settles on the nearest printed figure. Arrow keys work when it's focused,
// and the printed "quick set" lines are clickable. From brand/mockups/costs-sliderule.html (A1).
// Figures are docs/Costs.md: Hetzner gross, billed hourly, capped at the monthly price.
const host = document.getElementById('nc-chart');
const DEFS = `<!-- paper: fibre multiplied over the fill -->
    <filter id="nc-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85 .5" numOctaves="3" seed="7" result="n"/><feColorMatrix in="n" values="0 0 0 0 .35 0 0 0 0 .3 0 0 0 0 .22 0 0 0 .55 -.1" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="gi"/><feBlend in="SourceGraphic" in2="gi" mode="multiply"/></filter>
    <!-- die-cut edge: a little wobble -->
    <filter id="nc-edge" x="-2%" y="-3%" width="104%" height="106%"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="2" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="2.6"/></filter>
    <!-- letterpress: ragged type edges -->
    <filter id="nc-ink" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="5" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale=".45"/></filter>
    <linearGradient id="nc-winShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".38"/><stop offset=".14" stop-color="#000" stop-opacity="0"/><stop offset=".9" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".12"/></linearGradient>
    <linearGradient id="nc-glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity=".18"/><stop offset=".5" stop-color="#fff" stop-opacity=".05"/><stop offset="1" stop-color="#fff" stop-opacity=".22"/></linearGradient>
    <linearGradient id="nc-metal" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d4d6d3"/><stop offset=".5" stop-color="#8f9290"/><stop offset="1" stop-color="#b9bbb8"/></linearGradient>
    <symbol id="nc-mark" viewBox="0 0 194 124"><path d="M0 42a2 2 0 0 1 2-2h40a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2ZM70 2a2 2 0 0 1 2-2h120a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2h-28v38a2 2 0 0 1-2 2h-18v38a2 2 0 0 1-2 2h-40a2 2 0 0 1-2-2V82a2 2 0 0 1 2-2h18V44H72a2 2 0 0 1-2-2Z"/></symbol>`;

// ---- the numbers (docs/Costs.md, Hetzner gross: hourly, capped at the monthly price) ----
const PARTS = { srv: [0.0326, 20.34], vol: [0.13, 84.37], ip: [0.0011, 0.66] };
const cost = h => { const p = { tot: 0 }; for (const [k, [r, cap]] of Object.entries(PARTS)) { p[k] = Math.min(h * r, cap); p.tot += p[k]; } return p; };
const fmt = v => v < 1 ? `${(v * 100).toFixed(v < .095 ? 1 : 0)}¢` : v < 100 ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`;
const MAX_H = 730, S = 1100;                       // scale runs 1 hour → 1 month over S units, log
const s = h => S * Math.log(h) / Math.log(MAX_H);
const STOPS = [1, 2, 4, 8, 12, 24, 48, 72, 168, 336, 730];
const NAMES = { 1: '1 HR', 2: '2 HRS', 4: '4 HRS', 8: '8 HRS', 12: '12 HRS', 24: '1 DAY', 48: '2 DAYS', 72: '3 DAYS', 168: '1 WEEK', 336: '2 WEEKS', 730: '1 MONTH' };
const MINOR = [1.5, 3, 5, 6, 7, 9, 10, 11, 14, 16, 18, 20, 22, 30, 36, 42, 60, 84, 96, 120, 144, 192, 216, 240, 264, 288, 312, 384, 432, 480, 528, 576, 624, 672, 720];
const QUICK = [[8, 'Sync & try'], [24, 'A day'], [48, 'A weekend'], [168, 'A week'], [730, 'A month']];
const nearest = h => STOPS.reduce((b, x) => Math.abs(Math.log(x) - Math.log(h)) < Math.abs(Math.log(b) - Math.log(h)) ? x : b);
const say = h => NAMES[h] ? NAMES[h].toLowerCase() : `${h} hours`;

const THEMES = {
  leblond:   { sleeve: '#e2be3a', ink: '#1b1a17', acc: '#c4302b', slide: '#f6f2e3', badge: '#f6f2e3', band: null, title: 'NODE COST CALCULATOR' },
  clearcast: { sleeve: '#c4c4ba', ink: '#1c1c1a', acc: '#7a54c9', slide: '#f4f3ec', badge: '#1c1c1a', band: null, title: 'NODE COST CALCULATOR' },
  cream:     { sleeve: '#e9e3cf', ink: '#1c1c1a', acc: '#7a54c9', slide: '#fbf9f1', badge: '#e9e3cf', band: '#1c1c1a', title: 'NODE COST CALCULATOR' },
};

// ---- A · slide chart --------------------------------------------------------------
// viewBox 1000 × 470. A white slide moves behind a printed sleeve with two windows.
// The hairline is fixed at x = HX; the slide sits at offset o so that hour h is under it.
const HX = 600, W1 = [340, 150, 860, 250], W2 = [60, 300, 860, 400];
function slideChart(host, T) {
  const t = (x, y, txt, o = '') => `<text x="${x}" y="${y}" ${o}>${txt}</text>`;
  // what's printed on the slide (x in slide units, 0 = 1 hour)
  let slide = `<rect x="-760" y="140" width="${S + 1120}" height="270" fill="${T.slide}" filter="url(#nc-paper)"/>`;
  slide += `<g fill="${T.ink}" stroke="${T.ink}" filter="url(#nc-ink)">`;
  for (const h of MINOR) { const x = s(h); slide += `<line x1="${x}" y1="150" x2="${x}" y2="159" stroke-width="1"/><line x1="${x}" y1="300" x2="${x}" y2="306" stroke-width="1"/>`; }
  for (const h of STOPS) {
    const x = s(h), p = cost(h);
    slide += `<line x1="${x}" y1="150" x2="${x}" y2="166" stroke-width="1.8"/><line x1="${x}" y1="240" x2="${x}" y2="250" stroke-width="1.4"/>`;
    slide += `<line x1="${x}" y1="300" x2="${x}" y2="311" stroke-width="1.6"/><line x1="${x}" y1="392" x2="${x}" y2="400" stroke-width="1.2"/>`;
    slide += `<g stroke="none" text-anchor="middle" font-family="Barlow Condensed">`
      + t(x, 189, NAMES[h], 'font-size="19" font-weight="700" letter-spacing=".5"')
      + t(x, 231, fmt(p.tot), `font-size="24" font-weight="700" fill="${T.acc}"`)
      + t(x, 333, fmt(p.srv), 'font-size="17" font-weight="600"')
      + t(x, 360, fmt(p.vol), 'font-size="17" font-weight="600"')
      + t(x, 387, fmt(p.ip), 'font-size="17" font-weight="600"') + `</g>`;
  }
  slide += `<g stroke="none" font-family="Barlow Condensed" font-weight="600" font-size="14" text-anchor="end">${t(-28, 196, 'START ►')}${t(-28, 350, 'START ►')}</g></g>`;

  // the sleeve, with the windows and thumb notches cut out (mask)
  const hole = ([x1, y1, x2, y2]) => `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="3" fill="#000"/>`;
  const mask = `<mask id="m-${host.id}" maskUnits="userSpaceOnUse"><rect x="0" y="0" width="1000" height="470" fill="#fff"/>${hole(W1)}${hole(W2)}<circle cx="20" cy="275" r="27" fill="#000"/><circle cx="980" cy="275" r="27" fill="#000"/></mask>`;
  const ink = T.ink, onBand = T.band ? T.sleeve : ink;
  const box = (y1, y2, rows) => { const hgt = (y2 - y1) / rows.length; return rows.map((r, i) => `<rect x="868" y="${y1 + i * hgt}" width="96" height="${hgt}" fill="none" stroke="${ink}" stroke-width="1.6"/>` + t(916, y1 + i * hgt + hgt / 2 + 1, r[0], `text-anchor="middle" dominant-baseline="central" font-family="Jost" font-weight="700" font-size="${r[1] || 13}" letter-spacing=".4" fill="${r[2] || ink}"`)).join(''); };
  const rivet = (x, y) => `<circle cx="${x}" cy="${y}" r="7.5" fill="#6e6c64"/><circle cx="${x}" cy="${y}" r="5.5" fill="#a8a69c"/><circle cx="${x - 1.3}" cy="${y - 1.5}" r="2" fill="#e2e0d6"/>`;
  let sleeve = `<rect x="20" y="20" width="960" height="430" rx="22" fill="${T.sleeve}" filter="url(#nc-paper)"/>`;
  if (T.band) sleeve += `<path d="M20 42 a22 22 0 0 1 22 -22 H958 a22 22 0 0 1 22 22 V100 H20 Z" fill="${T.band}"/>`;
  // windows' cut edges catch shadow; drawn on top of the slide, under the print
  const shade = ([x1, y1, x2, y2]) => `<rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="url(#nc-winShade)"/><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="3" fill="none" stroke="rgb(0 0 0 / .35)" stroke-width="1.2"/>`;
  let print = `<g filter="url(#nc-ink)" fill="${ink}">`;
  // badge
  print += `<g transform="translate(50 36)"><rect width="252" height="100" rx="50" fill="${T.badge}" stroke="${T.band ? T.sleeve : ink}" stroke-width="3"/><rect x="7" y="7" width="238" height="86" rx="43" fill="none" stroke="${T.badge === '#1c1c1a' ? T.sleeve : ink}" stroke-width="1.2"/>`
    + `<use href="#nc-mark" x="34" y="27" width="58" height="37" fill="${T.badge === '#1c1c1a' ? T.sleeve : ink}"/>`
    + t(104, 52, 'create-fc', `font-family="Jost" font-weight="800" font-size="30" letter-spacing="-.5" fill="${T.badge === '#1c1c1a' ? T.sleeve : ink}"`)
    + t(105, 72, 'NETWORK DECENTRALIZATION', `font-family="Jost" font-weight="600" font-size="8" letter-spacing=".3" fill="${T.acc}"`)
    + t(105, 83, 'AUTHORITY', `font-family="Jost" font-weight="600" font-size="8" letter-spacing=".3" fill="${T.acc}"`) + `</g>`;
  print += t(632, 74, T.title, `text-anchor="middle" font-family="Jost" font-weight="800" font-size="38" letter-spacing="1.2" fill="${onBand}"`);
  print += t(640, 117, 'Set how long you keep it under the arrow.', 'font-family="Jost" font-weight="700" font-size="15"');
  print += t(640, 135, 'Read what you pay on the line.', 'font-family="Jost" font-weight="700" font-size="15"');
  print += `<path d="M${HX - 17} 112 h34 l-17 30 Z" fill="${ink}"/>`;
  print += box(W1[1], W1[3], [['KEEP IT FOR', 12], ['YOU PAY', 14, T.acc]]);
  print += box(W2[1], W2[3], [['SERVER'], ['STORAGE'], ['IPv4']]);
  print += t(64, 286, 'Set under the line, read the parts.', 'font-family="Jost" font-weight="700" font-size="13.5"');
  // quick set: printed lines you can click
  print += t(62, 172, 'QUICK SET', `font-family="Jost" font-weight="800" font-size="13" letter-spacing="1.4"`);
  QUICK.forEach(([h, l], i) => { print += `<text x="62" y="${192 + i * 15}" font-family="Jost" font-weight="600" font-size="12.5" data-set="${h}">${l} · ${NAMES[h].toLowerCase()}</text>`; });
  print += t(500, 432, 'THE NETWORK DECENTRALIZATION AUTHORITY  •  create-fc', 'text-anchor="middle" font-family="Jost" font-weight="700" font-size="15" letter-spacing=".6"');
  print += t(64, 434, 'Form NC-1', 'font-family="Jost" font-weight="600" font-size="9.5"');
  print += t(936, 434, 'Billed hourly · capped monthly', 'text-anchor="end" font-family="Jost" font-weight="600" font-size="9.5"');
  print += `</g>` + rivet(46, 46) + rivet(954, 46) + rivet(46, 424) + rivet(954, 424);
  // hairline across both windows (a printed line on clear film)
  const hair = `<line x1="${HX}" y1="${W1[1] - 2}" x2="${HX}" y2="${W1[3] + 2}" stroke="${T.acc}" stroke-width="1.6"/><line x1="${HX}" y1="${W2[1] - 2}" x2="${HX}" y2="${W2[3] + 2}" stroke="${T.acc}" stroke-width="1.6"/>`;

  host.innerHTML = `<svg class="obj" viewBox="0 0 1000 470" role="slider" tabindex="0" aria-label="Node cost calculator: how long you keep the node" aria-valuemin="1" aria-valuemax="730" xmlns="http://www.w3.org/2000/svg">
    <defs>${DEFS}${mask}<clipPath id="c-${host.id}"><rect x="20" y="20" width="960" height="430" rx="22"/></clipPath></defs>
    <g filter="url(#nc-edge)">
      <g clip-path="url(#c-${host.id})"><g class="slide">${slide}</g></g>
      ${shade(W1)}${shade(W2)}
      <g mask="url(#m-${host.id})">${sleeve}${print}</g>
      ${hair}
    </g></svg>`;
  return host.querySelector('svg');
}

// ---- interaction: drag, snap to the nearest printed figure, keys, quick set ----
function wire(svg, place, toHours, startH = 24) {
  let h = startH;
  const set = (nh, snap = true) => { h = snap ? nearest(nh) : nh; place(h); const p = cost(nearest(h)); svg.setAttribute('aria-valuenow', Math.round(nearest(h))); svg.setAttribute('aria-valuetext', `${say(nearest(h))}: ${fmt(p.tot)}`); };
  const vb = () => svg.viewBox.baseVal.width / svg.getBoundingClientRect().width;
  svg.addEventListener('pointerdown', e => {
    if (e.target.closest('[data-set]')) return;
    svg.setPointerCapture(e.pointerId); svg.classList.add('drag');
    const x0 = e.clientX, h0 = h;
    const mv = ev => set(toHours(h0, (ev.clientX - x0) * vb()), false);
    const up = () => { svg.classList.remove('drag'); set(h); svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up); };
    svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  });
  svg.addEventListener('keydown', e => { const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key]; if (!d) return; e.preventDefault(); const i = STOPS.indexOf(nearest(h)); set(STOPS[Math.max(0, Math.min(STOPS.length - 1, i + d))]); });
  svg.querySelectorAll('[data-set]').forEach(el => el.addEventListener('click', () => set(+el.dataset.set)));
  set(startH);
}
const clampS = v => Math.max(0, Math.min(S, v));
const hoursAt = sv => Math.exp(clampS(sv) / S * Math.log(MAX_H));

// The mockup's palettes: 'leblond' (yellow card, black and red), 'clearcast' (greys and purple), 'cream'.
const svg = slideChart(host, THEMES.leblond);
const slide = svg.querySelector('.slide');
// dragging right pulls the slide right, moving shorter durations under the hairline
wire(svg, h => slide.style.transform = `translateX(${HX - s(h)}px)`, (h0, dx) => hoursAt(s(h0) - dx));
