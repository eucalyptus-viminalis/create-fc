// A thin wrapper over your own node's HTTP API (port 3381).
// Every read in this client is one of these GETs, so you can repeat any of
// them with curl: curl "$FC_NODE/v1/castsByFid?fid=3&reverse=true"

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Your node's HTTP address: $FC_NODE, else what install.sh saved in
// ~/.fc-client/config.json, else a node on this machine.
function configuredNode(): string | undefined {
  try {
    const dir = process.env.FC_HOME ?? join(homedir(), ".fc-client");
    return (JSON.parse(readFileSync(join(dir, "config.json"), "utf8")) as { node?: string }).node;
  } catch {
    return undefined;
  }
}
export const NODE = (process.env.FC_NODE ?? configuredNode() ?? "http://localhost:3381").replace(/\/$/, "");

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

export async function get<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
  timeoutMs = 15_000,
): Promise<T> {
  const url = new URL(NODE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new NodeError(`can't reach your node at ${NODE} (${(e as Error).message}). Is FC_NODE right, and is port 3381 open?`);
  }
  const body = await res.text();
  if (!res.ok) throw new NodeError(`${url.pathname} returned ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as T;
}

// Writes go in as protobuf bytes, not JSON. Your node checks the message
// against its own copy of the state, then relays it to the validators.
// /v1/validateMessage runs the same checks and relays nothing.
export async function post<T>(path: "/v1/submitMessage" | "/v1/validateMessage", bytes: Uint8Array): Promise<T> {
  let res: Response;
  try {
    res = await fetch(NODE + path, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new NodeError(`can't reach your node at ${NODE} (${(e as Error).message})`);
  }
  const body = await res.text();
  if (!res.ok) {
    let detail = body;
    try {
      const j = JSON.parse(body) as { error?: string; errorDetail?: string; error_detail?: string };
      detail = [j.error, j.errorDetail ?? j.error_detail].filter(Boolean).join(": ");
    } catch {}
    throw new NodeError(`node rejected the message: ${detail}`);
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
