// Which commit a copy runs (src/version.ts), read from .git without git, and
// served at /version without the page's token.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildInfo, gitCommit, githubRepo } from "../src/version.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);

function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "fameboy-version-"));
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), body + "\n");
  }
  return dir;
}

test("a branch's commit, from a loose ref or packed-refs", () => {
  assert.equal(gitCommit(repo({ ".git/HEAD": "ref: refs/heads/main", ".git/refs/heads/main": A })), A);
  const packed = `# pack-refs with: peeled fully-peeled sorted\n${B} refs/heads/dev\n${A} refs/heads/main`;
  assert.equal(gitCommit(repo({ ".git/HEAD": "ref: refs/heads/main", ".git/packed-refs": packed })), A);
});

test("a detached HEAD is the commit itself", () => {
  assert.equal(gitCommit(repo({ ".git/HEAD": B })), B);
});

test("a worktree follows its .git file to the main repo's refs", () => {
  const dir = repo({
    "main/.git/refs/heads/feat": A,
    "main/.git/worktrees/wt/HEAD": "ref: refs/heads/feat",
    "main/.git/worktrees/wt/commondir": "../..",
    "wt/.git": "gitdir: ../main/.git/worktrees/wt",
  });
  assert.equal(gitCommit(join(dir, "wt")), A);
});

test("origin on GitHub gives the repo's address, in https or ssh form", () => {
  const config = (url: string) => `[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/x/y\n[remote "origin"]\n\turl = ${url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*`;
  for (const url of ["https://github.com/o/create-fc.git", "https://github.com/o/create-fc", "git@github.com:o/create-fc.git", "ssh://git@github.com/o/create-fc.git"])
    assert.equal(githubRepo(repo({ ".git/config": config(url) })), "https://github.com/o/create-fc", url);
  assert.equal(githubRepo(repo({ ".git/config": config("https://gitlab.com/o/create-fc.git") })), null);
  assert.equal(githubRepo(repo({ "README.md": "hi" })), null);
});

test("no checkout, no commit", () => {
  assert.equal(gitCommit(repo({ "README.md": "hi" })), null);
  assert.equal(gitCommit(repo({ ".git/HEAD": "ref: refs/heads/gone" })), null);
});

test("this checkout's commit matches git's", () => {
  const root = resolve(import.meta.dirname, "..", "..");
  const info = buildInfo(join(root, "client"));
  assert.equal(info.name, "fameboy");
  assert.equal(info.commit, execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
});

let ui: typeof import("../src/ui-server.ts");
let origin = "";

before(async () => {
  process.env.FC_HOME = mkdtempSync(join(tmpdir(), "fameboy-version-home-"));
  ui = await import("../src/ui-server.ts");
  const port = await new Promise<number>((r) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => r(port));
    });
  });
  origin = await ui.startUi(port, true, { hosted: true, origin: `http://127.0.0.1:${port}` });
});

after(() => ui?.stopUi());

test("GET /version answers without the page's token", async () => {
  const res = await fetch(`${origin}/version`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), buildInfo());
});
