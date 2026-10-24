// Hosted sign out (src/ui-server.ts): it pauses for the browser to sign an
// "offline" heartbeat, then clears the session cookie. The clear must reach
// the browser on the reply that finishes the request (POST /api/sign), or the
// browser stays signed in. A fake node stands in for Snapchain and the
// companion; nothing leaves this machine.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hexToBytes } from "viem";

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });

// Every key is active; everything else (the companion's presence) is missing.
let node: Server;
let origin = "";
let ui: typeof import("../src/ui-server.ts");
let session: typeof import("../src/session.ts");

before(async () => {
  node = createServer((req, res) => {
    const ok = req.url?.startsWith("/v1/signer");
    res.writeHead(ok ? 200 : 404, { "content-type": "application/json" }).end(ok ? "{}" : '{"error":"no"}');
  });
  await new Promise<void>((r) => node.listen(0, "127.0.0.1", r));
  const nodeUrl = `http://127.0.0.1:${(node.address() as AddressInfo).port}`;
  process.env.FC_HOME = mkdtempSync(join(tmpdir(), "fameboy-signout-"));
  process.env.FC_NODE = nodeUrl;
  process.env.FC_COMPANION = nodeUrl;
  // These read the environment when they load.
  ui = await import("../src/ui-server.ts");
  session = await import("../src/session.ts");
  const port = await freePort();
  origin = await ui.startUi(port, true, { hosted: true, origin: `http://127.0.0.1:${port}` });
});

after(async () => {
  await ui?.stopUi();
  node?.closeAllConnections();
  await new Promise((r) => node?.close(r) ?? r(undefined));
});

test("hosted sign out clears the session cookie after the signature pause", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = "0x" + publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const cookie = session.sessionCookie({ fid: 7, key }, false).split(";")[0]!;
  const page = await (await fetch(origin + "/")).text();
  const token = page.match(/name="fameboy-token" content="([0-9a-f]+)"/)![1]!;
  const call = (path: string, body: unknown) =>
    fetch(origin + path, { method: "POST", headers: { "content-type": "application/json", "x-fameboy-token": token, cookie }, body: JSON.stringify(body) });
  const cleared = (res: Response) => res.headers.getSetCookie().some((c) => c.startsWith(`${session.COOKIE}=;`) && c.includes("Max-Age=0"));

  // First reply: "sign this". The cookie must survive it, or /api/sign can't tell who's answering.
  const first = await call("/api/signout", { device: "test-device" });
  const ask = (await first.json()) as { sign: { id: string; payload: `0x${string}` } };
  assert.ok(ask.sign, "sign out asks the browser to sign the offline heartbeat");
  assert.equal(cleared(first), false);

  // Second reply: the result, carrying the cleared cookie.
  const sig = "0x" + sign(null, hexToBytes(ask.sign.payload), privateKey).toString("hex");
  const last = await call("/api/sign", { id: ask.sign.id, sig });
  const done = (await last.json()) as { data: { removed: boolean } };
  assert.equal(last.status, 200);
  assert.equal(done.data.removed, true);
  assert.ok(cleared(last), `expected the session cookie cleared, got ${JSON.stringify(last.headers.getSetCookie())}`);
});
