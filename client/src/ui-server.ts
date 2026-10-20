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
import { forgetKey, loadKey } from "./keys.ts";
import { cast, follow, react } from "./write.ts";
import { changeCleared, clearedFor } from "./cleared.ts";
import { NoAppAccount, appSignInStatus, loadAppAccount, phraseSignInStatus, startAppSignIn, startPhraseSignIn } from "./signin.ts";
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
    return { app: app ? { fid: app.fid, username: p?.username, display: p?.display, pfp: p?.pfp, sponsor: app.sponsor } : null, phrase: LOCAL_ONLY };
  },
  "POST /api/signin/app": async () => startAppSignIn(),
  "GET /api/signin/app": async (q) => appSignInStatus(q.get("token") ?? ""),
  "POST /api/signin/phrase": async (_q, b) => {
    if (!LOCAL_ONLY) throw new NodeError("this clearcast is shared over the network, so it never accepts a seed phrase");
    return { job: startPhraseSignIn(String(b.phrase ?? "")) };
  },
  "GET /api/signin/phrase": async (q) => phraseSignInStatus(q.get("job") ?? ""),
  // Sign out: delete the app key from this computer.
  "POST /api/signout": async () => {
    const fid = await myFid().catch(() => undefined);
    if (fid !== undefined) feedCache.delete(fid);
    return { removed: await forgetKey() };
  },
  "POST /api/cast": async (_q, b) => {
    const text = String(b.text ?? "").trim();
    if (!text) throw new NodeError("nothing to post");
    const replyTo = b.replyTo as { fid: number; hash: Hex } | undefined;
    return cast(text, { replyTo });
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
    if (token && rel === "index.html") data = data.toString().replace("__CLEARCAST_TOKEN__", token);
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
        const handler = routes[`${req.method} ${path}`];
        if (!handler) return send(res, 404, { error: "no such endpoint" });
        const body = req.method === "POST" ? await readJson(req) : {};
        const { result, calls } = await recordCalls(() => handler(url.searchParams, body));
        return send(res, 200, { data: result, calls });
      }
      if (path === "/" || path === "/index.html") return serveFile(res, UI_DIR, "index.html", token);
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
