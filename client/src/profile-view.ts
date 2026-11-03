// The profile page, /profile/<username>: anyone's profile, read from your
// node, so fameboy links to its own page instead of farcaster.xyz.
//
// Counting followers means paging through every follow link to them, so the
// count stops at FOLLOW_PAGES pages and says "at least", and comes in its own
// request (followView) so the rest of the page doesn't wait for it. Everything here is
// public, so a signed-out visitor gets it too, minus what depends on who's
// looking (follows you, you follow, in common).

import { FARCASTER_EPOCH, get, pool, type Message, type Page } from "./node.ts";
import { following, type Profile } from "./read.ts";
import { appsFor } from "./filter.ts";

const FOLLOW_PAGES = 10; // 10,000 follow links each way
const CAST_PAGES = 3; // up to 3,000 casts for the last 30 days
const DAY_MS = 86_400_000;
const COMMON_SHOWN = 8;
const COMMON_CHECKS = 2_000; // follows of yours checked one by one, for big accounts

type ProfileOf = (fid: number) => Promise<Profile>;
const unixMs = (t: number) => (t + FARCASTER_EPOCH) * 1000;

// Up to FOLLOW_PAGES pages of follow links. more: there were others.
async function followLinks(path: string, params: Record<string, string | number>) {
  const out: Message[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < FOLLOW_PAGES; i++) {
    const page = await get<Page>(path, { ...params, link_type: "follow", pageSize: 1000, pageToken });
    out.push(...page.messages);
    pageToken = page.nextPageToken || undefined;
    if (!pageToken) return { links: out, more: false };
  }
  return { links: out, more: true };
}

const follows = (from: number, to: number) => get("/v1/linkById", { fid: from, target_fid: to, link_type: "follow" }).then(() => true, () => false);

// Their casts and replies from the last 30 days: when each was posted (the
// browser sorts them into its own local days) and which apps posted them.
async function recentCasts(fid: number) {
  const since = Date.now() - 30 * DAY_MS;
  const casts: Message[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < CAST_PAGES; i++) {
    const page = await get<Page>("/v1/castsByFid", { fid, pageSize: 1000, reverse: true, pageToken });
    const recent = page.messages.filter((m) => m.data.castAddBody && unixMs(m.data.timestamp) > since && unixMs(m.data.timestamp) <= Date.now() + 600_000);
    casts.push(...recent);
    pageToken = page.nextPageToken || undefined;
    if (!pageToken || recent.length < page.messages.filter((m) => m.data.castAddBody).length) break;
  }
  return casts;
}

// People you follow who follow them. Their whole follower list, when it's
// small enough to have loaded; otherwise each of your follows, checked.
async function inCommon(viewer: number, fid: number, followers: { links: Message[]; more: boolean }) {
  const mine = await following(viewer);
  if (!followers.more) {
    const theirs = new Set(followers.links.map((m) => m.data.fid));
    return mine.filter((f) => theirs.has(f) && f !== fid);
  }
  const checks = await pool(mine.slice(0, COMMON_CHECKS), 96, async (f) => (f !== fid && (await follows(f, fid)) ? f : undefined));
  return checks.filter((f): f is number => f !== undefined);
}

// Who they are, how they relate to you, and their last 30 days of casts.
// Quick: a few calls, so the page can show it at once.
export async function profileView(fid: number, viewer: number | undefined, profileOf: ProfileOf) {
  const [profile, casts] = await Promise.all([profileOf(fid), recentCasts(fid)]);
  const self = viewer === fid;
  const [followsYou, youFollow] = viewer === undefined || self ? [false, false] : await Promise.all([follows(fid, viewer), follows(viewer, fid)]);

  const apps = await appsFor(casts);
  const perApp = new Map<number | undefined, number>();
  for (const m of casts) perApp.set(apps.get(m.hash), (perApp.get(apps.get(m.hash)) ?? 0) + 1);
  const appRows = await Promise.all(
    [...perApp].map(async ([app, count]) => ({ fid: app ?? null, name: app === undefined ? null : ((await profileOf(app)).username ?? `!${app}`), count })),
  );

  return {
    profile,
    self,
    signedIn: viewer !== undefined,
    followsYou,
    youFollow,
    casts: casts.map((m) => unixMs(m.data.timestamp)), // ms, newest first
    apps: appRows.sort((a, b) => b.count - a.count),
  };
}

// Follower and following counts, and people you follow who follow them.
// Slow for big accounts (a page of follow links at a time), so the page asks
// for it separately and fills it in when it comes.
export async function followView(fid: number, viewer: number | undefined, profileOf: ProfileOf) {
  const [followers, followed] = await Promise.all([followLinks("/v1/linksByTargetFid", { target_fid: fid }), followLinks("/v1/linksByFid", { fid })]);
  const common = viewer === undefined || viewer === fid ? [] : await inCommon(viewer, fid, followers);
  return {
    followers: { count: followers.links.length, more: followers.more },
    following: { count: followed.links.length, more: followed.more },
    common: { count: common.length, people: await Promise.all(common.slice(0, COMMON_SHOWN).map(profileOf)) },
  };
}
