// fc-companion: a small service next to your Snapchain node, on port 3390.
//
// Snapchain's API can't say how long the node has been running or who is
// using it, so this answers those two questions for clearcast:
//
//   GET  /v1/companion   when Snapchain started, and how many devices are online
//   GET  /v1/presence    who is online on this node right now (signed, members only)
//   POST /v1/presence    "I'm here" from a clearcast, every ~30 s (signed)
//
// Both presence calls are signed with the sender's app key, and the key is
// checked against Snapchain, so nobody can appear online as someone else.
// Only people currently using this node (a heartbeat in the last 90 s,
// visible or not) can read the list, so the world can't watch who's online.
// "invisible" devices never appear in the list. Presence lives in memory only
// and is forgotten 90 s after the last heartbeat.
//
// No dependencies: plain Node 22. Run by fc-companion-install in Docker.

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
    if (req.method === "POST" && url.pathname === "/v1/presence") {
      const [status, body] = await heartbeat(await readBody(req));
      return send(res, status, body);
    }
    send(res, 404, "not found");
  } catch (e) {
    send(res, 400, e instanceof Error ? e.message : String(e));
  }
}).listen(PORT, () => console.log(`fc-companion on :${PORT}, Snapchain at ${SNAPCHAIN}`));
