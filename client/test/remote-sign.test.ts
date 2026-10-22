// Signing in the browser, mid-request (src/remote-sign.ts), and writes built
// through an Author (src/write.ts). No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { CastType, FarcasterNetwork, Message, NobleEd25519Signer, makeCastAdd, makeCastAddData } from "@farcaster/core";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { Conversation, answer, browserAuthor } from "../src/remote-sign.ts";
import { fileAuthor } from "../src/keys.ts";
import { build } from "../src/write.ts";

function browserKey() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = "0x" + publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  return { key, sign: (bytes: Uint8Array) => "0x" + sign(null, bytes, privateKey).toString("hex") };
}

test("a request can pause for two signatures and then finish", async () => {
  const k = browserKey(), session = { fid: 7, key: k.key }, conv = new Conversation();
  const by = browserAuthor(session, conv);
  const run = (async () => [await by.sign(Buffer.from("one")), await by.sign(Buffer.from("two"))])();
  run.then((sigs) => conv.say({ done: sigs }), (e) => conv.say({ failed: e }));

  let r = await conv.next();
  assert.ok("sign" in r);
  assert.equal(Buffer.from(hexToBytes(r.sign.payload)).toString(), "one");
  const c2 = answer(session, { id: r.sign.id, sig: k.sign(hexToBytes(r.sign.payload)) });
  r = await c2.next();
  assert.ok("sign" in r);
  answer(session, { id: r.sign.id, sig: k.sign(hexToBytes(r.sign.payload)) });
  r = await conv.next();
  assert.ok("done" in r);
  assert.equal((r.done as string[]).length, 2);
});

test("a bad signature, or someone else's answer, is refused", async () => {
  const k = browserKey(), other = browserKey(), session = { fid: 7, key: k.key }, conv = new Conversation();
  void browserAuthor(session, conv).sign(Buffer.from("x")).catch(() => {});
  const r = await conv.next();
  assert.ok("sign" in r);
  assert.throws(() => answer(session, { id: r.sign.id, sig: other.sign(hexToBytes(r.sign.payload)) }), /doesn't match/);
  assert.throws(() => answer({ fid: 8, key: k.key }, { id: r.sign.id, sig: k.sign(hexToBytes(r.sign.payload)) }), /someone else/);
  assert.throws(() => answer(undefined, { id: r.sign.id, sig: "0x" }), /someone else/);
  assert.throws(() => answer(session, { id: "nope", sig: "0x" }), /expired/);
});

test("a cast signed through an Author is the same message @farcaster/core makes", async () => {
  const priv = new Uint8Array(32).fill(3);
  const pub = bytesToHex((await new NobleEd25519Signer(priv).getSignerKey())._unsafeUnwrap());
  const key = { fid: 99, publicKey: pub, privateKey: bytesToHex(priv) } as Parameters<typeof fileAuthor>[0];
  const body = { text: "hello", type: CastType.CAST, embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [] };
  const o = { fid: 99, network: FarcasterNetwork.MAINNET, timestamp: 150_000_000 };
  const ours = await build(fileAuthor(key), makeCastAddData(body, o));
  const theirs = (await makeCastAdd(body, o, new NobleEd25519Signer(priv)))._unsafeUnwrap();
  assert.equal(bytesToHex(ours.bytes), bytesToHex(Message.encode(theirs).finish()));
  assert.equal(ours.hash, bytesToHex(theirs.hash) as Hex);
});
