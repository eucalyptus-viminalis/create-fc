// The member card as a 1200x630 link-preview image: the tear-off card from NDA Form 1
// (brand/mockups/finish.html) lying on a desk. cardSvg() is pure; renderPng() needs resvg.

const PAPER = '#ece6d2', FORM = '#24493b', TYPED = '#23253a', STAMP = '#6b4fc4', SIG = '#1f2a6b';
const MARK = 'M0 42a2 2 0 0 1 2-2h40a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2ZM70 2a2 2 0 0 1 2-2h120a2 2 0 0 1 2 2v40a2 2 0 0 1-2 2h-28v38a2 2 0 0 1-2 2h-18v38a2 2 0 0 1-2 2h-40a2 2 0 0 1-2-2V82a2 2 0 0 1 2-2h18V44H72a2 2 0 0 1-2-2Z';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Shrink long typed values so they stay inside the card.
const fit = (text, size, room, perChar = 0.6) => Math.min(size, room / Math.max(1, String(text).length * perChar));

export function cardSvg({ name, number, enrolled, signature }) {
  // The card: a wallet card (3.37 x 2.125 in) at 880 x 555, turned a little on the desk.
  const W = 880, H = 555, x = (1200 - W) / 2, y = (630 - H) / 2;
  const rowY = [262, 330, 398];
  const rows = [['Operator', name], ['Member no.', number], ['Enrolled', enrolled]];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="desk" cx="30%" cy="20%" r="120%"><stop offset="0" stop-color="#d9d7cc"/><stop offset="1" stop-color="#b6b4a8"/></radialGradient>
    <filter id="tooth" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" seed="4" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 .35  0 0 0 0 .31  0 0 0 0 .24  0 0 0 -1.6 1.05"/>
    </filter>
    <filter id="stampy" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="13" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -3.2 2.3" result="gaps"/>
      <feComposite in="SourceGraphic" in2="gaps" operator="in"/>
    </filter>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="8" dy="14" stdDeviation="14" flood-color="#000" flood-opacity=".28"/></filter>
    <clipPath id="clip"><rect width="${W}" height="${H}"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="url(#desk)"/>
  <g transform="translate(${x} ${y}) rotate(-1.6 ${W / 2} ${H / 2})">
    <rect width="${W}" height="${H}" fill="${PAPER}" filter="url(#shadow)"/>
    <g clip-path="url(#clip)"><rect width="${W}" height="${H}" filter="url(#tooth)" opacity=".42"/></g>
    <rect x="22" y="22" width="${W - 44}" height="${H - 44}" fill="none" stroke="${FORM}" stroke-width="3"/>

    <text x="52" y="86" font-family="Libre Franklin" font-weight="900" font-size="31" fill="${FORM}" letter-spacing="1">NETWORK DECENTRALIZATION</text>
    <text x="52" y="122" font-family="Libre Franklin" font-weight="900" font-size="31" fill="${FORM}" letter-spacing="1">AUTHORITY · MEMBER</text>
    <path d="${MARK}" fill="${FORM}" transform="translate(${W - 52 - 110} 58) scale(${110 / 194})"/>
    <rect x="52" y="146" width="${W - 104}" height="4" fill="${FORM}"/>

    ${rows.map(([label, value], i) => `
    <text x="52" y="${rowY[i]}" font-family="Archivo Narrow" font-weight="600" font-size="22" fill="${FORM}" letter-spacing="1.5">${esc(label.toUpperCase())}</text>
    <text x="250" y="${rowY[i]}" font-family="Courier Prime" font-weight="700" font-size="${fit(value, 40, 500).toFixed(1)}" fill="${TYPED}">${esc(value)}</text>
    <line x1="250" y1="${rowY[i] + 14}" x2="${W - 52}" y2="${rowY[i] + 14}" stroke="${FORM}" stroke-opacity=".35" stroke-width="2" stroke-dasharray="2 5"/>`).join('')}

    <text x="52" y="${H - 52}" font-family="Archivo Narrow" font-weight="600" font-size="20" fill="${FORM}" letter-spacing="1.5">BEARER IS A CERTIFIED NODE OPERATOR</text>
    <text x="${W - 52}" y="${H - 50}" text-anchor="end" font-family="Homemade Apple" font-size="${fit(signature, 30, 330, 0.75).toFixed(1)}" fill="${SIG}">${esc(signature)}</text>

    <g transform="translate(${W - 150} ${H - 175}) rotate(-12)" filter="url(#stampy)" opacity=".85">
      <circle r="78" fill="none" stroke="${STAMP}" stroke-width="5"/>
      <circle r="66" fill="none" stroke="${STAMP}" stroke-width="2"/>
      <text y="-14" text-anchor="middle" font-family="Libre Franklin" font-weight="900" font-size="17" fill="${STAMP}" letter-spacing="2">CERTIFIED</text>
      <text y="9" text-anchor="middle" font-family="Libre Franklin" font-weight="900" font-size="17" fill="${STAMP}" letter-spacing="2">NODE</text>
      <text y="32" text-anchor="middle" font-family="Libre Franklin" font-weight="900" font-size="17" fill="${STAMP}" letter-spacing="2">OPERATOR</text>
    </g>
  </g>
</svg>`;
}

// fonts: an array of font files (Uint8Array) for the four families used above.
export function renderPng(Resvg, svg, fonts) {
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { fontBuffers: fonts, loadSystemFonts: false, defaultFontFamily: 'Archivo Narrow' } });
  return r.render().asPng();
}
