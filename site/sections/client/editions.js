// fameboy's colour editions, for the client ad (and brand/mockups/client-ad/). Each copy of fameboy takes its
// name's colour (ADR 004): @fameboyteal is teal, @fameboytangerine tangerine, and so on, 470 of them.
//
//   data-color="teal" on any element     its --g0..--g3 become that edition's four shades, the same
//                                        maths as client/ui/theme.js (a Game Boy Color screen);
//                                        "clear" keeps the default greys.
//   <span class="edition"></span>         inside it: the edition's name, as on the boot screen.
//   <span class="keycap" data-color="…">  the fameboy keycap in that colour (client/logo/fameboy.js).
//
// Load vendor/fameboy-keycap.js (a copy of client/logo/fameboy.js) first for the keycaps.
(() => {
  // A few editions, hex from node/fameboy-name.mjs.
  const EDITIONS = { clear: null, teal: '#008080', tangerine: '#f28500', orchid: '#da70d6', coral: '#ff7f50', lime: '#32cd32', azure: '#007fff', scarlet: '#ff2400', mint: '#3eb489' };

  // client/ui/theme.js: lightest to darkest, the colour's hue at fixed lightness, saturation toned down like an LCD.
  const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  function hsl(hex) {
    const [r, g, b] = rgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }
  const shades = hex => { const [h, s] = hsl(hex); return [[0.42, 87], [0.48, 64], [0.55, 32], [0.62, 11]].map(([k, l]) => `hsl(${h.toFixed(1)} ${(Math.min(s * k * 1.6, 0.7) * 100).toFixed(1)}% ${l}%)`); };
  const GREYS = ['#dcdcd2', '#a6a69d', '#57574f', '#1c1c1a'];

  function paint(root = document) {
    root.querySelectorAll('[data-color]').forEach(el => {
      const name = el.dataset.color, hex = EDITIONS[name] ?? null;
      if (el.classList.contains('keycap')) {
        if (window.fameboyKeycap) el.innerHTML = window.fameboyKeycap({ hex, small: el.dataset.small != null });
        return;
      }
      (hex ? shades(hex) : GREYS).forEach((v, n) => el.style.setProperty(`--g${n}`, v));
      el.querySelectorAll('.edition').forEach(e => { e.textContent = name; });
    });
  }
  window.fameboyEditions = { EDITIONS, shades, paint };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', () => paint()); else paint();
})();
