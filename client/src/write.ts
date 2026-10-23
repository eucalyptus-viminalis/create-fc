// Writes: cast, delete, follow, unfollow, like, recast. Each is a protobuf
// message signed by your app key (an Author: the key file, or on a hosted
// fameboy your browser) and POSTed to your own node, which checks it
// and relays it to the validators. A read node keeps no mempool, so "accepted"
// only means "valid and relayed". We confirm every write by reading it back.

import {
  CastType,
  FarcasterNetwork,
  Message as MessageProto,
  ReactionType,
  SignatureScheme,
  makeCastAddData,
  makeCastRemoveData,
  makeLinkAddData,
  makeLinkRemoveData,
  makeMessageHash,
  makeMessageWithSignature,
  makeReactionAddData,
  makeReactionRemoveData,
  type HubAsyncResult,
  type MessageData,
} from "@farcaster/core";
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { localAuthor, type Author } from "./keys.ts";
import { NodeError, get, post, submitUntil, type Message, type Page } from "./node.ts";
import { resolveFid } from "./read.ts";

const MAX_CAST_BYTES = 320; // 1,024 for Pro accounts

export type CastRef = { fid: number; hash: Hex };

// "dwr/0x35c7b588" -> the full cast id. The short hash is what `fameboy casts` and
// `fameboy feed` print; we find the full one among that user's recent casts.
export async function resolveCast(ref: string): Promise<CastRef> {
  const m = ref.match(/^@?([^/]+)\/(0x[0-9a-fA-F]+)$/);
  if (!m) throw new NodeError(`"${ref}" isn't a cast reference. Use user/hash, e.g. dwr/0x35c7b588`);
  const fid = await resolveFid(m[1]!);
  const prefix = m[2]!.toLowerCase();
  if (prefix.length === 42) return { fid, hash: prefix as Hex };
  const page = await get<Page>("/v1/castsByFid", { fid, pageSize: 1000, reverse: true });
  const hits = page.messages.filter((c) => c.hash.startsWith(prefix));
  if (hits.length === 0) throw new NodeError(`no cast starting ${prefix} among @${m[1]}'s last 1,000 casts`);
  if (hits.length > 1) throw new NodeError(`${prefix} matches ${hits.length} casts; use more of the hash`);
  return { fid, hash: hits[0]!.hash as Hex };
}

// Turn "@dwr" in the text into a real mention. Farcaster stores mentions out
// of band: the name is cut from the text, and its FID and byte offset go in
// `mentions` and `mentionsPositions`. Clients put the name back when they
// render, which is why renaming yourself doesn't break old mentions.
async function extractMentions(text: string) {
  const enc = new TextEncoder();
  const mentions: number[] = [];
  const mentionsPositions: number[] = [];
  let out = "";
  let last = 0;
  for (const m of text.matchAll(/(^|\s)@([a-z0-9][a-z0-9-]{0,15}(?:\.eth)?)\b/g)) {
    const start = m.index! + m[1]!.length;
    let fid: number;
    try {
      fid = await resolveFid(m[2]!);
    } catch {
      continue; // not a user: leave "@word" as plain text
    }
    out += text.slice(last, start);
    mentionsPositions.push(enc.encode(out).length);
    mentions.push(fid);
    last = start + 1 + m[2]!.length;
  }
  out += text.slice(last);
  return { text: out, mentions, mentionsPositions };
}

// Build a message, have its author sign the hash, and encode it. With dryRun,
// only run the node's stateless checks.
export async function build(by: Author, made: HubAsyncResult<MessageData>, dryRun = false) {
  const data = await made;
  if (data.isErr()) throw new NodeError(`couldn't build the message: ${data.error.message}`);
  const hashed = await makeMessageHash(data.value);
  if (hashed.isErr()) throw new NodeError(`couldn't hash the message: ${hashed.error.message}`);
  const signature = hexToBytes(await by.sign(hashed.value));
  const r = await makeMessageWithSignature(data.value, { signature, signatureScheme: SignatureScheme.ED25519, signer: hexToBytes(by.publicKey) });
  if (r.isErr()) throw new NodeError(`that signature doesn't fit the message: ${r.error.message}`);
  const bytes = MessageProto.encode(r.value).finish();
  if (dryRun) {
    const { valid } = await post<{ valid: boolean }>("/v1/validateMessage", bytes);
    if (!valid) throw new NodeError("your node's stateless checks reject this message");
  }
  return { hash: bytesToHex(r.value.hash), bytes };
}

// Send it and poll a read until it succeeds (or, for removals, until it stops succeeding).
const sendAndConfirm = (bytes: Uint8Array, read: () => Promise<unknown>, wantPresent = true) =>
  submitUntil(bytes, () => read().then(() => wantPresent, () => !wantPresent));

const opts = (by: Author) => ({ fid: by.fid, network: FarcasterNetwork.MAINNET });

export async function cast(text: string, o: { replyTo?: CastRef; embeds?: string[]; dryRun?: boolean } = {}, by?: Author) {
  const key = by ?? (await localAuthor());
  const body = await extractMentions(text);
  const bytes = new TextEncoder().encode(body.text).length;
  if (bytes > MAX_CAST_BYTES) throw new NodeError(`that's ${bytes} bytes; casts max out at ${MAX_CAST_BYTES}`);
  const { hash, bytes: msg } = await build(
    key,
    makeCastAddData(
      {
        ...body,
        type: CastType.CAST,
        embeds: (o.embeds ?? []).map((url) => ({ url })),
        embedsDeprecated: [],
        parentCastId: o.replyTo ? { fid: o.replyTo.fid, hash: hexToBytes(o.replyTo.hash) } : undefined,
      },
      opts(key),
    ),
    o.dryRun,
  );
  if (o.dryRun) return { hash, landed: false, text: body.text, mentions: body.mentions };
  const landed = await sendAndConfirm(msg, () => get<Message>("/v1/castById", { fid: key.fid, hash }));
  return { hash, landed, text: body.text, mentions: body.mentions };
}

export async function deleteCast(hash: Hex, by?: Author) {
  const key = by ?? (await localAuthor());
  const { bytes } = await build(key, makeCastRemoveData({ targetHash: hexToBytes(hash) }, opts(key)));
  const landed = await sendAndConfirm(bytes, () => get<Message>("/v1/castById", { fid: key.fid, hash }), false);
  return { landed };
}

export async function follow(targetFid: number, on = true, by?: Author) {
  const key = by ?? (await localAuthor());
  const body = { type: "follow", targetFid };
  const { bytes } = await build(key, on ? makeLinkAddData(body, opts(key)) : makeLinkRemoveData(body, opts(key)));
  const landed = await sendAndConfirm(bytes, () => get<Message>("/v1/linkById", { fid: key.fid, target_fid: targetFid, link_type: "follow" }), on);
  return { landed };
}

export async function react(kind: "like" | "recast", target: CastRef, on = true, by?: Author) {
  const key = by ?? (await localAuthor());
  const type = kind === "like" ? ReactionType.LIKE : ReactionType.RECAST;
  const body = { type, targetCastId: { fid: target.fid, hash: hexToBytes(target.hash) } };
  const { bytes } = await build(key, on ? makeReactionAddData(body, opts(key)) : makeReactionRemoveData(body, opts(key)));
  const landed = await sendAndConfirm(
    bytes,
    () =>
      get<Message>("/v1/reactionById", {
        fid: key.fid,
        reaction_type: kind === "like" ? "Like" : "Recast",
        target_fid: target.fid,
        target_hash: target.hash,
      }),
    on,
  );
  return { landed };
}
