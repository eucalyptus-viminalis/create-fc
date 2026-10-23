// Hosted sessions (src/session.ts): a browser signs a challenge with its app
// key; the server checks it and sets a signed cookie. No network: the node's
// "is this key active?" check is passed in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { challenge, readSession, sessionCookie, sessionPayload, startSession } from "../src/session.ts";

const ORIGIN = "https://fameboy.example";
function browserKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  return { key: "0x" + raw.toString("hex"), sign: (text: string) => "0x" + sign(null, Buffer.from(text), privateKey).toString("hex") };
}
const yes = async () => true;
const no = async () => false;

test("a signed challenge opens a session for that fid and key", async () => {
  const k = browserKey(), nonce = challenge();
  const s = await startSession(ORIGIN, { fid: 42, key: k.key, nonce, sig: k.sign(sessionPayload(ORIGIN, 42, k.key, nonce)) }, yes);
  assert.deepEqual(s, { fid: 42, key: k.key });
});

test("a signature for another fid, origin or challenge is refused", async () => {
  const k = browserKey(), nonce = challenge();
  const sig = k.sign(sessionPayload(ORIGIN, 42, k.key, nonce));
  await assert.rejects(startSession(ORIGIN, { fid: 43, key: k.key, nonce, sig }, yes), /doesn't match/);
  await assert.rejects(startSession("https://other.example", { fid: 42, key: k.key, nonce, sig }, yes), /doesn't match/);
  await assert.rejects(startSession(ORIGIN, { fid: 42, key: k.key, nonce: challenge(), sig }, yes), /doesn't match/);
});

test("someone else's key, or a key the node doesn't know, is refused", async () => {
  const k = browserKey(), other = browserKey(), nonce = challenge();
  await assert.rejects(startSession(ORIGIN, { fid: 42, key: other.key, nonce, sig: k.sign(sessionPayload(ORIGIN, 42, other.key, nonce)) }, yes), /doesn't match/);
  await assert.rejects(startSession(ORIGIN, { fid: 42, key: k.key, nonce, sig: k.sign(sessionPayload(ORIGIN, 42, k.key, nonce)) }, no), /isn't an app key/);
});

test("a forged challenge is refused", async () => {
  const k = browserKey(), nonce = `${Date.now()}.abc.forged`;
  await assert.rejects(startSession(ORIGIN, { fid: 42, key: k.key, nonce, sig: k.sign(sessionPayload(ORIGIN, 42, k.key, nonce)) }, yes), /expired/);
});

test("the cookie round-trips, and a changed one is ignored", () => {
  const k = browserKey();
  const set = sessionCookie({ fid: 42, key: k.key }, true);
  assert.match(set, /HttpOnly; SameSite=Lax; Secure$/);
  const value = set.split(";")[0]!;
  assert.deepEqual(readSession(`other=1; ${value}`), { fid: 42, key: k.key });
  assert.equal(readSession(value.replace("cc_session=42.", "cc_session=43.")), undefined);
  assert.equal(readSession(undefined), undefined);
});
