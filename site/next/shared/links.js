// Links that leave the site open in a new tab and carry a ↗, so it's clear before you click.
// Applies to every document; a link can opt out with data-internal (for links styled as buttons).
const here = location.origin;
for (const a of document.querySelectorAll('a[href]')) {
  let url; try { url = new URL(a.getAttribute('href'), location.href); } catch { continue; }
  if (url.origin === here || a.hasAttribute('data-internal') || !/^https?:$/.test(url.protocol)) continue;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  if (a.closest('svg') || a.classList.contains('ext')) continue;
  a.classList.add('ext');
  a.insertAdjacentHTML('beforeend', '<span class="ext-mark" aria-hidden="true">↗</span><span class="ext-sr"> (opens in a new tab)</span>');
}
