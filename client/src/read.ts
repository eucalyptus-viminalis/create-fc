// Reads: profiles, a user's casts, and a home feed, all from your own node.
import { FARCASTER_EPOCH, get, getAll, pool, NodeError, type Message, type Page } from "./node.ts";

export type Profile = { fid: number; username?: string; display?: string; bio?: string; pfp?: string };

// "dwr", "@dwr" or "3" -> 3. Usernames resolve through the node's own
// username proofs, so no call goes to the fname server.
export async function resolveFid(who: string): Promise<number> {
  const s = who.replace(/^@/, "");
  if (/^\d+$/.test(s)) return Number(s);
  try {
    const proof = await get<{ fid: number }>("/v1/userNameProofByName", { name: s });
    return proof.fid;
  } catch (e) {
    if (e instanceof NodeError && /\b(400|404)\b/.test(e.message)) throw new NodeError(`no Farcaster user named "${s}"`);
    throw e;
  }
}

const USER_DATA_FIELDS: Record<string, keyof Profile> = {
  USER_DATA_TYPE_USERNAME: "username",
  USER_DATA_TYPE_DISPLAY: "display",
  USER_DATA_TYPE_BIO: "bio",
  USER_DATA_TYPE_PFP: "pfp",
};

export async function profile(fid: number): Promise<Profile> {
  const page = await get<Page>("/v1/userDataByFid", { fid });
  const p: Profile = { fid };
  for (const m of page.messages) {
    const body = m.data.userDataBody;
    const field = body && USER_DATA_FIELDS[body.type];
    if (field && body.value) (p as Record<string, unknown>)[field] = body.value;
  }
  return p;
}

// Newest first. Each user's casts live on one shard, so this is a single
// range scan on the node.
export async function castsByFid(fid: number, limit = 20, opts: { replies?: boolean } = {}): Promise<Message[]> {
  const page = await get<Page>("/v1/castsByFid", { fid, pageSize: opts.replies ? limit : limit * 3, reverse: true });
  const casts = page.messages.filter((m) => m.data.castAddBody);
  return (opts.replies ? casts : casts.filter((m) => !isReply(m))).slice(0, limit);
}

// A reply has a parent cast. A parentUrl alone means the cast was posted in a
// channel, which still counts as a top-level cast.
export const isReply = (m: Message) => Boolean(m.data.castAddBody?.parentCastId);

export async function following(fid: number): Promise<number[]> {
  const links = await getAll("/v1/linksByFid", { fid, link_type: "follow" });
  return links.map((m) => m.data.linkBody!.targetFid);
}

// Snapchain has no "home feed" endpoint: a feed is something a client builds.
// Ours is the simplest one: the latest casts from everyone you follow, merged
// by time. Against your own node, one request per followed account is cheap.
export async function feed(fid: number, opts: { limit?: number; perUser?: number; replies?: boolean } = {}) {
  const { limit = 30, perUser = 5, replies = false } = opts;
  const fids = await following(fid);
  const lists = await pool(fids, 48, (f) => castsByFid(f, perUser, { replies }).catch(() => [] as Message[]));
  // A few old casts carry timestamps decades ahead (fid 347 has one dated
  // ~2061) and would sit at the top forever, so skip anything >10 min ahead.
  const horizon = Date.now() / 1000 - FARCASTER_EPOCH + 600;
  const casts = lists
    .flat()
    .filter((m) => m.data.timestamp <= horizon)
    .sort((a, b) => b.data.timestamp - a.data.timestamp)
    .slice(0, limit);
  return { following: fids.length, casts };
}

// Usernames for a set of fids, fetched once each.
export async function usernames(fids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(fids)];
  const profiles = await pool(unique, 48, (f) => profile(f).catch(() => ({ fid: f }) as Profile));
  return new Map(profiles.map((p) => [p.fid, p.username ?? `!${p.fid}`]));
}
