// The GUI: a small web server on 127.0.0.1 that serves the page in client/ui
// and a JSON API over your node. The browser never sees your app key; the
// server signs writes with it. Every API response lists the node calls it
// made, so the page can show exactly what happened.
//
// Writes are guarded two ways, so another website open in your browser can't
// post as you through this server: the request must come from this server's
// own origin, and carry a token that's only embedded in the page it served.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeError, PUBLIC_NODE, get, pool, recordCalls, type CallRecord, type Message, type Page } from "./node.ts";
import { following, profile, resolveFid, type Profile } from "./read.ts";
import { appsFor, keysOfUser } from "./filter.ts";
import { fileAuthor, forgetKey, hostedMode, loadKey, localAuthor, revokeKey, type Author } from "./keys.ts";
import { Conversation, answer, browserAuthor } from "./remote-sign.ts";
import { challenge, clearCookie, readSession, sessionCookie, signerActive, startSession, type Session } from "./session.ts";
import { cast, follow, react } from "./write.ts";
import { legacyState } from "./legacy.ts";
import { NoAppAccount, appSignInStatus, browserSignInStatus, loadAppAccount, nodeSignInOptions, phraseSignInStatus, savedInvite, startAppSignIn, startBrowserSignIn, startNodeSignIn, startPhraseSignIn } from "./signin.ts";
import { checkDevice, companionStatus, conditions, leaveNode, live, nodeOverview, presence, setDeviceLabel, sinceLastVisit } from "./home.ts";
import { deleteImage, imageUsage, uploadImage } from "./images.ts";
import { unfurl } from "./unfurl.ts";
import { castsView, followersView, likesView, repliesView, waiting } from "./inbox.ts";
import { CastNotFound, thread } from "./thread.ts";
import type { Hex } from "viem";
import { colorOf } from "../../node/fameboy-name.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const UI_DIR = join(HERE, "..", "ui");
const FARCASTER_EPOCH = 1609459200;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Link previews (Farcaster, X, iMessage) don't run the page's scripts, so every
// page carries the same card: ui/og.png, drawn from assets/fameboy-og.html
// (make fameboy-og). A host can have its own card, ui/og-<host>.png, like
// demo.createfc.org's with a QR code for its address. Previews need absolute
// links, hence this server's origin.
let OG_IMAGE = "og.png";
let OG_ALT = "fameboy: a clear keycap beside the words It's playtime, built with create-fc.";
const OG_DESCRIPTION = "A Farcaster client that reads from its own node. Sign in with your phone. Built with create-fc.";
// The link forge has its own card, ui/og-forge.png, drawn from assets/forge-og.html.
const FORGE_OG = {
  title: "link forge · fameboy",
  description: "Farcaster link in, fameboy link out. Paste a cast link from farcaster.xyz and get the same cast on fameboy.",
  image: "og-forge.png",
  alt: "link forge: a hammer striking a link on an anvil, beside a farcaster.xyz cast link turned into a demo.createfc.org one.",
};
function ogTags(path: string) {
  const forge = path === "/forge" || path === "/forge.html";
  const title = forge ? FORGE_OG.title : "fameboy";
  const description = forge ? FORGE_OG.description : OG_DESCRIPTION;
  return [
    `<meta name="description" content="${description}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="fameboy" />`,
    `<meta property="og:url" content="${ORIGIN}${encodeURI(path)}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:image" content="${ORIGIN}/${forge ? FORGE_OG.image : OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${forge ? FORGE_OG.alt : OG_ALT}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
  ].join("\n  ");
}

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

// Farcaster keeps mentions out of the text: each is a fid and the byte where
// its name goes. Put "@name" back in at those bytes.
function withMentions(text: string, fids: number[] = [], at: number[] = [], names: Map<number, Profile>) {
  if (!fids.length) return text;
  const bytes = Buffer.from(text, "utf8");
  const order = fids.map((f, i) => ({ f, at: at[i] ?? 0 })).sort((a, b) => a.at - b.at);
  let out = "", last = 0;
  for (const { f, at: pos } of order) {
    out += bytes.subarray(last, pos).toString("utf8") + `@${names.get(f)?.username ?? `!${f}`}`;
    last = pos;
  }
  return out + bytes.subarray(last).toString("utf8");
}

async function shape(casts: Message[]): Promise<CastView[]> {
  const apps = await appsFor(casts);
  const mentioned = casts.flatMap((c) => c.data.castAddBody?.mentions ?? []);
  const authorFids = [...new Set([...casts.map((c) => c.data.fid), ...mentioned, ...[...apps.values()].filter((a): a is number => a !== undefined)])];
  const people = new Map((await Promise.all(authorFids.map(profileOf))).map((p) => [p.fid, p]));
  return casts.map((m) => {
    const b = m.data.castAddBody!;
    const author = people.get(m.data.fid) ?? { fid: m.data.fid };
    const appFid = apps.get(m.hash);
    return {
      hash: m.hash,
      fid: m.data.fid,
      author: { username: author.username, display: author.display, pfp: author.pfp },
      text: withMentions(b.text, b.mentions, b.mentionsPositions, people),
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
const CAST_PAGE = /^\/[^/]+\/0x[0-9a-f]{8,40}\/?$/i;

// ------------------------------------------------------------------ routes

type Handler = (q: URLSearchParams, body: Record<string, unknown>) => Promise<unknown>;

// Two modes (ADR 003):
//   local   fameboy ui. Only the person at this computer can reach it, so
//           typing a seed phrase into its page is as safe as a terminal, and
//           it signs with the key file in ~/.fameboy.
//   hosted  fameboy serve. Other people use it over the network. Each
//           person's key stays in their browser and a session cookie says who
//           they are (session.ts). It never accepts a seed phrase or uses a key file.
let LOCAL_ONLY = true;
let ORIGIN = ""; // where people reach this server; requests must come from here
let SECURE = false; // https, so cookies get Secure

// Per request: who's signed in (hosted), where they're calling from, and any
// cookie to set on the way out.
type Ctx = { session?: Session; client: string; cookies: string[]; conv?: Conversation };
const ctx = new AsyncLocalStorage<Ctx>();
const here = (): Ctx => ctx.getStore() ?? { client: "?", cookies: [] };

// Everything but status needs you signed in: the feed, keys and apps are always your own.
class SignedOut extends NodeError {}
const myFid = async () => {
  if (!LOCAL_ONLY) {
    const s = here().session;
    if (!s) throw new SignedOut("signed out: sign in on this page");
    return s.fid;
  }
  const key = await loadKey().catch(() => undefined);
  if (!key) throw new SignedOut("signed out: run fameboy login in a terminal");
  return key.fid;
};

// Who signs this request's writes: the key file here, or the signed-in
// person's browser on a hosted fameboy (remote-sign.ts).
async function author(): Promise<Author> {
  await myFid();
  if (LOCAL_ONLY) return localAuthor();
  const c = here();
  return browserAuthor(c.session!, (c.conv ??= new Conversation()));
}

// A session names a key; check now and then that it's still an app key of
// that fid, so removing it in the Farcaster app signs that browser out here.
const checked = new Map<string, number>(); // "fid:key" -> when it was last confirmed
async function stillValid(s: Session): Promise<boolean> {
  const id = `${s.fid}:${s.key}`;
  if (Date.now() - (checked.get(id) ?? 0) < 10 * 60_000) return true;
  if (!(await signerActive(s.fid, s.key))) return checked.delete(id), false;
  if (checked.size > 50_000) checked.clear();
  checked.set(id, Date.now());
  return true;
}

// When your last visit ended, as the page sends it (ms). The browser keeps it
// (ui/mine.js); without one, "new" means the last day.
const sinceOf = (q: URLSearchParams) => {
  const n = Number(q.get("since"));
  return Number.isFinite(n) && n > 0 && n <= Date.now() ? n : Date.now() - 86_400_000;
};

// This copy's name and colour (ADR 004): the username of the app account that
// vouches for sign-ins here. Locally that's this computer's app account if it
// has one, else the node's; hosted, always the node's. @fameboy<color> gives
// the pages that colour (ui/theme.js); any other name, or none, the clear look.
let instanceCache: { at: number; value: Promise<{ name: string; fid: number | null; color: string | null; hex: string | null }> } | undefined;
function instance() {
  if (instanceCache && Date.now() - instanceCache.at < 10 * 60_000) return instanceCache.value;
  const value = (async () => {
    const local = LOCAL_ONLY ? await loadAppAccount().catch(() => undefined) : undefined;
    const fid = local?.fid ?? (await nodeSignInOptions())?.appFid ?? null;
    const name = fid ? (await profileOf(fid)).username : undefined;
    const c = colorOf(name);
    return { name: name ?? "fameboy", fid, color: c?.color ?? null, hex: c?.hex ?? null };
  })();
  instanceCache = { at: Date.now(), value };
  value.catch(() => (instanceCache = undefined));
  return value;
}

const routes: Record<string, Handler> = {
  "GET /api/instance": async () => instance(),
  "GET /api/status": async () => {
    const info = await get<{ version: string; shardInfos: { shardId: number; maxHeight: number; blockDelay: number }[] }>("/v1/info");
    return { node: PUBLIC_NODE, version: info.version, shards: info.shardInfos.sort((a, b) => a.shardId - b.shardId) };
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
  "GET /api/since": async (q) => {
    const fid = await myFid();
    return sinceLastVisit(fid, sinceOf(q), q.get("first") === "1", await feedFor(fid));
  },
  // ---- the inbox (inbox.ts): what's waiting for you, and the four views behind it.
  // Every item in each view; the page takes out what it cleared and counts the rest.
  "GET /api/waiting": async (q) => {
    const fid = await myFid();
    return waiting(fid, sinceOf(q), await feedFor(fid), shape, profileOf);
  },
  "GET /api/inbox/casts": async (q) => {
    const fid = await myFid();
    if (q.get("fresh")) feedCache.delete(fid);
    return castsView(fid, sinceOf(q), await feedFor(fid));
  },
  "GET /api/inbox/likes": async (q) => likesView(await myFid(), sinceOf(q), profileOf),
  "GET /api/inbox/replies": async (q) => repliesView(await myFid(), sinceOf(q), shape),
  "GET /api/inbox/followers": async (q) => followersView(await myFid(), sinceOf(q), profileOf),
  // Personal state older versions kept in ~/.fameboy, for the page to take
  // over once (legacy.ts). Never on a hosted fameboy.
  "GET /api/legacy": async () => (LOCAL_ONLY ? legacyState(await myFid()) : null),
  // One cast and its conversation, for the cast page (thread.ts). Open to
  // anyone, signed in or not: casts are public. Signed in, it also says
  // whether you've liked or recast it.
  "GET /api/thread": async (q) => {
    const viewer = await myFid().catch(() => undefined);
    return thread(q.get("who") ?? "", q.get("hash") ?? "", viewer, shape, Boolean(q.get("fresh")));
  },
  // Likes, recasts and replies on one cast, for the reading pane.
  "GET /api/inbox/counts": async (q) => {
    const fid = Number(q.get("fid")), hash = q.get("hash") ?? "";
    if (!Number.isInteger(fid) || !/^0x[0-9a-f]{40}$/i.test(hash)) throw new NodeError("counts need fid and hash");
    const count = (path: string, params: Record<string, string | number>) => get<Page>(path, { ...params, pageSize: 1000 }).then((p) => p.messages.length, () => 0);
    const [likes, recasts, replies] = await Promise.all([
      count("/v1/reactionsByCast", { target_fid: fid, target_hash: hash, reaction_type: "Like" }),
      count("/v1/reactionsByCast", { target_fid: fid, target_hash: hash, reaction_type: "Recast" }),
      count("/v1/castsByParent", { fid, hash }),
    ]);
    return { likes, recasts, replies };
  },
  // Who's on this node. Each call is also your heartbeat, so the page calls it
  // every 30 s with its device id and status (online or invisible).
  "POST /api/presence": async (_q, b) => {
    return presence(await author(), checkDevice(b.device as { id?: unknown; status?: unknown }));
  },
  "GET /api/me": async () => {
    if (!LOCAL_ONLY) {
      const s = here().session;
      return s ? { ...(await profileOf(s.fid)), scopes: ["ALL"], publicKey: s.key, hosted: true } : null;
    }
    const key = await loadKey().catch(() => undefined);
    if (!key) return null;
    return { ...(await profileOf(key.fid)), scopes: key.scopes, publicKey: key.publicKey };
  },
  "GET /api/feed": async (q) => {
    const fid = await myFid();
    if (q.get("fresh")) feedCache.delete(fid);
    return feedFor(fid);
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
    if (!LOCAL_ONLY) {
      // Hosted: phone approval only, vouched for by this node's app account,
      // with a key the browser makes. browser: true tells the page to make it.
      const node = await nodeSignInOptions();
      const nodeApp = node?.phone && node.appFid ? await profileOf(node.appFid) : undefined;
      return {
        app: null,
        node: node ? { phone: node.phone, app: nodeApp ? { fid: nodeApp.fid, username: nodeApp.username } : null, invite: null, inviteRequired: node.invite !== false } : null,
        phrase: false,
        browser: true,
      };
    }
    const app = await loadAppAccount();
    const p = app ? await profileOf(app.fid) : undefined;
    // node: this node's companion can vouch for phone sign-ins (needs an invite code).
    const [node, invite] = await Promise.all([nodeSignInOptions(), savedInvite()]);
    const nodeApp = node?.phone && node.appFid ? await profileOf(node.appFid) : undefined;
    return {
      app: app ? { fid: app.fid, username: p?.username, display: p?.display, pfp: p?.pfp, sponsor: app.sponsor } : null,
      node: node ? { phone: node.phone, app: nodeApp ? { fid: nodeApp.fid, username: nodeApp.username } : null, invite: invite ?? null, inviteRequired: node.invite !== false } : null,
      phrase: LOCAL_ONLY,
      browser: false,
    };
  },
  // Phone sign-in: this computer's own app account if it has one, else the node's (with an invite code).
  "POST /api/signin/app": async (_q, b) => {
    if (!LOCAL_ONLY) throw new NodeError("this fameboy is hosted: sign in with a key your browser makes (/api/signin/browser)");
    if (await loadAppAccount()) return startAppSignIn();
    // The companion says whether it needs an invite code.
    return startNodeSignIn(String(b.invite ?? "").trim());
  },
  // Hosted sign-in: the browser made a key and sends its public half.
  "POST /api/signin/browser": async (_q, b) => {
    if (LOCAL_ONLY) throw new NodeError("this fameboy runs on your computer and keeps its key in ~/.fameboy");
    return startBrowserSignIn(String(b.key ?? ""), String(b.invite ?? "").trim(), here().client);
  },
  "GET /api/signin/browser": async (q) => browserSignInStatus(q.get("token") ?? ""),
  // A session: sign this challenge with your browser's key, then POST it back.
  "GET /api/session/challenge": async () => ({ nonce: challenge(), origin: ORIGIN }),
  "POST /api/session": async (_q, b) => {
    if (LOCAL_ONLY) throw new NodeError("this fameboy runs on your computer: it needs no session");
    const s = await startSession(ORIGIN, b);
    checked.set(`${s.fid}:${s.key}`, Date.now());
    here().cookies.push(sessionCookie(s, SECURE));
    return { fid: s.fid };
  },
  "GET /api/signin/app": async (q) => appSignInStatus(q.get("token") ?? ""),
  "POST /api/signin/phrase": async (_q, b) => {
    if (!LOCAL_ONLY) throw new NodeError("this fameboy is shared over the network, so it never accepts a seed phrase");
    return { job: startPhraseSignIn(String(b.phrase ?? "")) };
  },
  "GET /api/signin/phrase": async (q) => phraseSignInStatus(q.get("job") ?? ""),
  // Sign out: revoke the app key on Farcaster when it can revoke itself (keys
  // from a seed phrase sign-in can; keys approved in the Farcaster app can't),
  // then delete it from this computer either way.
  "POST /api/signout": async (_q, b) => {
    if (!LOCAL_ONLY) {
      // The browser deletes its own key. A key approved in the Farcaster app
      // can't revoke itself, so it stays valid on chain until removed there.
      const s = here().session;
      if (s) {
        feedCache.delete(s.fid);
        if (typeof b.device === "string") await leaveNode(await author(), b.device);
      }
      here().cookies.push(clearCookie(SECURE));
      return { removed: true, revoked: "not revoked: remove it in the Farcaster app, under connected apps" };
    }
    const key = await loadKey().catch(() => undefined);
    let revoked: string = "no key";
    if (key) {
      feedCache.delete(key.fid);
      if (typeof b.device === "string") await leaveNode(fileAuthor(key), b.device);
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
    return cast(text, { replyTo, embeds }, await author());
  },
  // A link's preview card: title, description, image, site (unfurl.ts).
  "GET /api/unfurl": async (q) => unfurl(String(q.get("url") ?? "")),
  // People to @mention: those you follow whose name starts with q, plus an exact username.
  "GET /api/mentions": async (q) => mentionSuggestions(await myFid(), q.get("q") ?? ""),
  // Image space on your node (images.ts). Uploads come in as raw bytes; see the server below.
  "GET /api/images/usage": async () => imageUsage(await author()),
  "POST /api/images/delete": async (_q, b) => deleteImage(await author(), String(b.name ?? "")),
  "POST /api/react": async (_q, b) =>
    react(b.kind === "recast" ? "recast" : "like", b.target as { fid: number; hash: Hex }, b.on !== false, await author()),
  // Follow by username or fid.
  "POST /api/follow": async (_q, b) => {
    await myFid();
    const fid = await resolveFid(String(b.user ?? "").trim().replace(/^@/, ""));
    const p = await profileOf(fid);
    return { ...(await follow(fid, b.on !== false, await author())), user: { fid, username: p.username } };
  },
};

// ------------------------------------------------------------------ server

// Run a request. It may pause for signatures from the browser
// (remote-sign.ts): each pause answers the waiting HTTP request with
// { sign: { id, payload } }, and the browser's POST /api/sign gets whatever
// comes next. Locally nothing pauses, so this is one plain reply.
function converse(res: ServerResponse, c: Ctx, run: () => Promise<unknown>) {
  const conv = (c.conv ??= new Conversation());
  recordCalls(run).then(
    ({ result, calls }) => conv.say({ done: { data: result, calls } }),
    (e) => conv.say({ failed: e }),
  );
  return reply(res, c, conv);
}

async function reply(res: ServerResponse, c: Ctx, conv: Conversation) {
  const r = await conv.next();
  if ("sign" in r) return send(res, 200, { sign: r.sign });
  if ("failed" in r) throw r.failed;
  if (c.cookies.length) res.setHeader("set-cookie", c.cookies);
  return send(res, 200, r.done);
}

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

async function serveFile(res: ServerResponse, root: string, rel: string, token?: string, urlPath = "/") {
  const path = normalize(join(root, rel));
  if (!path.startsWith(root)) return send(res, 404, "not found", "text/plain");
  try {
    let data: Buffer | string = await readFile(path);
    if (token && rel.endsWith(".html")) data = data.toString().replace("__FAMEBOY_TOKEN__", token).replace("</head>", `  ${ogTags(urlPath)}\n</head>`);
    send(res, 200, data, TYPES[extname(path)] ?? "application/octet-stream");
  } catch {
    send(res, 404, "not found", "text/plain");
  }
}

// Start on `port`; if something else already uses it, try the next few
// unless the port was asked for explicitly.
export type UiOptions = { hosted?: boolean; origin?: string };

export async function startUi(port: number, explicit = false, opts: UiOptions = {}): Promise<string> {
  if (opts.hosted) {
    LOCAL_ONLY = false;
    hostedMode(); // never touch a key file again in this process
    // "web: fameboyclear" for fameboyclear.<ip>.sslip.io, else the domain.
    if (opts.origin) {
      const host = new URL(opts.origin).host;
      setDeviceLabel(`web: ${host.endsWith(".sslip.io") ? host.split(".")[0] : host}`);
    }
  }
  for (let p = port; p < port + (explicit ? 1 : 20); p++) {
    try {
      return await listenOn(p, opts);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EADDRINUSE") throw e;
      if (explicit) throw new NodeError(`port ${p} is already in use. Pick another: fameboy ui --port ${p + 1}`);
    }
  }
  throw new NodeError(`ports ${port}-${port + 19} are all in use. Pick one: fameboy ui --port <n>`);
}

async function listenOn(port: number, opts: UiOptions): Promise<string> {
  const token = randomBytes(24).toString("hex");
  // Hosted behind a proxy (Caddy), people reach it at its public address.
  const origin = (opts.origin ?? `http://127.0.0.1:${port}`).replace(/\/$/, "");
  ORIGIN = origin;
  SECURE = origin.startsWith("https://");
  const host = new URL(origin).hostname;
  if (existsSync(join(UI_DIR, `og-${host}.png`))) {
    OG_IMAGE = `og-${host}.png`;
    OG_ALT = `fameboy: a clear keycap beside the words It's playtime, and a QR code for ${host}.`;
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", origin);
    const path = url.pathname;
    // Hosted, this listens on 127.0.0.1 behind Caddy, which names the visitor.
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]!.trim();
    const c: Ctx = { client: (!LOCAL_ONLY && forwarded) || req.socket.remoteAddress || "?", cookies: [] };
    if (!LOCAL_ONLY) {
      const s = readSession(req.headers.cookie);
      if (s && (await stillValid(s).catch(() => true))) c.session = s;
      else if (s) c.cookies.push(clearCookie(SECURE));
    }
    return ctx.run(c, () =>
      handle(req, res, url, path, c).catch((e) => {
        // Last resort: one bad request must never stop the server.
        if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
      }),
    );
  });

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, path: string, c: Ctx) {
    if (c.cookies.length) res.setHeader("set-cookie", c.cookies);
    try {
      if (path.startsWith("/api/")) {
        // Only this page may call the API: same origin, and the page's token.
        const from = req.headers.origin;
        if ((from && from !== origin) || req.headers["x-fameboy-token"] !== token) return send(res, 403, { error: "forbidden" });
        // An image comes in as raw bytes, not JSON (up to 6 MB; the node caps files at 5).
        // A hosted page's answer to "sign this": carry on the paused request.
        if (req.method === "POST" && path === "/api/sign") return await reply(res, c, answer(c.session, await readJson(req)));
        if (req.method === "POST" && path === "/api/images") {
          await myFid();
          const device = checkDevice({ id: req.headers["x-fameboy-device"], status: req.headers["x-fameboy-status"] });
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const c of req) {
            size += (c as Buffer).length;
            if (size > 6 * 1024 * 1024) throw new NodeError("images max out at 5 MB");
            chunks.push(c as Buffer);
          }
          return await converse(res, c, async () => uploadImage(await author(), Buffer.concat(chunks), device));
        }
        const handler = routes[`${req.method} ${path}`];
        if (!handler) return send(res, 404, { error: "no such endpoint" });
        const body = req.method === "POST" ? await readJson(req) : {};
        // await, so the catch below answers with the error instead of it escaping and stopping the server.
        return await converse(res, c, () => handler(url.searchParams, body));
      }
      if (path === "/" || path === "/home.html") return serveFile(res, UI_DIR, "home.html", token, path);
      if (path === "/signin" || path === "/signin.html") return serveFile(res, UI_DIR, "signin.html", token, path);
      if (path === "/post" || path === "/post.html") return serveFile(res, UI_DIR, "post.html", token, path);
      if (path === "/inbox" || path === "/inbox.html") return serveFile(res, UI_DIR, "inbox.html", token, path);
      if (path === "/apps" || path === "/apps.html") return serveFile(res, UI_DIR, "apps.html", token, path);
      if (path === "/keys" || path === "/keys.html") return serveFile(res, UI_DIR, "keys.html", token, path);
      if (path === "/forge" || path === "/forge.html") return serveFile(res, UI_DIR, "forge.html", token, path);
      // A cast: /<username>/<hash>, as on farcaster.xyz. The second part
      // starting 0x tells it apart from fameboy's own pages and files.
      if (CAST_PAGE.test(path)) return serveFile(res, UI_DIR, "cast.html", token, path);
      return serveFile(res, UI_DIR, path.slice(1));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      send(res, e instanceof SignedOut ? 401 : e instanceof CastNotFound ? 404 : e instanceof NoAppAccount ? 409 : e instanceof NodeError ? 400 : 500, { error: message });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return origin;
}
