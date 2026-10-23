// The inbox: what's waiting for you since your last visit, in four views.
//
//   casts      casts from people you follow, the last 7 days
//   likes      likes on your casts, grouped by cast
//   replies    replies to your casts
//   followers  new followers
//
// "Cleared" and "saved" are yours alone: the browser keeps them (ui/mine.js),
// never this server, and they're never published (Farcaster has no read
// state or bookmarks). Everything here comes from your node. `since` is when
// your last visit ended, which the browser also keeps; items after it are
// marked fresh.

import { FARCASTER_EPOCH, get, pool, type Message, type Page } from "./node.ts";
import { following, type Profile } from "./read.ts";

const WEEK_MS = 7 * 86_400_000;
const unixMs = (fc: number) => (fc + FARCASTER_EPOCH) * 1000;

export type Kind = "casts" | "likes" | "replies" | "followers";

// ------------------------------------------------------------------ views

type Shape = (casts: Message[]) => Promise<{ hash: string; fid: number; time: string }[]>;
type ProfileOf = (fid: number) => Promise<Profile>;

// Casts from people you follow, the last 7 days. `feed` is the GUI's feed.
export async function castsView<C extends { hash: string; fid: number; time: string }>(fid: number, since: number, feed: { casts: C[] }) {
  const week = Date.now() - WEEK_MS;
  const casts = feed.casts
    .filter((c) => c.fid !== fid && Date.parse(c.time) > week)
    .map((c) => ({ ...c, fresh: Date.parse(c.time) > since }));
  return { since: new Date(since).toISOString(), casts };
}

// Your last 30 casts, which likes and replies are about.
async function myCasts(fid: number) {
  return (await get<Page>("/v1/castsByFid", { fid, pageSize: 30, reverse: true })).messages.filter((m) => m.data.castAddBody);
}

// Likes on your casts in the last 7 days, one group per cast. A like's id is
// "<cast hash>:<liker fid>", so a new like on a cleared cast shows up again.
export async function likesView(fid: number, since: number, profileOf: ProfileOf) {
  const week = Date.now() - WEEK_MS;
  const mine = await myCasts(fid);
  const groups = await pool(mine, 12, async (m) => {
    const page = await get<Page>("/v1/reactionsByCast", { target_fid: fid, target_hash: m.hash, reaction_type: "Like", pageSize: 1000 }).catch(() => ({ messages: [] as Message[] }));
    const likes = page.messages
      .filter((r) => r.data.fid !== fid && unixMs(r.data.timestamp) > week)
      .sort((a, b) => b.data.timestamp - a.data.timestamp)
      .map((r) => ({ id: `${m.hash}:${r.data.fid}`, fid: r.data.fid, time: new Date(unixMs(r.data.timestamp)).toISOString(), fresh: unixMs(r.data.timestamp) > since }));
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
export async function repliesView(fid: number, since: number, shape: Shape) {
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
    out.push({ cast: g.cast, replies: shaped.map((r) => ({ ...r, fresh: Date.parse(r.time) > since })) });
  }
  out.sort((a, b) => Date.parse(b.replies[0]!.time) - Date.parse(a.replies[0]!.time));
  return { since: new Date(since).toISOString(), groups: out };
}

// People who followed you in the last 7 days, and whether you follow them.
export async function followersView(fid: number, since: number, profileOf: ProfileOf) {
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
    })),
  };
}

// The home tile: every item in each view, as id and time. The browser takes
// out what it has cleared and counts the rest. Ids match what it clears:
// cast hash (casts, replies), "<cast hash>:<liker fid>" (likes), fid (followers).
// Casts also say which app they came through (its fid), for the apps filter.
export async function waiting(fid: number, since: number, feed: { following: number; casts: { hash: string; fid: number; time: string; app?: { fid: number } }[] }, shape: Shape, profileOf: ProfileOf) {
  const [c, l, r, f] = await Promise.all([castsView(fid, since, feed), likesView(fid, since, profileOf), repliesView(fid, since, shape), followersView(fid, since, profileOf)]);
  return {
    since: c.since,
    following: feed.following,
    casts: c.casts.map((x) => ({ id: x.hash, time: x.time, app: x.app?.fid })), // app: so the page can leave out apps you hid
    likes: l.groups.flatMap((g) => g.likes).map((x) => ({ id: x.id, time: x.time })),
    replies: r.groups.flatMap((g) => g.replies).map((x) => ({ id: x.hash, time: x.time })),
    followers: f.followers.map((x) => ({ id: String(x.fid), time: x.time })),
  };
}
