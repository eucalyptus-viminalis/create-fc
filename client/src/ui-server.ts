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
import { NODE, NodeError, get, recordCalls, type Message } from "./node.ts";
import { castsByFid, following, profile, resolveFid, type Profile } from "./read.ts";
import { appsFor, keysOfUser } from "./filter.ts";
import { loadKey } from "./keys.ts";
import { cast, follow, react } from "./write.ts";
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
// instantly, without asking again.
async function feedFor(fid: number) {
  const fids = await following(fid);
  const lists: Message[][] = [];
  for (let i = 0; i < fids.length; i += 48) {
    lists.push(...(await Promise.all(fids.slice(i, i + 48).map((f) => castsByFid(f, 8).catch(() => [] as Message[])))));
  }
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

const user = async (q: URLSearchParams) => {
  const who = q.get("user");
  if (!who) throw new NodeError("which account? pass ?user=");
  return resolveFid(who);
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
  "GET /api/profile": async (q) => {
    const fid = await user(q);
    const [p, follows] = await Promise.all([profileOf(fid), following(fid)]);
    return { ...p, following: follows.length };
  },
  "GET /api/feed": async (q) => feedFor(await user(q)),
  // Does the logged-in account follow this one?
  "GET /api/relationship": async (q) => {
    const key = await loadKey().catch(() => undefined);
    const target = await user(q);
    if (!key || key.fid === target) return { following: null };
    const following = await get("/v1/linkById", { fid: key.fid, target_fid: target, link_type: "follow" }).then(() => true, () => false);
    return { following };
  },
  "GET /api/casts": async (q) => shape(await castsByFid(await user(q), 30, { replies: true })),
  "GET /api/keys": async (q) => {
    const keys = await keysOfUser(await user(q));
    const names = new Map(
      (await Promise.all([...new Set(keys.map((k) => k.appFid).filter((a): a is number => a !== undefined))].map(profileOf))).map((p) => [
        p.fid,
        p,
      ]),
    );
    return keys.map((k) => ({ ...k, app: k.appFid === undefined ? undefined : { fid: k.appFid, name: names.get(k.appFid)?.username, pfp: names.get(k.appFid)?.pfp } }));
  },
  "POST /api/cast": async (_q, b) => {
    const text = String(b.text ?? "").trim();
    if (!text) throw new NodeError("nothing to post");
    const replyTo = b.replyTo as { fid: number; hash: Hex } | undefined;
    return cast(text, { replyTo });
  },
  "POST /api/react": async (_q, b) =>
    react(b.kind === "recast" ? "recast" : "like", b.target as { fid: number; hash: Hex }, b.on !== false),
  "POST /api/follow": async (_q, b) => follow(Number(b.fid), b.on !== false),
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
    if (token && rel === "index.html") data = data.toString().replace("__FCLI_TOKEN__", token);
    send(res, 200, data, TYPES[extname(path)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

export async function startUi(port: number): Promise<string> {
  const token = randomBytes(24).toString("hex");
  const origin = `http://127.0.0.1:${port}`;

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);
    const path = url.pathname;
    try {
      if (path.startsWith("/api/")) {
        // Only this page may call the API: same origin, and the page's token.
        const from = req.headers.origin;
        if ((from && from !== origin) || req.headers["x-fcli-token"] !== token) return send(res, 403, { error: "forbidden" });
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
      send(res, e instanceof NodeError ? 400 : 500, { error: message });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return origin;
}
