// clearcast's mark: a clear glass sphere lit from the top left (direction A).
// orb() returns SVG markup on a 512 grid. Ids get a unique prefix so many
// copies can sit in one page. Loaded by scripts/build-logo.cjs and by the
// pages in mockups/.
const INK = '#17151f', ACC = '#7959ff', ACC_INK = '#5d43d6', GROUND = '#e6e5ec';
let n = 0;
const uid = () => 'k' + (++n);
const svg = body => `<svg viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
const blur = (id, s) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${s}"/></filter>`;
const tile = (id, dark, accent = false) => {
  const [a, b] = accent ? ['#8b6dff', '#4f37c4'] : dark ? ['#2a2540', '#0e0c15'] : ['#f8f7fb', '#d7d5e2'];
  return `<radialGradient id="${id}" cx="28%" cy="18%" r="100%"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
};

// A · glass orb with a caustic: rendered sphere, light from top-left,
// refracted light gathering on the far rim and focusing to a point on the ground.
function orb(theme, { tint = false, full = false, bare = false, crisp = false } = {}) {
  // full: the sphere fills the frame (for the circular pfp) and the ground is out of view.
  // bare: no background tile, so the glass shows whatever it sits on (the mark and favicon).
  // crisp: tuned for ~28px, with a darker edge and a thin ink rim so the outline survives shrinking.
  // Everything is drawn relative to the round 1 sphere (r 148) and scaled by k.
  const d = theme === 'dark', i = uid(), cx = 256, cy = full ? 256 : 222, r = full ? 254 : 148, k = r / 148;
  const caus = tint ? ACC : '#fff';
  const at = (dx, dy) => [cx + dx * k, cy + dy * k];
  const [wx, wy] = at(-58, -72), [px, py] = at(-73, -81);
  return svg(`<defs>${tile(i + 'bg', d)}
    <radialGradient id="${i}body" cx="38%" cy="32%" r="72%">
      <stop offset="0" stop-color="#fff" stop-opacity="${d ? .10 : .45}"/>
      <stop offset=".72" stop-color="#fff" stop-opacity="${d ? .03 : .10}"/>
      <stop offset="1" stop-color="${d ? '#fff' : INK}" stop-opacity="${d ? .38 : crisp ? .5 : .34}"/></radialGradient>
    <linearGradient id="${i}cres" x1=".15" y1=".15" x2=".85" y2=".85">
      <stop offset=".5" stop-color="${caus}" stop-opacity="0"/><stop offset="1" stop-color="${caus}" stop-opacity=".95"/></linearGradient>
    <radialGradient id="${i}caus"><stop offset="0" stop-color="${caus}"/><stop offset=".3" stop-color="${caus}" stop-opacity=".6"/><stop offset="1" stop-color="${caus}" stop-opacity="0"/></radialGradient>
    <mask id="${i}m"><circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff"/><circle cx="${cx - 24 * k}" cy="${cy - 28 * k}" r="${r - 4 * k}" fill="#000"/></mask>
    <clipPath id="${i}c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    ${blur(i + 'b3', 3 * k)}${blur(i + 'b6', 6 * k)}${blur(i + 'b16', 16 * k)}</defs>
    ${bare ? '' : `<rect width="512" height="512" fill="url(#${i}bg)"/>`}
    ${full ? '' : `<ellipse cx="282" cy="400" rx="140" ry="20" fill="${d ? '#000' : INK}" opacity="${d ? .6 : .28}" filter="url(#${i}b16)"/>
    <ellipse cx="300" cy="398" rx="74" ry="13" fill="url(#${i}caus)" filter="url(#${i}b3)"/>
    <ellipse cx="300" cy="398" rx="20" ry="3.5" fill="${caus}"/>`}
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${i}body)"/>
    <g clip-path="url(#${i}c)">
      <ellipse cx="${cx}" cy="${cy - 92 * k}" rx="${125 * k}" ry="${40 * k}" fill="${d ? '#000' : INK}" opacity="${d ? .35 : .10}" filter="url(#${i}b16)"/>
      <g filter="url(#${i}b6)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#${i}cres)" mask="url(#${i}m)"/></g>
    </g>
    <ellipse cx="${wx}" cy="${wy}" rx="${44 * k}" ry="${22 * k}" transform="rotate(-38 ${wx} ${wy})" fill="#fff" opacity=".85" filter="url(#${i}b3)"/>
    <circle cx="${px}" cy="${py}" r="${7 * k}" fill="#fff"/>
    ${crisp ? `<circle cx="${cx}" cy="${cy}" r="${r - 7}" fill="none" stroke="${INK}" stroke-opacity=".3" stroke-width="14"/>
    <circle cx="${cx}" cy="${cy}" r="${r - 17}" fill="none" stroke="#fff" stroke-opacity=".95" stroke-width="6"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r - .8 * k}" fill="none" stroke="#fff" stroke-opacity="${d ? .55 : .95}" stroke-width="${1.6 * k}"/>`}`);
}

if (typeof module !== 'undefined') module.exports = { orb };
