#!/usr/bin/env node
// clearcast: a minimal Farcaster client for your own Snapchain node.
import { parseArgs } from "node:util";
import { NODE, NodeError, get, toDate, type Message } from "./node.ts";
import { castsByFid, feed, profile, resolveFid, usernames } from "./read.ts";
import { cast, deleteCast, follow, react, resolveCast } from "./write.ts";
import { setUsername } from "./username.ts";
import { startUi } from "./ui-server.ts";
import { setUpAppAccount } from "./app-account.ts";
import { setProfile } from "./profile.ts";
import { createInterface } from "node:readline/promises";
import { newAccount } from "./new-account.ts";
import { appNames, appsOfUser, filterByApp, resolveApps } from "./filter.ts";
import { KEY_FILE, checkPhrase, findCustody, forgetKey, loadKey, normalizePhrase, promptPhrase, registerAppKey, revokeKey } from "./keys.ts";

const HELP = `clearcast: a Farcaster client that talks only to your own node (${NODE})

Usage:
  clearcast ui [--port 4747]           Open the client in your browser
  clearcast serve --origin https://<host> [--port 4748]
                                       Host clearcast for other people (ADR 003): their
                                       keys stay in their browsers. Listens on 127.0.0.1;
                                       put a proxy like Caddy in front for https
  clearcast status                     Is the node in sync?
  clearcast new-account [--recovery 0x..] [--dry-run]
                                       Register a new Farcaster account (~$0.20 of ETH
                                       on Optimism), for you or as the app account
  clearcast login [--dry-run]          Import a seed phrase once, register an app key
  clearcast whoami                     Show the saved app key and its status
  clearcast logout                     Sign out: delete the app key from this computer
  clearcast revoke [--dry-run]         Revoke this computer's app key on Farcaster, then
                                       sign out. The key signs its own removal: no seed phrase
  clearcast app-account [--sponsor]    Set up the account that lets people sign in to
                                       clearcast ui by approving in the Farcaster app
  clearcast profile [--display "Name"] [--pfp https://…] [--bio "…"]
                                       Show or change your display name, picture and bio
  clearcast username <name> [--dry-run]  Claim an fname and set it as your username
                                       (asks for the seed phrase, like login)
  clearcast cast "<text>" [--reply user/hash] [--embed url] [--dry-run]
                                       Post a cast. @names become mentions.
  clearcast delete <hash>              Delete one of your casts
  clearcast follow | unfollow <name>   Follow or unfollow someone
  clearcast like | unlike <user/hash>  Like a cast, e.g. clearcast like dwr/0x35c7b588
  clearcast recast | unrecast <user/hash>
  clearcast user <name|fid>            Show a profile
  clearcast casts <name|fid> [-n 20]   A user's latest casts
  clearcast feed [-n 30]               Your feed: latest casts from everyone you follow
  clearcast apps <name|fid>            Which apps hold keys for this account

Options:
  -n, --limit <n>    How many casts to show
  -r, --replies      Include replies (hidden by default)
  --app <name|fid>   (casts, feed) Only casts posted through this app. Repeatable.
  --not-app <name|fid>  (casts, feed) Hide casts posted through this app. Repeatable.
  --json             Print raw messages as JSON
  --dry-run          (login) Build and check the KEY_ADD, but don't send it
  --sponsor          (app-account) Pay the onchain fee for people who sign in

Set FC_NODE to your node's HTTP address, e.g. FC_NODE=http://203.0.113.7:3381
`;

type Info = { version: string; shardInfos: { shardId: number; maxHeight: number; blockDelay: number }[] };

function ago(d: Date): string {
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 0) return "in the future"; // the network tolerates a little clock skew
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

async function show(casts: Message[], apps: Map<string, number | undefined>) {
  const parents = casts.flatMap((m) => (m.data.castAddBody?.parentCastId ? [m.data.castAddBody.parentCastId.fid] : []));
  const [names, appName] = await Promise.all([usernames([...casts.map((m) => m.data.fid), ...parents]), appNames([...apps.values()])]);
  for (const m of casts) {
    const b = m.data.castAddBody!;
    const app = apps.get(m.hash);
    const via = app === undefined ? "via ?" : `via @${appName.get(app)}`;
    const head = `@${names.get(m.data.fid)} · ${ago(toDate(m.data.timestamp))} · ${via}${b.parentCastId ? ` · reply to @${names.get(b.parentCastId.fid) ?? b.parentCastId.fid}` : ""}`;
    const embeds = b.embeds.map((e) => ("url" in e ? e.url : `cast ${e.castId.hash.slice(0, 10)}`));
    console.log(`\x1b[1m${head}\x1b[0m  \x1b[2m${m.hash.slice(0, 10)}\x1b[0m`);
    if (b.text) console.log(b.text);
    for (const e of embeds) console.log(`  ↳ ${e}`);
    console.log();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      limit: { type: "string", short: "n" },
      replies: { type: "boolean", short: "r" },
      json: { type: "boolean" },
      "dry-run": { type: "boolean" },
      reply: { type: "string" },
      embed: { type: "string", multiple: true },
      app: { type: "string", multiple: true },
      "not-app": { type: "string", multiple: true },
      help: { type: "boolean", short: "h" },
      port: { type: "string" },
      origin: { type: "string" },
      sponsor: { type: "boolean" },
      recovery: { type: "string" },
      display: { type: "string" },
      pfp: { type: "string" },
      bio: { type: "string" },
    },
  });
  const [cmd, arg] = positionals;
  const limit = values.limit ? Number(values.limit) : undefined;
  const need = () => {
    if (!arg) throw new NodeError(`clearcast ${cmd} needs a username or fid`);
    return resolveFid(arg);
  };

  switch (cmd) {
    case "status": {
      const info = await get<Info>("/v1/info");
      const worst = Math.max(...info.shardInfos.map((s) => s.blockDelay));
      console.log(`node ${NODE} · snapchain ${info.version}`);
      for (const s of [...info.shardInfos].sort((a, b) => a.shardId - b.shardId))
        console.log(`  shard ${s.shardId}  height ${s.maxHeight}  ${s.blockDelay}s behind`);
      console.log(worst < 10 ? "in sync" : `catching up: ${(worst / 3600).toFixed(1)}h behind. Reads work now, but recent casts may be missing.`);
      break;
    }
    case "ui": {
      const url = await startUi(Number(values.port ?? 4747), values.port !== undefined);
      console.log(`clearcast is running at ${url}  (your node: ${NODE})`);
      console.log("It only listens on this computer. Ctrl-C to stop.");
      const { spawn } = await import("node:child_process");
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
      spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
      return new Promise<void>(() => {}); // run until Ctrl-C
    }
    case "serve": {
      if (!values.origin || !/^https?:\/\/[^/]+\/?$/.test(values.origin)) throw new NodeError("clearcast serve needs --origin, the address people open, e.g. --origin https://clearcast.example.com");
      const url = await startUi(Number(values.port ?? 4748), values.port !== undefined, { hosted: true, origin: values.origin });
      console.log(`hosted clearcast is listening on 127.0.0.1 for ${url}  (node: ${NODE})`);
      console.log("Each person signs in with their phone; keys stay in their browsers. Ctrl-C to stop.");
      return new Promise<void>(() => {});
    }
    case "login":
      return login(Boolean(values["dry-run"]));
    case "username": {
      if (!arg) throw new NodeError("clearcast username needs a name: clearcast username alice");
      console.error(WARNING);
      const phrase = normalizePhrase(await promptPhrase("seed phrase (hidden): "));
      checkPhrase(phrase);
      const custody = await findCustody(phrase, (line) => console.error(line));
      return setUsername(arg.replace(/^@/, "").toLowerCase(), custody, { dryRun: values["dry-run"], log: (l) => console.error(l) });
    }
    case "new-account":
      return newAccount({ dryRun: values["dry-run"], recovery: values.recovery });
    case "app-account": {
      console.error(APP_ACCOUNT_WARNING);
      const phrase = normalizePhrase(await promptPhrase("app account's seed phrase (hidden): "));
      checkPhrase(phrase);
      const custody = await findCustody(phrase, (line) => console.error(line));
      const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stderr }) : undefined;
      try {
        await setUpAppAccount(custody, { sponsor: Boolean(values.sponsor), ask: rl && ((q) => rl.question(q)), log: (l) => console.error(l) });
      } finally {
        rl?.close();
      }
      console.log(`\nclearcast ui now offers "Approve in the Farcaster app".${values.sponsor ? " Sign-ins are sponsored: the app account needs warps in the Farcaster app." : ""}`);
      break;
    }
    case "profile": {
      const key = await loadKey();
      const fields = { display: values.display, pfp: values.pfp, bio: values.bio };
      if (Object.values(fields).some((v) => v !== undefined)) await setProfile(key, fields, (l) => console.error(l));
      const p = await profile(key.fid);
      console.log(`@${p.username ?? "?"} (fid ${key.fid})\ndisplay  ${p.display ?? "-"}\npicture  ${p.pfp ?? "-"}\nbio      ${p.bio ?? "-"}`);
      break;
    }
    case "logout": {
      const key = await loadKey().catch(() => undefined);
      if (!(await forgetKey())) return console.log("Already signed out: no app key on this computer.");
      console.log(`Signed out${key ? ` of fid ${key.fid}` : ""}: deleted ${KEY_FILE}.`);
      console.log("The key stays registered on Farcaster until it expires, but nobody else has a copy.");
      console.log("To sign in again: clearcast login");
      break;
    }
    case "revoke": {
      const key = await loadKey();
      const r = await revokeKey(key, { dryRun: values["dry-run"], log: (l) => console.error(l) });
      if (values["dry-run"]) break;
      await forgetKey();
      console.log(`${r.state === "revoked" ? "Revoked" : "Nothing to revoke"}: fid ${key.fid}'s key ${key.publicKey.slice(0, 10)}…, and deleted ${KEY_FILE}.`);
      console.log("To sign in again: clearcast login");
      break;
    }
    case "whoami": {
      const key = await loadKey();
      const p = await profile(key.fid);
      console.log(`@${p.username ?? "?"} (fid ${key.fid})`);
      console.log(`app key   ${key.publicKey}`);
      console.log(`custody   ${key.custody} (${key.derivationPath})`);
      console.log(`scopes    ${key.scopes.join(", ")}`);
      try {
        const { signer } = await get<{ signer: { expiresAt?: number } }>("/v1/signer", { fid: key.fid, signer: key.publicKey });
        console.log(`status    active${signer.expiresAt ? `, expires ${new Date(signer.expiresAt * 1000).toISOString().slice(0, 10)} unless used` : ""}`);
      } catch {
        // A node that's still catching up hasn't seen recent keys yet.
        const info = await get<Info>("/v1/info").catch(() => undefined);
        const lag = info ? Math.max(...info.shardInfos.map((s) => s.blockDelay)) : 0;
        if (lag > 60) console.log(`status    not on your node yet: it's ${(lag / 3600).toFixed(1)} h behind, and this key may be newer than that. Check again once clearcast status says "in sync".`);
        else console.log("status    NOT FOUND on your node: it expired, was revoked, or never landed. Run: clearcast login");
      }
      break;
    }
    case "cast": {
      if (!arg) throw new NodeError('clearcast cast needs some text: clearcast cast "hello"');
      const replyTo = values.reply ? await resolveCast(values.reply) : undefined;
      const r = await cast(arg, { replyTo, embeds: values.embed, dryRun: values["dry-run"] });
      if (values["dry-run"]) {
        console.log(`dry run: valid cast ${r.hash.slice(0, 10)}, ${r.mentions.length} mention(s). Nothing was sent.`);
        break;
      }
      console.log(r.landed ? `posted ${r.hash}` : `sent ${r.hash}, but it hasn't shown up on your node after 60 s. If gossip dropped it, cast again.`);
      break;
    }
    case "delete": {
      if (!arg?.startsWith("0x")) throw new NodeError("clearcast delete needs the cast's hash (0x...)");
      const hash = arg.length === 42 ? (arg as `0x${string}`) : (await resolveCast(`${(await loadKey()).fid}/${arg}`)).hash;
      const r = await deleteCast(hash);
      console.log(r.landed ? `deleted ${hash}` : `sent the delete for ${hash}; the cast is still on your node after 60 s`);
      break;
    }
    case "follow":
    case "unfollow": {
      const target = await need();
      const r = await follow(target, cmd === "follow");
      console.log(r.landed ? `${cmd}ed fid ${target}` : `sent ${cmd} for fid ${target}; not visible on your node yet`);
      break;
    }
    case "like":
    case "unlike":
    case "recast":
    case "unrecast": {
      if (!arg) throw new NodeError(`clearcast ${cmd} needs a cast: user/hash`);
      const target = await resolveCast(arg);
      const r = await react(cmd.endsWith("like") ? "like" : "recast", target, !cmd.startsWith("un"));
      const done = { like: "liked", unlike: "unliked", recast: "recasted", unrecast: "unrecasted" }[cmd];
      console.log(r.landed ? `${done} ${arg}` : `sent ${cmd} for ${arg}; not visible on your node yet`);
      break;
    }
    case "user": {
      const p = await profile(await need());
      if (values.json) return console.log(JSON.stringify(p, null, 2));
      console.log(`@${p.username ?? "?"}  ${p.display ?? ""}  (fid ${p.fid})`);
      if (p.bio) console.log(p.bio);
      if (p.pfp) console.log(p.pfp);
      break;
    }
    case "casts": {
      const filter = { include: await resolveApps(values.app), exclude: await resolveApps(values["not-app"]) };
      const filtering = Boolean(filter.include || filter.exclude);
      const all = await castsByFid(await need(), filtering ? 300 : (limit ?? 20), { replies: values.replies });
      const { kept, apps } = await filterByApp(all, filter);
      const casts = kept.slice(0, limit ?? 20);
      if (values.json) return console.log(JSON.stringify(casts, null, 2));
      await show(casts, apps);
      if (filtering) console.log(`\x1b[2m${casts.length} shown; ${all.length - kept.length} of the last ${all.length} casts filtered out by app\x1b[0m`);
      break;
    }
    case "feed": {
      if (arg && arg !== "me") throw new NodeError(`clearcast feed shows your own feed. For someone else's casts: clearcast casts ${arg}`);
      const fid = (await loadKey()).fid;
      const filter = { include: await resolveApps(values.app), exclude: await resolveApps(values["not-app"]) };
      const filtering = Boolean(filter.include || filter.exclude);
      const { following, casts: all } = await feed(fid, { limit: Infinity, perUser: filtering ? 20 : 5, replies: values.replies });
      const { kept, apps } = await filterByApp(all, filter);
      const casts = kept.slice(0, limit ?? 30);
      if (values.json) return console.log(JSON.stringify(casts, null, 2));
      await show(casts, apps);
      console.log(`\x1b[2m${casts.length} casts from the ${following} accounts you follow${filtering ? `; ${all.length - kept.length} of ${all.length} filtered out by app` : ""}\x1b[0m`);
      break;
    }
    case "apps": {
      const fid = await need();
      const counts = await appsOfUser(fid);
      const names = await appNames([...counts.keys()]);
      const rows = [...counts].sort((a, b) => b[1] - a[1]);
      for (const [app, n] of rows) console.log(`${String(n).padStart(4)} key${n === 1 ? " " : "s"}  ${app === undefined ? "unknown app" : `@${names.get(app)} (fid ${app})`}`);
      break;
    }
    case undefined:
    case "help":
      console.log(HELP);
      break;
    default:
      console.log(HELP);
      if (cmd && !values.help) {
        // Show pasted invisible characters (non-breaking or zero-width
        // spaces), e.g. "username\u200b", which otherwise look identical.
        const shown = cmd.replace(/[^\x21-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
        console.error(`clearcast: unknown command "${shown}"${shown !== cmd ? " (it contains hidden characters; retype it instead of pasting)" : ""}`);
        process.exitCode = 1;
      }
  }
}

const WARNING = `
\x1b[1mThis command asks for a seed phrase. Read this first.\x1b[0m

A Farcaster seed phrase (the "recovery phrase") is the master key to an
account. Whoever has it can post as you, transfer your FID to themselves,
and take any funds held at the custody address. It's the rm -rf of this
tutorial: powerful, legitimate, and unforgiving.

  - Type it only in your own terminal, on your own computer. Never through
    an AI assistant's shell: its transcript keeps whatever this prints.
  - Only paste a seed phrase into software whose source you've read, or from
    developers you trust. That includes this one: see client/src/keys.ts.
  - Prefer signing in through an app that asks your wallet to approve a key
    (delegated signer authorization), so the phrase never leaves the wallet.

This client uses the phrase only in memory, to sign what this command needs
(a KEY_ADD, and for clearcast username, the name claim). It never stores, prints or
sends the phrase. Afterwards it posts with its own app key, which can't
transfer the account or add other keys.
`;

const APP_ACCOUNT_WARNING = `
\x1b[1mThis saves an account's custody key on this computer. Read this first.\x1b[0m

To let people sign in by approving in the Farcaster app, clearcast needs an
"app account": a Farcaster account that vouches for every key it asks people
to approve. Its custody key signs each request, so it's saved here
(mode 600). Anyone who copies that file controls the app account.

  - Use an account made for this, never your personal one.
    clearcast new-account makes one.
  - People who sign in see this account's name as the app asking for access,
    and their casts show "via" it. Without a username, setup suggests a free
    @<color>cast name, like @tealcast. Keep it or type your own.
    One shared @clearcast can't work: every clearcast would need its key.
`;

async function login(dryRun: boolean) {
  console.error(WARNING);
  const phrase = normalizePhrase(await promptPhrase("seed phrase (hidden): "));
  checkPhrase(phrase);

  console.error("\nlooking for the custody address on your node:");
  const custody = await findCustody(phrase, (line) => console.error(line));
  const p = await profile(custody.fid);
  console.error(`\nfound @${p.username ?? "?"} (fid ${custody.fid}) at ${custody.path}`);

  await registerAppKey(custody, { dryRun, log: (line) => console.error(line) });
}

main().catch((e) => {
  console.error(e instanceof NodeError ? `clearcast: ${e.message}` : e);
  process.exitCode = 1;
});
