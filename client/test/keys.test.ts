// node --test "test/*.test.ts"   (FC_NODE=http://<node>:3381 for the network tests)
// Never uses a real seed phrase, and never calls submitMessage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";
import { buildKeyAdd, checkPhrase, findCustody, normalizePhrase, validate } from "../src/keys.ts";

const HARDHAT = "test test test test test test test test test test test junk";
const online = Boolean(process.env.FC_NODE);

test("derives the standard first Ethereum address, m/44'/60'/0'/0/0", () => {
  assert.equal(mnemonicToAccount(HARDHAT).address, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
});

test("accepts a valid phrase with stray case and whitespace", () => {
  assert.doesNotThrow(() => checkPhrase(normalizePhrase(`  TEST test  test test test test test test test test test JUNK \n`)));
});

test("rejects bad phrases with a reason", () => {
  assert.throws(() => checkPhrase("one two three"), /12 or 24 words/);
  assert.throws(() => checkPhrase(HARDHAT.replace("junk", "zzzz")), /word list/);
  assert.throws(() => checkPhrase(HARDHAT.replace("junk", "test")), /checksum/);
});

test("a fresh random phrase owns no FID", { skip: !online, timeout: 300_000 }, async () => {
  await assert.rejects(findCustody(generateMnemonic(wordlist, 256), () => {}), /none of the first 10 addresses/);
});

test("builds a KEY_ADD that passes the node's stateless checks", { skip: !online }, async () => {
  // A throwaway custody key that does NOT own fid 13642: the node's merge-time
  // checks would reject it, but validateMessage is stateless and relays nothing.
  const throwaway = mnemonicToAccount(generateMnemonic(wordlist, 256));
  const { key, bytes } = await buildKeyAdd({ account: throwaway, fid: 13642, path: "m/44'/60'/0'/0/0" });
  assert.equal(key.scopes.length, 7);
  assert.ok(key.nonce >= 1);
  const res = await validate(bytes);
  assert.equal(res.valid, true);
});
