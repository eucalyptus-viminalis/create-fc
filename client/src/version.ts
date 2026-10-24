// Which fameboy this is: the package version and the git commit it runs.
// Both installs (install.sh on your computer, fc-node client on a node) are
// git checkouts, so the commit says exactly what code is live. It reads the
// files under .git directly: the hosted container has no git binary.

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// url: the commit on GitHub, when the checkout came from there.
export type BuildInfo = { name: string; version: string; commit: string | null; url: string | null };

const CLIENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
};

// A checkout's git dir, and the main one that holds its refs and config.
// They differ in a worktree, whose .git is a file pointing at its own git dir.
function gitDirs(repo: string) {
  let gitDir = join(repo, ".git");
  const pointer = read(gitDir)?.match(/^gitdir: (.+)$/m)?.[1];
  if (pointer) gitDir = isAbsolute(pointer) ? pointer : resolve(repo, pointer);
  const common = read(join(gitDir, "commondir"));
  return { gitDir, commonDir: common ? resolve(gitDir, common) : gitDir };
}

// The commit HEAD points at, or null when it isn't a git checkout.
export function gitCommit(repo: string): string | null {
  const { gitDir, commonDir } = gitDirs(repo);
  const head = read(join(gitDir, "HEAD"));
  if (!head) return null;
  if (/^[0-9a-f]{40}$/.test(head)) return head;
  const ref = head.match(/^ref: (.+)$/)?.[1];
  if (!ref) return null;
  for (const dir of new Set([gitDir, commonDir])) {
    const loose = read(join(dir, ref));
    if (loose && /^[0-9a-f]{40}$/.test(loose)) return loose;
    const packed = read(join(dir, "packed-refs"))
      ?.split("\n")
      .find((line) => line.endsWith(` ${ref}`))
      ?.slice(0, 40);
    if (packed && /^[0-9a-f]{40}$/.test(packed)) return packed;
  }
  return null;
}

// Where origin's commits live on GitHub, e.g. https://github.com/o/r, or null
// when origin isn't on GitHub.
export function githubRepo(repo: string): string | null {
  const config = read(join(gitDirs(repo).commonDir, "config"));
  const section = config?.split(/^\[/m).find((s) => s.startsWith('remote "origin"]'));
  const url = section?.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
  const m = url?.match(/^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

export function buildInfo(clientDir = CLIENT_DIR): BuildInfo {
  const pkg = JSON.parse(read(join(clientDir, "package.json")) ?? "{}");
  const repo = resolve(clientDir, "..");
  const commit = gitCommit(repo);
  const github = githubRepo(repo);
  return { name: pkg.name ?? "fameboy", version: pkg.version ?? "unknown", commit, url: commit && github ? `${github}/commit/${commit}` : null };
}
