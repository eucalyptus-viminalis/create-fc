// The profile page (src/profile-view.ts, /profile/<username>): follow counts,
// casts from the last 30 days with the app that posted each, and, signed in,
// how they relate to you. A fake node stands in for Snapchain.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const FARCASTER_EPOCH = 1609459200;
const now = Math.floor(Date.now() / 1000) - FARCASTER_EPOCH;
const day = 86_400;

// juno (fid 10) is followed by 20, 21 and 22, and follows 20. The viewer
// (fid 1) follows 20 and 21. juno cast twice this month (one through app 99,
// one through a key the node doesn't know) and once 40 days ago.
const link = (fid: number, target: number) => ({ data: { fid, timestamp: now, linkBody: { type: "follow", targetFid: target } }, hash: "0x", signer: "0x" });
const castMsg = (hash: string, signer: string, ago: number) => ({ hash, signer, data: { fid: 10, timestamp: now - ago, castAddBody: { text: "hi", embeds: [], mentions: [], mentionsPositions: [] } } });
const FOLLOWS: [number, number][] = [[20, 10], [21, 10], [22, 10], [10, 20], [1, 20], [1, 21]];
const ROUTES: Record<string, (q: URLSearchParams) => unknown> = {
  "/v1/userDataByFid": (q) => ({ messages: q.get("fid") === "10" ? [{ data: { userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: "juno" } } }] : [] }),
  "/v1/linksByTargetFid": (q) => ({ messages: FOLLOWS.filter(([, t]) => t === Number(q.get("target_fid"))).map(([f, t]) => link(f, t)) }),
  "/v1/linksByFid": (q) => ({ messages: FOLLOWS.filter(([f]) => f === Number(q.get("fid"))).map(([f, t]) => link(f, t)) }),
  "/v1/linkById": (q) => (FOLLOWS.some(([f, t]) => f === Number(q.get("fid")) && t === Number(q.get("target_fid"))) ? link(0, 0) : undefined),
  "/v1/castsByFid": () => ({ messages: [castMsg("0xa", "0xk1", day), castMsg("0xb", "0xk2", 2 * day), castMsg("0xc", "0xk1", 40 * day)] }),
  "/v1/signersByFid": () => ({ signers: [{ key: "0xk1", requestFid: 99 }] }),
  "/v1/userNameProofByName": (q) => (q.get("name") === "juno" ? { fid: 10 } : undefined),
};

let node: Server;
let view: typeof import("../src/profile-view.ts");
let read: typeof import("../src/read.ts");

before(async () => {
  node = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const body = ROUTES[url.pathname]?.(url.searchParams);
    res.writeHead(body ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(body ?? { error: "not found" }));
  });
  await new Promise<void>((r) => node.listen(0, "127.0.0.1", r));
  process.env.FC_NODE = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  view = await import("../src/profile-view.ts");
  read = await import("../src/read.ts");
});

after(async () => {
  node?.closeAllConnections();
  await new Promise((r) => node?.close(r) ?? r(undefined));
});

test("a signed-in viewer sees follows-you, casts this month and their apps", async () => {
  const v = await view.profileView(10, 1, read.profile);
  assert.equal(v.profile.username, "juno");
  assert.equal(v.followsYou, false);
  assert.equal(v.youFollow, false);
  assert.equal(v.self, false);
  assert.equal(v.casts.length, 2, "only the last 30 days");
  assert.deepEqual(v.apps.map((a) => [a.fid, a.count]), [[99, 1], [null, 1]]);
});

test("follow counts, and people you follow who follow them", async () => {
  const f = await view.followView(10, 1, read.profile);
  assert.deepEqual(f.followers, { count: 3, more: false });
  assert.deepEqual(f.following, { count: 1, more: false });
  assert.equal(f.common.count, 2); // 20 and 21: the viewer follows both, both follow juno
});

test("signed out, nothing depends on who's looking", async () => {
  const v = await view.profileView(10, undefined, read.profile);
  const f = await view.followView(10, undefined, read.profile);
  assert.equal(v.signedIn, false);
  assert.equal(f.common.count, 0);
  assert.equal(f.followers.count, 3);
});

test("your own profile says so", async () => {
  const v = await view.profileView(10, 10, read.profile);
  assert.equal(v.self, true);
  assert.equal(v.followsYou, false);
});
