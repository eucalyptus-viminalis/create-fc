// Link previews for the composer: read a page's Open Graph / Twitter card
// tags (title, description, image, site name), the way other Farcaster apps
// build their cards. The page is fetched from this computer, like a browser
// would; there's no preview service or API key in between.

import { NodeError } from "./node.ts";

export type Unfurl = {
  url: string; // what was asked for
  final: string; // after redirects
  site: string;
  title?: string;
  description?: string;
  image?: string;
  kind: "page" | "image";
};

// A desktop browser's identity, plus our name: some sites (YouTube) send
// unknown visitors to a mobile page with no preview tags.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 fameboy/0.1";
const MAX_BYTES = 768 * 1024; // the tags live in <head>; no need for the whole page
const cache = new Map<string, Promise<Unfurl>>();

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1]!.toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  ).replace(/\s+/g, " ").trim();

// Every <meta>'s property/name -> content, first one wins.
function metaTags(html: string) {
  const tags = new Map<string, string>();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = new Map<string, string>();
    for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) attrs.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? m[4] ?? "");
    const key = (attrs.get("property") ?? attrs.get("name") ?? "").toLowerCase();
    const content = attrs.get("content");
    if (key && content && !tags.has(key)) tags.set(key, decode(content));
  }
  return tags;
}

async function readHead(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size > MAX_BYTES || /<\/head>/i.test(new TextDecoder().decode(value))) break;
  }
  reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function fetchCard(raw: string): Promise<Unfurl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NodeError("that isn't a link");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new NodeError("only http and https links get a preview");
  let res: Response;
  try {
    res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8_000), headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5" } });
  } catch {
    throw new NodeError(`couldn't reach ${url.hostname}`);
  }
  const final = new URL(res.url || url.href);
  const site = final.hostname.replace(/^www\./, "");
  if (!res.ok) throw new NodeError(`${site} answered ${res.status}`);
  const type = res.headers.get("content-type") ?? "";
  if (type.startsWith("image/")) {
    res.body?.cancel().catch(() => {});
    return { url: raw, final: final.href, site, image: final.href, kind: "image" };
  }
  const html = await readHead(res);
  const t = metaTags(html);
  const abs = (u?: string) => {
    if (!u) return undefined;
    try {
      const a = new URL(u, final);
      return a.protocol === "https:" || a.protocol === "http:" ? a.href : undefined;
    } catch {
      return undefined;
    }
  };
  const titleTag = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1];
  return {
    url: raw,
    final: final.href,
    site: t.get("og:site_name") ?? site,
    title: t.get("og:title") ?? t.get("twitter:title") ?? (titleTag ? decode(titleTag) : undefined),
    description: t.get("og:description") ?? t.get("twitter:description") ?? t.get("description"),
    image: abs(t.get("og:image") ?? t.get("og:image:url") ?? t.get("og:image:secure_url") ?? t.get("twitter:image") ?? t.get("twitter:image:src")),
    kind: "page",
  };
}

// Kept for 30 minutes, so typing around a link doesn't fetch it again.
export function unfurl(url: string): Promise<Unfurl> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = fetchCard(url);
  cache.set(url, p);
  p.then(
    () => setTimeout(() => cache.delete(url), 30 * 60_000).unref(),
    () => cache.delete(url),
  );
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return p;
}
