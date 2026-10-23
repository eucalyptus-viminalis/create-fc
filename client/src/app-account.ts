// Setting up an app account: the account people see on their phone when they
// approve signing in ("@name wants to post on your behalf"). Used by
// fameboy app-account and the last step of fameboy new-account.

import { NodeError } from "./node.ts";
import { registerAppKey, type Custody } from "./keys.ts";
import { loadAppAccount, saveAppAccount } from "./signin.ts";
import { profile } from "./read.ts";
import { checkProfile, setProfile, type ProfileFields } from "./profile.ts";
import { setUsername } from "./username.ts";
import { avatarFor, colorOf, nameHolder, pickFameboyName } from "../../node/fameboy-name.mjs";

export const DEFAULT_PFP = avatarFor(undefined); // the clear keycap; @fameboy<color> names get their colour (avatarFor)
export const DEFAULT_BIO = "a pocket Farcaster, on its own node";

type Ask = (question: string) => Promise<string>;

// Save the app account, then offer to give it a display name, picture and bio
// so the approval screen looks like an app and not a bare number. `ask` is
// undefined when there's no terminal to ask in; then empty fields get the defaults.
export async function setUpAppAccount(custody: Custody, o: { sponsor: boolean; ask?: Ask; log: (s: string) => void }) {
  const { log } = o;
  const file = await saveAppAccount(custody, o.sponsor);
  const p = await profile(custody.fid);
  log(`App account: @${p.username ?? "?"}${p.display ? ` ("${p.display}")` : ""} (fid ${custody.fid}). Saved its custody key to ${file} (mode 600).`);

  // No username yet: suggest @fameboy<color>, with a random color that's still free.
  if (!p.username) {
    const name = await chooseUsername(custody.fid, o);
    if (name) {
      try {
        await setUsername(name, custody, { log });
        p.username = name;
      } catch (e) {
        log(`couldn't set @${name}: ${e instanceof Error ? e.message : e}. Try again later: fameboy username ${name}`);
      }
    }
  }

  // What people will see. Suggest a name and picture when they're missing.
  // "fameboy teal" for @fameboyteal; plain "fameboy" for any other name.
  const c = colorOf(p.username);
  const suggestDisplay = c ? `fameboy ${c.color}` : "fameboy";
  const want = async (label: string, current: string | undefined, suggestion: string): Promise<string | undefined> => {
    if (!o.ask) return current ? undefined : suggestion;
    const answer = (await o.ask(`${label} [${current ?? suggestion}]: `)).trim();
    const value = answer || current || suggestion;
    return value === current ? undefined : value;
  };
  log("\nThis is what people see when they approve signing in. Press Enter to keep the value in brackets.");
  const fields: ProfileFields = {
    display: await want("display name", p.display, suggestDisplay),
    pfp: await want("picture URL", p.pfp, avatarFor(p.username)),
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

  if (!/fameboy/i.test(fields.display ?? p.display ?? ""))
    log(`
\x1b[1mHeads up: this account's display name doesn't mention fameboy.\x1b[0m People signing in will see
"@${p.username ?? custody.fid} wants to post on your behalf". A display name like "fameboy" tells them
which app is asking. Run fameboy app-account again to change it.`);
  if (!p.username) log("It has no username yet, so the approval screen shows its number. Claim one with fameboy username <name>.");
}

// Suggest @fameboy<color> and let the person keep it or type their own. Without a
// terminal, only print the suggestion. Returns the name to claim, or undefined.
async function chooseUsername(fid: number, o: { ask?: Ask; log: (s: string) => void }): Promise<string | undefined> {
  const { log } = o;
  log("\nThis account has no username yet. Picking a free @fameboy<color> name for it...");
  const suggestion = await pickFameboyName({ fid, log });
  if (!o.ask) {
    if (suggestion) log(`@${suggestion} is free. Claim it with: fameboy username ${suggestion}`);
    return undefined;
  }
  if (suggestion) log(`@${suggestion} is free.`);
  for (;;) {
    const answer = (await o.ask(suggestion ? `username [${suggestion}], or type your own (- to skip): ` : "username (- to skip): ")).trim().replace(/^@/, "").toLowerCase();
    if (answer === "-" || (!answer && !suggestion)) return undefined;
    if (!answer) return suggestion;
    try {
      if ((await nameHolder(answer, fid)) !== "taken") return answer;
      log(`@${answer} is taken. Try another.`);
    } catch (e) {
      log(e instanceof Error ? e.message : String(e));
    }
  }
}
