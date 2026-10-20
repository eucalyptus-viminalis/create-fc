// Keys: turn a seed phrase into a custody account, find its FID on your own
// node, and use it once to authorize an app key for this client.
//
// The seed phrase controls the whole account: it can transfer the FID, add
// and remove keys, and move any funds at the custody address. This module
// holds it in memory for the few seconds it takes to sign one KEY_ADD, then
// drops it. It never writes it to disk, prints it, or sends it anywhere.
// What does get saved is the app key, which can only sign the message types
// listed in SCOPES, and which the node expires after TTL seconds unused.

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import {
  FarcasterNetwork,
  Message as MessageProto,
  MessageType,
  NobleEd25519Signer,
  ViemLocalEip712Signer,
  getFarcasterTime,
  makeKeyAdd,
  makeKeyAddBody,
  makeKeyRemove,
  makeKeyRemoveBodySelfRevoke,
} from "@farcaster/core";
import { NODE, get, post, submitUntil, NodeError } from "./node.ts";

export const KEY_DIR = process.env.FC_HOME ?? join(homedir(), ".fc-client");
export const KEY_FILE = join(KEY_DIR, "appkey.json");

// The message types our app key may sign. The node rejects anything else
// signed with it. KEY_ADD and KEY_REMOVE can never be scopes, so a leaked app
// key can't mint more keys or revoke yours.
export const SCOPES = [
  MessageType.CAST_ADD,
  MessageType.CAST_REMOVE,
  MessageType.REACTION_ADD,
  MessageType.REACTION_REMOVE,
  MessageType.LINK_ADD,
  MessageType.LINK_REMOVE,
  MessageType.USER_DATA_ADD, // profile fields: username, display name, bio, pfp
];

// Sliding expiry: every message the key signs pushes this window forward.
// 30 days unused and the key dies on its own. The protocol maximum is 90 days.
export const TTL = 30 * 24 * 60 * 60;

// How far down the derivation path to look for the custody address. Farcaster
// apps and most wallets use the first address (index 0), m/44'/60'/0'/0/0.
const MAX_INDEX = 10;

export type AppKey = {
  fid: number;
  custody: Hex;
  derivationPath: string;
  publicKey: Hex;
  privateKey: Hex;
  scopes: string[];
  ttl: number;
  nonce: number;
  addedAt: string;
  node: string;
};

// ---------------------------------------------------------------- the phrase

export function normalizePhrase(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).join(" ");
}

export function checkPhrase(phrase: string): void {
  const words = phrase.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length))
    throw new NodeError(`a seed phrase is 12 or 24 words; that was ${words.length}`);
  const unknown = words.filter((w) => !wordlist.includes(w));
  if (unknown.length) throw new NodeError(`${unknown.length} word(s) aren't in the BIP-39 English word list. Check for typos.`);
  if (!validateMnemonic(phrase, wordlist)) throw new NodeError("the words are valid but the checksum isn't: a word is wrong or out of order");
}

// Read the phrase without echoing it, so it never lands in your terminal
// scrollback. When stdin isn't a terminal (piped from a password manager),
// read it from there instead.
export async function promptPhrase(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    let data = "";
    for await (const chunk of stdin) data += chunk;
    return data;
  }
  process.stderr.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve, reject) => {
    let buf = "";
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      err ? reject(err) : resolve(buf);
    };
    const onData = (s: string) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new NodeError("cancelled"));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
      process.stderr.write(`\r${prompt}${"*".repeat(buf.split(/\s+/).filter(Boolean).length)} words`);
    };
    stdin.on("data", onData);
  });
}

// ------------------------------------------------- phrase -> custody -> FID

type OnChainEvent = {
  fid: number;
  blockNumber: number;
  idRegisterEventBody?: { to: string; from: string; eventType: string };
};

// Ask your own node which FID an address holds. The node keeps the onchain
// ID Registry events, so this needs no Ethereum RPC.
async function fidForAddress(address: string): Promise<number | undefined> {
  try {
    // Fast when the address owns an FID. For one that doesn't, the node
    // scans every ID registry event before saying so: 30-40 s on mainnet.
    const ev = await get<OnChainEvent>("/v1/onChainIdRegistryEventByAddress", { address }, 120_000);
    return ev.fid || undefined;
  } catch (e) {
    if (e instanceof NodeError && /NotFound|no id-registry event/.test(e.message)) return undefined;
    throw e;
  }
}

// The address that owns an FID right now: the `to` of its latest Register or
// Transfer event.
export async function currentCustody(fid: number): Promise<string> {
  const { events } = await get<{ events: OnChainEvent[] }>("/v1/onChainEventsByFid", { fid, event_type: "EVENT_TYPE_ID_REGISTER" });
  const owners = events.filter((e) => e.idRegisterEventBody && e.idRegisterEventBody.eventType !== "ChangeRecovery");
  const last = owners.sort((a, b) => a.blockNumber - b.blockNumber).at(-1);
  if (!last) throw new NodeError(`your node has no registration event for fid ${fid}. Is it still syncing?`);
  return last.idRegisterEventBody!.to.toLowerCase();
}

export type Custody = { account: HDAccount; fid: number; path: string };

// Try m/44'/60'/0'/0/0 first: Farcaster apps and most wallets use it. Only
// if that misses, try /1 to /9 together, since each miss costs the node a
// 30-40 s scan.
export async function findCustody(phrase: string, log: (s: string) => void): Promise<Custody> {
  const candidates = Array.from({ length: MAX_INDEX }, (_, i) => ({
    account: mnemonicToAccount(phrase, { addressIndex: i }),
    path: `m/44'/60'/0'/0/${i}`,
  }));
  const check = async ({ account, path }: (typeof candidates)[number]): Promise<Custody | undefined> => {
    const fid = await fidForAddress(account.address);
    log(`  ${path}  ${account.address}  ${fid ? `fid ${fid}` : "no fid"}`);
    if (!fid) return undefined;
    if ((await currentCustody(fid)) !== account.address.toLowerCase()) {
      log(`  fid ${fid} was registered to this address but has since been transferred away; skipping`);
      return undefined;
    }
    return { account, fid, path };
  };

  const first = await check(candidates[0]!);
  if (first) return first;
  log(`  not at index 0; checking indexes 1-${MAX_INDEX - 1} (each miss costs the node a full scan, so this takes 2-3 minutes)`);
  const rest = (await Promise.all(candidates.slice(1).map(check))).find(Boolean);
  if (rest) return rest;
  throw new NodeError(
    `none of the first ${MAX_INDEX} addresses from this phrase owns a Farcaster account. ` +
      `Check it's the account's recovery phrase, and that your node has finished syncing.`,
  );
}

export async function storageUnits(fid: number): Promise<number> {
  const s = await get<{ units: number }>("/v1/storageLimitsByFid", { fid });
  return s.units;
}

// ------------------------------------------------------- the gasless KEY_ADD

type SignersResponse = { currentUserNonce: number; gaslessSignerCount: number; gaslessSignerLimit: number };

// Build a KEY_ADD that authorizes a fresh Ed25519 app key for `fid`.
// Three signatures go into it:
//   1. SignedKeyRequest (EIP-712, custody key): "app <requestFid> asks for this key".
//      We are our own app, so requestFid = fid and the same custody key signs.
//   2. KeyAdd (EIP-712, custody key): "add this key to <fid> with these
//      scopes, this TTL and this nonce". This is the authorization itself.
//   3. The message envelope, signed by the new app key: proof we hold it.
// No transaction and no gas: it's an ordinary message, sent to your node.
export async function buildKeyAdd(custody: Custody) {
  const privateKey = new Uint8Array(randomBytes(32));
  const appSigner = new NobleEd25519Signer(privateKey);
  const publicKey = (await appSigner.getSignerKey())._unsafeUnwrap();

  const signers = await get<SignersResponse>("/v1/signersByFid", { fid: custody.fid, pageSize: 1 });
  if (signers.gaslessSignerCount >= signers.gaslessSignerLimit)
    throw new NodeError(`fid ${custody.fid} already has ${signers.gaslessSignerCount} gasless keys, the maximum`);
  const nonce = signers.currentUserNonce + 1;

  const now = getFarcasterTime()._unsafeUnwrap();
  const body = await makeKeyAddBody(
    { fid: BigInt(custody.fid), key: publicKey, scopes: SCOPES, ttl: TTL, nonce, deadline: now + 10 * 60 },
    new ViemLocalEip712Signer(custody.account),
  );
  if (body.isErr()) throw new NodeError(`couldn't sign the key request: ${body.error.message}`);

  const message = await makeKeyAdd(body.value, { fid: custody.fid, network: FarcasterNetwork.MAINNET }, appSigner);
  if (message.isErr()) throw new NodeError(`couldn't build the KEY_ADD message: ${message.error.message}`);

  const key: AppKey = {
    fid: custody.fid,
    custody: custody.account.address,
    derivationPath: custody.path,
    publicKey: bytesToHex(publicKey),
    privateKey: bytesToHex(privateKey),
    scopes: SCOPES.map((s) => MessageType[s]!),
    ttl: TTL,
    nonce,
    addedAt: new Date().toISOString(),
    node: "",
  };
  return { key, bytes: MessageProto.encode(message.value).finish(), hash: bytesToHex(message.value.hash) };
}

export async function validate(bytes: Uint8Array) {
  return post<{ valid: boolean }>("/v1/validateMessage", bytes);
}


// Check storage, build the KEY_ADD, send it to your node, wait for it to land,
// then save the app key. With dryRun, stop after the node's stateless checks.
// With save: false the key is returned but not saved as this computer's key
// (an app account keeps its own, in app-account.json).
export async function registerAppKey(custody: Custody, opts: { dryRun?: boolean; save?: boolean; log: (s: string) => void }) {
  const { log } = opts;
  const units = await storageUnits(custody.fid);
  if (units === 0) throw new NodeError(`fid ${custody.fid} has no storage units, so the network would reject every message from it. Rent storage first.`);
  log(`storage: ${units} unit(s)`);

  const { key, bytes, hash } = await buildKeyAdd(custody);
  key.node = NODE;
  log(`app key: ${key.publicKey}\nKEY_ADD: ${hash}, nonce ${key.nonce}, ttl ${key.ttl / 86400} days`);

  if (opts.dryRun) {
    // validateMessage only runs the node's stateless checks (structure, the
    // envelope signature, the KEY_ADD body). Custody and nonce are checked
    // against state at merge time; findCustody checked custody, and the nonce
    // came from the node a moment ago.
    const res = await validate(bytes);
    log(
      res.valid
        ? "dry run: passes your node's stateless checks, and the custody address matches the FID's current owner. Nothing was sent."
        : "dry run: your node's stateless checks REJECT this KEY_ADD. Nothing was sent.",
    );
    return undefined;
  }

  log("sending to your node, which relays it to the validators. Waiting for it to land...");
  const seen = () => get("/v1/signer", { fid: key.fid, signer: key.publicKey }).then(() => true, () => false);
  if (!(await submitUntil(bytes, seen, 90_000))) {
    throw new NodeError("the key didn't appear within 90 s, even after resending. Check clearcast status (is your node in sync and connected?), then try again.");
  }
  if (opts.save === false) {
    log("done. App key registered.");
    return key;
  }
  await saveKey(key);
  log(`done. App key saved to ${KEY_FILE} (mode 600). Your seed phrase was not saved.`);
  return key;
}

// ------------------------------------------------------ the self-revoking KEY_REMOVE

export type Revoked = { state: "revoked" | "already gone" | "dry run ok" | "dry run rejected" };

// Revoke an app key using the key itself: a gasless key may sign its own
// KEY_REMOVE, so no seed phrase is needed. The node checks that the message's
// signer is the key being removed. The nonce comes from the app that asked for
// the key (requestFid; for keys clearcast login made, that's your own fid).
// Keys approved in the Farcaster app are onchain, and only an onchain
// transaction removes those.
export async function revokeKey(key: AppKey, opts: { dryRun?: boolean; log: (s: string) => void }): Promise<Revoked> {
  const { log } = opts;
  type SignerRecord = { source: string; requestFid?: number };
  const record = await get<{ signer: SignerRecord }>("/v1/signer", { fid: key.fid, signer: key.publicKey }).then(
    (r) => r.signer,
    () => undefined,
  );
  if (!record) {
    log("your node doesn't have this key: it expired, was revoked, or never landed.");
    return { state: "already gone" };
  }
  if (record.source !== "SIGNER_SOURCE_OFFCHAIN")
    throw new NodeError(
      "this key was approved in the Farcaster app, so it lives onchain. A message can't remove it: remove it in the Farcaster app's settings instead.",
    );

  const requestFid = record.requestFid ?? key.fid;
  const nonces = await get<{ requesterFidNonces?: Record<string, number> }>("/v1/signersByFid", { fid: key.fid, pageSize: 1 });
  // The node doesn't always report the app nonce it has used, so if it
  // rejects one as used, try the next few.
  const first = (nonces.requesterFidNonces?.[String(requestFid)] ?? 0) + 1;
  const build = async (nonce: number) => {
    const now = getFarcasterTime()._unsafeUnwrap();
    const body = makeKeyRemoveBodySelfRevoke({ key: hexToBytes(key.publicKey), nonce, deadline: now + 10 * 60 });
    if (body.isErr()) throw new NodeError(`couldn't build the KEY_REMOVE: ${body.error.message}`);
    const message = await makeKeyRemove(body.value, { fid: key.fid, network: FarcasterNetwork.MAINNET }, appSigner(key));
    if (message.isErr()) throw new NodeError(`couldn't sign the KEY_REMOVE: ${message.error.message}`);
    log(`KEY_REMOVE: ${bytesToHex(message.value.hash)}, app nonce ${nonce} (requested by fid ${requestFid})`);
    return MessageProto.encode(message.value).finish();
  };

  if (opts.dryRun) {
    const res = await validate(await build(first));
    log(res.valid ? "dry run: passes your node's stateless checks. Nothing was sent." : "dry run: your node's stateless checks REJECT this KEY_REMOVE. Nothing was sent.");
    return { state: res.valid ? "dry run ok" : "dry run rejected" };
  }
  log("sending to your node. Waiting for the key to disappear...");
  const gone = () => get("/v1/signer", { fid: key.fid, signer: key.publicKey }).then(() => false, () => true);
  for (let nonce = first; ; nonce++) {
    try {
      if (!(await submitUntil(await build(nonce), gone, 90_000)))
        throw new NodeError("the key is still there after 90 s, even after resending. Check that your node is in sync, then try again.");
      break;
    } catch (e) {
      if (!(e instanceof NodeError && /nonce/i.test(e.message)) || nonce >= first + 9) throw e;
      log(`  nonce ${nonce} is used up; trying ${nonce + 1}`);
    }
  }
  log("done. The key can't sign anything now.");
  return { state: "revoked" };
}

// ---------------------------------------------------------- the key file

export async function saveKey(key: AppKey): Promise<void> {
  await mkdir(KEY_DIR, { recursive: true, mode: 0o700 });
  await chmod(KEY_DIR, 0o700);
  await writeFile(KEY_FILE, JSON.stringify(key, null, 2) + "\n", { mode: 0o600 });
  await chmod(KEY_FILE, 0o600);
}

export async function loadKey(): Promise<AppKey> {
  let raw: string;
  try {
    raw = await readFile(KEY_FILE, "utf8");
  } catch {
    throw new NodeError(`no app key at ${KEY_FILE}. Run: clearcast login`);
  }
  return JSON.parse(raw) as AppKey;
}

// Sign out: delete the app key from this computer. The key stays registered
// on the network until it expires, but nobody else holds a copy. Signing in
// again means running clearcast login with the seed phrase.
export async function forgetKey(): Promise<boolean> {
  try {
    await unlink(KEY_FILE);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
}

export const appSigner = (key: AppKey) => new NobleEd25519Signer(hexToBytes(key.privateKey));
