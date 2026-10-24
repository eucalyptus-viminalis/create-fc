// Signing in from the browser, two ways.
//
// 1. Approve in the Farcaster app (recommended). This server makes a new app
//    key and asks Farcaster's signer-request service to show it to you. You
//    scan a QR code, approve on your phone, and the Farcaster app adds the key
//    on chain. Your seed phrase never leaves your phone. The service is free
//    and needs no API key, but it does need an "app account": a Farcaster
//    account whose custody key vouches for every key request this server makes.
//    Whoever runs fameboy sets it up once with `fameboy app-account`.
//    Docs: https://docs.farcaster.xyz/reference/farcaster/signer-requests
//
//    Or the node vouches: when the node's owner ran `fc-node app-account`,
//    fc-companion holds an app account for everyone on that node, so friends
//    sharing it need no setup of their own, only an invite code. The new key
//    is still made here; only its public half goes to the companion.
//
// 2. Seed phrase in the page (this computer only). The same steps as
//    `fameboy login`: the phrase goes from your browser to this server on
//    127.0.0.1, signs one KEY_ADD in memory, and is dropped. A fameboy that
//    other people use over the network must never accept a phrase, so this
//    route only exists while the server listens on this computer alone.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NobleEd25519Signer } from "@farcaster/core";
import QRCode from "qrcode";
import { bytesToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { NodeError, NODE, get } from "./node.ts";
import { COMPANION } from "./home.ts";
import { KEY_DIR, type AppKey, checkPhrase, currentCustody, findCustody, normalizePhrase, registerAppKey, saveKey, type Custody } from "./keys.ts";

const FARCASTER_API = "https://api.farcaster.xyz";
const APP_FILE = join(KEY_DIR, "app-account.json");

// ------------------------------------------------------------ app account

// appKey: the app account's own app key, used to set its profile. Not this
// computer's sign-in key.
type AppAccount = { fid: number; address: Hex; privateKey: Hex; sponsor: boolean; appKey?: AppKey };

export class NoAppAccount extends NodeError {}

export async function loadAppAccount(): Promise<AppAccount | undefined> {
  try {
    const app = JSON.parse(await readFile(APP_FILE, "utf8")) as AppAccount;
    return app.fid && app.privateKey ? app : undefined;
  } catch {
    return undefined;
  }
}

// Saves the app account's custody private key, mode 600. Use an account made
// for this: anyone who copies this file controls that account.
export async function saveAppAccount(custody: Custody, sponsor: boolean, appKey?: AppKey): Promise<string> {
  const privateKey = custody.account.getHdKey().privateKey;
  if (!privateKey) throw new NodeError("couldn't derive the custody key");
  const old = await loadAppAccount();
  const keep = appKey ?? (old?.fid === custody.fid ? old.appKey : undefined);
  const app: AppAccount = { fid: custody.fid, address: custody.account.address, privateKey: bytesToHex(privateKey), sponsor, appKey: keep };
  await mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
  await writeFile(APP_FILE, JSON.stringify(app, null, 2) + "\n", { mode: 0o600 });
  await chmod(APP_FILE, 0o600);
  return APP_FILE;
}

// ------------------------------------------------- 1. approve in the app

type Request = { privateKey: Hex; publicKey: Hex; requestFid: number; expires: number };
const requests = new Map<string, Request>(); // token -> the key waiting for approval

const DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: "0x00000000fc700472606ed4fa22623acf62c60553",
} as const;
const TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

type SignedKeyRequest = { token: string; deeplinkUrl: string; key: string; state: "pending" | "approved" | "completed"; userFid?: number };

async function farcaster<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${FARCASTER_API}${path}`, { ...init, headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(20_000) });
  const json = (await res.json().catch(() => ({}))) as { result?: T; errors?: { message: string }[] };
  if (!res.ok || !json.result) throw new NodeError(`Farcaster's signer-request service said: ${json.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`}`);
  return json.result;
}

export async function startAppSignIn() {
  const app = await loadAppAccount();
  if (!app) throw new NoAppAccount("no app account set up: run fameboy app-account once in a terminal");
  for (const [t, r] of requests) if (r.expires < Date.now()) requests.delete(t);

  const privateKey = new Uint8Array(randomBytes(32));
  const publicKey = (await new NobleEd25519Signer(privateKey).getSignerKey())._unsafeUnwrap();
  const deadline = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
  const account = privateKeyToAccount(app.privateKey);
  // Farcaster only checks the signature when you approve, so check here that
  // the saved key still owns the app account; otherwise the request would fail late.
  if ((await currentCustody(app.fid)) !== account.address.toLowerCase())
    throw new NodeError(`the saved app account key doesn't own fid ${app.fid} any more. Run fameboy app-account again.`);
  const signature = await account.signTypedData({
    domain: DOMAIN,
    types: TYPES,
    primaryType: "SignedKeyRequest",
    message: { requestFid: BigInt(app.fid), key: bytesToHex(publicKey), deadline: BigInt(deadline) },
  });
  // Sponsoring pays the onchain fee for the person signing in. It needs the
  // app account to hold warps in the Farcaster app.
  const sponsorship = app.sponsor ? { sponsorFid: app.fid, signature: await account.signMessage({ message: { raw: signature } }) } : undefined;

  const { signedKeyRequest: req } = await farcaster<{ signedKeyRequest: SignedKeyRequest }>("/v2/signed-key-requests", {
    method: "POST",
    body: JSON.stringify({ key: bytesToHex(publicKey), requestFid: app.fid, signature, deadline, sponsorship }),
  });
  requests.set(req.token, { privateKey: bytesToHex(privateKey), publicKey: bytesToHex(publicKey), requestFid: app.fid, expires: deadline * 1000 });
  const qr = await QRCode.toString(req.deeplinkUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#17151f", light: "#0000" } });
  return { token: req.token, url: req.deeplinkUrl, qr, sponsored: Boolean(sponsorship) };
}

// --- 1b. the node vouches (fc-companion's app account)

export type NodeSignIn = { phone: boolean; appFid: number | null; invite?: boolean } | null; // invite: whether sign-in needs a code

// Can this node's companion start phone sign-ins? null: no companion.
export async function nodeSignInOptions(): Promise<NodeSignIn> {
  try {
    const res = await fetch(`${COMPANION}/v1/signin`, { signal: AbortSignal.timeout(5_000) });
    return res.ok ? ((await res.json()) as NodeSignIn) : null;
  } catch {
    return null;
  }
}

// The invite code that last worked, kept so a friend types it once.
const INVITE_FILE = join(KEY_DIR, "invite.json");
export async function savedInvite(): Promise<string | undefined> {
  try {
    const saved = JSON.parse(await readFile(INVITE_FILE, "utf8")) as { node?: string; code?: string };
    return saved.node === NODE ? saved.code : undefined;
  } catch {
    return undefined;
  }
}

export async function startNodeSignIn(invite: string) {
  for (const [t, r] of requests) if (r.expires < Date.now()) requests.delete(t);
  const privateKey = new Uint8Array(randomBytes(32));
  const publicKey = bytesToHex((await new NobleEd25519Signer(privateKey).getSignerKey())._unsafeUnwrap());
  let res: Response;
  try {
    res = await fetch(`${COMPANION}/v1/signin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: publicKey, invite }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new NodeError(`can't reach your node's companion at ${COMPANION}`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; token: string; deeplinkUrl: string; requestFid: number; deadline: number };
  if (!res.ok) throw new NodeError(json.error ?? `the companion said ${res.status}`);
  requests.set(json.token, { privateKey: bytesToHex(privateKey), publicKey, requestFid: json.requestFid, expires: json.deadline * 1000 });
  await mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
  await writeFile(INVITE_FILE, JSON.stringify({ node: NODE, code: invite }, null, 2) + "\n");
  const qr = await QRCode.toString(json.deeplinkUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c1c1a", light: "#0000" } });
  return { token: json.token, url: json.deeplinkUrl, qr, sponsored: false, via: "node" as const, requestFid: json.requestFid };
}

// --- 1c. hosted: the key is made in the browser (ADR 003)
//
// The browser sends only the public half; the node's companion vouches for it
// as above. When it's approved, the browser keeps the key and opens a session
// (session.ts). Nothing is saved here. `client` is the visitor's address, so
// the companion's limit of sign-ins per address counts visitors, not this server.

const browserRequests = new Map<string, { publicKey: string; expires: number }>(); // token -> key waiting for approval

// The QR code opens this server's /approve page rather than the farcaster://
// link itself: a phone without the Farcaster app can't open that link, and
// its camera only says "No usable data found" (ADR 005).
export const approvePage = (origin: string, token: string) => `${origin}/approve#${token}`;

export async function startBrowserSignIn(key: string, invite: string, client: string, origin: string) {
  for (const [t, r] of browserRequests) if (r.expires < Date.now()) browserRequests.delete(t);
  if (!/^0x[0-9a-f]{64}$/i.test(key)) throw new NodeError("that isn't an Ed25519 public key");
  let res: Response;
  try {
    res = await fetch(`${COMPANION}/v1/signin`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-clearcast-client": client },
      body: JSON.stringify({ key: key.toLowerCase(), invite }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new NodeError(`can't reach your node's companion at ${COMPANION}`);
  }
  const json = (await res.json().catch(() => ({}))) as { error?: string; token: string; deeplinkUrl: string; requestFid: number; deadline: number };
  if (!res.ok) throw new NodeError(json.error ?? `the companion said ${res.status}`);
  browserRequests.set(json.token, { publicKey: key.toLowerCase(), expires: json.deadline * 1000 });
  const qr = await QRCode.toString(approvePage(origin, json.token), { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1c1c1a", light: "#0000" } });
  return { token: json.token, url: json.deeplinkUrl, qr, sponsored: false, via: "node" as const, requestFid: json.requestFid };
}

// "ready" once the key is on chain and this node has seen it. The browser then
// signs a session challenge with it. (Not "approved": Farcaster's service uses
// that word for "tapped approve", before the key is on chain.)
export async function browserSignInStatus(token: string) {
  const pending = browserRequests.get(token);
  if (!pending) throw new NodeError("this sign-in request has expired. Start again.");
  const { signedKeyRequest: req } = await farcaster<{ signedKeyRequest: SignedKeyRequest }>(`/v2/signed-key-request?token=${encodeURIComponent(token)}`);
  if (req.state !== "completed" || !req.userFid) return { state: req.state };
  const seen = await get("/v1/signer", { fid: req.userFid, signer: pending.publicKey }).then(() => true, () => false);
  if (!seen) return { state: "syncing" as const };
  browserRequests.delete(token);
  return { state: "ready" as const, fid: req.userFid, key: pending.publicKey };
}

// Poll Farcaster's service; once the key is on chain and your node has seen
// it, save it as this computer's app key.
export async function appSignInStatus(token: string) {
  const pending = requests.get(token);
  if (!pending) throw new NodeError("this sign-in request has expired. Start again.");
  const { signedKeyRequest: req } = await farcaster<{ signedKeyRequest: SignedKeyRequest }>(`/v2/signed-key-request?token=${encodeURIComponent(token)}`);
  if (req.state !== "completed" || !req.userFid) return { state: req.state };
  // Approved on chain. Your node learns about it a few seconds later.
  const seen = await get("/v1/signer", { fid: req.userFid, signer: pending.publicKey }).then(
    () => true,
    () => false,
  );
  if (!seen) return { state: "syncing" as const };
  await saveKey({
    fid: req.userFid,
    custody: ((await currentCustody(req.userFid).catch(() => "")) || "0x") as Hex,
    derivationPath: `approved in the Farcaster app, requested by fid ${pending.requestFid}`,
    publicKey: pending.publicKey,
    privateKey: pending.privateKey,
    scopes: ["ALL"], // an onchain key can sign any message type
    ttl: 0, // onchain keys don't expire
    nonce: 0,
    addedAt: new Date().toISOString(),
    node: NODE,
  });
  requests.delete(token);
  return { state: "signed-in" as const, fid: req.userFid };
}

// ------------------------------------------- 2. seed phrase, this computer only

type Job = { lines: string[]; done: boolean; error?: string; fid?: number };
const jobs = new Map<string, Job>();

// Starts the same steps as fameboy login and returns a job id to poll. The
// phrase lives only in this function's scope while it runs.
export function startPhraseSignIn(raw: string): string {
  const phrase = normalizePhrase(raw);
  checkPhrase(phrase);
  const id = randomBytes(8).toString("hex");
  const job: Job = { lines: [], done: false };
  jobs.set(id, job);
  const log = (line: string) => job.lines.push(line);
  (async () => {
    log("Looking for your account on your node. This can take up to a minute.");
    const custody = await findCustody(phrase, log);
    log(`Found fid ${custody.fid} at ${custody.path}.`);
    const key = await registerAppKey(custody, { log });
    job.fid = key?.fid;
  })().then(
    () => (job.done = true),
    (e) => {
      job.error = e instanceof Error ? e.message : String(e);
      job.done = true;
    },
  );
  setTimeout(() => jobs.delete(id), 10 * 60_000).unref();
  return id;
}

export function phraseSignInStatus(id: string): Job {
  const job = jobs.get(id);
  if (!job) throw new NodeError("this sign-in has expired. Start again.");
  return job;
}
