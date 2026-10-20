// Builds the clearcast logo files from clearcast.js
// and copies them to where the GUI and the site use them.
//   client/logo/clearcast.svg        the mark: sphere only, no background
//   client/logo/clearcast-pfp.svg    the Farcaster pfp: sphere filling a light tile
//   client/logo/clearcast-pfp.png    1024px render of the pfp
//   client/logo/clearcast-small.svg  the mark tuned for ~28px (crisper edge)
//   client/ui/clearcast.svg          GUI favicon
//   client/ui/clearcast-small.svg    GUI header mark
//   site/img/clearcast.svg           mark on the site's client section
//   site/img/clearcast-avatar.png    512px pfp, the default pfp for new app accounts
const fs = require('fs'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const logo = path.join(__dirname, '..'), repo = path.join(logo, '..', '..');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(logo, 'clearcast.js'), 'utf8'), sandbox);
const { orb } = sandbox.module.exports;

const write = (file, svg) => {
  fs.writeFileSync(file, svg);
  execFileSync('svgo', ['--quiet', '--multipass', file]);
};
const mark = path.join(logo, 'clearcast.svg'), pfp = path.join(logo, 'clearcast-pfp.svg');
write(mark, orb('light', { full: true, bare: true }));
write(pfp, orb('light', { full: true }));
const small = path.join(logo, 'clearcast-small.svg');
write(small, orb('light', { full: true, bare: true, crisp: true }));
execFileSync('resvg', ['-w', '1024', pfp, path.join(logo, 'clearcast-pfp.png')]);

fs.copyFileSync(mark, path.join(repo, 'client', 'ui', 'clearcast.svg'));
fs.copyFileSync(small, path.join(repo, 'client', 'ui', 'clearcast-small.svg'));
fs.copyFileSync(mark, path.join(repo, 'site', 'img', 'clearcast.svg'));
execFileSync('resvg', ['-w', '512', pfp, path.join(repo, 'site', 'img', 'clearcast-avatar.png')]);
console.log('built clearcast.svg, clearcast-small.svg, clearcast-pfp.svg/png; copied to client/ui and site/img');
