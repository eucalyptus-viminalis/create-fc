// Personal state from before it moved to the browser (ADR 003): cleared and
// saved casts, last visit, presence. Older versions kept these in files in
// ~/.fameboy. The page asks for them once per account and keeps them in the
// browser from then on; the files are left as they are.
// Local mode only: a hosted fameboy never had these files.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { KEY_DIR } from "./keys.ts";

async function read<T>(name: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(join(KEY_DIR, name), "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function legacyState(fid: number) {
  const [inbox, checkins, presence, device] = await Promise.all([
    read<Record<string, unknown>>("inbox.json"),
    read<Record<string, unknown>>("checkins.json"),
    read<{ status?: string }>("presence.json"),
    read<{ id?: string }>("device.json"),
  ]);
  return {
    inbox: inbox?.[fid] ?? null, // { cleared: { casts, likes, replies, followers }, saved }
    visit: checkins?.[fid] ?? null, // { prev, lastActive }
    presence: presence?.status ?? null,
    device: device?.id ?? null,
  };
}
