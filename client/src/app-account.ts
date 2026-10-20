// Setting up an app account: the account people see on their phone when they
// approve signing in ("@name wants to post on your behalf"). Used by
// clearcast app-account and the last step of clearcast new-account.

import { NodeError } from "./node.ts";
import { registerAppKey, type Custody } from "./keys.ts";
import { loadAppAccount, saveAppAccount } from "./signin.ts";
import { profile } from "./read.ts";
import { checkProfile, setProfile, type ProfileFields } from "./profile.ts";

export const DEFAULT_PFP = "https://eucalyptus-viminalis.github.io/create-fc/img/clearcast-avatar.png";
export const DEFAULT_BIO = "it's so clear to me now";

type Ask = (question: string) => Promise<string>;

// Save the app account, then offer to give it a display name, picture and bio
// so the approval screen looks like an app and not a bare number. `ask` is
// undefined when there's no terminal to ask in; then empty fields get the defaults.
export async function setUpAppAccount(custody: Custody, o: { sponsor: boolean; ask?: Ask; log: (s: string) => void }) {
  const { log } = o;
  const file = await saveAppAccount(custody, o.sponsor);
  const p = await profile(custody.fid);
  log(`App account: @${p.username ?? "?"}${p.display ? ` ("${p.display}")` : ""} (fid ${custody.fid}). Saved its custody key to ${file} (mode 600).`);

  // What people will see. Suggest a name and picture when they're missing.
  const suggestDisplay = p.username === "clearcast" ? "clearcast" : `clearcast (run by ${p.username?.replace(/-?clearcast-?/, "") || "you"})`;
  const want = async (label: string, current: string | undefined, suggestion: string): Promise<string | undefined> => {
    if (!o.ask) return current ? undefined : suggestion;
    const answer = (await o.ask(`${label} [${current ?? suggestion}]: `)).trim();
    const value = answer || current || suggestion;
    return value === current ? undefined : value;
  };
  log("\nThis is what people see when they approve signing in. Press Enter to keep the value in brackets.");
  const fields: ProfileFields = {
    display: await want("display name", p.display, suggestDisplay),
    pfp: await want("picture URL", p.pfp, DEFAULT_PFP),
    bio: await want("bio", p.bio, DEFAULT_BIO),
  };
  checkProfile(fields);
  if (!fields.display && !fields.pfp && !fields.bio) log("profile unchanged.");
  else {
    // The app account needs its own app key to sign profile changes. Keep it
    // with the app account, not as this computer's sign-in key.
    let key = (await loadAppAccount())?.appKey;
    if (!key) {
      log("registering an app key for the app account, to set its profile");
      key = await registerAppKey(custody, { save: false, log });
      if (!key) throw new NodeError("couldn't register an app key for the app account");
      await saveAppAccount(custody, o.sponsor, key);
    }
    await setProfile(key, fields, log);
  }

  if (!/clearcast/i.test(`${p.username ?? ""} ${fields.display ?? p.display ?? ""}`))
    log(`
\x1b[1mHeads up: this account's name doesn't mention clearcast.\x1b[0m People signing in will see
"@${p.username ?? custody.fid} wants to post on your behalf". Consider a username like
yourname-clearcast: clearcast username yourname-clearcast (asks for this account's phrase).`);
  if (!p.username) log("It has no username yet, so the approval screen shows its number. Claim one with clearcast username <name>.");
}
