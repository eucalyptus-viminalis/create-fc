// The home view's data: your node, how busy the network is, what happened
// since you last looked, and who else is on this node right now.
//
// Node facts come from Snapchain's own API. Uptime and presence come from
// fc-companion (node/companion.mjs), a small service on the same server, on
// port 3390, because Snapchain doesn't track either.

import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { KEY_DIR, loadKey, type AppKey } from "./keys.ts";
import { FARCASTER_EPOCH, NODE, NodeError, get, pool, type Message, type Page } from "./node.ts";
import { following, profile } from "./read.ts";

// ------------------------------------------------------------------ files

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(KEY_DIR, name), "utf8")) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(name: string, value: unknown) {
  await mkdir(KEY_DIR, { recursive: true });
  const tmp = join(KEY_DIR, `${name}.tmp`);
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, join(KEY_DIR, name));
}

const fcSeconds = (unixMs: number) => Math.floor(unixMs / 1000) - FARCASTER_EPOCH;
const unixMs = (fcTime: number) => (fcTime + FARCASTER_EPOCH) * 1000;

// ------------------------------------------------------------------ node

type Info = {
  version: string;
  peer_id: string;
  dbStats: { numMessages: number; numFidRegistrations: number; approxSize: number };
  shardInfos: { shardId: number; maxHeight: number; blockDelay: number }[];
};

export type NodeOverview = {
  url: string;
  version: string;
  peerId: string;
  latencyMs: number;
  inSync: boolean;
  behindSeconds: number;
  shards: { id: number; height: number; behind: number }[];
  totals: { messages: number; accounts: number; bytes: number };
};

export async function nodeOverview(): Promise<NodeOverview> {
  const t = Date.now();
  const info = await get<Info>("/v1/info");
  const latencyMs = Date.now() - t;
  const shards = info.shardInfos.map((s) => ({ id: s.shardId, height: s.maxHeight, behind: s.blockDelay })).sort((a, b) => a.id - b.id);
  const behindSeconds = Math.max(...shards.map((s) => s.behind));
  return {
    url: NODE,
    version: info.version,
    peerId: info.peer_id,
    latencyMs,
    inSync: behindSeconds < 10, // same line fc-node status draws
    behindSeconds,
    shards,
    totals: { messages: info.dbStats.numMessages, accounts: info.dbStats.numFidRegistrations, bytes: info.dbStats.approxSize },
  };
}

// ------------------------------------------------------------- companion

// $FC_COMPANION, else the node's host on port 3390.
export const COMPANION = (
  process.env.FC_COMPANION ??
  (() => {
    const u = new URL(NODE);
    u.port = "3390";
    return u.origin;
  })()
).replace(/\/$/, "");

class NoCompanion extends NodeError {}

async function companion<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(COMPANION + path, { ...init, signal: AbortSignal.timeout(5_000) });
  } catch {
    throw new NoCompanion(`no companion at ${COMPANION}`);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new NodeError(`companion: ${body.error ?? res.status}`);
  return body;
}

export type CompanionStatus = { snapchainStartedAt: string | null; devicesOnline: number; peopleOnline: number } | null;

export async function companionStatus(): Promise<CompanionStatus> {
  try {
    return await companion("/v1/companion");
  } catch {
    return null; // not installed yet, or the port is closed
  }
}

// ------------------------------------------------------------- presence

export type PresenceStatus = "online" | "invisible";

// This computer's id on the node: random, made once, kept with your key.
async function device(): Promise<{ id: string; label: string }> {
  const saved = await readJson<{ id?: string }>("device.json", {});
  const id = saved.id ?? randomBytes(12).toString("hex");
  if (!saved.id) await writeJson("device.json", { id });
  const os = ({ darwin: "mac", win32: "windows", linux: "linux" } as Record<string, string>)[platform()] ?? platform();
  return { id, label: `clearcast on ${os}` };
}

export const presenceStatus = async () => (await readJson<{ status?: PresenceStatus }>("presence.json", {})).status ?? "online";

// Ed25519 over the exact bytes the companion checks (see node/companion.mjs).
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
export function signWith(key: AppKey, payload: string): string {
  const pk = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(key.privateKey.replace(/^0x/, ""), "hex")]), format: "der", type: "pkcs8" });
  return "0x" + sign(null, Buffer.from(payload), pk).toString("hex");
}

async function heartbeat(key: AppKey, status: PresenceStatus | "offline") {
  const d = await device();
  const h = { fid: key.fid, device: d.id, label: d.label, status, ts: Date.now() };
  const sig = signWith(key, `clearcast-presence:v1:${h.fid}:${h.device}:${h.label}:${h.status}:${h.ts}`);
  await companion("/v1/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...h, key: key.publicKey, sig }) });
  return d;
}

// Say "I'm here" without reading the list: uploads need a recent heartbeat.
export async function heartbeatNow() {
  try {
    await heartbeat(await loadKey(), await presenceStatus());
  } catch {}
}

// Tell the companion this device is leaving (on sign out), so it drops off
// everyone's list now rather than in 90 s. Best effort.
export async function leaveNode() {
  try {
    await heartbeat(await loadKey(), "offline");
  } catch {}
}

type Online = { fid: number; devices: { id: string; label: string; status: string; seen: string }[]; lastSeen: string };

export type Presence =
  | { companion: false; url: string }
  | {
      companion: true;
      status: PresenceStatus;
      people: {
        fid: number;
        you: boolean;
        username?: string;
        pfp?: string;
        relation: "you" | "mutual" | "follows you" | "you follow" | "on this node";
        devices: { label: string; thisDevice: boolean }[];
        lastSeen: string;
      }[];
    };

// Say we're here (or invisible), then read who's online, closest first.
export async function presence(setTo?: PresenceStatus): Promise<Presence> {
  const key = await loadKey();
  if (setTo) await writeJson("presence.json", { status: setTo });
  const status = setTo ?? (await presenceStatus());
  let me: { id: string; label: string };
  try {
    me = await heartbeat(key, status);
  } catch (e) {
    if (e instanceof NoCompanion) return { companion: false, url: COMPANION };
    throw e;
  }
  const ts = Date.now();
  const sig = signWith(key, `clearcast-presence-read:v1:${key.fid}:${ts}`);
  const { online } = await companion<{ online: Online[] }>(`/v1/presence?fid=${key.fid}&ts=${ts}&key=${key.publicKey}&sig=${sig}`);

  const mine = new Set(await following(key.fid));
  const people = await pool(online, 8, async (p) => {
    const you = p.fid === key.fid;
    const [prof, followsYou] = await Promise.all([
      profile(p.fid).catch(() => ({ fid: p.fid }) as { fid: number; username?: string; pfp?: string }),
      you ? false : get("/v1/linkById", { fid: p.fid, target_fid: key.fid, link_type: "follow" }).then(() => true, () => false),
    ]);
    const relation = you ? "you" : mine.has(p.fid) && followsYou ? "mutual" : followsYou ? "follows you" : mine.has(p.fid) ? "you follow" : "on this node";
    return {
      fid: p.fid,
      you,
      username: prof.username,
      pfp: prof.pfp,
      relation,
      devices: p.devices.map((d) => ({ label: d.label, thisDevice: you && d.id === me.id })),
      lastSeen: p.lastSeen,
    } as const;
  });
  // You're always listed, even while invisible (the companion hides you from everyone else).
  if (!people.some((p) => p.you)) {
    const prof = await profile(key.fid).catch(() => ({ fid: key.fid }) as { username?: string; pfp?: string });
    people.push({ fid: key.fid, you: true, username: prof.username, pfp: prof.pfp, relation: "you", devices: [{ label: me.label, thisDevice: true }], lastSeen: new Date().toISOString() });
  }
  const rank = { you: 0, mutual: 1, "follows you": 2, "you follow": 3, "on this node": 4 };
  people.sort((a, b) => rank[a.relation] - rank[b.relation] || b.lastSeen.localeCompare(a.lastSeen));
  return { companion: true, status, people };
}

// ------------------------------------------------------------- the network

// Snapchain event ids are blockNumber * 16384 + the event's place in the
// block, and each block starts with a BLOCK_CONFIRMED event carrying its
// timestamp. So any block's events can be read starting from its id.
const PER_BLOCK = 16384;
type Ev = { id: number; type: string; blockNumber: number; blockConfirmedBody?: { timestamp: number } };

// New messages in blocks [from, from + n) of one shard: the total, a count
// per block, and how many seconds those blocks spanned.
async function countBlocks(shard: number, from: number, n: number) {
  const perBlock = new Array<number>(n).fill(0);
  let first: number | undefined, last: number | undefined;
  let cursor = from * PER_BLOCK;
  for (let pages = 0; pages < 20; pages++) {
    const { events } = await get<{ events: Ev[] }>("/v1/events", { from_event_id: cursor, shard_index: shard, page_size: 1000 }, 30_000);
    let done = events.length < 1000;
    for (const e of events) {
      if (e.blockNumber >= from + n) {
        done = true;
        break;
      }
      if (e.blockConfirmedBody) {
        first ??= e.blockConfirmedBody.timestamp;
        last = e.blockConfirmedBody.timestamp;
      }
      if (e.type === "HUB_EVENT_TYPE_MERGE_MESSAGE") perBlock[e.blockNumber - from]++;
    }
    if (done || !events.length) break;
    cursor = events[events.length - 1].id + 1;
  }
  const seconds = first !== undefined && last !== undefined ? Math.max(1, last - first + 1) : n;
  return { messages: perBlock.reduce((a, b) => a + b, 0), perBlock, seconds };
}

const dataShards = (node: NodeOverview) => node.shards.filter((s) => s.id > 0); // shard 0 orders the others; messages live in 1..n

// Right now: messages a minute over the last ~3 minutes, and per-block counts
// for the shard strips.
export async function live(node: NodeOverview) {
  const span = 180;
  const shards = await Promise.all(
    dataShards(node).map(async (s) => {
      const w = await countBlocks(s.id, s.height - span, span);
      return { id: s.id, perMinute: (w.messages / w.seconds) * 60, recent: w.perBlock.slice(-60) };
    }),
  );
  return { perMinute: Math.round(shards.reduce((a, s) => a + s.perMinute, 0)), shards: shards.map(({ id, recent }) => ({ id, recent })) };
}

// --- by the hour

// Where a shard's history starts and ends, to turn a time into a block number.
async function shardSpan(shard: number) {
  const ends = await Promise.all([
    get<{ events: Ev[] }>("/v1/events", { from_event_id: 0, shard_index: shard, page_size: 1 }),
    get<{ events: Ev[] }>("/v1/events", { shard_index: shard, page_size: 1, reverse: true }),
  ]);
  const [a, b] = ends.map((r) => r.events[0]);
  if (!a?.blockConfirmedBody || !b?.blockConfirmedBody) throw new NodeError(`shard ${shard} has no event history`);
  return { firstBlock: a.blockNumber, firstMs: unixMs(a.blockConfirmedBody.timestamp), lastBlock: b.blockNumber, lastMs: unixMs(b.blockConfirmedBody.timestamp) };
}
type Span = Awaited<ReturnType<typeof shardSpan>>;
const blockAt = (s: Span, ms: number) => Math.round(s.firstBlock + ((ms - s.firstMs) * (s.lastBlock - s.firstBlock)) / (s.lastMs - s.firstMs));

// One hour's rate, from a ~4 minute sample in the middle of it. Past hours
// never change, so they're kept in ~/.fc-client/network-hours.json.
const SAMPLE_BLOCKS = 240;
type HourCache = Record<string, number>; // "<shard>:<hour start, unix ms>" -> messages a minute
async function hourRate(shard: number, span: Span, hourStart: number, cache: HourCache): Promise<number | undefined> {
  const k = `${shard}:${hourStart}`;
  if (k in cache) return cache[k];
  const at = hourStart + 25 * 60_000;
  if (at < span.firstMs || at + 5 * 60_000 > span.lastMs) return undefined; // outside what the node keeps
  const w = await countBlocks(shard, blockAt(span, at), SAMPLE_BLOCKS);
  return (cache[k] = (w.messages / w.seconds) * 60);
}

export type Conditions = {
  state: "measuring" | "ready" | "failed";
  done: number;
  total: number;
  error?: string;
  hours: { hour: number; today?: number; usual?: number }[]; // messages a minute, local hours 0-23
  historyDays: number; // how far back the node's events go
  updatedAt?: string;
};

// The 24 hours of today (local time), each with today's rate (hours already
// over) and the usual rate: the same hour on each earlier day the node still
// has, up to 3. Measuring takes a minute the first time, so it runs in the
// background and the page asks for progress.
let job: { started: number; result: Conditions } | undefined;

export function conditions(node: NodeOverview): Conditions {
  const stale = job && job.result.state !== "measuring" && Date.now() - job.started > 10 * 60_000;
  if (!job || stale) {
    const result: Conditions = { state: "measuring", done: 0, total: 0, hours: [], historyDays: 0 };
    job = { started: Date.now(), result };
    measure(node, result).catch((e) => {
      result.state = "failed";
      result.error = e instanceof Error ? e.message : String(e);
    });
  }
  return job.result;
}

async function measure(node: NodeOverview, out: Conditions) {
  const shards = dataShards(node).map((s) => s.id);
  const spans = new Map(await Promise.all(shards.map(async (id) => [id, await shardSpan(id)] as const)));
  const oldest = Math.max(...[...spans.values()].map((s) => s.firstMs));
  out.historyDays = Math.round(((Date.now() - oldest) / 86_400_000) * 10) / 10;

  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const nowHour = new Date().getHours();
  const cache = await readJson<HourCache>("network-hours.json", {});
  const hourStart = (daysAgo: number, h: number) => {
    const d = new Date(midnight);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h);
    return d.getTime();
  };

  // Every (day, hour) worth measuring: today's finished hours, and all 24 hours of up to 3 earlier days.
  const jobs: { daysAgo: number; hour: number }[] = [];
  for (let h = 0; h < nowHour; h++) jobs.push({ daysAgo: 0, hour: h });
  for (let d = 1; d <= 3; d++) for (let h = 0; h < 24; h++) if (hourStart(d, h) + 30 * 60_000 > oldest) jobs.push({ daysAgo: d, hour: h });
  out.total = jobs.length;

  const rates = new Map<string, number>(); // "<daysAgo>:<hour>" -> messages a minute, all shards
  await pool(jobs, 6, async (j) => {
    const parts = await Promise.all(shards.map((id) => hourRate(id, spans.get(id)!, hourStart(j.daysAgo, j.hour), cache)));
    if (parts.every((p) => p !== undefined)) rates.set(`${j.daysAgo}:${j.hour}`, parts.reduce((a, b) => a + b!, 0));
    out.done++;
    out.hours = summarize(rates);
  });
  // Keep a week of hours; older ones can never be asked for again.
  const weekAgo = Date.now() - 7 * 86_400_000;
  await writeJson("network-hours.json", Object.fromEntries(Object.entries(cache).filter(([k]) => Number(k.split(":")[1]) > weekAgo)));
  out.hours = summarize(rates);
  out.state = "ready";
  out.updatedAt = new Date().toISOString();
}

function summarize(rates: Map<string, number>) {
  return Array.from({ length: 24 }, (_, hour) => {
    const past = [1, 2, 3].map((d) => rates.get(`${d}:${hour}`)).filter((r): r is number => r !== undefined);
    const today = rates.get(`0:${hour}`);
    return {
      hour,
      today: today === undefined ? undefined : Math.round(today),
      usual: past.length ? Math.round(past.reduce((a, b) => a + b, 0) / past.length) : undefined,
    };
  });
}

// ------------------------------------------------------- since last time

// When you last looked. A visit lasts until you've been away 30 minutes, so
// refreshing the page doesn't reset what counts as new.
// When your previous visit ended, without counting this look as a visit.
export async function visitSince(fid: number): Promise<number> {
  const r = (await readJson<Record<string, { prev: number }>>("checkins.json", {}))[fid];
  return r?.prev ?? Date.now() - 86_400_000;
}

export async function lastVisit(fid: number): Promise<{ since: number; first: boolean }> {
  const all = await readJson<Record<string, { prev: number; lastActive: number }>>("checkins.json", {});
  const now = Date.now();
  let r = all[fid];
  const first = !r;
  if (!r) r = { prev: now - 86_400_000, lastActive: now };
  else if (now - r.lastActive > 30 * 60_000) r = { prev: r.lastActive, lastActive: now };
  else r.lastActive = now;
  all[fid] = r;
  await writeJson("checkins.json", all);
  return { since: r.prev, first };
}

export type Since = {
  since: string;
  first: boolean; // no earlier visit on record: "since" is a day ago
  following: number; // how many accounts you follow
  casts: number; // from people you follow
  likes: number;
  replies: number;
  followers: { count: number; names: string[] };
};

// `feed` is the one the GUI already builds (people you follow, newest first).
export async function sinceLastVisit(fid: number, feed: { following: number; casts: { fid: number; time: string }[] }): Promise<Since> {
  const feedCasts = feed.casts;
  const { since, first } = await lastVisit(fid);
  const after = fcSeconds(since);

  const casts = feedCasts.filter((c) => c.fid !== fid && Date.parse(c.time) > since).length;

  // Likes and replies on your last 30 casts.
  const mine = (await get<Page>("/v1/castsByFid", { fid, pageSize: 30, reverse: true })).messages.filter((m) => m.data.castAddBody);
  const newer = (msgs: Message[]) => msgs.filter((m) => m.data.fid !== fid && m.data.timestamp > after).length;
  const counts = await pool(mine, 12, async (m) => {
    const [likes, replies] = await Promise.all([
      get<Page>("/v1/reactionsByCast", { target_fid: fid, target_hash: m.hash, reaction_type: "Like", pageSize: 1000 }).then((p) => newer(p.messages), () => 0),
      get<Page>("/v1/castsByParent", { fid, hash: m.hash, pageSize: 1000 }).then((p) => newer(p.messages), () => 0),
    ]);
    return { likes, replies };
  });

  const follows = (await get<Page>("/v1/linksByTargetFid", { target_fid: fid, link_type: "follow", pageSize: 100, reverse: true })).messages.filter(
    (m) => m.data.timestamp > after && m.data.fid !== fid,
  );
  const names = await Promise.all(follows.slice(0, 3).map((m) => profile(m.data.fid).then((p) => p.username ?? `!${p.fid}`, () => `!${m.data.fid}`)));

  return {
    since: new Date(since).toISOString(),
    first,
    following: feed.following,
    casts,
    likes: counts.reduce((a, c) => a + c.likes, 0),
    replies: counts.reduce((a, c) => a + c.replies, 0),
    followers: { count: follows.length, names },
  };
}
