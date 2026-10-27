// The home view's data: your node, how busy the network is, what happened
// since you last looked, and who else is on this node right now.
//
// Node facts come from Snapchain's own API. Uptime and presence come from
// fc-companion (node/companion.mjs), a small service on the same server, on
// port 3390, because Snapchain doesn't track either.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import { KEY_DIR, type Author } from "./keys.ts";
import { FARCASTER_EPOCH, NODE, NodeError, PUBLIC_NODE, get, pool, type Message, type Page } from "./node.ts";
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
    url: PUBLIC_NODE,
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

// $FC_COMPANION, else the node's host on port 3390 when the node is on 3381,
// as a node set up by command 1 is. Any other node (a public one, such as
// https://haatz.quilibrium.com) has no companion: "" here, and companionUrl
// says so at once instead of waiting for a port that never answers.
export const COMPANION = (
  process.env.FC_COMPANION ??
  (() => {
    const u = new URL(NODE);
    if (u.port !== "3381") return "";
    u.port = "3390";
    return u.origin;
  })()
).replace(/\/$/, "");

class NoCompanion extends NodeError {}

// The companion's address for a call, or a NoCompanion error when this node has none.
export function companionUrl(path: string) {
  if (!COMPANION) {
    throw new NoCompanion(
      `the node at ${NODE} has no companion, which phone sign-in through the node, image uploads and who's online need. Set FC_COMPANION if it has one elsewhere.`,
    );
  }
  return COMPANION + path;
}

async function companion<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = companionUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(5_000) });
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

// A device: one browser, named by an id it makes and keeps itself (ui/mine.js).
// Its status, online or invisible, is kept there too. The server only adds a
// label saying what it runs on.
export type Device = { id: string; status: PresenceStatus };
const DEVICE_ID = /^[0-9a-f]{16,64}$/;
export function checkDevice(d: { id?: unknown; status?: unknown } | undefined): Device {
  if (!d || typeof d.id !== "string" || !DEVICE_ID.test(d.id)) throw new NodeError("device id must be 16-64 hex characters");
  if (d.status !== "online" && d.status !== "invisible") throw new NodeError("status must be online or invisible");
  return { id: d.id, status: d.status };
}
const os = ({ darwin: "mac", win32: "windows", linux: "linux" } as Record<string, string>)[platform()] ?? platform();
// What others on the node see next to your name. A hosted fameboy names
// itself instead of the server's OS (setDeviceLabel).
let label = `fameboy on ${os}`;
// At most 40 characters: the companion cuts labels there before checking the
// signature, so a longer one would never verify.
export const setDeviceLabel = (l: string) => void (label = l.slice(0, 40));

// Ed25519 over the exact bytes the companion checks (see node/companion.mjs).
export const signWith = (by: Author, payload: string) => by.sign(Buffer.from(payload));

async function heartbeat(key: Author, device: string, status: PresenceStatus | "offline") {
  const d = { id: device, label };
  const h = { fid: key.fid, device: d.id, label: d.label, status, ts: Date.now() };
  const sig = await signWith(key, `clearcast-presence:v1:${h.fid}:${h.device}:${h.label}:${h.status}:${h.ts}`);
  await companion("/v1/presence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...h, key: key.publicKey, sig }) });
  return d;
}

// Say "I'm here" without reading the list: uploads need a recent heartbeat.
export async function heartbeatNow(by: Author, device: Device) {
  try {
    await heartbeat(by, device.id, device.status);
  } catch {}
}

// Tell the companion this device is leaving (on sign out), so it drops off
// everyone's list now rather than in 90 s. Best effort.
export async function leaveNode(by: Author, device: string) {
  try {
    await heartbeat(by, device, "offline");
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
export async function presence(key: Author, device: Device): Promise<Presence> {
  const status = device.status;
  let me: { id: string; label: string };
  try {
    me = await heartbeat(key, device.id, status);
  } catch (e) {
    if (e instanceof NoCompanion) return { companion: false, url: COMPANION };
    throw e;
  }
  const ts = Date.now();
  const sig = await signWith(key, `clearcast-presence-read:v1:${key.fid}:${ts}`);
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
  // Not every event carries a block timestamp, so look past the first few at each end.
  const ends = await Promise.all([
    get<{ events: Ev[] }>("/v1/events", { from_event_id: 0, shard_index: shard, page_size: 1000 }),
    get<{ events: Ev[] }>("/v1/events", { shard_index: shard, page_size: 1000, reverse: true }),
  ]);
  const [a, b] = ends.map((r) => r.events.find((e) => e.blockConfirmedBody));
  if (!a?.blockConfirmedBody || !b?.blockConfirmedBody) throw new NodeError(`shard ${shard} has no event history`);
  return { firstBlock: a.blockNumber, firstMs: unixMs(a.blockConfirmedBody.timestamp), lastBlock: b.blockNumber, lastMs: unixMs(b.blockConfirmedBody.timestamp) };
}
type Span = Awaited<ReturnType<typeof shardSpan>>;

// A shard's span, sturdy against a node that's restarting or busy: ask up to
// three times, and keep the last good answer in ~/.fameboy/network-spans.json.
// If the node still can't say, use that saved span, with its newer end
// replaced by the node's current height (blocks keep a steady pace, so the
// estimate holds). undefined only when there has never been a good answer.
async function spanFor(shard: number, height: number): Promise<Span | undefined> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const span = await shardSpan(shard);
      const saved = await readJson<Record<string, Span>>("network-spans.json", {});
      saved[shard] = span;
      await writeJson("network-spans.json", saved);
      return span;
    } catch {
      await new Promise((r) => setTimeout(r, [2_000, 5_000, 0][attempt]));
    }
  }
  const saved = (await readJson<Record<string, Span>>("network-spans.json", {}))[shard];
  return saved ? { ...saved, lastBlock: height, lastMs: Date.now() } : undefined;
}
const blockAt = (s: Span, ms: number) => Math.round(s.firstBlock + ((ms - s.firstMs) * (s.lastBlock - s.firstBlock)) / (s.lastMs - s.firstMs));

// One hour's rate, from a ~4 minute sample in the middle of it. Past hours
// never change, so they're kept in ~/.fameboy/network-hours.json.
const SAMPLE_BLOCKS = 240;
const SAMPLE_START_MS = 25 * 60_000; // from the hour's start
const SAMPLE_END_MS = 30 * 60_000; // 240 blocks at about one a second, with room to spare
type HourCache = Record<string, number>; // "<shard>:<hour start, unix ms>" -> messages a minute
async function hourRate(shard: number, span: Span | undefined, hourStart: number, cache: HourCache): Promise<number | undefined> {
  const k = `${shard}:${hourStart}`;
  if (k in cache) return cache[k];
  if (!span) return undefined; // no history from the node: only what's cached
  const at = hourStart + SAMPLE_START_MS;
  if (at < span.firstMs || hourStart + SAMPLE_END_MS > span.lastMs) return undefined; // outside what the node keeps
  const w = await countBlocks(shard, blockAt(span, at), SAMPLE_BLOCKS);
  return (cache[k] = (w.messages / w.seconds) * 60);
}

export type Conditions = {
  state: "measuring" | "ready" | "failed";
  done: number;
  total: number;
  error?: string;
  retryAt?: string; // when a failed measurement is tried again
  samples: { at: string; perMinute: number }[]; // one per hour, oldest first; `at` is the middle of the sample
  historyDays: number; // how far back the node's events go
  updatedAt?: string;
};

// One sample per hour for the last 4 days, as far back as the node still has.
// Hours are whole UTC hours and each sample carries its time, so the browser
// can sort them into its own local hours (today, and the usual from earlier
// days): a hosted server's clock and timezone aren't the viewer's. Measuring
// takes a minute the first time, so it runs in the background and the page
// asks for progress.
let job: { started: number; result: Conditions } | undefined;
const RETRY_MS = 60_000;

export function conditions(node: NodeOverview): Conditions {
  // Fresh measurements every 10 minutes; after a failure, try again in one.
  const age = job ? Date.now() - job.started : 0;
  const stale = job && job.result.state !== "measuring" && age > (job.result.state === "failed" ? RETRY_MS : 10 * 60_000);
  if (!job || stale) {
    const result: Conditions = { state: "measuring", done: 0, total: 0, samples: [], historyDays: 0 };
    const started = Date.now();
    job = { started, result };
    measure(node, result).catch((e) => {
      result.state = "failed";
      result.error = e instanceof Error ? e.message : String(e);
      result.retryAt = new Date(started + RETRY_MS).toISOString();
    });
  }
  return job.result;
}

async function measure(node: NodeOverview, out: Conditions) {
  const shards = dataShards(node).map((s) => s.id);
  const spans = new Map(await Promise.all(dataShards(node).map(async (s) => [s.id, await spanFor(s.id, s.height)] as const)));
  const known = [...spans.values()].filter((x): x is Span => x !== undefined);
  const cache = await readJson<HourCache>("network-hours.json", {});
  // With no history from the node and nothing cached, there's nothing to compare against.
  if (!known.length && !Object.keys(cache).length) throw new NodeError("this node isn't sharing its event history yet");
  const oldest = known.length ? Math.max(...known.map((x) => x.firstMs)) : Date.now() - 3.5 * 86_400_000;
  out.historyDays = Math.round(((Date.now() - oldest) / 86_400_000) * 10) / 10;

  // Every whole UTC hour of the last 4 days (enough for today and 3 earlier
  // days in any timezone) whose sample is over and still on the node.
  const HOUR = 3_600_000;
  const now = Date.now();
  const hourStarts: number[] = [];
  for (let t = Math.floor(now / HOUR) * HOUR - 4 * 24 * HOUR; t + SAMPLE_END_MS <= now; t += HOUR) if (t + SAMPLE_START_MS > oldest) hourStarts.push(t);
  out.total = hourStarts.length;

  const rates = new Map<number, number>(); // hour start -> messages a minute, all shards
  const publish = () => {
    out.samples = [...rates]
      .sort(([a], [b]) => a - b)
      .map(([t, perMinute]) => ({ at: new Date(t + (SAMPLE_START_MS + SAMPLE_END_MS) / 2).toISOString(), perMinute: Math.round(perMinute * 10) / 10 }));
  };
  await pool(hourStarts, 6, async (t) => {
    const parts = await Promise.all(shards.map((id) => hourRate(id, spans.get(id), t, cache).catch(() => undefined)));
    if (parts.every((p) => p !== undefined)) rates.set(t, parts.reduce((a, b) => a + b!, 0));
    out.done++;
    publish();
  });
  // Keep a week of hours; older ones can never be asked for again.
  const weekAgo = Date.now() - 7 * 86_400_000;
  await writeJson("network-hours.json", Object.fromEntries(Object.entries(cache).filter(([k]) => Number(k.split(":")[1]) > weekAgo)));
  publish();
  out.state = "ready";
  out.updatedAt = new Date().toISOString();
}

// ------------------------------------------------------- since last time

// What happened since your last visit. The browser keeps when that was
// (ui/mine.js) and sends it as `since`.
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
export async function sinceLastVisit(fid: number, since: number, first: boolean, feed: { following: number; casts: { fid: number; time: string }[] }): Promise<Since> {
  const feedCasts = feed.casts;
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
