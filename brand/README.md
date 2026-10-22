# brand

The create-fc identity. clearcast's own mark (the glass orb) lives with the client in `client/logo/`.

## The mark

The keys you press to type `createfc` on a QWERTY keyboard, in their real positions. E R T F C touch and merge into one shape. A sits alone on the home row. The wordmark is `create-fc` in JetBrains Mono Bold, tracking -0.02em, ink only (no accent colour). In the files, the letters are converted to outlines.

## Files

```
brand/
  src/create-fc.mjs    draws everything: mark geometry, lockup, favicon, icon
  scripts/build.mjs    writes logo/ and copies files to site/ and docs/public/
  logo/                finished files: use these, don't edit them by hand
  mockups/             explorations (gitignored)
```

| File | Use |
| --- | --- |
| `create-fc-mark.svg` / `-white.svg` | The mark alone, on light / dark |
| `create-fc-lockup.svg` / `-white.svg` | Mark + wordmark, on light / dark |
| `create-fc-icon.svg`, `-512.png`, `-1024.png` | White mark on an ink square: avatars, profile pictures (the platform rounds it) |
| `create-fc-icon-rounded.svg` | Same with its own rounded corners, for places that don't round |
| `favicon.svg` | Browser tab icon, switches to white in dark mode |
| `favicon.ico` | 16/32/48px fallback for older browsers and tools |
| `apple-touch-icon.png` | 180px iOS home-screen icon |

Copies are written to `site/` (favicons, `img/create-fc-lockup.svg`) and `docs/public/` (mark, favicon). The social preview (`assets/social-preview.html`) loads `logo/create-fc-lockup-white.svg` directly.

## Rebuilding

Change `src/create-fc.mjs`, then:

```bash
pnpm brand:build
```

Needs `svgo`, `resvg` and ImageMagick (`brew install svgo resvg imagemagick`). Then run `make social-preview` to rebuild the social preview image.

## Use

- Keep clear space around the mark of at least the A key's width.
- Ink `#17151f` on light, white on dark. Don't recolour it purple or add effects.
- Below about 24px wide, use the mark without the wordmark.
