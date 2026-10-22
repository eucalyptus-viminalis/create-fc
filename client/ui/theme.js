// This copy's look (ADR 004). Every copy of fameboy is named after its app
// account. A @fameboy<color> copy takes that colour; any other name keeps the
// clear look (the greys in home.css).
//
// A colour becomes a four-shade palette, like a Game Boy Color screen: the
// pages draw everything with --g0 (lightest) to --g3 (darkest), so changing
// those four recolours every page. Each shade keeps the colour's hue at a
// fixed lightness, so text stays readable whatever the colour.
//
// Also: the favicon keycap takes the colour, the page title uses the copy's name, and
// the classic page's accent follows the colour.
//
// Load it first, in <head>:  <script src="/theme.js"></script>
// theme.name is this copy's name ("fameboyteal", or "fameboy").

(() => {
  const TOKEN = () => document.querySelector('meta[name="fameboy-token"]')?.content ?? "";
  const KEY = "fameboy-instance";

  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  function hsl(hex) {
    const [r, g, b] = rgb(hex), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(h * 60 + 360) % 360, s, l];
  }
  const css = (h, s, l) => `hsl(${h.toFixed(1)} ${(s * 100).toFixed(1)}% ${l}%)`;

  // Lightest to darkest. Saturation is the colour's, toned down like an LCD.
  function shades(hex) {
    const [h, s] = hsl(hex);
    return [[0.42, 87], [0.48, 64], [0.55, 32], [0.62, 11]].map(([k, l]) => css(h, Math.min(s * k * 1.6, 0.7), l));
  }

  // The favicon is the keycap in this copy's colour, drawn by client/logo/fameboy.js.
  function favicon(hex) {
    const draw = () => {
      const svg = window.fameboyKeycap({ hex, small: true });
      document.querySelectorAll('link[rel="icon"]').forEach((l) => (l.href = `data:image/svg+xml,${encodeURIComponent(svg)}`));
    };
    if (window.fameboyKeycap) return draw();
    const s = document.createElement("script");
    s.src = "/fameboy-keycap.js";
    s.onload = draw;
    document.head.append(s);
  }

  const theme = { name: "fameboy", color: null, hex: null };
  function apply(i) {
    if (!i) return;
    Object.assign(theme, { name: i.name || "fameboy", color: i.color ?? null, hex: i.hex ?? null });
    const root = document.documentElement;
    root.dataset.theme = theme.color ?? "clear";
    if (theme.hex) {
      shades(theme.hex).forEach((v, n) => root.style.setProperty(`--g${n}`, v));
      root.style.setProperty("--accent", theme.hex);
      root.style.setProperty("--accent-ink", shades(theme.hex)[2]);
      favicon(theme.hex);
    } else {
      document.querySelectorAll('link[rel="icon"]').forEach((l) => (l.href = "/fameboy-small.svg"));
      for (const n of [0, 1, 2, 3, "accent", "accent-ink"].map((x) => (typeof x === "number" ? `--g${x}` : `--${x}`))) root.style.removeProperty(n);
    }
    if (theme.name !== "fameboy") document.title = document.title.replace(/\bfameboy\b/, theme.name);
    document.dispatchEvent(new CustomEvent("fameboy:theme", { detail: theme }));
  }

  // Paint the last known look at once, then check for a newer one.
  try { apply(JSON.parse(localStorage.getItem(KEY) ?? "null")); } catch {}
  addEventListener("DOMContentLoaded", () => {
    if (theme.name !== "fameboy") document.title = document.title.replace(/\bfameboy\b/, theme.name);
    fetch("/api/instance", { headers: { "x-fameboy-token": TOKEN() } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return;
        try { localStorage.setItem(KEY, JSON.stringify(j.data)); } catch {}
        apply(j.data);
      })
      .catch(() => {});
  });

  // theme.apply({ name, color, hex }) repaints, e.g. to preview a colour from the console.
  theme.apply = apply;
  window.theme = theme;
})();
