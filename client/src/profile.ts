// Display name, profile picture and bio. Each is a USER_DATA_ADD message
// signed by an app key that has that scope (gasless keys from this client do,
// and onchain keys can sign anything). The picture is a URL: Farcaster stores
// the link, not the image.

import { FarcasterNetwork, Message as MessageProto, UserDataType, makeUserDataAdd, makeUserDataAddData } from "@farcaster/core";
import { appSigner, type AppKey, type Author } from "./keys.ts";
import { NodeError, submitUntil } from "./node.ts";
import { profile } from "./read.ts";
import { build } from "./write.ts";

export type ProfileFields = { display?: string; pfp?: string; bio?: string };

const FIELDS = {
  display: { type: UserDataType.DISPLAY, max: 32, what: "display name" },
  pfp: { type: UserDataType.PFP, max: 256, what: "picture URL" },
  bio: { type: UserDataType.BIO, max: 256, what: "bio" },
} as const;

export function checkProfile(fields: ProfileFields) {
  for (const [k, v] of Object.entries(fields) as [keyof ProfileFields, string | undefined][]) {
    if (v === undefined) continue;
    const bytes = new TextEncoder().encode(v).length;
    if (bytes > FIELDS[k].max) throw new NodeError(`that ${FIELDS[k].what} is ${bytes} bytes; the most is ${FIELDS[k].max}`);
    if (k === "pfp" && v && !/^https:\/\/\S+$/.test(v)) throw new NodeError("the picture must be an https:// URL to an image");
  }
}

export async function setProfile(key: AppKey, fields: ProfileFields, log: (s: string) => void) {
  checkProfile(fields);
  if (!key.scopes.includes("USER_DATA_ADD") && !key.scopes.includes("ALL"))
    throw new NodeError("this app key can't edit profiles. Sign in again (fameboy login) for a key that can.");
  const current = await profile(key.fid);
  for (const [k, value] of Object.entries(fields) as [keyof ProfileFields, string | undefined][]) {
    if (value === undefined || current[k] === value) continue;
    const msg = await makeUserDataAdd({ type: FIELDS[k].type, value }, { fid: key.fid, network: FarcasterNetwork.MAINNET }, appSigner(key));
    if (msg.isErr()) throw new NodeError(`couldn't build the ${FIELDS[k].what} update: ${msg.error.message}`);
    const ok = await submitUntil(MessageProto.encode(msg.value).finish(), async () => (await profile(key.fid))[k] === value);
    log(ok ? `${FIELDS[k].what} set` : `sent the ${FIELDS[k].what}, but your node doesn't show it yet`);
  }
}

// The same, signed by any Author: the key file here, or a hosted fameboy's
// browser (remote-sign.ts). Used by the me page. An empty value clears the field.
export async function editProfile(by: Author, fields: ProfileFields) {
  checkProfile(fields);
  const current = await profile(by.fid);
  const changed: (keyof ProfileFields)[] = [];
  for (const [k, value] of Object.entries(fields) as [keyof ProfileFields, string | undefined][]) {
    if (value === undefined || (current[k] ?? "") === value) continue;
    const { bytes } = await build(by, makeUserDataAddData({ type: FIELDS[k].type, value }, { fid: by.fid, network: FarcasterNetwork.MAINNET }));
    const landed = await submitUntil(bytes, async () => ((await profile(by.fid))[k] ?? "") === value).catch((e) => {
      // A key approved without USER_DATA_ADD (older fameboy logins) is refused here.
      if (/scope|not authorized|invalid signer/i.test(String(e))) throw new NodeError("this app key can't edit your profile. Sign out, then sign in again for one that can.");
      throw e;
    });
    if (!landed) throw new NodeError(`sent the new ${FIELDS[k].what}, but your node doesn't show it yet. Reload in a minute.`);
    changed.push(k);
  }
  return { changed, profile: await profile(by.fid) };
}
