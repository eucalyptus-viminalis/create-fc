// clearcast's UI kit: small components shared by every page, as functions
// that return HTML strings (the pages build their views from strings).
// Load it before the page's own script:
//   <link rel="stylesheet" href="/kit.css"> <script src="/kit.js"></script>
//
// kit.ext(href, label, opts)  a link that leaves clearcast. It always opens in
//                             a new tab, says so to screen readers, and shows
//                             a small pixel arrow (↗) after text labels.
//   href    where it goes (escaped here)
//   label   the link's content, as HTML: escape any text you pass in
//   opts    { cls, title, arrow, attrs }: arrow defaults to true; pass false
//           when the label is a picture, where an arrow would look like part
//           of it. attrs: extra attributes, as HTML (escape their values)

(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // A 7x7 pixel diagonal arrow, drawn in the text colour.
  const ARROW_CELLS = [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [5, 1], [4, 2], [3, 3], [2, 4], [1, 5], [0, 6]];
  const arrow = `<svg class="ext-arrow" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${ARROW_CELLS.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join("")}</svg>`;

  function ext(href, label, opts = {}) {
    const { cls = "", title, arrow: withArrow = true, attrs = "" } = opts;
    return `<a class="ext${cls ? ` ${cls}` : ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ""}${attrs ? ` ${attrs}` : ""}>${label}${withArrow ? arrow : ""}<span class="sr"> (opens in a new tab)</span></a>`;
  }

  window.kit = { esc, ext, arrow };
})();
