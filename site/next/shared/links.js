// Links that leave the site open in a new tab and carry a ↗, so it's clear before you click.
// Applies to every document; a link can opt out with data-internal (for links styled as buttons).
// The ↗ is glued to the link's last word, so it never wraps onto a line by itself.
const here = location.origin;

// The last bit of text in the link, wherever it's nested (a <code>, a <b> ...).
function lastText(el) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
  let n, last = null; while ((n = walk.nextNode())) last = n; return last;
}

for (const a of document.querySelectorAll('a[href]')) {
  let url; try { url = new URL(a.getAttribute('href'), location.href); } catch { continue; }
  if (url.origin === here || a.hasAttribute('data-internal') || !/^https?:$/.test(url.protocol)) continue;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (a.closest('svg') || a.classList.contains('ext')) continue;
  a.classList.add('ext');
  const mark = '<span class="ext-mark" aria-hidden="true">↗</span>';
  const t = lastText(a);
  if (t) {
    // split off the last word and wrap it with the ↗ in a span that doesn't break
    const m = t.data.match(/\S+\s*$/), tail = t.splitText(m.index), keep = document.createElement('span');
    keep.className = 'ext-nw'; tail.replaceWith(keep); keep.append(tail); keep.insertAdjacentHTML('beforeend', mark);
  } else a.insertAdjacentHTML('beforeend', mark);
  a.insertAdjacentHTML('beforeend', '<span class="ext-sr"> (opens in a new tab)</span>');
}
