// fameboy update (src/update.ts): pulls the checkout it runs from, reinstalls
// dependencies only when something changed, and leaves edited checkouts alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { update } from "../src/update.ts";

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "init.defaultBranch=main", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

// An upstream repo, and an install cloned from it like install.sh does.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "fameboy-update-"));
  const upstream = join(dir, "upstream");
  mkdirSync(join(upstream, "client"), { recursive: true });
  git(upstream, "init", "-q");
  writeFileSync(join(upstream, "client", "cli.ts"), "v1\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-qm", "v1");
  const app = join(dir, "app");
  execFileSync("git", ["clone", "-q", "--depth", "1", `file://${upstream}`, app], { stdio: "ignore" });
  const commit = (body: string) => {
    writeFileSync(join(upstream, "client", "cli.ts"), body + "\n");
    git(upstream, "commit", "-qam", body);
    return git(upstream, "rev-parse", "HEAD");
  };
  return { app, clientDir: join(app, "client"), commit };
}

test("nothing new: no pull changes, no reinstall", () => {
  const { clientDir } = setup();
  let installs = 0;
  const r = update({ clientDir, install: () => installs++ });
  assert.equal(r.from, r.to);
  assert.equal(installs, 0);
});

test("new commits upstream: pulls them and reinstalls dependencies", () => {
  const { app, clientDir, commit } = setup();
  const v2 = commit("v2");
  const installed: string[] = [];
  const r = update({ clientDir, install: (d) => installed.push(d) });
  assert.equal(r.to, v2);
  assert.notEqual(r.from, v2);
  assert.equal(git(app, "rev-parse", "HEAD"), v2);
  assert.deepEqual(installed, [clientDir]);
});

test("a checkout with local edits is left alone", () => {
  const { app, clientDir, commit } = setup();
  const before = git(app, "rev-parse", "HEAD");
  commit("v2");
  writeFileSync(join(clientDir, "cli.ts"), "my edit\n");
  assert.throws(() => update({ clientDir, install: () => assert.fail("installed") }), /local changes/);
  assert.equal(git(app, "rev-parse", "HEAD"), before);
});

test("not a git checkout: says to run install.sh again", () => {
  const dir = mkdtempSync(join(tmpdir(), "fameboy-update-"));
  mkdirSync(join(dir, "client"));
  assert.throws(() => update({ clientDir: join(dir, "client") }), /install\.sh/);
});
