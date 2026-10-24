// One cast and the conversation around it, for the cast page (ui/cast.js):
// the casts it answers, back to where the conversation started, and the
// replies under it, two levels deep. It's all public, so anyone can open it,
// signed in or not.
//
// Addresses match farcaster.xyz: /<username>/<hash>, so swapping the domain
// on a farcaster.xyz link opens it here. Those links carry the hash's first
// 8 hex digits, but your node only looks a cast up by its full hash. A short
// one means paging back through the author's casts until one matches, which
// gets slow far back. fameboy's own links carry the full hash: one lookup.

import { get, NodeError, pool, type Message, type Page } from "./node.ts";

const FULL = /^0x[0-9a-f]{40}$/;
const SHORT = /^0x[0-9a-f]{8,39}$/;
const SCAN_PAGES = 5; // a short hash searches the author's last 5,000 casts
const MAX_UP = 30; // casts shown above, at most
const MAX_REPLIES = 50; // direct replies shown, each with up to MAX_KIDS of its own
const MAX_KIDS = 3;

export class CastNotFound extends NodeError {}

// "kenny", "@kenny", "vitalik.eth", "!2210" or "2210" -> 2210.
async function fidOf(who: string): Promise<number> {
  const s = who.replace(/^[@!]/, "").toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  try {
    return (await get<{ fid: number }>("/v1/userNameProofByName", { name: s })).fid;
  } catch (e) {
    if (e instanceof NodeError && /\b(400|404)\b/.test(e.message)) throw new CastNotFound(`no Farcaster user named "${s}"`);
    throw e;
  }
}

async function castById(fid: number, hash: string): Promise<Message> {
  const m = await get<Message>("/v1/castById", { fid, hash }).catch((e) => {
    if (e instanceof NodeError && /not found/i.test(e.message)) throw new CastNotFound("cast not found: it may have been deleted");
    throw e;
  });
  if (!m.data.castAddBody) throw new CastNotFound("cast not found: it may have been deleted");
  return m;
}

// Short hashes found once, so the next visit is one lookup. "fid:0xabc…" -> full hash.
const found = new Map<string, string>();

async function findCast(fid: number, raw: string): Promise<Message> {
  const hash = raw.toLowerCase();
  if (FULL.test(hash)) return castById(fid, hash);
  if (!SHORT.test(hash)) throw new CastNotFound(`"${raw}" isn't a cast hash`);
  const hit = found.get(`${fid}:${hash}`);
  if (hit) return castById(fid, hit);
  let pageToken: string | undefined;
  for (let i = 0; i < SCAN_PAGES; i++) {
    const page = await get<Page>("/v1/castsByFid", { fid, pageSize: 1000, reverse: true, pageToken });
    const m = page.messages.find((x) => x.data.castAddBody && x.hash.startsWith(hash));
    if (m) {
      if (found.size > 10_000) found.clear();
      found.set(`${fid}:${hash}`, m.hash);
      return m;
    }
    pageToken = page.nextPageToken || undefined;
    if (!pageToken) throw new CastNotFound(`no cast starting ${hash} from this account`);
  }
  throw new CastNotFound(`no cast starting ${hash} in this account's last ${SCAN_PAGES * 1000} casts. A link with the full hash finds older ones.`);
}

// Direct replies. The author's own come first (they often carry the thread
// on), then the rest, oldest first, as the conversation happened.
async function repliesTo(m: Message): Promise<Message[]> {
  const page = await get<Page>("/v1/castsByParent", { fid: m.data.fid, hash: m.hash, pageSize: 1000 });
  return page.messages
    .filter((r) => r.data.castAddBody)
    .sort((a, b) => Number(b.data.fid === m.data.fid) - Number(a.data.fid === m.data.fid) || a.data.timestamp - b.data.timestamp);
}

const reactors = (m: Message, type: "Like" | "Recast") =>
  get<Page>("/v1/reactionsByCast", { target_fid: m.data.fid, target_hash: m.hash, reaction_type: type, pageSize: 1000 }).then(
    (p) => p.messages.map((r) => r.data.fid),
    () => [] as number[],
  );

type Shaped = { hash: string };
type Built<C> = {
  ancestors: C[];
  earlier: boolean; // more casts above than we show
  gone: boolean; // a cast above was deleted, so the chain stops there
  cast: C;
  likers: number[];
  recasters: number[];
  replyCount: number;
  replies: (C & { replyCount: number; children: C[] })[];
};

async function build<C extends Shaped>(who: string, hash: string, shape: (m: Message[]) => Promise<C[]>): Promise<Built<C>> {
  const cast = await findCast(await fidOf(who), hash);

  // Up: one lookup per parent, since each names only the one above it.
  const up: Message[] = [];
  let parent = cast.data.castAddBody!.parentCastId;
  let gone = false;
  while (parent && up.length < MAX_UP) {
    const p = await castById(parent.fid, parent.hash).catch(() => undefined);
    if (!p) { gone = true; break; }
    up.unshift(p);
    parent = p.data.castAddBody!.parentCastId;
  }

  // Down: direct replies, then a few replies to each.
  const [replies, likers, recasters] = await Promise.all([repliesTo(cast), reactors(cast, "Like"), reactors(cast, "Recast")]);
  const top = replies.slice(0, MAX_REPLIES);
  const kids = await pool(top, 12, (r) => repliesTo(r).catch(() => [] as Message[]));

  const shown = [...up, cast, ...top, ...kids.flatMap((k) => k.slice(0, MAX_KIDS))];
  const byHash = new Map((await shape(shown)).map((c) => [c.hash, c]));
  const view = (m: Message) => byHash.get(m.hash)!;
  return {
    ancestors: up.map(view),
    earlier: Boolean(parent) && !gone,
    gone,
    cast: view(cast),
    likers,
    recasters,
    replyCount: replies.length,
    replies: top.map((r, i) => ({ ...view(r), replyCount: kids[i]!.length, children: kids[i]!.slice(0, MAX_KIDS).map(view) })),
  };
}

// A page can be opened by anyone, so keep each answer for 20 s: a burst of
// visitors costs the node one set of lookups. fresh skips it (after you reply).
const cache = new Map<string, { at: number; value: Promise<Built<Shaped>> }>();

export async function thread<C extends Shaped>(who: string, hash: string, viewer: number | undefined, shape: (m: Message[]) => Promise<C[]>, fresh = false) {
  const key = `${who.toLowerCase()}/${hash.toLowerCase()}`;
  let hit = cache.get(key);
  if (fresh || !hit || Date.now() - hit.at > 20_000) {
    hit = { at: Date.now(), value: build(who, hash, shape) };
    if (cache.size > 500) cache.clear();
    cache.set(key, hit);
    hit.value.catch(() => cache.delete(key));
  }
  const b = (await hit.value) as Built<C>;
  return {
    ancestors: b.ancestors,
    earlier: b.earlier,
    gone: b.gone,
    cast: { ...b.cast, likes: b.likers.length, recasts: b.recasters.length, replies: b.replyCount },
    // what the person looking has done, so the buttons start right
    mine: viewer === undefined ? null : { liked: b.likers.includes(viewer), recasted: b.recasters.includes(viewer) },
    replies: b.replies,
    more: b.replyCount - b.replies.length,
  };
}

// Just the cast, for its link preview: one lookup when the hash is full.
export async function lookupCast(who: string, hash: string): Promise<Message> {
  return findCast(await fidOf(who), hash);
}

// After a delete, so no page shows the cast from the cache.
export function forgetThreads() {
  cache.clear();
}
