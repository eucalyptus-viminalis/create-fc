// Builds the create-fc logo files from brand/src/create-fc.mjs into brand/logo/,
// then copies them to the site and docs. Run: pnpm brand:build
// Needs svgo, resvg and ImageMagick (brew install svgo resvg imagemagick).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mark, lockup, favicon, icon, INK, WHITE } from '../src/create-fc.mjs';

const brand = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(brand, '..'), out = path.join(brand, 'logo');
fs.mkdirSync(out, { recursive: true });
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
const svg = (name, body) => {
  const file = path.join(out, name);
  fs.writeFileSync(file, body);
  run('svgo', ['--quiet', '--multipass', file]);
  return file;
};
const png = (src, name, width) => { const file = path.join(out, name); run('resvg', ['-w', String(width), src, file]); return file; };

svg('create-fc-mark.svg', mark(INK));
svg('create-fc-mark-white.svg', mark(WHITE));
svg('create-fc-lockup.svg', lockup(INK));
svg('create-fc-lockup-white.svg', lockup(WHITE));
const fav = svg('favicon.svg', favicon());
const tile = svg('create-fc-icon.svg', icon());
svg('create-fc-icon-rounded.svg', icon({ round: true }));
png(tile, 'create-fc-icon-1024.png', 1024);
png(tile, 'create-fc-icon-512.png', 512);
png(tile, 'apple-touch-icon.png', 180);

// favicon.ico: the light-mode mark at 16, 32 and 48px, for browsers and tools without SVG favicons.
const tmp = fs.mkdtempSync(path.join(out, '.ico-'));
const sizes = [16, 32, 48].map(s => { const f = path.join(tmp, `${s}.png`); run('resvg', ['-w', String(s), fav, f]); return f; });
run('magick', [...sizes, path.join(out, 'favicon.ico')]);
fs.rmSync(tmp, { recursive: true });

const copy = (name, ...to) => to.forEach(dest => {
  fs.mkdirSync(path.dirname(path.join(repo, dest)), { recursive: true });
  fs.copyFileSync(path.join(out, name), path.join(repo, dest));
});
// microsite
copy('create-fc-lockup.svg', 'site/img/create-fc-lockup.svg');
copy('favicon.svg', 'site/favicon.svg');
copy('favicon.ico', 'site/favicon.ico');
copy('apple-touch-icon.png', 'site/apple-touch-icon.png');
// docs
copy('create-fc-mark.svg', 'docs/public/create-fc-mark.svg');
copy('create-fc-mark-white.svg', 'docs/public/create-fc-mark-white.svg');
copy('favicon.svg', 'docs/public/favicon.svg');
// fameboy's "built with create-fc" corner
copy('create-fc-lockup.svg', 'client/ui/create-fc-lockup.svg');

console.log('built brand/logo/*; copied to site/, docs/public/ and client/ui/');
