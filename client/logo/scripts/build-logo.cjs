// Builds the fameboy logo files from fameboy.js
// and copies them to where the GUI and the site use them.
//   client/logo/fameboy.svg        the mark: the clear keycap, no background
//   client/logo/fameboy-small.svg  the mark tuned for ≤32px (fewer facets, a stronger rim and outline)
//   client/logo/fameboy-pfp.svg    the Farcaster pfp: the keycap on a light tile
//   client/logo/fameboy-pfp.png    1024px render of the pfp
//   client/ui/fameboy.svg          GUI mark (classic header, client section)
//   client/ui/fameboy-small.svg    GUI favicon and classic header mark
//   client/ui/fameboy-keycap.js    fameboy.js, so theme.js can draw each copy's coloured favicon
//   site/img/fameboy.svg           mark on the site's client section
//   site/img/fameboy-avatar.png    512px pfp, the default pfp for new app accounts
// Per-colour pfps for @fameboy<color> names: build-avatars.cjs (pnpm avatars:build).
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const logo = path.join(__dirname, '..'), repo = path.join(logo, '..', '..');
const sandbox = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(logo, 'fameboy.js'), 'utf8'), sandbox);
const { keycap } = sandbox.module.exports;

const write = (file, svg) => {
  fs.writeFileSync(file, svg);
  execFileSync('svgo', ['--quiet', '--multipass', file]);
};
const mark = path.join(logo, 'fameboy.svg'), small = path.join(logo, 'fameboy-small.svg'), pfp = path.join(logo, 'fameboy-pfp.svg');
write(mark, keycap());
write(small, keycap({ small: true }));
write(pfp, keycap({ tile: ['#f8f7fb', '#d7d5e2'] }));
execFileSync('resvg', ['-w', '1024', pfp, path.join(logo, 'fameboy-pfp.png')]);

fs.copyFileSync(mark, path.join(repo, 'client', 'ui', 'fameboy.svg'));
fs.copyFileSync(small, path.join(repo, 'client', 'ui', 'fameboy-small.svg'));
fs.copyFileSync(path.join(logo, 'fameboy.js'), path.join(repo, 'client', 'ui', 'fameboy-keycap.js'));
fs.copyFileSync(mark, path.join(repo, 'site', 'img', 'fameboy.svg'));
execFileSync('resvg', ['-w', '512', pfp, path.join(repo, 'site', 'img', 'fameboy-avatar.png')]);
console.log('built fameboy.svg, fameboy-small.svg, fameboy-pfp.svg/png; copied to client/ui and site/img');
