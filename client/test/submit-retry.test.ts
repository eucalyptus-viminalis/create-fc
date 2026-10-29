// submitUntil against a node behind a proxy that fails for a moment, the way
// haatz.quilibrium.com's Cloudflare answered a 502 page on 2026-10-29.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

const CLOUDFLARE_502 = `<!DOCTYPE html><html><head><title>quilibrium.com | 502: Bad gateway</title></head><body><h1>Bad gateway</h1></body></html>`;

// A fake node that answers each request with the next queued reply, then 200.
const replies: [number, string][] = [];
let posts = 0;
const server = createServer((req, res) => {
  req.resume().on("end", () => {
    const [status, body] = replies.shift() ?? [200, "{}"];
    posts++;
    res.writeHead(status).end(body);
  });
});
await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
process.env.FC_NODE = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const { submitUntil, post, NodeUnavailable } = await import("../src/node.ts");
after(() => server.close());

test("a gateway error page becomes one readable line", async () => {
  replies.push([502, CLOUDFLARE_502]);
  await assert.rejects(post("/v1/submitMessage", new Uint8Array([1])), (e: Error) => {
    assert.ok(e instanceof NodeUnavailable);
    assert.equal(e.message, "the node didn't answer: 502 (quilibrium.com | 502: Bad gateway). Try again in a minute.");
    return true;
  });
});

test("a node's own rejection keeps its JSON error", async () => {
  replies.push([400, JSON.stringify({ error: "bad_request.validation_failure", errorDetail: "fid cannot be 0" })]);
  await assert.rejects(post("/v1/submitMessage", new Uint8Array([1])), /node rejected the message: bad_request.validation_failure: fid cannot be 0/);
});

test("submitUntil sends again after a 502", async () => {
  posts = 0;
  replies.push([502, CLOUDFLARE_502]);
  assert.equal(await submitUntil(new Uint8Array([1]), async () => true), true);
  assert.equal(posts, 2);
});

test("a retry rejected as a duplicate counts if the message landed", async () => {
  posts = 0;
  replies.push([502, CLOUDFLARE_502], [400, JSON.stringify({ error: "bad_request.duplicate" })]);
  assert.equal(await submitUntil(new Uint8Array([1]), async () => true), true);
  assert.equal(posts, 2);
});

test("a first rejection isn't retried", async () => {
  posts = 0;
  replies.push([400, JSON.stringify({ error: "bad_request.validation_failure" })]);
  await assert.rejects(submitUntil(new Uint8Array([1]), async () => true), /node rejected/);
  assert.equal(posts, 1);
});
