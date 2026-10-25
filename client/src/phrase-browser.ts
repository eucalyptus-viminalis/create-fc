// Seed phrase sign-in on a hosted fameboy: the part that runs in the browser
// (ADR 006). Built into ui/vendor/phrase-browser.js by `pnpm build:browser`,
// which exposes it as window.phraseBrowser.
//
// The phrase and the custody key it unlocks stay inside this module. The page
// gets an address and two signatures, and nothing else leaves the browser.
// Every field the custody key signs is checked or filled in here, never taken
// as a ready-made hash from the server, so a server that has been tampered
// with can't get it to sign something else, such as an FID transfer.
//
// Imported by the server too (keys.ts), so both sides agree on the scopes and
// TTL an app key gets. Keep it free of Node APIs.

import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { mnemonicToAccount } from "viem/accounts";

// The message types an app key may sign: CAST_ADD, CAST_REMOVE, REACTION_ADD,
// REACTION_REMOVE, LINK_ADD, LINK_REMOVE, USER_DATA_ADD (MessageType in
// @farcaster/core). Never KEY_ADD or KEY_REMOVE, so a leaked app key can't
// mint more keys or revoke yours.
export const KEY_SCOPES = [1, 2, 3, 4, 5, 6, 11] as const;
// Sliding expiry: 30 days unused and the key dies on its own.
export const KEY_TTL = 30 * 24 * 60 * 60;
// How far down m/44'/60'/0'/0/<i> to look for the custody address.
export const MAX_INDEX = 10;
const FARCASTER_EPOCH = 1609459200;

// Snapchain's gasless KEY_ADD (GASLESS_* in @farcaster/core; a test checks they match).
export const GASLESS_DOMAIN = { name: "Farcaster KeyAdd", version: "1", chainId: 1 } as const;
export const KEY_ADD_TYPES = {
  KeyAdd: [
    { name: "fid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "keyType", type: "uint32" },
    { name: "scopes", type: "uint32[]" },
    { name: "ttl", type: "uint32" },
    { name: "nonce", type: "uint32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
export const KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function normalize(raw: string): string {
  return raw.trim().toLowerCase().split(/\s+/).join(" ");
}

// Throws a plain-words reason when the phrase can't be one.
export function check(phrase: string): void {
  const words = phrase.split(" ");
  if (![12, 15, 18, 21, 24].includes(words.length)) throw new Error(`a seed phrase is 12 or 24 words; that was ${words.length}`);
  const unknown = words.filter((w) => !wordlist.includes(w));
  if (unknown.length) throw new Error(`${unknown.length} word(s) aren't in the BIP-39 English word list. Check for typos.`);
  if (!validateMnemonic(phrase, wordlist)) throw new Error("the words are valid but the checksum isn't: a word is wrong or out of order");
}

type Hex = `0x${string}`;
const HEX_KEY = /^0x[0-9a-f]{64}$/;
const isUint = (n: unknown, max: number): n is number => Number.isInteger(n) && (n as number) > 0 && (n as number) <= max;

export type Custody = {
  address: Hex;
  path: string;
  // Both signatures for adding `key` (this browser's app key) to `fid`. The
  // account names itself as the app asking for the key, as fameboy login does.
  sign(o: { fid: number; key: string; nonce: number; deadline: number }): Promise<{ keyAdd: Hex; request: Hex }>;
};

// The custody account at m/44'/60'/0'/0/<index>.
export function custody(rawPhrase: string, index: number): Custody {
  const phrase = normalize(rawPhrase);
  check(phrase);
  if (!Number.isInteger(index) || index < 0 || index >= MAX_INDEX) throw new Error(`index ${index} is out of range`);
  const account = mnemonicToAccount(phrase, { addressIndex: index });
  return {
    address: account.address,
    path: `m/44'/60'/0'/0/${index}`,
    async sign({ fid, key, nonce, deadline }) {
      const k = String(key).toLowerCase();
      if (!HEX_KEY.test(k)) throw new Error("that isn't an Ed25519 public key");
      if (!isUint(fid, 2 ** 48)) throw new Error("bad fid");
      if (!isUint(nonce, 2 ** 32 - 1)) throw new Error("bad nonce");
      // In Farcaster time (seconds since 2021-01-01), set by the server's
      // clock. Allow a day either way for this browser's clock being off.
      const now = Math.floor(Date.now() / 1000) - FARCASTER_EPOCH;
      if (!Number.isInteger(deadline) || Math.abs(deadline - now) > 86_400) throw new Error("bad deadline");
      const keyAdd = await account.signTypedData({
        domain: GASLESS_DOMAIN,
        types: KEY_ADD_TYPES,
        primaryType: "KeyAdd",
        message: { fid: BigInt(fid), key: k as Hex, keyType: 1, scopes: [...KEY_SCOPES], ttl: KEY_TTL, nonce, deadline: BigInt(deadline) },
      });
      const request = await account.signTypedData({
        domain: GASLESS_DOMAIN,
        types: KEY_REQUEST_TYPES,
        primaryType: "SignedKeyRequest",
        message: { requestFid: BigInt(fid), key: k as Hex, deadline: BigInt(deadline) },
      });
      return { keyAdd, request };
    },
  };
}
