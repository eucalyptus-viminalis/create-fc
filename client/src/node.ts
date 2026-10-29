// A thin wrapper over your own node's HTTP API (port 3381).
// Every read in this client is one of these GETs, so you can repeat any of
// them with curl: curl "$FC_NODE/v1/castsByFid?fid=3&reverse=true"

import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Your node's HTTP address: $FC_NODE, else what install.sh saved in
// ~/.fameboy/config.json, else a node on this machine.
function configuredNode(): string | undefined {
  try {
    const dir = process.env.FC_HOME ?? join(homedir(), ".fameboy");
    return (JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { node?: string }).node;
  } catch {
    return undefined;
  }
}
export const NODE = (process.env.FC_NODE ?? configuredNode() ?? "http://localhost:3381").replace(/\/$/, "");
// The node's address as people outside this server reach it, for showing on
// pages and in copy-as-curl commands. A hosted fameboy reads its node at
// 127.0.0.1, which means nothing to a visitor, so fc-node client sets
// $FC_PUBLIC_NODE to http://<server ip>:3381.
export const PUBLIC_NODE = (process.env.FC_PUBLIC_NODE ?? NODE).replace(/\/$/, "");

// Farcaster timestamps count seconds from 2021-01-01T00:00:00Z, not 1970.
export const FARCASTER_EPOCH = 1609459200;
export const toDate = (farcasterTime: number) => new Date((farcasterTime + FARCASTER_EPOCH) * 1000);

export type CastId = { fid: number; hash: string };

export type CastAddBody = {
  text: string;
  embeds: ({ url: string } | { castId: CastId })[];
  mentions: number[];
  mentionsPositions: number[];
  parentCastId: CastId | null;
  parentUrl: string | null;
  type: string;
};

export type Message = {
  data: {
    type: string;
    fid: number;
    timestamp: number;
    network: string;
    castAddBody?: CastAddBody;
    linkBody?: { type: string; targetFid: number };
    reactionBody?: { type: string; targetCastId?: CastId; targetUrl?: string };
    userDataBody?: { type: string; value: string };
  };
  hash: string;
  signer: string; // the Ed25519 app key that signed it, which is how we tell clients apart
};

export type Page = { messages: Message[]; nextPageToken?: string };

export class NodeError extends Error {}
// The node, or a proxy in front of it, didn't answer: a timeout, a refused
// connection, or a gateway error such as Cloudflare's 502 page from a public
// node. Worth trying again; a rejection from the node itself isn't.
export class NodeUnavailable extends NodeError {}

// Gateway errors: 502-504, and Cloudflare's 520-524 when its origin fails.
const GATEWAY = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

// What a failed response says, in one line. The node answers errors in JSON;
// a proxy in front of it may answer with a whole HTML page, of which only the
// title is worth showing.
function failureDetail(res: Response, body: string): string {
  try {
    const j = JSON.parse(body) as { error?: string; errorDetail?: string; error_detail?: string; details?: string };
    const d = [j.error, j.errorDetail ?? j.error_detail ?? j.details].filter(Boolean).join(": ");
    if (d) return d;
  } catch {}
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(body)?.[1]?.trim();
  if (title) return `${res.status} (${title})`;
  if (/^\s*</.test(body) || !body.trim()) return `${res.status} ${res.statusText}`.trim();
  return body.slice(0, 300);
}

// The GUI shows the node calls behind every panel. Code running inside
// recordCalls() gets each URL it fetches collected, in order.
// Each record says what was called, when (unix ms) and how long it took.
export type CallRecord = { call: string; at: number; ms: number };
const callLog = new AsyncLocalStorage<CallRecord[]>();
// Recording inside a recording (the feed, built inside a request) also hands
// its calls to the outer one, so the request still lists them.
export async function recordCalls<T>(fn: () => Promise<T>): Promise<{ result: T; calls: CallRecord[] }> {
  const calls: CallRecord[] = [];
  const outer = callLog.getStore();
  try {
    const result = await callLog.run(calls, fn);
    return { result, calls };
  } finally {
    outer?.push(...calls);
  }
}

export async function get<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const url = new URL(NODE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    const rec = { call: `GET ${url.pathname}${url.search}`, at: Date.now(), ms: 0 };
    callLog.getStore()?.push(rec);
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    rec.ms = Date.now() - rec.at;
  } catch (e) {
    throw new NodeError(`can't reach your node at ${NODE} (${(e as Error).message}). Is FC_NODE right, and is port 3381 open?`);
  }
  const body = await res.text();
  if (!res.ok) {
    const Err = GATEWAY.has(res.status) ? NodeUnavailable : NodeError;
    throw new Err(`${url.pathname} returned ${failureDetail(res, body)}`);
  }
  return JSON.parse(body) as T;
}

// Writes go in as protobuf bytes, not JSON. Your node checks the message
// against its own copy of the state, then relays it to the validators.
// /v1/validateMessage runs the same checks and relays nothing.
export async function post<T>(path: "/v1/submitMessage" | "/v1/validateMessage", bytes: Uint8Array): Promise<T> {
  let res: Response;
  const rec = { call: `POST ${path} (${bytes.length} bytes of protobuf)`, at: Date.now(), ms: 0 };
  callLog.getStore()?.push(rec);
  try {
    res = await fetch(NODE + path, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new NodeUnavailable(`can't reach your node at ${NODE} (${(e as Error).message})`);
  }
  rec.ms = Date.now() - rec.at;
  const body = await res.text();
  if (!res.ok) {
    if (GATEWAY.has(res.status)) throw new NodeUnavailable(`the node didn't answer: ${failureDetail(res, body)}. Try again in a minute.`);
    throw new NodeError(`node rejected the message: ${failureDetail(res, body)}`);
  }
  return JSON.parse(body) as T;
}

// Walk every page of a paginated endpoint. The node caps pageSize, so a user
// following 2,000 accounts takes a couple of requests.
export async function getAll(path: string, params: Record<string, string | number | boolean | undefined>): Promise<Message[]> {
  const out: Message[] = [];
  let pageToken: string | undefined;
  do {
    const page = await get<Page>(path, { ...params, pageSize: 1000, pageToken });
    out.push(...page.messages);
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return out;
}

// Run fn over items with at most `limit` requests in flight.
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// Submit a message, then poll `landed` until it shows up. A read node passes
// your message to the validators over gossip and keeps no copy, so if it has
// no peers at that moment the message is lost without an error. (We saw this
// once: the demo node lost all its peers for 27 s, and a KEY_ADD sent 3 s in
// vanished.) Sending the same signed message again is harmless, so resend it
// every 15 s until it lands.
// The first send also retries when the node doesn't answer (a public node's
// proxy can return a 502 for a few seconds). Such a send may still have got
// through, so a retry that's then rejected (as a duplicate, say) checks
// whether the message landed before giving up.
export async function submitUntil(bytes: Uint8Array, landed: () => Promise<boolean>, timeoutMs = 60_000): Promise<boolean> {
  for (const [attempt, wait] of [2_000, 5_000, 0].entries()) {
    try {
      await post("/v1/submitMessage", bytes);
      break;
    } catch (e) {
      if (attempt > 0 && !(e instanceof NodeUnavailable) && (await landed().catch(() => false))) return true;
      if (!(e instanceof NodeUnavailable) || !wait) throw e;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const until = Date.now() + timeoutMs;
  let resendAt = Date.now() + 15_000;
  while (Date.now() < until) {
    if (await landed().catch(() => false)) return true;
    if (Date.now() >= resendAt) {
      await post("/v1/submitMessage", bytes).catch(() => {}); // e.g. "duplicate" once it's in
      resendAt = Date.now() + 15_000;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}
