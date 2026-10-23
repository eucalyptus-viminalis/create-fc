// Builds a profile picture for every @fameboy<color> name (ADR 004): the
// keycap in that colour on a light tile of the same colour, 512px JPEG.
//   site/img/avatars/fameboy<color>.jpg
// Published with the site, so the URLs outlive any one node. `fameboy
// app-account` suggests the one that matches the account's name
// (avatarFor in node/fameboy-name.mjs); other names get site/img/fameboy-avatar.png.
//
//   node client/logo/scripts/build-avatars.cjs [color ...]   (all colours if none given)
//
// Needs resvg (brew install resvg) and macOS's sips for the JPEG step.
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), { execFileSync } = require('child_process');
const logo = path.join(__dirname, '..'), repo = path.join(logo, '..', '..');
const out = path.join(repo, 'site', 'img', 'avatars');

const sandbox = { module: { exports: {} }, globalThis: {} };
vm.runInNewContext(fs.readFileSync(path.join(logo, 'fameboy.js'), 'utf8'), sandbox);
const { keycap } = sandbox.module.exports;

// The colour mixed toward white by t (0 = the colour, 1 = white).
const tint = (hex, t) => '#' + [1, 3, 5].map((i) => { const v = parseInt(hex.slice(i, i + 2), 16); return Math.round(v + (255 - v) * t).toString(16).padStart(2, '0'); }).join('');

(async () => {
  const { PALETTE, PREFIX } = await import(path.join(repo, 'node', 'fameboy-name.mjs'));
  const want = process.argv.slice(2);
  const colors = want.length ? want : Object.keys(PALETTE);
  fs.mkdirSync(out, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fameboy-avatars-'));
  for (const color of colors) {
    const hex = PALETTE[color];
    if (!hex) throw new Error(`${color} isn't in the palette`);
    const svg = path.join(tmp, `${color}.svg`), png = path.join(tmp, `${color}.png`);
    fs.writeFileSync(svg, keycap({ hex, tile: [tint(hex, 0.9), tint(hex, 0.7)] }));
    execFileSync('resvg', ['-w', '512', svg, png]);
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', png, '--out', path.join(out, `${PREFIX}${color}.jpg`)], { stdio: 'ignore' });
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`built ${colors.length} avatars in site/img/avatars/`);
})();
