// Give an account a username (an "fname", like @alice).
//
// Usernames are the one part of this client that needs a service other than
// your node: the fname server at fnames.farcaster.xyz, run by Farcaster. It
// hands out names first come first served, free, no API key. Getting one
// takes three steps:
//
//   1. The custody key signs an EIP-712 UserNameProof claim ("give <name> to
//      <owner>"), and we POST it to the fname server.
//   2. The fname server countersigns. Validators pick that up and store a
//      username proof on the network, and your node syncs it.
//   3. Your app key signs a USER_DATA_ADD setting USERNAME = <name>. The node
//      only accepts it once the proof from step 2 is there, so we wait for it.
//
// The fname server allows one name per FID, and changing it is rate-limited.

import { FarcasterNetwork, Message as MessageProto, UserDataType, ViemLocalEip712Signer, makeUserDataAdd, makeUserNameProofClaim } from "@farcaster/core";
import { bytesToHex } from "viem";
import { appSigner, loadKey, registerAppKey, type Custody } from "./keys.ts";
import { NodeError, get, post, submitUntil } from "./node.ts";
import { profile } from "./read.ts";
import { loadAppAccount, saveAppAccount } from "./signin.ts";

const FNAMES = "https://fnames.farcaster.xyz";
const FNAME = /^[a-z0-9][a-z0-9-]{0,15}$/;

type Transfer = { username: string; to: number; owner: string };

async function fnameGet(query: string): Promise<Transfer | undefined> {
  const res = await fetch(`${FNAMES}/transfers/current?${query}`, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new NodeError(`fname server: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { transfer: Transfer }).transfer;
}

export function checkName(name: string) {
  if (!FNAME.test(name))
    throw new NodeError(`"${name}" isn't a valid fname: 1-16 characters, lowercase letters, digits and hyphens, not starting with a hyphen`);
}

// What would happen if `fid` asked for `name`? Throws if it can't have it.
export async function nameStatus(name: string, fid: number): Promise<"available" | "already-yours"> {
  checkName(name);
  const holder = await fnameGet(`name=${encodeURIComponent(name)}`);
  if (holder && holder.to === fid) return "already-yours";
  if (holder && holder.to !== 0) throw new NodeError(`@${name} is taken (fid ${holder.to})`);
  const current = await fnameGet(`fid=${fid}`);
  if (current) throw new NodeError(`fid ${fid} already has the fname @${current.username}. Release it on the fname server before claiming another.`);
  return "available";
}

export async function setUsername(name: string, custody: Custody, o: { dryRun?: boolean; log: (s: string) => void }) {
  const { log } = o;
  const status = await nameStatus(name, custody.fid);
  log(`@${name}: ${status === "available" ? "available" : "already registered to this fid"}`);

  // 1. claim it on the fname server
  if (status === "available") {
    const timestamp = Math.floor(Date.now() / 1000);
    const claim = makeUserNameProofClaim({ name, owner: custody.account.address, timestamp });
    const sig = await new ViemLocalEip712Signer(custody.account).signUserNameProofClaim(claim);
    if (sig.isErr()) throw new NodeError(`couldn't sign the name claim: ${sig.error.message}`);
    if (o.dryRun) {
      log("dry run: signed the name claim, but didn't send it to the fname server.");
    } else {
      const res = await fetch(`${FNAMES}/transfers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          from: 0,
          to: custody.fid,
          fid: custody.fid,
          owner: custody.account.address,
          timestamp,
          signature: bytesToHex(sig.value),
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new NodeError(`fname server refused: ${res.status} ${await res.text()}`);
      log(`fname server registered @${name} to fid ${custody.fid}`);
    }
  }

  // 2. an app key allowed to sign USER_DATA_ADD. Keys from older versions of
  // this client lack that scope, and scopes are fixed at KEY_ADD time, so we
  // add a new key. The old one expires on its own once it stops being used.
  // For this fameboy's app account, use its own key so this computer's
  // sign-in key isn't replaced.
  const app = await loadAppAccount();
  const forApp = app?.fid === custody.fid;
  let key = forApp ? app.appKey : await loadKey().catch(() => undefined);
  if (!key || key.fid !== custody.fid || !(key.scopes.includes("USER_DATA_ADD") || key.scopes.includes("ALL"))) {
    log(key ? "your app key can't edit profiles; registering a new one with that scope" : "registering an app key");
    const fresh = await registerAppKey(custody, { dryRun: o.dryRun, save: !forApp, log });
    if (!fresh) return log("dry run: stopping before USER_DATA_ADD, since there's no key that could sign it.");
    if (forApp) await saveAppAccount(custody, app.sponsor, fresh);
    key = fresh;
  }

  // 3. wait for the username proof to reach your node, then set the name
  if (!o.dryRun) {
    log("waiting for the username proof to reach your node...");
    const until = Date.now() + 5 * 60_000;
    for (;;) {
      const proof = await get<{ fid: number }>("/v1/userNameProofByName", { name }).catch(() => undefined);
      if (proof?.fid === custody.fid) break;
      if (Date.now() > until) throw new NodeError(`the proof for @${name} hasn't reached your node after 5 minutes. Run fameboy username ${name} again later; it will skip the claim.`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  const msg = await makeUserDataAdd(
    { type: UserDataType.USERNAME, value: name },
    { fid: custody.fid, network: FarcasterNetwork.MAINNET },
    appSigner(key),
  );
  if (msg.isErr()) throw new NodeError(`couldn't build USER_DATA_ADD: ${msg.error.message}`);
  const bytes = MessageProto.encode(msg.value).finish();
  if (o.dryRun) {
    const { valid } = await post<{ valid: boolean }>("/v1/validateMessage", bytes);
    return log(`dry run: USER_DATA_ADD username=${name} ${valid ? "passes" : "FAILS"} your node's stateless checks. Nothing was sent.`);
  }
  if (await submitUntil(bytes, async () => (await profile(custody.fid)).username === name)) return log(`done: fid ${custody.fid} is now @${name}`);
  throw new NodeError(`sent USER_DATA_ADD, but your node doesn't show @${name} after 60 s. Run fameboy username ${name} again.`);
}
