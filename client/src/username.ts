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
// The fname server allows one name per FID, and changing it is rate-limited
// (Farcaster's docs: at most once every 28 days). To change it, --replace
// first gives the current name back (a transfer to fid 0), then claims the
// new one. If the claim fails after that, it tries to take the old name back.

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
// With replace, a name the fid holds now is given up first ("replace").
export async function nameStatus(name: string, fid: number, replace = false): Promise<{ status: "available" | "already-yours" | "replace"; current?: string }> {
  checkName(name);
  const holder = await fnameGet(`name=${encodeURIComponent(name)}`);
  if (holder && holder.to === fid) return { status: "already-yours" };
  if (holder && holder.to !== 0) throw new NodeError(`@${name} is taken (fid ${holder.to})`);
  const current = await fnameGet(`fid=${fid}`);
  if (current && !replace)
    throw new NodeError(`fid ${fid} already has the fname @${current.username}. To give it up and take @${name} instead: fameboy username ${name} --replace`);
  return current ? { status: "replace", current: current.username } : { status: "available" };
}

// One signed transfer on the fname server: claim (from 0 to fid) or give back (fid to 0).
async function transfer(custody: Custody, name: string, from: number, to: number, dryRun?: boolean) {
  const timestamp = Math.floor(Date.now() / 1000);
  const claim = makeUserNameProofClaim({ name, owner: custody.account.address, timestamp });
  const sig = await new ViemLocalEip712Signer(custody.account).signUserNameProofClaim(claim);
  if (sig.isErr()) throw new NodeError(`couldn't sign the name transfer: ${sig.error.message}`);
  if (dryRun) return;
  const res = await fetch(`${FNAMES}/transfers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, from, to, fid: custody.fid, owner: custody.account.address, timestamp, signature: bytesToHex(sig.value) }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new NodeError(`fname server refused: ${res.status} ${await res.text()}`);
}

export async function setUsername(name: string, custody: Custody, o: { dryRun?: boolean; replace?: boolean; log: (s: string) => void }) {
  const { log } = o;
  const { status, current } = await nameStatus(name, custody.fid, o.replace);
  log(`@${name}: ${status === "already-yours" ? "already registered to this fid" : status === "replace" ? `available; giving up @${current} first` : "available"}`);

  // 0. --replace: give the current name back
  if (status === "replace" && current) {
    await transfer(custody, current, custody.fid, 0, o.dryRun);
    log(o.dryRun ? `dry run: signed giving up @${current}, but didn't send it.` : `gave @${current} back to the fname server`);
  }

  // 1. claim the new one on the fname server
  if (status !== "already-yours") {
    try {
      await transfer(custody, name, 0, custody.fid, o.dryRun);
    } catch (e) {
      if (status !== "replace" || !current || o.dryRun) throw e;
      // The old name is gone and the new one was refused (often the 28-day limit). Try to take the old one back.
      const back = await transfer(custody, current, 0, custody.fid).then(() => `took @${current} back`, () => `couldn't take @${current} back either`);
      throw new NodeError(`${e instanceof Error ? e.message : e}. ${back}. The account's profile still shows its old username until a new one is set.`);
    }
    log(o.dryRun ? "dry run: signed the name claim, but didn't send it to the fname server." : `fname server registered @${name} to fid ${custody.fid}`);
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
    // Never replace this computer's sign-in key with one for another account
    // (e.g. renaming a node's app account from your own computer): that key
    // is made just for this change and not saved.
    const otherAccount = Boolean(key && key.fid !== custody.fid);
    log(otherAccount ? `registering an app key for fid ${custody.fid}, used for this change only` : key ? "your app key can't edit profiles; registering a new one with that scope" : "registering an app key");
    const fresh = await registerAppKey(custody, { dryRun: o.dryRun, save: !forApp && !otherAccount, log });
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
