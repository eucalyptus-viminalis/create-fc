// "Clear": casts you've read and don't want to see again, like archiving an
// email. This is private and stays on this computer, in
// ~/.fc-client/cleared.json. Nothing is published; it isn't a protocol message
// and nobody else can see it. (Deleting a cast is different: that removes your
// own cast from the network.)
//
// Per feed (the fid whose feed it is), two things are kept:
//   before: every cast at or before this time counts as cleared ("clear all")
//   hashes: casts after that, cleared one by one, with their times, so they
//           can be dropped once "before" passes them and the file stays small.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DIR = process.env.FC_HOME ?? join(homedir(), ".fc-client");
const FILE = join(DIR, "cleared.json");

export type Cleared = {
  before?: string; // ISO time
  hashes: Record<string, string>; // hash -> cast time (ISO)
  today: { day: string; n: number }; // how many you cleared today, for the counter
};
type Store = Record<string, Cleared>;

const localDay = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

async function load(): Promise<Store> {
  try {
    return JSON.parse(await readFile(FILE, "utf8")) as Store;
  } catch {
    return {};
  }
}

// One write at a time; each goes to a temp file first so a crash can't leave half a file.
let queue = Promise.resolve();
async function save(store: Store) {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  await writeFile(`${FILE}.tmp`, JSON.stringify(store), { mode: 0o600 });
  await rename(`${FILE}.tmp`, FILE);
}

const empty = (): Cleared => ({ hashes: {}, today: { day: localDay(), n: 0 } });

export async function clearedFor(fid: number): Promise<Cleared> {
  const c = (await load())[fid] ?? empty();
  if (c.today.day !== localDay()) c.today = { day: localDay(), n: 0 };
  return c;
}

export type ClearChange = {
  add?: { hash: string; time: string }[]; // clear these
  remove?: string[]; // un-clear these (undo)
  before?: string | null; // move the "clear all" line; null removes it (undo)
  counted?: number; // how many casts this change cleared (+) or restored (-), for today's count
};

export function changeCleared(fid: number, change: ClearChange): Promise<Cleared> {
  const run = queue.then(async () => {
    const store = await load();
    const c = store[fid] ?? empty();
    if (c.today.day !== localDay()) c.today = { day: localDay(), n: 0 };
    for (const { hash, time } of change.add ?? []) c.hashes[hash] = time;
    for (const hash of change.remove ?? []) delete c.hashes[hash];
    if (change.before === null) delete c.before;
    else if (change.before) c.before = change.before;
    // Hashes the "clear all" line already covers aren't needed any more.
    if (c.before) for (const [h, t] of Object.entries(c.hashes)) if (t <= c.before) delete c.hashes[h];
    c.today.n = Math.max(0, c.today.n + (change.counted ?? (change.add?.length ?? 0) - (change.remove?.length ?? 0)));
    store[fid] = c;
    await save(store);
    return c;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
