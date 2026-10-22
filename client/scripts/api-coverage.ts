// Which of the node's HTTP routes does fameboy use, and which not yet?
//
//   pnpm coverage            the table
//   pnpm coverage --upstream also fetch Snapchain's route list for the
//                            node's version and flag routes missing here
//   pnpm coverage --json     machine-readable
//
// "Used" means a "/v1/<route>" string appears in client/src or client/ui.
// The catalogue below is Snapchain v0.14.3's src/network/http_server.rs.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

type Route = { route: string; area: string; idea: string; skip?: string };

const ROUTES: Route[] = [
  { route: "info", area: "node", idea: "Sync status, shard heights" },
  { route: "fids", area: "network", idea: "Network-wide account count" },
  { route: "currentPeers", area: "network", idea: "Who your node is peered with, on the node tab" },
  { route: "events", area: "live", idea: "A feed that updates itself instead of refetching" },
  { route: "eventById", area: "live", idea: "Jump to one event from the live stream" },

  { route: "castById", area: "casts", idea: "Open one cast" },
  { route: "castsByFid", area: "casts", idea: "A user's casts" },
  { route: "castsByMention", area: "notifications", idea: "Mentions inbox" },
  { route: "castsByParent", area: "threads", idea: "Replies under a cast; channel feeds by parent URL" },

  { route: "reactionById", area: "reactions", idea: "Has this account liked/recast that cast" },
  { route: "reactionsByFid", area: "reactions", idea: "A user's likes" },
  { route: "reactionsByCast", area: "reactions", idea: "Who liked or recast a cast" },
  { route: "reactionsByTarget", area: "notifications", idea: "Likes and recasts of your casts" },

  { route: "linkById", area: "follows", idea: "Does A follow B" },
  { route: "linksByFid", area: "follows", idea: "Who someone follows" },
  { route: "linksByTargetFid", area: "notifications", idea: "Followers; new-follower inbox" },

  { route: "userDataByFid", area: "profiles", idea: "Name, bio, avatar" },
  { route: "userNameProofByName", area: "profiles", idea: "Username to fid" },
  { route: "userNameProofsByFid", area: "profiles", idea: "All of a user's names (fname, ENS)" },
  { route: "verificationsByFid", area: "profiles", idea: "Verified ETH and Solana addresses" },
  { route: "fidAddressType", area: "profiles", idea: "Is an address custody, auth or verified" },
  { route: "storageLimitsByFid", area: "accounts", idea: "Storage units and usage" },

  { route: "signer", area: "keys", idea: "Is this key active for this fid" },
  { route: "signersByFid", area: "keys", idea: "Every app key, and which app added it" },
  { route: "onChainSignersByFid", area: "keys", idea: "", skip: "deprecated; signersByFid replaces it" },
  { route: "onChainEventsByFid", area: "keys", idea: "Custody and key events" },
  { route: "onChainIdRegistryEventByAddress", area: "keys", idea: "Address to fid at login" },

  { route: "validateMessage", area: "writes", idea: "Check a message before sending" },
  { route: "submitMessage", area: "writes", idea: "Send one message" },
  { route: "submitBulkMessages", area: "writes", idea: "Several writes in one request (bulk follow)" },

  { route: "channelOwner", area: "channels", idea: "Channel owner" },
  { route: "channelsByAddress", area: "channels", idea: "Channels an address owns" },
  { route: "channelsByFid", area: "channels", idea: "Channels someone owns" },
  { route: "channelMember", area: "channels", idea: "Is someone a member" },
  { route: "channelMembers", area: "channels", idea: "Member list" },
  { route: "channelPin", area: "channels", idea: "Pinned cast" },
  { route: "channelModerations", area: "channels", idea: "Hidden casts and bans" },
  { route: "channelMetadata", area: "channels", idea: "Name, description, image" },
  { route: "channelMembershipsByFid", area: "channels", idea: "Channels someone belongs to" },
  { route: "channelFollowers", area: "channels", idea: "Channel followers" },
  { route: "channelFollowerCount", area: "channels", idea: "Follower count" },
  { route: "channelFollows", area: "channels", idea: "Channels someone follows" },
  { route: "isFollowingChannel", area: "channels", idea: "Follow button state" },

  { route: "mesh", area: "admin", idea: "", skip: "admin view of the node's mesh, not for clients" },
  { route: "mesh/ui", area: "admin", idea: "", skip: "admin view of the node's mesh, not for clients" },
];

const root = join(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "mockups" || e.name === "node_modules") return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.(ts|js|html)$/.test(e.name) ? [p] : [];
  });
}

// route -> "file:line" of each use
const uses = new Map<string, string[]>();
for (const f of [...files(join(root, "src")), ...files(join(root, "ui"))]) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/["'`]\/v1\/([A-Za-z/]+?)["'`?]/g)) {
      const at = `${relative(root, f)}:${i + 1}`;
      uses.set(m[1], [...(uses.get(m[1]) ?? []), at]);
    }
  });
}

const used = ROUTES.filter((r) => !r.skip && uses.has(r.route));
const todo = ROUTES.filter((r) => !r.skip && !uses.has(r.route));
const skipped = ROUTES.filter((r) => r.skip);
const unknown = [...uses.keys()].filter((u) => !ROUTES.some((r) => r.route === u));

let upstreamMissing: string[] = [];
if (args.has("--upstream")) {
  const { NODE } = await import("../src/node.ts");
  let version = "v0.14.3";
  try {
    const info = (await (await fetch(`${NODE}/v1/info`)).json()) as { version?: string };
    if (info.version) version = `v${info.version.replace(/^v/, "")}`;
  } catch {}
  const src = await (await fetch(`https://raw.githubusercontent.com/farcasterxyz/snapchain/${version}/src/network/http_server.rs`)).text();
  const live = new Set([...src.matchAll(/"\/v1\/([A-Za-z/]+)"/g)].map((m) => m[1]));
  upstreamMissing = [...live].filter((r) => !ROUTES.some((x) => x.route === r));
  console.error(`Checked against Snapchain ${version}: ${live.size} routes upstream.`);
}

if (args.has("--json")) {
  console.log(JSON.stringify({ used: used.map((r) => ({ ...r, at: uses.get(r.route) })), todo, skipped, unknown, upstreamMissing }, null, 2));
  process.exit(0);
}

const total = used.length + todo.length;
const pct = Math.round((used.length / total) * 100);
const bar = "█".repeat(Math.round(pct / 5)).padEnd(20, "░");
console.log(`\nSnapchain HTTP API coverage  ${bar}  ${used.length}/${total} routes (${pct}%)\n`);

const byArea = (list: Route[]) => {
  const out: Record<string, Route[]> = {};
  for (const r of list) (out[r.area] ??= []).push(r);
  return out;
};
console.log("Not used yet");
for (const [area, list] of Object.entries(byArea(todo))) {
  console.log(`  ${area}`);
  for (const r of list) console.log(`    ✗ ${r.route.padEnd(34)} ${r.idea}`);
}
console.log("\nUsed");
for (const r of used) console.log(`    ✓ ${r.route.padEnd(34)} ${uses.get(r.route)![0]}${uses.get(r.route)!.length > 1 ? ` +${uses.get(r.route)!.length - 1}` : ""}`);
console.log("\nLeft out on purpose");
for (const r of skipped) console.log(`    – ${r.route.padEnd(34)} ${r.skip}`);
if (unknown.length) console.log(`\nCalled but not in the catalogue (typo, or a new route?): ${unknown.join(", ")}`);
if (upstreamMissing.length) console.log(`\nNew upstream routes to add to the catalogue: ${upstreamMissing.join(", ")}`);
console.log("\nThe gRPC API (port 3383) also has a streaming Subscribe; not counted here.\n");
