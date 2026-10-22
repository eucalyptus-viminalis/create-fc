// Sessions for a hosted clearcast (ADR 003). Each person's app key lives in
// their browser; this server never sees it. To sign in, the browser signs a
// challenge with that key, the server checks the key is active for that fid
// on the node, and sets a session cookie naming the fid and key.
//
// The cookie is signed with a secret made when the server starts, so a
// restart signs everyone out. That's fine: the browser still has its key and
// signs a new challenge without asking the person anything.
//
// Nothing here is stored: challenges and cookies carry their own expiry and
// signature.

import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { NodeError, get } from "./node.ts";

const SECRET = randomBytes(32);
const CHALLENGE_MS = 5 * 60_000;
export const SESSION_S = 30 * 24 * 60 * 60;
export const COOKIE = "cc_session";

const mac = (s: string) => createHmac("sha256", SECRET).update(s).digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const HEX_KEY = /^0x[0-9a-f]{64}$/i;
const HEX_SIG = /^0x[0-9a-f]{128}$/i;

export type Session = { fid: number; key: string };

// ------------------------------------------------------------ challenges

export function challenge(): string {
  const body = `${Date.now()}.${randomBytes(16).toString("base64url")}`;
  return `${body}.${mac(`challenge:${body}`)}`;
}

function challengeOk(nonce: string): boolean {
  const [ts, rand, m] = nonce.split(".");
  if (!ts || !rand || !m || !same(m, mac(`challenge:${ts}.${rand}`))) return false;
  const age = Date.now() - Number(ts);
  return age >= 0 && age < CHALLENGE_MS;
}

// The exact bytes the browser signs (ui/mine.js). The origin stops a
// signature made for one clearcast being replayed on another.
export const sessionPayload = (origin: string, fid: number, key: string, nonce: string) => `clearcast-session:v1:${origin}:${fid}:${key.toLowerCase()}:${nonce}`;

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
export function signatureOk(key: string, sig: string, payload: string): boolean {
  if (!HEX_KEY.test(key) || !HEX_SIG.test(sig)) return false;
  try {
    const pub = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(key.slice(2), "hex")]), format: "der", type: "spki" });
    return verify(null, Buffer.from(payload), pub, Buffer.from(sig.slice(2), "hex"));
  } catch {
    return false;
  }
}

// Is this key an active app key of this fid, as the node sees it?
export const signerActive = (fid: number, key: string) => get("/v1/signer", { fid, signer: key }).then(() => true, () => false);

// Check a signed challenge; returns the session to set.
export async function startSession(origin: string, b: { fid?: unknown; key?: unknown; nonce?: unknown; sig?: unknown }, active = signerActive): Promise<Session> {
  const fid = Number(b.fid), key = String(b.key ?? "").toLowerCase(), nonce = String(b.nonce ?? ""), sig = String(b.sig ?? "");
  if (!Number.isInteger(fid) || fid <= 0) throw new NodeError("a session needs your fid");
  if (!challengeOk(nonce)) throw new NodeError("that sign-in challenge expired. Try again.");
  if (!signatureOk(key, sig, sessionPayload(origin, fid, key, nonce))) throw new NodeError("the signature doesn't match that key");
  if (!(await active(fid, key))) throw new NodeError(`that key isn't an app key of fid ${fid} on this node (yet)`);
  return { fid, key };
}

// ------------------------------------------------------------ cookies

export function sessionCookie(s: Session, secure: boolean): string {
  const body = `${s.fid}.${s.key}.${Math.floor(Date.now() / 1000) + SESSION_S}`;
  return `${COOKIE}=${body}.${mac(`session:${body}`)}; Path=/; Max-Age=${SESSION_S}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export function readSession(cookieHeader: string | undefined): Session | undefined {
  const raw = (cookieHeader ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return undefined;
  const [fid, key, exp, m] = raw.split(".");
  if (!fid || !key || !exp || !m || !same(m, mac(`session:${fid}.${key}.${exp}`))) return undefined;
  if (Number(exp) * 1000 < Date.now()) return undefined;
  return { fid: Number(fid), key };
}
