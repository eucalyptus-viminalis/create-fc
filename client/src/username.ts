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

import { FarcasterNetwork, Message as MessageProto, UserDataType, ViemLocalEip712Signer, makeUserDataAdd, makeUserDataAddData, makeUserNameProofClaim } from "@farcaster/core";
import { bytesToHex, type Hex } from "viem";
import { appSigner, currentCustody, loadKey, registerAppKey, type Author, type Custody } from "./keys.ts";
import { NodeError, get, post, submitUntil } from "./node.ts";
import { profile } from "./read.ts";
import { loadAppAccount, saveAppAccount } from "./signin.ts";
import { editProfile, setProfile } from "./profile.ts";
import { build } from "./write.ts";
import { avatarFor, colorOf } from "../../node/fameboy-name.mjs";

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
  await postTransfer(custody.fid, { name, from, to, owner: custody.account.address, timestamp, signature: bytesToHex(sig.value) });
}

// A transfer signed by the custody key: here, or in the browser (the me page).
export type SignedTransfer = { name: string; from: number; to: number; owner: Hex; timestamp: number; signature: Hex };

async function postTransfer(fid: number, t: SignedTransfer) {
  const res = await fetch(`${FNAMES}/transfers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...t, fid }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text();
    if (/THROTTLED/.test(body)) {
      // Names can change at most once every 28 days, counted from the fid's last transfer.
      const last = await fnameGet(`fid=${fid}`).catch(() => undefined);
      const t = (last as (Transfer & { timestamp?: number }) | undefined)?.timestamp;
      const when = t ? ` @${last!.username} was claimed on ${new Date(t * 1000).toLocaleString()}, so the next change works from about ${new Date((t + 28 * 86400) * 1000).toLocaleString()}.` : "";
      throw new NodeError(`the fname server says this account changed its name too recently: names can change once every 28 days.${when}`);
    }
    throw new NodeError(`fname server refused: ${res.status} ${body}`);
  }
}

export async function setUsername(name: string, custody: Custody, o: { dryRun?: boolean; replace?: boolean; log: (s: string) => void }) {
  const { log } = o;
  const { status, current } = await nameStatus(name, custody.fid, o.replace);
  log(`@${name}: ${status === "already-yours" ? "already registered to this fid" : status === "replace" ? `available; giving up @${current} first` : "available"}`);

  // 0. --replace: give the current name back
  if (status === "replace" && current) {
    await transfer(custody, current, custody.fid, 0, o.dryRun).catch((e) => {
      throw new NodeError(`${e instanceof Error ? e.message : e} Nothing was changed: the account still has @${current}.`);
    });
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
    if (!(await proofArrives(name, custody.fid)))
      throw new NodeError(`the proof for @${name} hasn't reached your node after 5 minutes. Run fameboy username ${name} again later; it will skip the claim.`);
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
  if (!(await submitUntil(bytes, async () => (await profile(custody.fid)).username === name)))
    throw new NodeError(`sent USER_DATA_ADD, but your node doesn't show @${name} after 60 s. Run fameboy username ${name} again.`);
  log(`done: fid ${custody.fid} is now @${name}`);
  await matchAvatar(name, key, log);
}

// An @fameboy<color> name with no picture yet gets the keycap in its colour,
// so an app account set up on a server (fc-node app-account) doesn't keep
// Farcaster's default avatar. Never replaces a picture someone chose.
async function matchAvatar(name: string, key: Parameters<typeof setProfile>[0], log: (s: string) => void) {
  if (!colorOf(name)) return;
  try {
    if ((await profile(key.fid)).pfp) return;
    await setProfile(key, { pfp: avatarFor(name) }, log);
  } catch (e) {
    log(`couldn't set the picture: ${e instanceof Error ? e.message : e}. Set it later: fameboy profile${key.fid === (await loadAppAccount())?.fid ? " --app-account" : ""} --pfp ${avatarFor(name)}`);
  }
}

async function proofArrives(name: string, fid: number, ms = 5 * 60_000): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    const proof = await get<{ fid: number }>("/v1/userNameProofByName", { name }).catch(() => undefined);
    if (proof?.fid === fid) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 5000));
  }
}

// ------------------------------------------------------- from the me page

// What the me page needs before it asks for a seed phrase: whether the name
// can be had, the address that must sign for it, and a timestamp to sign.
export async function renameCheck(name: string, fid: number) {
  const n = name.trim().toLowerCase().replace(/^@/, "");
  const { status, current } = await nameStatus(n, fid, true);
  return { name: n, status, current: current ?? null, custody: await currentCustody(fid), timestamp: Math.floor(Date.now() / 1000) };
}

// Change the username with transfers the browser signed with the custody key
// (phrase-browser.ts), so the seed phrase never reaches this server. Then the
// app key (by) sets USERNAME, as fameboy username does.
export async function renameSigned(by: Author, b: { name?: unknown; release?: unknown; claim?: unknown }) {
  const name = String(b.name ?? "");
  const { status, current } = await nameStatus(name, by.fid, true);
  const owner = await currentCustody(by.fid);
  const valid = (t: unknown, n: string, from: number, to: number): t is SignedTransfer => {
    const x = t as Partial<SignedTransfer> | undefined;
    return !!x && x.name === n && x.from === from && x.to === to && String(x.owner).toLowerCase() === owner && Number.isInteger(x.timestamp) && /^0x[0-9a-f]{130}$/i.test(String(x.signature));
  };
  if (status === "replace") {
    if (!valid(b.release, current!, by.fid, 0)) throw new NodeError(`giving up @${current} needs a signature from your account's key`);
    await postTransfer(by.fid, b.release).catch((e) => {
      throw new NodeError(`${e instanceof Error ? e.message : e} Nothing was changed: you still have @${current}.`);
    });
  }
  if (status !== "already-yours") {
    if (!valid(b.claim, name, 0, by.fid)) throw new NodeError(`claiming @${name} needs a signature from your account's key`);
    await postTransfer(by.fid, b.claim).catch((e) => {
      throw new NodeError(`${e instanceof Error ? e.message : e}${status === "replace" ? ` @${current} was given up, so your profile keeps showing it until a new name is set. Try again later.` : ""}`);
    });
  }
  if (!(await proofArrives(name, by.fid)))
    throw new NodeError(`Farcaster gave you @${name}, but your node hasn't seen it after 5 minutes. Try again in a while: it will skip straight to setting it.`);
  const { bytes } = await build(by, makeUserDataAddData({ type: UserDataType.USERNAME, value: name }, { fid: by.fid, network: FarcasterNetwork.MAINNET }));
  if (!(await submitUntil(bytes, async () => (await profile(by.fid)).username === name)))
    throw new NodeError(`sent the new username, but your node doesn't show @${name} yet. Reload in a minute.`);
  // An @fameboy<color> name with no picture yet gets the keycap in its colour.
  if (colorOf(name) && !(await profile(by.fid)).pfp) await editProfile(by, { pfp: avatarFor(name) }).catch(() => {});
  return profile(by.fid);
}
