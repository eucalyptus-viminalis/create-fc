// Seed phrase sign-in on a hosted fameboy: the server's part (ADR 006).
//
// The browser keeps the phrase and the custody key (phrase-browser.ts). This
// server only ever sees public data and signatures:
//
//   1. account   the browser sends a custody address; this answers which FID
//                it owns, its storage, the next key nonce and a deadline.
//   2. prepare   the browser sends its app key's public half and the two
//                custody signatures. This checks them, builds the KEY_ADD and
//                returns its hash for the app key to sign.
//   3. finish    the browser sends that signature. This submits the KEY_ADD
//                and waits until the node has the key.
//
// Then the browser opens a session as after phone sign-in (session.ts).

import { randomBytes } from "node:crypto";
import {
  FarcasterNetwork,
  ID_REGISTRY_ADDRESS,
  KeyAddBody,
  Message as MessageProto,
  SignatureScheme,
  encodeGaslessSignedKeyRequestMetadata,
  getFarcasterTime,
  idRegistryABI,
  makeKeyAddData,
  makeMessageHash,
  makeMessageWithSignature,
  type MessageData,
} from "@farcaster/core";
import { bytesToHex, createPublicClient, hexToBytes, http, verifyTypedData, type Hex } from "viem";
import { optimism } from "viem/chains";
import { COMPANION } from "./home.ts";
import { currentCustody, fidForAddress, storageUnits, validate } from "./keys.ts";
import { NodeError, get, submitUntil } from "./node.ts";
import { GASLESS_DOMAIN, KEY_ADD_TYPES, KEY_REQUEST_TYPES, KEY_SCOPES, KEY_TTL } from "./phrase-browser.ts";
import { signatureOkBytes } from "./session.ts";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const HEX_KEY = /^0x[0-9a-f]{64}$/;
const HEX_SIG = /^0x[0-9a-f]{130}$/;

// ------------------------------------------------------------ 1. the account

// Which FID an address owns: Optimism's ID Registry answers at once (idOf,
// through OP_RPC, as fameboy new-account uses). Without it, the node can
// answer too, but an address that owns no FID makes it scan every ID registry
// event: 30-100 s. So each visitor gets LOOKUPS fresh lookups an hour, enough
// for three passes over m/44'/60'/0'/0/0-9, and at most SCANS node scans run
// at once. Answers are kept 10 minutes, and a kept answer costs nothing.
const OP_RPC = process.env.OP_RPC ?? "https://mainnet.optimism.io";
const LOOKUPS = 30;
const SCANS = 3;
const chain = createPublicClient({ chain: optimism, transport: http(OP_RPC, { timeout: 10_000 }) });
const lookups = new Map<string, number[]>(); // visitor -> times of fresh lookups
const known = new Map<string, { at: number; fid: number | undefined }>();
let scanning = 0;
const queue: (() => void)[] = [];

function overLimit(client: string): boolean {
  const now = Date.now();
  const recent = (lookups.get(client) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= LOOKUPS) return lookups.set(client, recent), true;
  recent.push(now);
  lookups.set(client, recent);
  if (lookups.size > 10_000) lookups.clear();
  return false;
}

async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (scanning >= SCANS) await new Promise<void>((resolve) => queue.push(resolve));
  scanning++;
  try {
    return await fn();
  } finally {
    scanning--;
    queue.shift()?.();
  }
}

async function ownedFid(address: string, client: string): Promise<number | undefined> {
  const k = known.get(address);
  if (k && Date.now() - k.at < 10 * 60_000) return k.fid;
  if (overLimit(client)) throw new NodeError("too many account lookups from here. Try again in an hour.");
  const onchain = await chain
    .readContract({ address: ID_REGISTRY_ADDRESS, abi: idRegistryABI, functionName: "idOf", args: [address as Hex] })
    .then((id) => (id > 0n ? Number(id) : undefined), () => null);
  const fid = onchain === null ? await oneAtATime(() => fidForAddress(address)) : onchain;
  // The node must agree: it checks the KEY_ADD against the owner it knows.
  // (From the node's scan: registered here once, maybe transferred away since.)
  const owns = fid !== undefined && (await currentCustody(fid)) === address;
  if (known.size > 10_000) known.clear();
  known.set(address, { at: Date.now(), fid: owns ? fid : undefined });
  return owns ? fid : undefined;
}

type SignersResponse = { currentUserNonce: number; gaslessSignerCount: number; gaslessSignerLimit: number };

export async function phraseAccount(rawAddress: string, client: string) {
  const address = String(rawAddress).toLowerCase();
  if (!ADDRESS.test(address)) throw new NodeError("that isn't an Ethereum address");
  const fid = await ownedFid(address, client);
  if (fid === undefined) return { fid: null };
  const [units, signers] = await Promise.all([storageUnits(fid), get<SignersResponse>("/v1/signersByFid", { fid, pageSize: 1 })]);
  return {
    fid,
    storage: units,
    full: signers.gaslessSignerCount >= signers.gaslessSignerLimit,
    nonce: signers.currentUserNonce + 1,
    // Farcaster time, like every KEY_ADD deadline. Ten minutes to finish.
    deadline: getFarcasterTime()._unsafeUnwrap() + 10 * 60,
  };
}

// ------------------------------------------------------------ the node's say

// The companion keeps this node's sign-in rules: whether seed phrase sign-in
// is on, invite codes, and 20 tries an hour per visitor (node/companion.mjs).
async function companionAllows(invite: string, client: string) {
  let res: Response;
  try {
    res = await fetch(`${COMPANION}/v1/signin/phrase`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-clearcast-client": client },
      body: JSON.stringify({ invite }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new NodeError(`can't reach your node's companion at ${COMPANION}`);
  }
  if (res.status === 404) throw new NodeError("this node's companion is too old for seed phrase sign-in. Its owner can re-run command 1.");
  if (!res.ok) throw new NodeError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `the companion said ${res.status}`);
}

// ------------------------------------------------------------ 2. prepare

type Pending = { fid: number; key: Hex; data: MessageData; hash: Uint8Array; expires: number };
const pending = new Map<string, Pending>();

export type PrepareRequest = {
  address?: unknown;
  fid?: unknown;
  key?: unknown;
  nonce?: unknown;
  deadline?: unknown;
  keyAdd?: unknown;
  request?: unknown;
  invite?: unknown;
};

export async function preparePhraseKey(b: PrepareRequest, client: string) {
  for (const [id, p] of pending) if (p.expires < Date.now()) pending.delete(id);
  if (pending.size > 1_000) throw new NodeError("too many sign-ins at once. Try again in a minute.");
  const address = String(b.address ?? "").toLowerCase() as Hex;
  const key = String(b.key ?? "").toLowerCase() as Hex;
  const fid = Number(b.fid), nonce = Number(b.nonce), deadline = Number(b.deadline);
  const keyAdd = String(b.keyAdd ?? "").toLowerCase() as Hex;
  const request = String(b.request ?? "").toLowerCase() as Hex;
  if (!ADDRESS.test(address) || !HEX_KEY.test(key) || !HEX_SIG.test(keyAdd) || !HEX_SIG.test(request)) throw new NodeError("that sign-in request is malformed");
  if (![fid, nonce, deadline].every((n) => Number.isInteger(n) && n > 0)) throw new NodeError("that sign-in request is malformed");
  if (deadline <= getFarcasterTime()._unsafeUnwrap()) throw new NodeError("that sign-in took too long. Start again.");

  await companionAllows(String(b.invite ?? "").trim(), client);

  // Both signatures must come from the address that owns the FID now.
  if ((await currentCustody(fid)) !== address) throw new NodeError(`that address doesn't own fid ${fid}`);
  const message = { fid: BigInt(fid), key, keyType: 1, scopes: [...KEY_SCOPES], ttl: KEY_TTL, nonce, deadline: BigInt(deadline) };
  const okAdd = await verifyTypedData({ address, domain: GASLESS_DOMAIN, types: KEY_ADD_TYPES, primaryType: "KeyAdd", message, signature: keyAdd });
  const okReq = await verifyTypedData({
    address,
    domain: GASLESS_DOMAIN,
    types: KEY_REQUEST_TYPES,
    primaryType: "SignedKeyRequest",
    message: { requestFid: BigInt(fid), key, deadline: BigInt(deadline) },
    signature: request,
  });
  if (!okAdd || !okReq) throw new NodeError("those signatures don't match the account's key");

  const { data, hash } = await keyAddData({ address, fid, key, nonce, deadline, keyAdd, request });
  const id = randomBytes(16).toString("hex");
  pending.set(id, { fid, key, data, hash, expires: Date.now() + 10 * 60_000 });
  return { id, hash: bytesToHex(hash) };
}

// The KEY_ADD's data and the hash the new app key signs, from the custody
// signatures. Exported for tests.
export async function keyAddData(o: { address: Hex; fid: number; key: Hex; nonce: number; deadline: number; keyAdd: Hex; request: Hex }) {
  const { address, fid, key, nonce, deadline, keyAdd, request } = o;
  const metadata = encodeGaslessSignedKeyRequestMetadata({ requestFid: BigInt(fid), requestSigner: address, signature: hexToBytes(request), deadline: BigInt(deadline) });
  if (metadata.isErr()) throw new NodeError(`couldn't encode the key request: ${metadata.error.message}`);
  const body = KeyAddBody.create({
    key: hexToBytes(key),
    keyType: 1,
    custodySignature: hexToBytes(keyAdd),
    deadline,
    nonce,
    metadata: metadata.value,
    metadataType: 1, // a signed key request
    registrationTxHash: new Uint8Array(),
    scopes: [...KEY_SCOPES],
    ttl: KEY_TTL,
  });
  const data = await makeKeyAddData(body, { fid, network: FarcasterNetwork.MAINNET });
  if (data.isErr()) throw new NodeError(`couldn't build the KEY_ADD: ${data.error.message}`);
  const hash = await makeMessageHash(data.value);
  if (hash.isErr()) throw new NodeError(`couldn't hash the KEY_ADD: ${hash.error.message}`);

  return { data: data.value, hash: hash.value };
}

// ------------------------------------------------------------ 3. finish

export async function finishPhraseKey(b: { id?: unknown; sig?: unknown }) {
  const id = String(b.id ?? "");
  const p = pending.get(id);
  if (!p || p.expires < Date.now()) throw new NodeError("this sign-in has expired. Start again.");
  const sig = String(b.sig ?? "");
  if (!signatureOkBytes(p.key, sig, p.hash)) throw new NodeError("that signature doesn't match your browser's key");
  pending.delete(id);

  const m = await makeMessageWithSignature(p.data, { signature: hexToBytes(sig as Hex), signatureScheme: SignatureScheme.ED25519, signer: hexToBytes(p.key) });
  if (m.isErr()) throw new NodeError(`that signature doesn't fit the KEY_ADD: ${m.error.message}`);
  const bytes = MessageProto.encode(m.value).finish();
  const { valid } = await validate(bytes);
  if (!valid) throw new NodeError("your node's checks reject this KEY_ADD");

  const seen = () => get("/v1/signer", { fid: p.fid, signer: p.key }).then(() => true, () => false);
  if (!(await submitUntil(bytes, seen, 90_000))) throw new NodeError("the key didn't appear within 90 s. Is this node in sync? Try again.");
  return { fid: p.fid, key: p.key };
}
