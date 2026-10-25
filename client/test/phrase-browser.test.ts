// Hosted seed phrase sign-in (ADR 006): the browser's signatures and the
// server's KEY_ADD must match what fameboy login builds.
// node --test "test/*.test.ts"   (FC_NODE=http://<node>:3381 for the network test)
// Never uses a real seed phrase, and never calls submitMessage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import {
  GASLESS_KEY_ADD_TYPE,
  GASLESS_KEY_EIP_712_DOMAIN,
  GASLESS_SIGNED_KEY_REQUEST_TYPE,
  Message as MessageProto,
  NobleEd25519Signer,
  SignatureScheme,
  ViemLocalEip712Signer,
  getFarcasterTime,
  makeKeyAddBody,
  makeMessageWithSignature,
} from "@farcaster/core";
import { GASLESS_DOMAIN, KEY_ADD_TYPES, KEY_REQUEST_TYPES, custody, normalize, check } from "../src/phrase-browser.ts";
import { SCOPES, TTL, validate } from "../src/keys.ts";
import { keyAddData } from "../src/phrase-signin.ts";

const HARDHAT = "test test test test test test test test test test test junk";
const online = Boolean(process.env.FC_NODE);

test("uses Snapchain's gasless EIP-712 domain and types", () => {
  assert.deepEqual(GASLESS_DOMAIN, GASLESS_KEY_EIP_712_DOMAIN);
  assert.deepEqual(KEY_ADD_TYPES.KeyAdd, GASLESS_KEY_ADD_TYPE);
  assert.deepEqual(KEY_REQUEST_TYPES.SignedKeyRequest, GASLESS_SIGNED_KEY_REQUEST_TYPE);
});

test("derives the same addresses as fameboy login", () => {
  for (const i of [0, 3, 9]) assert.equal(custody(HARDHAT, i).address, mnemonicToAccount(HARDHAT, { addressIndex: i }).address);
  assert.equal(custody(HARDHAT, 1).path, "m/44'/60'/0'/0/1");
  assert.throws(() => custody(HARDHAT, 10), /out of range/);
});

test("checks phrases like fameboy login", () => {
  assert.doesNotThrow(() => check(normalize(`  TEST test  test test test test test test test test test JUNK \n`)));
  assert.throws(() => check("one two three"), /12 or 24 words/);
  assert.throws(() => check(HARDHAT.replace("junk", "zzzz")), /word list/);
  assert.throws(() => check(HARDHAT.replace("junk", "test")), /checksum/);
});

async function fixture() {
  const privateKey = new Uint8Array(32).fill(7);
  const app = new NobleEd25519Signer(privateKey);
  const key = bytesToHex((await app.getSignerKey())._unsafeUnwrap());
  const deadline = getFarcasterTime()._unsafeUnwrap() + 600;
  return { app, key, deadline, fid: 13642, nonce: 5 };
}

test("signs exactly what fameboy login signs", async () => {
  const { key, deadline, fid, nonce } = await fixture();
  const sigs = await custody(HARDHAT, 0).sign({ fid, key, nonce, deadline });
  const account = mnemonicToAccount(HARDHAT);
  const body = (await makeKeyAddBody({ fid: BigInt(fid), key: hexToBytes(key), scopes: SCOPES, ttl: TTL, nonce, deadline }, new ViemLocalEip712Signer(account)))._unsafeUnwrap();
  assert.equal(bytesToHex(body.custodySignature), sigs.keyAdd);
  const { data } = await keyAddData({ address: account.address.toLowerCase() as Hex, fid, key, nonce, deadline, keyAdd: sigs.keyAdd, request: sigs.request });
  assert.deepEqual(data.keyAddBody, body);
});

test("refuses to sign odd fields", async () => {
  const { key, deadline, fid, nonce } = await fixture();
  const c = custody(HARDHAT, 0);
  await assert.rejects(c.sign({ fid, key: "0x1234", nonce, deadline }), /Ed25519/);
  await assert.rejects(c.sign({ fid: 0, key, nonce, deadline }), /fid/);
  await assert.rejects(c.sign({ fid, key, nonce, deadline: deadline + 3 * 86_400 }), /deadline/);
});

test("builds a KEY_ADD that passes the node's stateless checks", { skip: !online }, async () => {
  // A throwaway custody key that does NOT own the FID: merge-time checks
  // would reject it, but validateMessage is stateless and relays nothing.
  const { app, key, deadline, fid, nonce } = await fixture();
  const phrase = generateMnemonic(wordlist, 128);
  const c = custody(phrase, 0);
  const sigs = await c.sign({ fid, key, nonce, deadline });
  const { data, hash } = await keyAddData({ address: c.address.toLowerCase() as Hex, fid, key, nonce, deadline, keyAdd: sigs.keyAdd, request: sigs.request });
  const signature = (await app.signMessageHash(hash))._unsafeUnwrap();
  const m = (await makeMessageWithSignature(data, { signature, signatureScheme: SignatureScheme.ED25519, signer: Buffer.from(key.slice(2), "hex") }))._unsafeUnwrap();
  assert.equal((await validate(MessageProto.encode(m).finish())).valid, true);
});
