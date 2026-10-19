// Which client posted a cast? Every message is signed by an app key, and
// every app key was authorized with a SignedKeyRequest naming the app that
// asked for it: the app's own FID, its `requestFid`. So:
//
//   cast.signer -> that author's signer record -> requestFid -> the app
//
// Your node returns both kinds of signer from /v1/signersByFid:
//   - gasless keys (KEY_ADD messages): the node has already decoded and
//     verified requestFid, and returns it as a field.
//   - onchain keys (OP Mainnet KeyRegistry): requestFid is inside the raw
//     `metadata` bytes of the onchain event, ABI-encoded, so we decode it.

import { decodeAbiParameters, type Hex } from "viem";
import { get, pool, type Message } from "./node.ts";
import { profile, resolveFid } from "./read.ts";

type Signer = {
  source: "SIGNER_SOURCE_ONCHAIN" | "SIGNER_SOURCE_OFFCHAIN";
  key: Hex;
  requestFid?: number;
  onChainEvent?: { signerEventBody?: { metadata: string; metadataType: number } };
};

// The struct the KeyGateway's SignedKeyRequestValidator checks.
const SIGNED_KEY_REQUEST = [
  {
    type: "tuple",
    components: [
      { name: "requestFid", type: "uint256" },
      { name: "requestSigner", type: "address" },
      { name: "signature", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
  },
] as const;

export function appFidOf(s: Signer): number | undefined {
  if (s.requestFid) return s.requestFid;
  const body = s.onChainEvent?.signerEventBody;
  if (!body?.metadata || body.metadataType !== 1) return undefined;
  try {
    const bytes = `0x${Buffer.from(body.metadata, "base64").toString("hex")}` as Hex;
    const [req] = decodeAbiParameters(SIGNED_KEY_REQUEST, bytes);
    return Number(req.requestFid);
  } catch {
    return undefined;
  }
}

// author fid -> (signer key -> app fid). One request per author per run.
const signerCache = new Map<number, Promise<Map<string, number | undefined>>>();

async function signersOf(fid: number) {
  let p = signerCache.get(fid);
  if (!p) {
    p = (async () => {
      const out = new Map<string, number | undefined>();
      let pageToken: string | undefined;
      do {
        const page = await get<{ signers: Signer[]; nextPageToken?: string }>("/v1/signersByFid", { fid, pageSize: 1000, pageToken });
        for (const s of page.signers) out.set(s.key.toLowerCase(), appFidOf(s));
        pageToken = page.nextPageToken || undefined;
      } while (pageToken);
      return out;
    })();
    signerCache.set(fid, p);
  }
  return p;
}

// The app FID that posted each message, or undefined when we can't tell:
// the key is gone (expired, or revoked and its messages not yet pruned) or
// its metadata is missing.
export async function appsFor(messages: Message[]): Promise<Map<string, number | undefined>> {
  const authors = [...new Set(messages.map((m) => m.data.fid))];
  await pool(authors, 96, (f) => signersOf(f).catch(() => new Map()));
  const out = new Map<string, number | undefined>();
  for (const m of messages) out.set(m.hash, (await signersOf(m.data.fid).catch(() => new Map())).get(m.signer.toLowerCase()));
  return out;
}

export type AppFilter = { include?: number[]; exclude?: number[] };

export async function resolveApps(names?: string[]): Promise<number[] | undefined> {
  return names?.length ? Promise.all(names.map(resolveFid)) : undefined;
}

// Keep casts from the included apps (if any are listed), then drop the
// excluded ones. Casts whose app is unknown count as "not in the list".
export async function filterByApp(casts: Message[], f: AppFilter) {
  const apps = await appsFor(casts);
  const kept = casts.filter((m) => {
    const app = apps.get(m.hash);
    if (f.include && (app === undefined || !f.include.includes(app))) return false;
    if (f.exclude && app !== undefined && f.exclude.includes(app)) return false;
    return true;
  });
  return { kept, apps };
}

// App FID -> display name, for labels like "via @farcaster".
export async function appNames(fids: (number | undefined)[]): Promise<Map<number, string>> {
  const unique = [...new Set(fids.filter((f): f is number => f !== undefined))];
  const ps = await pool(unique, 16, (f) => profile(f).catch(() => ({ fid: f })));
  return new Map(ps.map((p) => [p.fid, "username" in p && p.username ? p.username : `!${p.fid}`]));
}

// A user's app keys, grouped by app: who can post as them.
export async function appsOfUser(fid: number) {
  const map = await signersOf(fid);
  const counts = new Map<number | undefined, number>();
  for (const app of map.values()) counts.set(app, (counts.get(app) ?? 0) + 1);
  return counts;
}

export type KeyInfo = {
  key: Hex;
  source: "onchain" | "gasless";
  appFid?: number;
  addedAt?: number; // unix seconds
  expiresAt?: number; // unix seconds; gasless keys only
  scopes: string[]; // empty: an onchain key, allowed to sign anything
};

// Every key that can sign for `fid`, with the app that asked for it.
export async function keysOfUser(fid: number): Promise<KeyInfo[]> {
  const out: KeyInfo[] = [];
  let pageToken: string | undefined;
  do {
    const page = await get<{ signers: (Signer & { addedAt?: number; expiresAt?: number; scopes?: string[] })[]; nextPageToken?: string }>(
      "/v1/signersByFid",
      { fid, pageSize: 1000, pageToken },
    );
    for (const s of page.signers)
      out.push({
        key: s.key,
        source: s.source === "SIGNER_SOURCE_OFFCHAIN" ? "gasless" : "onchain",
        appFid: appFidOf(s),
        addedAt: s.addedAt,
        expiresAt: s.expiresAt,
        scopes: (s.scopes ?? []).map((x) => x.replace(/^MESSAGE_TYPE_/, "")),
      });
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);
  return out;
}
