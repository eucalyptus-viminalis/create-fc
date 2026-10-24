// Link-preview cards for single casts. Link previews (Farcaster, X, iMessage)
// don't run the page's scripts, so a hosted fameboy draws each cast page's card
// itself: a 1200x630 PNG that looks like the cast page's open cast. The
// picture, name, text, first image and counts are drawn as SVG and turned
// into a PNG by resvg (WebAssembly, so nothing to compile).
//
// The text is VT323, which is monospaced: every character is 0.4 em wide, so
// wrapping is counting. The text gets the biggest size that fits; a cast too
// long even at the smallest size is cut off with "…". Emoji come from Twemoji.
// Characters VT323 doesn't have (most non-Latin scripts) are left blank.

import { readFile } from "node:fs/promises";
import { lookup } from "node:dns/promises";
import { createRequire } from "node:module";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { Resvg, initWasm } from "@resvg/resvg-wasm";

export type CardCast = {
  fid: number;
  hash: string;
  author: { username?: string; display?: string; pfp?: string };
  text: string;
  time: string;
  embeds: string[];
  channel?: string;
  app?: { name: string };
  likes: number;
  recasts: number;
  replies: number;
};
// This copy: its name (the app account's), its colour, and its address.
export type CardLook = { name: string; hex: string | null; host: string };

const HERE = dirname(fileURLToPath(import.meta.url));
const W = 1200, H = 630;
const ADV = 0.4; // VT323's advance, in em
const SIZES = [60, 52, 46, 40, 34];
const LEADING = 1.22;
const TWEMOJI = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg";

// ------------------------------------------------------------------ setup
type Kit = { vt: Uint8Array; px: Uint8Array; has: (cp: number) => boolean; keycap: (o: { hex?: string }) => string };
let kitP: Promise<Kit> | undefined;
const kit = () =>
  (kitP ??= (async () => {
    const require = createRequire(import.meta.url);
    await initWasm(await readFile(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const [vt, px, logo] = await Promise.all([
      readFile(join(HERE, "../fonts/VT323-Regular.ttf")),
      readFile(join(HERE, "../fonts/Silkscreen-Regular.ttf")),
      readFile(join(HERE, "../logo/fameboy.js"), "utf8"),
    ]);
    // logo/fameboy.js is a browser script that also sets module.exports.
    const mod = { exports: {} as { keycap: Kit["keycap"] } };
    vm.runInNewContext(logo, { module: mod });
    const covered = cmap(vt);
    return { vt, px, has: (cp: number) => covered.has(cp), keycap: mod.exports.keycap };
  })());

// The code points a TrueType font has glyphs for (cmap formats 4 and 12).
function cmap(font: Uint8Array): Set<number> {
  const b = Buffer.from(font.buffer, font.byteOffset, font.byteLength);
  const tables = b.readUInt16BE(4);
  let at = -1;
  for (let i = 0; i < tables; i++) if (b.toString("ascii", 12 + i * 16, 16 + i * 16) === "cmap") at = b.readUInt32BE(20 + i * 16);
  const out = new Set<number>();
  if (at < 0) return out;
  const n = b.readUInt16BE(at + 2);
  for (let i = 0; i < n; i++) {
    const sub = at + b.readUInt32BE(at + 8 + i * 8);
    const format = b.readUInt16BE(sub);
    if (format === 4) {
      const segs = b.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14, starts = ends + segs * 2 + 2, deltas = starts + segs * 2, ranges = deltas + segs * 2;
      for (let s = 0; s < segs; s++) {
        const end = b.readUInt16BE(ends + s * 2), start = b.readUInt16BE(starts + s * 2);
        const delta = b.readUInt16BE(deltas + s * 2), range = b.readUInt16BE(ranges + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c++) {
          const g = range === 0 ? (c + delta) & 0xffff : b.readUInt16BE(ranges + s * 2 + range + (c - start) * 2);
          if (g) out.add(c);
        }
      }
    } else if (format === 12) {
      const groups = b.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g++) {
        const o = sub + 16 + g * 12;
        for (let c = b.readUInt32BE(o); c <= b.readUInt32BE(o + 4); c++) out.add(c);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------ colours
// The clear look's greys (ui/home.css), or a @fameboy<color> copy's four
// shades, worked out the way ui/theme.js does.
const GREYS = ["#dcdcd2", "#a6a69d", "#57574f", "#1c1c1a"];
function palette(hex: string | null): string[] {
  if (!hex) return GREYS;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = ((max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60 + 360) % 360;
  }
  return [[0.42, 87], [0.48, 64], [0.55, 32], [0.62, 11]].map(([k, light]) => hslHex(h, Math.min(s * k! * 1.6, 0.7), light! / 100));
}
function hslHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ------------------------------------------------------------------ fetching
// Pictures come from addresses in people's profiles and casts, so a hosted
// server only fetches public http(s) addresses on the usual ports: never
// itself, its node or anything else on a private network.
export function privateIp(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return privateIp(mapped[1]!);
    return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

type Picture = { type: string; bytes: Buffer };
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/;
async function fetchPicture(raw: string, maxBytes = 4 * 1024 * 1024): Promise<Picture | undefined> {
  let href = raw;
  for (let hop = 0; hop < 4; hop++) {
    let url: URL;
    try { url = new URL(href); } catch { return undefined; }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.port || url.username) return undefined;
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ips = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((a) => a.address), () => []);
    if (!ips.length || ips.some(privateIp)) return undefined;
    let res: Response;
    try {
      // Ask for PNG or JPEG: image CDNs pick a format by what's accepted.
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(5_000), headers: { accept: "image/png,image/jpeg;q=0.9,image/*;q=0.5", "user-agent": "fameboy/0.1 (link preview)" } });
    } catch {
      return undefined;
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      href = new URL(res.headers.get("location")!, url).href;
      continue;
    }
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!res.ok || !IMAGE_TYPES.test(type) || Number(res.headers.get("content-length") ?? 0) > maxBytes) return undefined;
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > maxBytes) return undefined;
      chunks.push(chunk);
    }
    return { type, bytes: Buffer.concat(chunks) };
  }
  return undefined;
}
const dataUri = (p: Picture) => `data:${p.type};base64,${p.bytes.toString("base64")}`;

// Twemoji's file for an emoji: its code points in hex, without the variation
// selector unless the emoji joins others.
const emojiCache = new Map<string, Promise<string | undefined>>();
function emoji(g: string): Promise<string | undefined> {
  const cps = [...g].map((c) => c.codePointAt(0)!);
  const name = (cps.includes(0x200d) ? cps : cps.filter((c) => c !== 0xfe0f)).map((c) => c.toString(16)).join("-");
  let hit = emojiCache.get(name);
  if (!hit) {
    hit = fetch(`${TWEMOJI}/${name}.svg`, { signal: AbortSignal.timeout(4_000) })
      .then(async (r) => (r.ok ? `data:image/svg+xml;base64,${Buffer.from(await r.text()).toString("base64")}` : undefined))
      .catch(() => undefined);
    if (emojiCache.size > 2000) emojiCache.clear();
    emojiCache.set(name, hit);
  }
  return hit;
}

// ------------------------------------------------------------------ text
// A grapheme and how many columns it takes: emoji take two.
type G = { s: string; cols: number; emoji: boolean };
const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
export const graphemes = (s: string): G[] =>
  [...segmenter.segment(s)].map(({ segment }) => (PICTO.test(segment) ? { s: segment, cols: 2, emoji: true } : { s: segment, cols: 1, emoji: false }));
const width = (gs: G[]) => gs.reduce((n, g) => n + g.cols, 0);

// Wrap at spaces into lines of at most `cols` columns; a word longer than a
// line is broken wherever it has to be.
export function wrap(text: string, cols: number): G[][] {
  const lines: G[][] = [];
  for (const para of text.replace(/\r/g, "").replace(/\t/g, "  ").split("\n")) {
    let line: G[] = [];
    for (const word of para.split(" ")) {
      let w = graphemes(word);
      const gap = line.length ? 1 : 0;
      if (width(line) + gap + width(w) <= cols) {
        if (gap) line.push({ s: " ", cols: 1, emoji: false });
        line.push(...w);
        continue;
      }
      if (line.length) lines.push(line);
      line = [];
      while (width(w) > cols) {
        let n = 0, used = 0;
        while (n < w.length && used + w[n]!.cols <= cols) used += w[n++]!.cols;
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      line = w;
    }
    lines.push(line);
  }
  while (lines.length > 1 && !lines[lines.length - 1]!.length) lines.pop();
  return lines;
}

// Cut a line to `cols` columns, ending in an ellipsis.
export function cut(line: G[], cols: number, dots: string): G[] {
  const out: G[] = [];
  let used = 0;
  for (const g of line) {
    if (used + g.cols > cols - dots.length) break;
    out.push(g);
    used += g.cols;
  }
  while (out.length && out[out.length - 1]!.s === " ") out.pop();
  return [...out, ...graphemes(dots)];
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// One line of VT323 at (x, baseline): text runs and emoji pictures, placed by column.
async function line(gs: G[], x: number, baseline: number, size: number, fill: string, k: Kit): Promise<string> {
  const col = size * ADV;
  let out = "", run = "", runAt = 0, c = 0;
  const flush = () => {
    if (run.trim()) out += `<text x="${(x + runAt * col).toFixed(1)}" y="${baseline.toFixed(1)}" font-family="VT323" font-size="${size}" fill="${fill}" xml:space="preserve">${esc(run)}</text>`;
    run = "";
  };
  for (const g of gs) {
    if (g.emoji) {
      flush();
      const src = await emoji(g.s);
      const d = size * 0.78;
      if (src) out += `<image href="${src}" x="${(x + c * col + (2 * col - d) / 2).toFixed(1)}" y="${(baseline - size * 0.72).toFixed(1)}" width="${d.toFixed(1)}" height="${d.toFixed(1)}"/>`;
    } else {
      if (!run) runAt = c;
      // VT323 lacks most non-Latin scripts; a blank keeps the columns right.
      run += [...g.s].every((ch) => k.has(ch.codePointAt(0)!) || /\s/.test(ch)) ? g.s : " ";
    }
    c += g.cols;
    if (g.emoji) runAt = c;
  }
  flush();
  return out;
}

// ------------------------------------------------------------------ the card
const isImage = (u: string) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) || /imagedelivery\.net|i\.imgur\.com|\.sslip\.io\/img\//.test(u);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function draw(c: CardCast, look: CardLook): Promise<string> {
  const k = await kit();
  const [g0, g1, g2, g3] = palette(look.hex) as [string, string, string, string];
  const dots = k.has(0x2026) ? "…" : "...";
  const picUrl = c.embeds.find((u) => /^https?:\/\//.test(u) && isImage(u));
  const [pfp, pic] = await Promise.all([c.author.pfp ? fetchPicture(c.author.pfp, 2 * 1024 * 1024) : undefined, picUrl ? fetchPicture(picUrl) : undefined]);

  // The tile: like the cast page's open cast, with its border and hard shadow.
  const tx = 56, ty = 44, tw = W - 2 * tx - 8, th = 470, pad = 30;
  const inX = tx + pad, inW = tw - 2 * pad;
  let svg = "";

  // head: picture, name, then @username · via @app · /channel
  const pf = 80;
  const headY = ty + pad;
  svg += pfp
    ? `<image href="${dataUri(pfp)}" x="${inX}" y="${headY}" width="${pf}" height="${pf}" preserveAspectRatio="xMidYMid slice" filter="url(#grey)"/>`
    : `<rect x="${inX}" y="${headY}" width="${pf}" height="${pf}" fill="${g1}"/>`;
  svg += `<rect x="${inX}" y="${headY}" width="${pf}" height="${pf}" fill="none" stroke="${g3}" stroke-width="3"/>`;
  const nameX = inX + pf + 20, nameCols = Math.floor((inW - pf - 20) / (40 * ADV));
  const who = c.author.username ? `@${c.author.username}` : `fid ${c.fid}`;
  // A name VT323 can't draw any of (a lone symbol, say) shows as the @username.
  const drawable = (s: string) => graphemes(s).some((g) => g.emoji || [...g.s].some((ch) => !/\s/.test(ch) && k.has(ch.codePointAt(0)!)));
  const named = Boolean(c.author.display && drawable(c.author.display));
  let name = graphemes(named ? c.author.display! : who);
  if (width(name) > nameCols) name = cut(name, nameCols, dots);
  svg += await line(name, nameX, headY + 36, 40, g3, k);
  let sub = graphemes([named ? who : "", c.app ? `via @${c.app.name}` : "", c.channel ? `/${c.channel}` : ""].filter(Boolean).join(" · "));
  const subCols = Math.floor((inW - pf - 20) / (28 * ADV));
  if (width(sub) > subCols) sub = cut(sub, subCols, dots);
  svg += await line(sub, nameX, headY + 72, 28, g2, k);

  // meta: a dashed rule, the day and the counts
  const metaY = ty + th - pad - 4;
  svg += `<line x1="${inX}" x2="${inX + inW}" y1="${metaY - 34}" y2="${metaY - 34}" stroke="${g1}" stroke-width="3" stroke-dasharray="9 7"/>`;
  const meta = `${day(c.time)}   ${plural(c.replies, "reply", "replies")} · ${plural(c.recasts, "recast", "recasts")} · ${plural(c.likes, "like", "likes")}`;
  svg += await line(graphemes(meta), inX, metaY, 28, g2, k);

  // the text, beside the first image when there is one
  const bodyTop = headY + pf + 22, bodyBottom = metaY - 34 - 20;
  const text = c.text.trim();
  const picW = pic ? (text ? 360 : inW) : 0;
  const textW = inW - (pic ? picW + 28 : 0);
  if (pic) {
    const px = inX + inW - picW, ph = bodyBottom - bodyTop + 4;
    svg += `<clipPath id="pic"><rect x="${px}" y="${bodyTop}" width="${picW}" height="${ph}"/></clipPath>`;
    svg += `<rect x="${px}" y="${bodyTop}" width="${picW}" height="${ph}" fill="${g1}"/>`;
    svg += `<image href="${dataUri(pic)}" x="${px}" y="${bodyTop}" width="${picW}" height="${ph}" preserveAspectRatio="xMidYMid ${text ? "slice" : "meet"}" clip-path="url(#pic)"/>`;
    svg += `<rect x="${px}" y="${bodyTop}" width="${picW}" height="${ph}" fill="none" stroke="${g3}" stroke-width="3"/>`;
  }
  if (text) {
    let size = SIZES[SIZES.length - 1]!, lines: G[][] = [];
    for (const s of SIZES) {
      size = s;
      lines = wrap(text, Math.floor(textW / (s * ADV)));
      if (lines.length * s * LEADING <= bodyBottom - bodyTop) break;
    }
    const max = Math.max(1, Math.floor((bodyBottom - bodyTop) / (size * LEADING)));
    if (lines.length > max) {
      lines = lines.slice(0, max);
      lines[max - 1] = cut(lines[max - 1]!, Math.floor(textW / (size * ADV)), dots);
    }
    for (let i = 0; i < lines.length; i++) svg += await line(lines[i]!, inX, bodyTop + size * 0.82 + i * size * LEADING, size, g3, k);
  }

  // below the tile: this copy's keycap and name, and its address
  const cap = k.keycap(look.hex ? { hex: look.hex } : {});
  const footY = ty + th + 8 + 34;
  svg += `<image href="data:image/svg+xml;base64,${Buffer.from(cap).toString("base64")}" x="${tx - 4}" y="${footY - 26}" width="52" height="52"/>`;
  svg += `<text x="${tx + 58}" y="${footY + 10}" font-family="Silkscreen" font-size="28" fill="${g3}">${esc(look.name)}</text>`;
  const host = graphemes(look.host);
  svg += await line(host, W - tx - 8 - width(host) * 32 * ADV, footY + 10, 32, g2, k);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs><filter id="grey"><feColorMatrix type="saturate" values="0"/></filter></defs>
<rect width="${W}" height="${H}" fill="${g0}"/>
<rect x="7" y="7" width="${W - 14}" height="${H - 14}" fill="none" stroke="${g3}" stroke-width="14"/>
<rect x="${tx + 8}" y="${ty + 8}" width="${tw}" height="${th}" fill="${g3}"/>
<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" fill="${g0}" stroke="${g3}" stroke-width="4"/>
${svg}
</svg>`;
}

// PNGs, kept 10 minutes; at most two drawn at once.
const cache = new Map<string, { at: number; png: Promise<Uint8Array> }>();
let running = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

export function castCard(c: CardCast, look: CardLook): Promise<Uint8Array> {
  const key = `${c.fid}:${c.hash}:${look.name}:${look.host}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.png;
  const png = slot(async () => {
    const svg = await draw(c, look);
    const k = await kit();
    const r = new Resvg(svg, { font: { fontBuffers: [k.vt, k.px], defaultFontFamily: "VT323" }, fitTo: { mode: "original" } });
    return r.render().asPng();
  });
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), png });
  png.catch(() => cache.delete(key));
  return png;
}
