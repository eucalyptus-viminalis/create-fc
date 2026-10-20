// fc-companion: a small service next to your Snapchain node, on port 3390.
//
// Snapchain's API can't say how long the node has been running or who is
// using it, so this answers those two questions for clearcast:
//
//   GET  /v1/companion   when Snapchain started, and how many devices are online
//   GET  /v1/presence    who is online on this node right now (signed, members only)
//   POST /v1/presence    "I'm here" from a clearcast, every ~30 s (signed)
//   GET  /v1/signin      can people sign in here by approving on their phone?
//   POST /v1/signin      start a phone sign-in for a key (needs an invite code)
//
// Both presence calls are signed with the sender's app key, and the key is
// checked against Snapchain, so nobody can appear online as someone else.
// Only people currently using this node (a heartbeat in the last 90 s,
// visible or not) can read the list, so the world can't watch who's online.
// "invisible" devices never appear in the list. Presence lives in memory only
// and is forgotten 90 s after the last heartbeat.
//
// Phone sign-in: Farcaster's signer-request service only shows a request
// that an "app account" vouches for, by signing it with its custody key. The
// node's owner sets one up with `fc-node app-account`; this signs requests as
// that account, so friends on the node need no setup of their own. Their new
// key is made on their own computer: only its public half comes here. Each
// request needs an invite code from `fc-node invite`, so strangers can't use
// the app account, and each address gets 20 tries an hour.
//
// One dependency, viem (EIP-712 signing), loaded only for phone sign-in.
// Run by fc-companion-install in Docker.

import { createServer } from "node:http";
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";

const PORT = Number(process.env.PORT ?? 3390);
const SNAPCHAIN = (process.env.SNAPCHAIN ?? "http://127.0.0.1:3381").replace(/\/$/, "");
// Written once a minute by the fc-companion-uptime timer: docker's record of
// when the Snapchain container started.
const UPTIME_FILE = process.env.UPTIME_FILE ?? "/state/snapchain.json";
const TTL_MS = 90_000; // forget a device this long after its last heartbeat
const SKEW_MS = 60_000; // how far a heartbeat's clock may be from ours
const MAX_DEVICES = 5_000;
const APP_FILE = process.env.APP_ACCOUNT_FILE ?? "/state/app-account.json";
const INVITES_FILE = process.env.INVITES_FILE ?? "/state/invites";
const FARCASTER_API = "https://api.farcaster.xyz";
const startedAt = new Date().toISOString();

// ------------------------------------------------------------ presence

/** @type {Map<string, { fid: number, device: string, label: string, status: string, seen: number }>} */
const devices = new Map();

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, d] of devices) if (d.seen < cutoff) devices.delete(k);
}
setInterval(sweep, 15_000).unref();

// The exact bytes each call signs. Keep in sync with client/src/home.ts.
const presencePayload = (h) => `clearcast-presence:v1:${h.fid}:${h.device}:${h.label}:${h.status}:${h.ts}`;
const readPayload = (fid, ts) => `clearcast-presence-read:v1:${fid}:${ts}`;

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const hexBytes = (h) => Buffer.from(h.replace(/^0x/, ""), "hex");

// Is `key` a signer for `fid` right now? Asked of Snapchain, kept 10 minutes.
const signerCache = new Map();
async function isSigner(fid, key) {
  const k = `${fid}:${key.toLowerCase()}`;
  const hit = signerCache.get(k);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  let pageToken;
  do {
    const url = new URL(`${SNAPCHAIN}/v1/signersByFid`);
    url.searchParams.set("fid", String(fid));
    url.searchParams.set("pageSize", "1000");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`snapchain returned ${res.status}`);
    const page = await res.json();
    if ((page.signers ?? []).some((s) => String(s.key).toLowerCase() === key.toLowerCase())) ok = true;
    pageToken = page.nextPageToken || undefined;
  } while (!ok && pageToken);
  signerCache.set(k, { ok, until: Date.now() + 600_000 });
  if (signerCache.size > 20_000) signerCache.clear();
  return ok;
}

// Check an Ed25519 signature over `payload` by `key`, and that `key` signs for `fid`.
async function signedBy(fid, key, sig, payload) {
  if (!/^0x[0-9a-f]{64}$/i.test(String(key)) || !/^0x[0-9a-f]{128}$/i.test(String(sig))) return "bad key or signature";
  const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, hexBytes(String(key))]), format: "der", type: "spki" });
  if (!verify(null, Buffer.from(payload), pub, hexBytes(String(sig)))) return "signature doesn't match";
  if (!(await isSigner(fid, String(key)))) return "that key can't sign for this fid";
  return null;
}

async function heartbeat(b) {
  const h = {
    fid: Number(b.fid),
    device: String(b.device ?? ""),
    label: String(b.label ?? "").slice(0, 40),
    status: String(b.status ?? ""),
    ts: Number(b.ts),
  };
  if (!Number.isInteger(h.fid) || h.fid <= 0) return [400, "bad fid"];
  if (!/^[0-9a-f]{16,64}$/.test(h.device)) return [400, "bad device id"];
  if (!["online", "invisible", "offline"].includes(h.status)) return [400, "status must be online, invisible or offline"];
  if (!Number.isFinite(h.ts) || Math.abs(Date.now() - h.ts) > SKEW_MS) return [400, "timestamp too far from now"];
  const bad = await signedBy(h.fid, b.key, b.sig, presencePayload(h));
  if (bad) return [401, bad];

  const id = `${h.fid}:${h.device}`;
  if (h.status === "offline") devices.delete(id);
  else {
    if (!devices.has(id) && devices.size >= MAX_DEVICES) return [503, "too many devices"];
    devices.set(id, { fid: h.fid, device: h.device, label: h.label, status: h.status, seen: Date.now() });
  }
  return [200, { ok: true }];
}

// Who's online, grouped by account. Invisible devices are left out.
function online() {
  sweep();
  const people = new Map();
  for (const d of devices.values()) {
    if (d.status === "invisible") continue;
    const p = people.get(d.fid) ?? { fid: d.fid, devices: [], lastSeen: 0 };
    p.devices.push({ id: d.device, label: d.label, status: d.status, seen: new Date(d.seen).toISOString() });
    p.lastSeen = Math.max(p.lastSeen, d.seen);
    people.set(d.fid, p);
  }
  return [...people.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map((p) => ({ ...p, lastSeen: new Date(p.lastSeen).toISOString() }));
}

function snapchainStartedAt() {
  try {
    return JSON.parse(readFileSync(UPTIME_FILE, "utf8")).startedAt ?? null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ phone sign-in

// Written by `fc-node app-account`: { fid, address, privateKey } (the custody key).
function appAccount() {
  try {
    const a = JSON.parse(readFileSync(APP_FILE, "utf8"));
    return a.fid && a.privateKey ? a : null;
  } catch {
    return null;
  }
}

// Written by `fc-node invite`: one code per line, then a tab and a note.
const normCode = (c) => String(c ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
function inviteOk(code) {
  const c = normCode(code);
  if (c.length < 6) return false;
  try {
    return readFileSync(INVITES_FILE, "utf8").split("\n").some((line) => normCode(line.split("\t")[0]) === c);
  } catch {
    return false;
  }
}

const tries = new Map(); // ip -> times of recent sign-in attempts
function limited(ip, perHour = 20) {
  const now = Date.now();
  const recent = (tries.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  const over = recent.length >= perHour;
  if (!over) recent.push(now);
  tries.set(ip, recent);
  if (tries.size > 10_000) tries.clear();
  return over;
}

// Does the saved custody key still own the app account? Farcaster only checks
// when someone approves, so catch it here instead. Kept 10 minutes.
let ownerCheck = { until: 0, ok: false };
async function stillOwns(app) {
  if (ownerCheck.until > Date.now()) return ownerCheck.ok;
  const url = new URL(`${SNAPCHAIN}/v1/onChainEventsByFid`);
  url.searchParams.set("fid", String(app.fid));
  url.searchParams.set("event_type", "EVENT_TYPE_ID_REGISTER");
  const { events = [] } = await (await fetch(url, { signal: AbortSignal.timeout(15_000) })).json();
  const last = events.filter((e) => e.idRegisterEventBody && e.idRegisterEventBody.eventType !== "ChangeRecovery").sort((a, b) => a.blockNumber - b.blockNumber).at(-1);
  const ok = last?.idRegisterEventBody?.to?.toLowerCase() === String(app.address).toLowerCase();
  ownerCheck = { until: Date.now() + 600_000, ok };
  return ok;
}

// The same EIP-712 request clearcast signs for a local app account (client/src/signin.ts).
const DOMAIN = { name: "Farcaster SignedKeyRequestValidator", version: "1", chainId: 10, verifyingContract: "0x00000000fc700472606ed4fa22623acf62c60553" };
const TYPES = { SignedKeyRequest: [{ name: "requestFid", type: "uint256" }, { name: "key", type: "bytes" }, { name: "deadline", type: "uint256" }] };

async function startSignIn(b, ip) {
  const app = appAccount();
  if (!app) return [404, "this node has no app account yet. Its owner can run: fc-node app-account"];
  if (limited(ip)) return [429, "too many sign-ins from here. Try again in an hour."];
  if (!inviteOk(b.invite)) return [403, "that invite code doesn't work on this node"];
  if (!/^0x[0-9a-f]{64}$/i.test(String(b.key))) return [400, "bad key"];
  if (!(await stillOwns(app))) return [409, `the saved key no longer owns fid ${app.fid}. The node's owner can run: fc-node app-account`];

  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(app.privateKey);
  const deadline = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const signature = await account.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: "SignedKeyRequest",
    message: { requestFid: BigInt(app.fid), key: b.key, deadline: BigInt(deadline) },
  });
  const res = await fetch(`${FARCASTER_API}/v2/signed-key-requests`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: b.key, requestFid: app.fid, signature, deadline }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.result) return [502, `Farcaster's signer-request service said: ${json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`];
  const r = json.result.signedKeyRequest;
  return [200, { token: r.token, deeplinkUrl: r.deeplinkUrl, requestFid: app.fid, deadline }];
}

// ------------------------------------------------------------ server

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(typeof body === "string" ? { error: body } : body));
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4_000) throw new Error("request too large");
  }
  return JSON.parse(raw || "{}");
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://companion");
  try {
    if (req.method === "GET" && url.pathname === "/v1/companion") {
      sweep();
      const visible = [...devices.values()].filter((d) => d.status === "online");
      return send(res, 200, { version: 1, startedAt, snapchainStartedAt: snapchainStartedAt(), devicesOnline: visible.length, peopleOnline: new Set(visible.map((d) => d.fid)).size });
    }
    if (req.method === "GET" && url.pathname === "/v1/presence") {
      const q = url.searchParams, fid = Number(q.get("fid")), ts = Number(q.get("ts"));
      if (!Number.isInteger(fid) || !Number.isFinite(ts) || Math.abs(Date.now() - ts) > SKEW_MS) return send(res, 400, "sign the request with fid and a current ts");
      sweep();
      if (![...devices.values()].some((d) => d.fid === fid)) return send(res, 403, "send a heartbeat first: only people using this node can see who's online");
      const bad = await signedBy(fid, q.get("key"), q.get("sig"), readPayload(fid, ts));
      if (bad) return send(res, 401, bad);
      return send(res, 200, { online: online() });
    }
    if (req.method === "GET" && url.pathname === "/v1/signin") {
      const app = appAccount();
      return send(res, 200, { phone: Boolean(app), appFid: app?.fid ?? null, invite: true });
    }
    if (req.method === "POST" && url.pathname === "/v1/signin") {
      const [status, body] = await startSignIn(await readBody(req), req.socket.remoteAddress ?? "?");
      return send(res, status, body);
    }
    if (req.method === "POST" && url.pathname === "/v1/presence") {
      const [status, body] = await heartbeat(await readBody(req));
      return send(res, status, body);
    }
    send(res, 404, "not found");
  } catch (e) {
    send(res, 400, e instanceof Error ? e.message : String(e));
  }
}).listen(PORT, () => console.log(`fc-companion on :${PORT}, Snapchain at ${SNAPCHAIN}`));
