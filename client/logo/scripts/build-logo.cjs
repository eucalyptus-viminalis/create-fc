// Builds the fameboy logo files from fameboy.js
// and copies them to where the GUI and the site use them.
//   client/logo/fameboy.svg        the mark: sphere only, no background
//   client/logo/fameboy-pfp.svg    the Farcaster pfp: sphere filling a light tile
//   client/logo/fameboy-pfp.png    1024px render of the pfp
//   client/logo/fameboy-small.svg  the mark tuned for ~28px (crisper edge)
//   client/ui/fameboy.svg          GUI favicon
//   client/ui/fameboy-small.svg    GUI header mark
//   site/img/fameboy.svg           mark on the site's client section
//   site/img/fameboy-avatar.png    512px pfp, the default pfp for new app accounts
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const logo = path.join(__dirname, '..'), repo = path.join(logo, '..', '..');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(logo, 'fameboy.js'), 'utf8'), sandbox);
const { orb } = sandbox.module.exports;

const write = (file, svg) => {
  fs.writeFileSync(file, svg);
  execFileSync('svgo', ['--quiet', '--multipass', file]);
};
const mark = path.join(logo, 'fameboy.svg'), pfp = path.join(logo, 'fameboy-pfp.svg');
write(mark, orb('light', { full: true, bare: true }));
write(pfp, orb('light', { full: true }));
const small = path.join(logo, 'fameboy-small.svg');
write(small, orb('light', { full: true, bare: true, crisp: true }));
execFileSync('resvg', ['-w', '1024', pfp, path.join(logo, 'fameboy-pfp.png')]);

fs.copyFileSync(mark, path.join(repo, 'client', 'ui', 'fameboy.svg'));
fs.copyFileSync(small, path.join(repo, 'client', 'ui', 'fameboy-small.svg'));
fs.copyFileSync(mark, path.join(repo, 'site', 'img', 'fameboy.svg'));
execFileSync('resvg', ['-w', '512', pfp, path.join(repo, 'site', 'img', 'fameboy-avatar.png')]);
console.log('built fameboy.svg, fameboy-small.svg, fameboy-pfp.svg/png; copied to client/ui and site/img');
