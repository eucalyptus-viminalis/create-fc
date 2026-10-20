// The GUI: a small web server on 127.0.0.1 that serves the page in client/ui
// and a JSON API over your node. The browser never sees your app key; the
// server signs writes with it. Every API response lists the node calls it
// made, so the page can show exactly what happened.
//
// Writes are guarded two ways, so another website open in your browser can't
// post as you through this server: the request must come from this server's
// own origin, and carry a token that's only embedded in the page it served.

import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE, NodeError, get, pool, recordCalls, type CallRecord, type Message, type Page } from "./node.ts";
import { following, profile, resolveFid, type Profile } from "./read.ts";
import { appsFor, keysOfUser } from "./filter.ts";
import { forgetKey, loadKey, revokeKey } from "./keys.ts";
import { cast, follow, react } from "./write.ts";
import { changeCleared, clearedFor } from "./cleared.ts";
import { NoAppAccount, appSignInStatus, loadAppAccount, nodeSignInOptions, phraseSignInStatus, savedInvite, startAppSignIn, startNodeSignIn, startPhraseSignIn } from "./signin.ts";
import { companionStatus, conditions, leaveNode, live, nodeOverview, presence, sinceLastVisit, type PresenceStatus } from "./home.ts";
import { deleteImage, imageUsage, uploadImage } from "./images.ts";
import type { Hex } from "viem";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI_DIR = join(HERE, "..", "ui");
const TANGERINE_DIR = join(HERE, "..", "..", "site", "tangerine");
const THEME_CSS = join(HERE, "..", "..", "site", "fc-theme.css");
const FARCASTER_EPOCH = 1609459200;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

// ------------------------------------------------------------ data shaping

const profiles = new Map<number, Promise<Profile>>();
const profileOf = (fid: number) => {
  let p = profiles.get(fid);
  if (!p) {
    p = profile(fid).catch(() => ({ fid }));
    profiles.set(fid, p);
  }
  return p;
};

type CastView = {
  hash: string;
  fid: number;
  author: { username?: string; display?: string; pfp?: string };
  text: string;
  time: string;
  embeds: string[];
  replyTo?: { fid: number; hash: string };
  channel?: string;
  app?: { fid: number; name: string; pfp?: string };
};

async function shape(casts: Message[]): Promise<CastView[]> {
  const apps = await appsFor(casts);
  const authorFids = [...new Set([...casts.map((c) => c.data.fid), ...[...apps.values()].filter((a): a is number => a !== undefined)])];
  const people = new Map((await Promise.all(authorFids.map(profileOf))).map((p) => [p.fid, p]));
  return casts.map((m) => {
    const b = m.data.castAddBody!;
    const author = people.get(m.data.fid) ?? { fid: m.data.fid };
    const appFid = apps.get(m.hash);
    return {
      hash: m.hash,
      fid: m.data.fid,
      author: { username: author.username, display: author.display, pfp: author.pfp },
      text: b.text,
      time: new Date((m.data.timestamp + FARCASTER_EPOCH) * 1000).toISOString(),
      embeds: b.embeds.map((e) => ("url" in e ? e.url : `cast ${e.castId.hash.slice(0, 10)}`)),
      replyTo: b.parentCastId ?? undefined,
      channel: b.parentUrl?.split("/").pop() ?? undefined,
      app: appFid === undefined ? undefined : { fid: appFid, name: people.get(appFid)?.username ?? `!${appFid}`, pfp: people.get(appFid)?.pfp },
    };
  });
}

// A feed with each cast's app already attached, so the page can filter by app
// instantly, without asking again. One small request per followed account,
// up to 96 in flight: 1,043 accounts took ~5 s over the internet (65 s when
// sent in fixed batches with bigger pages). Kept for 2 minutes per account.
// The calls that built a feed are kept with it, so a cached answer can still
// show what it took.
type Feed = { following: number; casts: CastView[]; calls: CallRecord[]; builtAt: number };
const feedCache = new Map<number, Promise<Feed>>();
function feedFor(fid: number): Promise<Feed> {
  const hit = feedCache.get(fid);
  if (hit) return hit;
  const value = recordCalls(() => buildFeed(fid)).then(({ result, calls }) => ({ ...result, calls, builtAt: Date.now() }));
  feedCache.set(fid, value);
  value.then(
    () => setTimeout(() => feedCache.delete(fid), 120_000).unref(),
    () => feedCache.delete(fid),
  );
  return value;
}

async function buildFeed(fid: number) {
  const fids = await following(fid);
  const lists = await pool(fids, 96, (f) =>
    get<Page>("/v1/castsByFid", { fid: f, pageSize: 6, reverse: true })
      .then((p) => p.messages.filter((m) => m.data.castAddBody))
      .catch(() => [] as Message[]),
  );
  const horizon = Date.now() / 1000 - FARCASTER_EPOCH + 600; // skip casts dated in the future
  const casts = lists
    .flat()
    .filter((m) => m.data.timestamp <= horizon)
    .sort((a, b) => b.data.timestamp - a.data.timestamp)
    .slice(0, 400);
  return { following: fids.length, casts: await shape(casts) };
}

// ------------------------------------------------------------- mentions

// Your node can't search usernames by prefix, so suggestions come from the
// people you follow: their profiles load once, in the background, and the
// list fills in as they arrive. A full username finds anyone else.
type Following = { people: Profile[]; total: number; done: boolean };
const followingCache = new Map<number, Following>();
function followingProfiles(fid: number): Following {
  let c = followingCache.get(fid);
  if (c) return c;
  const made: Following = { people: [], total: 0, done: false };
  followingCache.set(fid, made);
  (async () => {
    const fids = await following(fid);
    made.total = fids.length;
    await pool(fids, 96, async (f) => {
      const p = await profileOf(f);
      if (p.username) made.people.push(p);
    });
  })().finally(() => {
    made.done = true;
    setTimeout(() => followingCache.delete(fid), 30 * 60_000).unref();
  });
  return made;
}

async function mentionSuggestions(me: number, raw: string) {
  const q = raw.toLowerCase().replace(/^@/, "").trim();
  const c = followingProfiles(me);
  const score = (p: Profile) => (p.username!.startsWith(q) ? 0 : 1) * 100 + p.username!.length;
  const people: (Profile & { relation: string })[] = c.people
    // the username's start, or the start of a word in the display name ("@lin", "@xie")
    .filter((p) => !q || p.username!.startsWith(q) || (p.display ?? "").toLowerCase().split(/\s+/).some((w) => w.startsWith(q)))
    .sort((a, b) => score(a) - score(b))
    .slice(0, 6)
    .map((p) => ({ ...p, relation: "you follow" }));
  if (q.length >= 2 && !people.some((p) => p.username === q)) {
    const fid = await resolveFid(q).catch(() => undefined);
    if (fid !== undefined && fid !== me) people.unshift({ ...(await profileOf(fid)), relation: "exact name" });
  }
  return { people: people.slice(0, 6), loading: !c.done, following: c.total };
}

const EMBED_URL = /^https:\/\/[^\s]{1,256}$/;

// ------------------------------------------------------------------ routes

type Handler = (q: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>;

// This server only ever listens on 127.0.0.1, so the person at the keyboard
// is the only one who can reach it, and typing a seed phrase into its page is
// as safe as typing it into a terminal. A shared (hosted) mode must set this
// to false.
const LOCAL_ONLY = true;

// Everything but status needs you signed in: the feed, keys and apps are always your own.
class SignedOut extends NodeError {}
const myFid = async () => {
  const key = await loadKey().catch(() => undefined);
  if (!key) throw new SignedOut("signed out: run clearcast login in a terminal");
  return key.fid;
};

const routes: Record<string, Handler> = {
  "GET /api/status": async () => {
    const info = await get<{ version: string; shardInfos: { shardId: number; maxHeight: number; blockDelay: number }[] }>("/v1/info");
    return { node: NODE, version: info.version, shards: info.shardInfos.sort((a, b) => a.shardId - b.shardId) };
  },
  // ---- the home view (see home.ts)
  // Your node, plus uptime and how many devices are online from fc-companion.
  "GET /api/home": async () => {
    const [node, companion] = await Promise.all([nodeOverview(), companionStatus()]);
    return { node, companion };
  },
  // Messages a minute right now, and per-block counts for the shard strips.
  "GET /api/live": async () => live(await nodeOverview()),
  // Today by the hour against a usual day. Measured in the background; poll for progress.
  "GET /api/conditions": async () => conditions(await nodeOverview()),
  // What happened since you last looked.
  "GET /api/since": async () => {
    const fid = await myFid();
    return sinceLastVisit(fid, await feedFor(fid));
  },
  // Who's on this node. Each call is also your heartbeat, so the page calls it every 30 s.
  "GET /api/presence": async () => {
    await myFid();
    return presence();
  },
  "POST /api/presence": async (_q, b) => {
    await myFid();
    if (b.status !== "online" && b.status !== "invisible") throw new NodeError("status must be online or invisible");
    return presence(b.status as PresenceStatus);
  },
  "GET /api/me": async () => {
    const key = await loadKey().catch(() => undefined);
    if (!key) return null;
    return { ...(await profileOf(key.fid)), scopes: key.scopes, publicKey: key.publicKey };
  },
  "GET /api/profile": async () => {
    const fid = await myFid();
    const [p, follows] = await Promise.all([profileOf(fid), following(fid)]);
    return { ...p, following: follows.length };
  },
  "GET /api/feed": async (q) => {
    const fid = await myFid();
    if (q.get("fresh")) feedCache.delete(fid);
    return feedFor(fid);
  },
  // What you've cleared from your feed. Stored on this computer only.
  "GET /api/cleared": async () => clearedFor(await myFid()),
  "POST /api/cleared": async (_q, b) => {
    const fid = await myFid();
    const iso = (t: unknown) => (typeof t === "string" && !Number.isNaN(Date.parse(t)) ? new Date(t).toISOString() : undefined);
    const add = Array.isArray(b.add)
      ? (b.add as { hash?: unknown; time?: unknown }[]).flatMap((a) => (typeof a.hash === "string" && /^0x[0-9a-f]{40}$/i.test(a.hash) && iso(a.time) ? [{ hash: a.hash, time: iso(a.time)! }] : []))
      : undefined;
    const remove = Array.isArray(b.remove) ? (b.remove as unknown[]).filter((h): h is string => typeof h === "string") : undefined;
    const before = b.before === null ? null : iso(b.before);
    return changeCleared(fid, { add, remove, before, counted: typeof b.counted === "number" ? b.counted : undefined });
  },
  "GET /api/keys": async () => {
    const keys = await keysOfUser(await myFid());
    const names = new Map(
      (await Promise.all([...new Set(keys.map((k) => k.appFid).filter((a): a is number => a !== undefined))].map(profileOf))).map((p) => [
        p.fid,
        p,
      ]),
    );
    return keys.map((k) => ({ ...k, app: k.appFid === undefined ? undefined : { fid: k.appFid, name: names.get(k.appFid)?.username, pfp: names.get(k.appFid)?.pfp } }));
  },
  // Signing in (see signin.ts). Which ways are available here?
  "GET /api/signin/options": async () => {
    const app = await loadAppAccount();
    const p = app ? await profileOf(app.fid) : undefined;
    // node: this node's companion can vouch for phone sign-ins (needs an invite code).
    const [node, invite] = await Promise.all([nodeSignInOptions(), savedInvite()]);
    const nodeApp = node?.phone && node.appFid ? await profileOf(node.appFid) : undefined;
    return {
      app: app ? { fid: app.fid, username: p?.username, display: p?.display, pfp: p?.pfp, sponsor: app.sponsor } : null,
      node: node ? { phone: node.phone, app: nodeApp ? { fid: nodeApp.fid, username: nodeApp.username } : null, invite: invite ?? null } : null,
      phrase: LOCAL_ONLY,
    };
  },
  // Phone sign-in: this computer's own app account if it has one, else the node's (with an invite code).
  "POST /api/signin/app": async (_q, b) => {
    if (await loadAppAccount()) return startAppSignIn();
    const invite = String(b.invite ?? "").trim();
    if (!invite) throw new NodeError("type the invite code from your node's owner");
    return startNodeSignIn(invite);
  },
  "GET /api/signin/app": async (q) => appSignInStatus(q.get("token") ?? ""),
  "POST /api/signin/phrase": async (_q, b) => {
    if (!LOCAL_ONLY) throw new NodeError("this clearcast is shared over the network, so it never accepts a seed phrase");
    return { job: startPhraseSignIn(String(b.phrase ?? "")) };
  },
  "GET /api/signin/phrase": async (q) => phraseSignInStatus(q.get("job") ?? ""),
  // Sign out: revoke the app key on Farcaster when it can revoke itself (keys
  // from a seed phrase sign-in can; keys approved in the Farcaster app can't),
  // then delete it from this computer either way.
  "POST /api/signout": async () => {
    const key = await loadKey().catch(() => undefined);
    let revoked: string = "no key";
    if (key) {
      feedCache.delete(key.fid);
      await leaveNode();
      revoked = await revokeKey(key, { log: () => {} }).then(
        (r) => r.state,
        (e) => `not revoked: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { removed: await forgetKey(), revoked };
  },
  "POST /api/cast": async (_q, b) => {
    const text = String(b.text ?? "").trim();
    const embeds = Array.isArray(b.embeds) ? (b.embeds as unknown[]).filter((u): u is string => typeof u === "string" && EMBED_URL.test(u)) : [];
    if (embeds.length > 2) throw new NodeError("a cast holds two attachments at most");
    if (!text && !embeds.length) throw new NodeError("nothing to post");
    const replyTo = b.replyTo as { fid: number; hash: Hex } | undefined;
    return cast(text, { replyTo, embeds });
  },
  // People to @mention: those you follow whose name starts with q, plus an exact username.
  "GET /api/mentions": async (q) => mentionSuggestions(await myFid(), q.get("q") ?? ""),
  // Image space on your node (images.ts). Uploads come in as raw bytes; see the server below.
  "GET /api/images/usage": async () => {
    await myFid();
    return imageUsage();
  },
  "POST /api/images/delete": async (_q, b) => {
    await myFid();
    return deleteImage(String(b.name ?? ""));
  },
  "POST /api/react": async (_q, b) =>
    react(b.kind === "recast" ? "recast" : "like", b.target as { fid: number; hash: Hex }, b.on !== false),
  // Follow by username or fid.
  "POST /api/follow": async (_q, b) => {
    await myFid();
    const fid = await resolveFid(String(b.user ?? "").trim().replace(/^@/, ""));
    const p = await profileOf(fid);
    return { ...(await follow(fid, b.on !== false)), user: { fid, username: p.username } };
  },
};

// ------------------------------------------------------------------ server

function send(res: ServerResponse, status: number, body: unknown, type = "application/json") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(type === "application/json" ? JSON.stringify(body) : (body as Buffer | string));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new NodeError("request too large");
  }
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

async function serveFile(res: ServerResponse, root: string, rel: string, token?: string) {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root)) return send(res, 404, "not found", "text/plain");
  try {
    let data: Buffer | string = await readFile(path);
    if (token && rel.endsWith(".html")) data = data.toString().replace("__CLEARCAST_TOKEN__", token);
    send(res, 200, data, TYPES[extname(path)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

// Start on `port`; if something else already uses it, try the next few
// unless the port was asked for explicitly.
export async function startUi(port: number, explicit = false): Promise<string> {
  for (let p = port; p < port + (explicit ? 1 : 20); p++) {
    try {
      return await listenOn(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      if (explicit) throw new NodeError(`port ${p} is already in use. Pick another: clearcast ui --port ${p + 1}`);
    }
  }
  throw new NodeError(`ports ${port}-${port + 19} are all in use. Pick one: clearcast ui --port <n>`);
}

async function listenOn(port: number): Promise<string> {
  const token = randomBytes(24).toString("hex");
  const origin = `http://127.0.0.1:${port}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/")) {
        // Only this page may call the API: same origin, and the page's token.
        const from = req.headers.origin;
        if ((from && from !== origin) || req.headers["x-clearcast-token"] !== token) return send(res, 403, { error: "forbidden" });
        // An image comes in as raw bytes, not JSON (up to 6 MB; the node caps files at 5).
        if (req.method === "POST" && path === "/api/images") {
          await myFid();
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > 6 * 1024 * 1024) throw new NodeError("images max out at 5 MB");
            chunks.push(c as Buffer);
          }
          const { result, calls } = await recordCalls(() => uploadImage(Buffer.concat(chunks)));
          return send(res, 200, { data: result, calls });
        }
        const handler = routes[`${req.method} ${path}`];
        if (!handler) return send(res, 404, { error: "no such endpoint" });
        const body = req.method === "POST" ? await readJson(req) : {};
        const { result, calls } = await recordCalls(() => handler(url.searchParams, body));
        return send(res, 200, { data: result, calls });
      }
      // The home view is the front page; the earlier all-in-one page lives on at /classic.
      if (path === "/" || path === "/home.html") return serveFile(res, UI_DIR, "home.html", token);
      if (path === "/classic" || path === "/index.html") return serveFile(res, UI_DIR, "index.html", token);
      if (path === "/signin" || path === "/signin.html") return serveFile(res, UI_DIR, "signin.html", token);
      if (path === "/post" || path === "/post.html") return serveFile(res, UI_DIR, "post.html", token);
      if (path === "/fc-theme.css") return serveFile(res, join(THEME_CSS, ".."), "fc-theme.css");
      if (path.startsWith("/tangerine/")) return serveFile(res, TANGERINE_DIR, path.slice("/tangerine/".length));
      return serveFile(res, UI_DIR, path.slice(1));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      send(res, e instanceof SignedOut ? 401 : e instanceof NoAppAccount ? 409 : e instanceof NodeError ? 400 : 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return origin;
}
