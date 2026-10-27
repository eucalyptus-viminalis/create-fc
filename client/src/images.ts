// Images for casts. A cast can only link to an image, so fc-companion hosts
// them on your node and Caddy serves them over HTTPS (node/companion.mjs).
// Each person has 500 MB of image space on a node, and the node 10 GB in all.
// Every call is signed with your app key, like presence.

import { createHash } from "node:crypto";
import type { Author } from "./keys.ts";
import { NodeError } from "./node.ts";
import { COMPANION, companionUrl, heartbeatNow, signWith, type Device } from "./home.ts";

export type ImageUsage = { hosting: boolean; used: number; files: number; cap: number; nodeUsed: number; nodeCap: number; fileCap: number };

async function companionCall<T>(path: string, init: RequestInit): Promise<T> {
  const url = companionUrl(path);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new NodeError(`can't reach your node's companion at ${COMPANION}`);
  }
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new NodeError(body.error ?? `the companion said ${res.status}`);
  return body;
}

export async function uploadImage(key: Author, bytes: Buffer, device: Device) {
  await heartbeatNow(key, device); // only people using the node may upload
  const hash = createHash("sha256").update(bytes).digest("hex");
  const ts = Date.now();
  return companionCall<{ url: string; name: string; size: number; type: string; usage: ImageUsage }>("/v1/images", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-fid": String(key.fid),
      "x-ts": String(ts),
      "x-key": key.publicKey,
      "x-sig": await signWith(key, `clearcast-image:v1:${key.fid}:${hash}:${ts}`),
    },
    body: new Uint8Array(bytes),
  });
}

// Give an image's space back, e.g. when it's removed before casting.
export async function deleteImage(key: Author, name: string) {
  if (!/^[0-9a-f]{64}\.(png|jpg|gif|webp)$/.test(name)) throw new NodeError("bad image name");
  const ts = Date.now();
  return companionCall<{ usage: ImageUsage }>(`/v1/images/${name}`, {
    method: "DELETE",
    headers: { "x-fid": String(key.fid), "x-ts": String(ts), "x-key": key.publicKey, "x-sig": await signWith(key, `clearcast-image-delete:v1:${key.fid}:${name}:${ts}`) },
  });
}

export async function imageUsage(key: Author): Promise<ImageUsage> {
  const ts = Date.now();
  const sig = await signWith(key, `clearcast-image-usage:v1:${key.fid}:${ts}`);
  return companionCall<ImageUsage>(`/v1/images/usage?fid=${key.fid}&ts=${ts}&key=${key.publicKey}&sig=${sig}`, { method: "GET" });
}
