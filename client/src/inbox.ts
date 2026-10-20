// The inbox: what's waiting for you since your last visit, in four views.
//
//   casts      casts from people you follow, the last 7 days
//   likes      likes on your casts, grouped by cast
//   replies    replies to your casts
//   followers  new followers
//
// "Cleared" and "saved" are yours alone: they live in ~/.fc-client/inbox.json,
// next to your app key, and are never published (Farcaster has no read state
// or bookmarks). Everything else comes from your node.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KEY_DIR } from "./keys.ts";
import { FARCASTER_EPOCH, get, pool, type Message, type Page } from "./node.ts";
import { following, type Profile } from "./read.ts";
import { visitSince } from "./home.ts";

const FILE = join(KEY_DIR, "inbox.json");
const WEEK_MS = 7 * 86_400_000;
const unixMs = (fc: number) => (fc + FARCASTER_EPOCH) * 1000;

export type Kind = "casts" | "likes" | "replies" | "followers";

// A saved cast keeps a copy, so it stays readable after it leaves the 7 days.
export type SavedCast = { hash: string; fid: number; savedAt: string; cast: unknown };
type State = { cleared: Record<Kind, Record<string, number>>; saved: SavedCast[] }; // cleared id -> when (ms)
type Store = Record<string, State>; // per fid

const empty = (): State => ({ cleared: { casts: {}, likes: {}, replies: {}, followers: {} }, saved: [] });

async function load(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}
let queue: Promise<unknown> = Promise.resolve();
// One change at a time, written through a temp file so a crash can't leave half a file.
function change<T>(fid: number, fn: (s: State) => T): Promise<T> {
  const run = queue.then(async () => {
    const store = await load();
    const s = (store[fid] ??= empty());
    const out = fn(s);
    // Forget cleared ids older than two weeks: they've left every view by then.
    const old = Date.now() - 2 * WEEK_MS;
    for (const k of Object.keys(s.cleared) as Kind[]) for (const [id, at] of Object.entries(s.cleared[k])) if (at < old) delete s.cleared[k][id];
    await mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
    await writeFile(`${FILE}.tmp`, JSON.stringify(store), { mode: 0o600 });
    await rename(`${FILE}.tmp`, FILE);
    return out;
  });
  queue = run.catch(() => {});
  return run;
}
export async function stateFor(fid: number): Promise<State> {
  return (await load())[fid] ?? empty();
}

export function setCleared(fid: number, kind: Kind, ids: string[], on: boolean) {
  return change(fid, (s) => {
    for (const id of ids) on ? (s.cleared[kind][id] = Date.now()) : delete s.cleared[kind][id];
    return { kind, ids, on };
  });
}

export function setSaved(fid: number, cast: { hash: string; fid: number }, on: boolean) {
  return change(fid, (s) => {
    s.saved = s.saved.filter((x) => x.hash !== cast.hash);
    if (on) s.saved.unshift({ hash: cast.hash, fid: cast.fid, savedAt: new Date().toISOString(), cast });
    return { saved: on };
  });
}

// ------------------------------------------------------------------ views

type Shape = (casts: Message[]) => Promise<{ hash: string; fid: number; time: string }[]>;
type ProfileOf = (fid: number) => Promise<Profile>;

// Casts from people you follow, the last 7 days. `feed` is the GUI's feed.
export async function castsView(fid: number, feed: { casts: { hash: string; fid: number; time: string }[] }) {
  const since = await visitSince(fid);
  const s = await stateFor(fid);
  const week = Date.now() - WEEK_MS;
  const casts = feed.casts
    .filter((c) => c.fid !== fid && Date.parse(c.time) > week)
    .map((c) => ({ ...c, fresh: Date.parse(c.time) > since, cleared: c.hash in s.cleared.casts, saved: s.saved.some((x) => x.hash === c.hash) }));
  return { since: new Date(since).toISOString(), casts, saved: s.saved };
}

// Your last 30 casts, which likes and replies are about.
async function myCasts(fid: number) {
  return (await get<Page>("/v1/castsByFid", { fid, pageSize: 30, reverse: true })).messages.filter((m) => m.data.castAddBody);
}

// Likes on your casts in the last 7 days, one group per cast. A like's id is
// "<cast hash>:<liker fid>", so a new like on a cleared cast shows up again.
export async function likesView(fid: number, profileOf: ProfileOf) {
  const since = await visitSince(fid);
  const s = await stateFor(fid);
  const week = Date.now() - WEEK_MS;
  const mine = await myCasts(fid);
  const groups = await pool(mine, 12, async (m) => {
    const page = await get<Page>("/v1/reactionsByCast", { target_fid: fid, target_hash: m.hash, reaction_type: "Like", pageSize: 1000 }).catch(() => ({ messages: [] as Message[] }));
    const likes = page.messages
      .filter((r) => r.data.fid !== fid && unixMs(r.data.timestamp) > week)
      .sort((a, b) => b.data.timestamp - a.data.timestamp)
      .map((r) => ({ id: `${m.hash}:${r.data.fid}`, fid: r.data.fid, time: new Date(unixMs(r.data.timestamp)).toISOString(), fresh: unixMs(r.data.timestamp) > since, cleared: `${m.hash}:${r.data.fid}` in s.cleared.likes }));
    return { cast: { hash: m.hash, text: m.data.castAddBody!.text, time: new Date(unixMs(m.data.timestamp)).toISOString() }, likes };
  });
  const withLikes = groups.filter((g) => g.likes.length);
  const people = new Map((await Promise.all([...new Set(withLikes.flatMap((g) => g.likes.map((l) => l.fid)))].map(profileOf))).map((p) => [p.fid, p]));
  return {
    since: new Date(since).toISOString(),
    groups: withLikes
      .map((g) => ({ ...g, likes: g.likes.map((l) => ({ ...l, username: people.get(l.fid)?.username, pfp: people.get(l.fid)?.pfp })) }))
      .sort((a, b) => Date.parse(b.likes[0]!.time) - Date.parse(a.likes[0]!.time)),
  };
}

// Replies to your casts in the last 7 days, grouped under the cast they answer.
export async function repliesView(fid: number, shape: Shape) {
  const since = await visitSince(fid);
  const s = await stateFor(fid);
  const week = Date.now() - WEEK_MS;
  const mine = await myCasts(fid);
  const groups = await pool(mine, 12, async (m) => {
    const page = await get<Page>("/v1/castsByParent", { fid, hash: m.hash, pageSize: 1000 }).catch(() => ({ messages: [] as Message[] }));
    const replies = page.messages.filter((r) => r.data.fid !== fid && r.data.castAddBody && unixMs(r.data.timestamp) > week);
    return { cast: { hash: m.hash, text: m.data.castAddBody!.text, time: new Date(unixMs(m.data.timestamp)).toISOString() }, replies };
  });
  const out = [];
  for (const g of groups.filter((g) => g.replies.length)) {
    const shaped = await shape(g.replies.sort((a, b) => b.data.timestamp - a.data.timestamp));
    out.push({ cast: g.cast, replies: shaped.map((r) => ({ ...r, fresh: Date.parse(r.time) > since, cleared: r.hash in s.cleared.replies })) });
  }
  out.sort((a, b) => Date.parse(b.replies[0]!.time) - Date.parse(a.replies[0]!.time));
  return { since: new Date(since).toISOString(), groups: out };
}

// People who followed you in the last 7 days, and whether you follow them.
export async function followersView(fid: number, profileOf: ProfileOf) {
  const since = await visitSince(fid);
  const s = await stateFor(fid);
  const week = Date.now() - WEEK_MS;
  const links = (await get<Page>("/v1/linksByTargetFid", { target_fid: fid, link_type: "follow", pageSize: 100, reverse: true })).messages.filter(
    (m) => m.data.fid !== fid && unixMs(m.data.timestamp) > week,
  );
  const mine = new Set(await following(fid));
  const people = await Promise.all(links.map((m) => profileOf(m.data.fid)));
  return {
    since: new Date(since).toISOString(),
    followers: links.map((m, i) => ({
      ...people[i]!,
      fid: m.data.fid,
      time: new Date(unixMs(m.data.timestamp)).toISOString(),
      fresh: unixMs(m.data.timestamp) > since,
      following: mine.has(m.data.fid),
      cleared: String(m.data.fid) in s.cleared.followers,
    })),
  };
}

// The home tile: how much is waiting in each view, and how much is new.
export async function waiting(fid: number, feed: { following: number; casts: { hash: string; fid: number; time: string }[] }, shape: Shape, profileOf: ProfileOf) {
  const [c, l, r, f] = await Promise.all([castsView(fid, feed), likesView(fid, profileOf), repliesView(fid, shape), followersView(fid, profileOf)]);
  const likes = l.groups.flatMap((g) => g.likes).filter((x) => !x.cleared);
  const replies = r.groups.flatMap((g) => g.replies).filter((x) => !x.cleared);
  const casts = c.casts.filter((x) => !x.cleared);
  const followers = f.followers.filter((x) => !x.cleared);
  const count = <T extends { fresh: boolean }>(xs: T[]) => ({ waiting: xs.length, fresh: xs.filter((x) => x.fresh).length });
  return { since: c.since, following: feed.following, casts: count(casts), likes: count(likes), replies: count(replies), followers: count(followers) };
}
