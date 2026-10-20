// fc-node app-account: give this node an "app account", so people using it
// can sign in to clearcast by approving on their phone.
//
// Farcaster's signer-request service only shows a sign-in request if a
// Farcaster account vouches for it, by signing it with its custody key. This
// saves that account's custody key on this server, for fc-companion to sign
// with. The seed phrase itself is only held in memory while this runs.
//
// Use an account made for this, never your main one: whoever gets into this
// server controls the app account. It can't touch the accounts that sign in;
// they still approve every key on their own phone.
//
// Runs inside the fc-companion image (it needs viem):
//   fc-node app-account          set it up (asks for the seed phrase)
//   fc-node app-account show     which account is set up
//   fc-node app-account remove   stop phone sign-in on this node

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { mnemonicToAccount } from "viem/accounts";
import { bytesToHex } from "viem";

const SNAPCHAIN = (process.env.SNAPCHAIN ?? "http://127.0.0.1:3381").replace(/\/$/, "");
const OUT = process.env.APP_ACCOUNT_FILE ?? "/state/app-account.json";
const MAX_INDEX = 10;

async function get(path, params, timeoutMs = 120_000) {
  const url = new URL(SNAPCHAIN + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const body = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${path}: ${res.status} ${body.slice(0, 200)}`), { status: res.status, body });
  return JSON.parse(body);
}

// Which fid an address holds right now, asked of this node (no Ethereum RPC).
async function fidOf(address) {
  let fid;
  try {
    fid = (await get("/v1/onChainIdRegistryEventByAddress", { address })).fid;
  } catch (e) {
    if (/NotFound|no id-registry event/i.test(String(e.body ?? e.message))) return undefined;
    throw e;
  }
  if (!fid) return undefined;
  const { events } = await get("/v1/onChainEventsByFid", { fid, event_type: "EVENT_TYPE_ID_REGISTER" });
  const owner = events.filter((e) => e.idRegisterEventBody && e.idRegisterEventBody.eventType !== "ChangeRecovery").sort((a, b) => a.blockNumber - b.blockNumber).at(-1);
  return owner?.idRegisterEventBody.to.toLowerCase() === address.toLowerCase() ? fid : undefined;
}

// Read a line without echoing it.
function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) return reject(new Error("run this in an interactive terminal: fc-node app-account"));
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    let s = "";
    const done = (v) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", on);
      process.stdout.write("\n");
      v === null ? reject(new Error("cancelled")) : resolve(v);
    };
    const on = (buf) => {
      for (const c of buf.toString("utf8")) {
        if (c === "\r" || c === "\n") return done(s);
        if (c === "\u0003") return done(null); // Ctrl-C
        if (c === "\u007f") s = s.slice(0, -1);
        else s += c;
      }
    };
    process.stdin.on("data", on);
  });
}

const cmd = process.argv[2] ?? "set";

if (cmd === "show") {
  if (!existsSync(OUT)) console.log("No app account. Phone sign-in is off on this node.");
  else {
    const a = JSON.parse(readFileSync(OUT, "utf8"));
    console.log(`App account: fid ${a.fid} (${a.address}). Phone sign-in is on.`);
  }
  process.exit(0);
}
if (cmd === "remove") {
  if (existsSync(OUT)) {
    unlinkSync(OUT);
    console.log("Removed. Phone sign-in is off on this node.");
  } else console.log("No app account was set up.");
  process.exit(0);
}

console.log(`This saves an account's custody key on this server.
People on this node then sign in by approving on their phone.
Use an account made for this. Never your main one.
`);
const phrase = (await askHidden("Seed phrase (hidden): ")).trim().toLowerCase().split(/\s+/).join(" ");
const words = phrase.split(" ").length;
if (![12, 15, 18, 21, 24].includes(words)) throw new Error(`that's ${words} words; a seed phrase has 12 or 24`);

console.log("Looking for the account on this node. This can take a minute.");
let found;
for (let i = 0; i < MAX_INDEX && !found; i++) {
  const account = mnemonicToAccount(phrase, { addressIndex: i });
  const fid = await fidOf(account.address);
  console.log(`  m/44'/60'/0'/0/${i}  ${account.address}  ${fid ? `fid ${fid}` : "no account"}`);
  if (fid) found = { fid, account };
}
if (!found) throw new Error(`none of the first ${MAX_INDEX} addresses owns a Farcaster account`);

const privateKey = found.account.getHdKey().privateKey;
writeFileSync(OUT, JSON.stringify({ fid: found.fid, address: found.account.address, privateKey: bytesToHex(privateKey), savedAt: new Date().toISOString() }, null, 2) + "\n", { mode: 0o600 });
console.log(`
Done. fid ${found.fid} now vouches for sign-ins on this node.
People see this account's name when they approve.
Give friends an invite code: fc-node invite`);
