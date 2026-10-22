// fameboy's mark: a clear keycap, seen from your chair (19° above the desk,
// turned 33°), lit from the top left. Picked in mockups/keycap.html.
//
// The cap is modelled in millimetres (a Cherry-style cap, 18 mm across, with a
// top that tilts toward you and a cylindrical scoop) and drawn as SVG
// polygons. A clear cap shows its far walls and the switch stem through the
// near walls, so the colour reads like a see-through Game Boy Color shell.
//
// keycap(options) returns SVG markup. Loaded by scripts/build-logo.cjs, by the
// pages in mockups/, and in the browser by client/ui/theme.js (which tints the
// favicon with each copy's colour) as window.fameboyKeycap.
(function () {
  const CLEAR_TINT = '#9ea3b0';
  const CAP = {
    w0: 18, d0: 18, r0: 1.3,          // bottom edge
    w1: 12.6, d1: 13.4, r1: 2.6,      // top face
    back: 0.7,                        // the top sits a little toward the back
    zFront: 7.4, zBack: 9.4,          // and tilts toward you
    dish: 0.75,                       // scoop across the top
  };
  let n = 0;

  const lerp = (a, b, t) => a + (b - a) * t;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c) => `rgb(${c.map(Math.round).join(',')})`;
  const pts = (p) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');

  // Rounded-rect outline, counter-clockwise from above, with a fixed point count.
  function rrect(w, d, r, cy, per) {
    const hw = w / 2, hd = d / 2, out = [];
    for (const [cx, cyy, a0] of [[hw - r, cy - hd + r, -90], [hw - r, cy + hd - r, 0], [-hw + r, cy + hd - r, 90], [-hw + r, cy - hd + r, 180]])
      for (let j = 0; j <= per; j++) { const a = (a0 + 90 * j / per) * Math.PI / 180; out.push([cx + r * Math.cos(a), cyy + r * Math.sin(a)]); }
    return out;
  }
  const topZ = (x, y) => lerp(CAP.zFront, CAP.zBack, (y - (CAP.back - CAP.d1 / 2)) / CAP.d1) - CAP.dish * (1 - (x / (CAP.w1 / 2)) ** 2);

  function model(per, rings) {
    const faces = [];
    const top = rrect(CAP.w1, CAP.d1, CAP.r1, CAP.back, per).map(([x, y]) => [x, y, topZ(x, y)]);
    const bottom = rrect(CAP.w0, CAP.d0, CAP.r0, 0, per).map(([x, y]) => [x, y, 0]);
    const k = top.length;
    for (let i = 0; i < k; i++) { const j = (i + 1) % k; faces.push({ p: [bottom[i], bottom[j], top[j], top[i]], part: 'wall' }); }
    const ring = (s) => top.map(([x, y]) => { const px = x * s, py = CAP.back + (y - CAP.back) * s; return [px, py, topZ(px, py)]; });
    for (let r = 0; r < rings; r++) {
      const a = ring(1 - r / rings), b = ring(1 - (r + 1) / rings);
      for (let i = 0; i < k; i++) { const j = (i + 1) % k; faces.push({ p: r === rings - 1 ? [a[i], a[j], b[i]] : [a[i], a[j], b[j], b[i]], part: 'top' }); }
    }
    return faces;
  }
  // The stem inside: a round post, seen through the cap.
  function stem() {
    const R = 2.75, N = 16, ring = (z) => Array.from({ length: N }, (_, i) => { const a = i / N * 2 * Math.PI; return [R * Math.cos(a), R * Math.sin(a), z]; });
    const lo = ring(0.6), hi = ring(7.0), f = [];
    for (let i = 0; i < N; i++) { const j = (i + 1) % N; f.push({ p: [lo[i], lo[j], hi[j], hi[i]], part: 'stem' }); }
    return f;
  }

  // hex: the copy's colour (null for clear). tile: draw on a square background
  // (for profile pictures). small: fewer facets and a stronger rim, for ≤32px.
  function keycap({ hex = null, elev = 19, yaw = -33, tile = null, small = false } = {}) {
    const id = 'kc' + (++n);
    const th = elev * Math.PI / 180, ps = yaw * Math.PI / 180;
    const cy = Math.cos(ps), sy = Math.sin(ps), ce = Math.cos(th), se = Math.sin(th);
    const rot = ([x, y, z]) => [x * cy - y * sy, x * sy + y * cy, z];
    const V = [0, -ce, se], L = unit([-0.55, -0.25, 0.8]), H = unit([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
    const S = 10;
    const proj = (q) => { const [x, y, z] = rot(q); return [x * S, -(z * ce + y * se) * S, -y * ce + z * se]; };
    const base = hexRgb(hex || CLEAR_TINT);
    const light = (nn, c, k = 1) => {
      const d = Math.max(0, dot(nn, L)), sp = Math.pow(Math.max(0, dot(nn, H)), 60);
      return { fill: c.map((v) => clamp(v * (0.42 + 0.68 * d) * k + 255 * sp * 0.85)), sp };
    };
    const prep = (f) => {
      const w = f.p.map(rot), p = f.p.map(proj);
      const nn = unit(cross(sub(w[1], w[0]), sub(w[2], w[0])));
      return { ...f, n: nn, q: p, depth: p.reduce((a, v) => a + v[2], 0) / p.length, facing: dot(nn, V) > 0 };
    };
    const byDepth = (a) => a.slice().sort((x, y) => x.depth - y.depth);
    const poly = (f, fill, extra = '') => `<polygon points="${pts(f.q)}" fill="${fill}" stroke="${fill}" stroke-width=".7" stroke-linejoin="round"${extra}/>`;

    const faces = model(small ? 5 : 8, small ? 3 : 5).map(prep);
    const inner = byDepth(faces.filter((f) => !f.facing && f.part === 'wall'));
    const outer = byDepth(faces.filter((f) => f.facing));
    const posts = byDepth(stem().map(prep).filter((f) => f.facing));
    const postRgb = base.map((c) => clamp(c * 0.55 + 70));

    let body = `<g opacity=".55">${inner.map((f) => poly(f, rgb(light(f.n.map((v) => -v), base, 0.8).fill))).join('')}</g>`;
    if (!small) body += `<g opacity=".8">${posts.map((f) => poly(f, rgb(light(f.n, postRgb).fill))).join('')}</g>`;
    body += `<g opacity="${small ? .78 : .62}">${outer.map((f) => poly(f, rgb(light(f.n, base).fill))).join('')}</g>`;
    body += outer.map((f) => { const s = light(f.n, base).sp; return s > 0.06 ? poly(f, '#fff', ` opacity="${Math.min(1, s).toFixed(2)}"`) : ''; }).join('');
    const rim = rrect(CAP.w1, CAP.d1, CAP.r1, CAP.back, 8).map(([x, y]) => proj([x, y, topZ(x, y)]));
    body += `<polygon points="${pts(rim)}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="${small ? 2.6 : 1.4}" stroke-linejoin="round"/>`;
    if (small) { // an outline so the cap holds its shape on any tab colour
      const sil = rrect(CAP.w0, CAP.d0, CAP.r0, 0, 5).map(([x, y]) => proj([x, y, 0]));
      body = `<polygon points="${pts(sil)}" fill="none" stroke="rgb(23,21,31)" stroke-opacity=".35" stroke-width="3" stroke-linejoin="round"/>` + body;
    }

    const all = faces.flatMap((f) => f.q);
    const minX = Math.min(...all.map((q) => q[0])), maxX = Math.max(...all.map((q) => q[0]));
    const minY = Math.min(...all.map((q) => q[1])), maxY = Math.max(...all.map((q) => q[1]));
    const w = maxX - minX, h = maxY - minY, pad = tile ? Math.max(w, h) * 0.24 : 2, side = Math.max(w, h) + pad * 2;
    const vx = minX - (side - w) / 2, vy = minY - (side - h) / 2;
    if (tile) body = `<defs><radialGradient id="${id}t" cx="28%" cy="18%" r="100%"><stop offset="0" stop-color="${tile[0]}"/><stop offset="1" stop-color="${tile[1]}"/></radialGradient></defs>`
      + `<rect x="${vx.toFixed(1)}" y="${vy.toFixed(1)}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" fill="url(#${id}t)"/>` + body;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx.toFixed(1)} ${vy.toFixed(1)} ${side.toFixed(1)} ${side.toFixed(1)}">${body}</svg>`;
  }

  if (typeof module !== 'undefined') module.exports = { keycap };
  else globalThis.fameboyKeycap = keycap;
})();
