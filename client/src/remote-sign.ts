// Signing in the browser, mid-request (ADR 003). On a hosted fameboy the
// server builds a write but the person's browser holds the key. So when
// server code calls author.sign(bytes), the request pauses: the HTTP reply
// the browser is waiting on becomes "sign this" ({ sign: { id, payload } }).
// The browser signs and POSTs /api/sign; the server checks the signature with
// the session's key and carries on from where it paused. The reply to
// /api/sign is the next "sign this", or the request's result.
//
// So any code path can ask for as many signatures as it needs (presence asks
// for two), with no separate prepare and submit steps.
//
// A paused request waits two minutes for its signature, then gives up.

import { randomBytes } from "node:crypto";
import { bytesToHex, type Hex } from "viem";
import type { Author } from "./keys.ts";
import { NodeError } from "./node.ts";
import { signatureOkBytes, type Session } from "./session.ts";

const WAIT_MS = 120_000;

export type Reply = { sign: { id: string; payload: Hex } } | { done: unknown } | { failed: unknown };

// One request's back and forth: what it has to say next, for whichever HTTP
// reply is waiting to carry it. cookies: what the request's code sets on the
// way out. After a pause the result goes out on a later request (/api/sign),
// so the cookies travel with the conversation, not the first request.
export class Conversation {
  readonly cookies: string[];
  constructor(cookies: string[] = []) {
    this.cookies = cookies;
  }
  private waiter?: (r: Reply) => void;
  private queued: Reply[] = [];
  say(r: Reply) {
    const w = this.waiter;
    if (w) (this.waiter = undefined), w(r);
    else this.queued.push(r);
  }
  next(): Promise<Reply> {
    const r = this.queued.shift();
    return r ? Promise.resolve(r) : new Promise((resolve) => (this.waiter = resolve));
  }
}

type Pending = { conv: Conversation; session: Session; payload: Uint8Array; resolve: (sig: Hex) => void; timer: NodeJS.Timeout };
const pending = new Map<string, Pending>();

// The signed-in person as an Author whose signatures come from their browser.
export function browserAuthor(session: Session, conv: Conversation): Author {
  return {
    fid: session.fid,
    publicKey: session.key as Hex,
    sign: (payload) =>
      new Promise<Hex>((resolve, reject) => {
        if (pending.size > 10_000) return reject(new NodeError("too many writes waiting for a signature. Try again in a minute."));
        const id = randomBytes(16).toString("hex");
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new NodeError("no signature came back from your browser within two minutes"));
        }, WAIT_MS);
        timer.unref();
        pending.set(id, { conv, session, payload: new Uint8Array(payload), resolve, timer });
        conv.say({ sign: { id, payload: bytesToHex(payload) } });
      }),
  };
}

// The browser's answer. Checks it's the same person and a good signature, and
// returns the conversation, whose next reply is for this HTTP request.
export function answer(session: Session | undefined, b: { id?: unknown; sig?: unknown }): Conversation {
  const p = pending.get(String(b.id ?? ""));
  if (!p) throw new NodeError("that signature request expired. Try again.");
  if (!session || session.fid !== p.session.fid || session.key !== p.session.key) throw new NodeError("that signature request belongs to someone else");
  const sig = String(b.sig ?? "");
  if (!signatureOkBytes(p.session.key, sig, p.payload)) throw new NodeError("that signature doesn't match your key");
  pending.delete(String(b.id));
  clearTimeout(p.timer);
  p.resolve(sig as Hex);
  return p.conv;
}
