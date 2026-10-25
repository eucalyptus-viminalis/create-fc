// fameboy update: pull the newest fameboy into the checkout this copy runs
// from (~/.fameboy/app for install.sh), then reinstall its dependencies.
// Same as running install.sh again, without needing the node's address:
// config.json, the app key and the fameboy wrapper stay as they are.

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeError } from "./node.ts";
import { gitCommit, githubRepo } from "./version.ts";

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type UpdateResult = { from: string; to: string; compare: string | null };

const git = (repo: string, ...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// The same pnpm install that install.sh runs.
export function installDeps(clientDir: string) {
  const args = ["install", "--prod", "--frozen-lockfile", "--silent"];
  const run = (cmd: string, a: string[]) => execFileSync(cmd, a, { cwd: clientDir, stdio: "inherit" });
  try {
    execFileSync("pnpm", ["--version"], { stdio: "ignore" });
    run("pnpm", args);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    run("npx", ["-y", "pnpm@10.33.0", ...args]);
  }
}

export function update(opts: { clientDir?: string; install?: (clientDir: string) => void } = {}): UpdateResult {
  const clientDir = opts.clientDir ?? CLIENT_DIR;
  const repo = resolve(clientDir, "..");
  const from = gitCommit(repo);
  if (!from) throw new NodeError(`${repo} isn't a git checkout, so it can't update itself. Run install.sh again instead.`);
  try {
    git(repo, "--version");
  } catch {
    throw new NodeError("fameboy update needs git");
  }
  // A checkout with edits is someone's working copy, not an install: leave it to them.
  if (git(repo, "status", "--porcelain", "--untracked-files=no"))
    throw new NodeError(`${repo} has local changes, so fameboy update left it alone. Commit or stash them, then git pull there yourself.`);

  try {
    git(repo, "pull", "--ff-only", "-q");
  } catch (e) {
    const why = String((e as { stderr?: string }).stderr ?? e).trim().split("\n").at(-1);
    throw new NodeError(`git pull in ${repo} failed: ${why}`);
  }
  const to = gitCommit(repo) ?? from;
  if (to !== from) (opts.install ?? installDeps)(join(repo, "client"));
  const github = githubRepo(repo);
  return { from, to, compare: github && to !== from ? `${github}/compare/${from.slice(0, 7)}...${to.slice(0, 7)}` : null };
}
