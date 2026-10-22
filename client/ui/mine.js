// What's yours alone, kept in this browser (ADR 003): cleared and saved casts,
// when your last visit ended, whether you appear online, and this browser's
// device id. The server never stores any of it, so a hosted clearcast holds
// nothing about the people who use it. Nothing here is published.
//
// Everything is per account (fid): one browser can sign in as more than one.
// It lives in IndexedDB; if that's unavailable (some private windows) it
// lasts until the tab closes. It's per browser: clearing on a laptop doesn't
// clear on a phone, and clearing site data forgets it.
//
// Load it before kit.js or app.js:  <script src="/mine.js"></script>
//
//   mine.device()                        { id, status } for presence
//   mine.setStatus(fid, "online" | "invisible")
//   mine.visit(fid, { count })           { since, first }: when your last visit ended (ms)
//   mine.inbox(fid)                      { cleared: { casts, likes, replies, followers }, saved }
//   mine.clear(fid, kind, ids, on)       clear or bring back inbox items
//   mine.save(fid, cast, on)             save a cast (keeps a copy) or unsave it
//   mine.feedCleared(fid)                the classic feed's { before, hashes, today }
//   mine.changeFeedCleared(fid, change)  { add, remove, before, counted }, like the old /api/cleared
//
// On a hosted clearcast, your app key lives here too:
//   mine.key.supported()   can this browser make Ed25519 keys?
//   mine.key.create()      make a key for a sign-in; returns its public half (hex)
//   mine.key.confirm(fid)  the sign-in was approved: keep that key as yours
//   mine.key.get()         { fid, publicKey } or null
//   mine.key.sign(text)    sign with it; returns the signature (hex)
//   mine.key.session()     sign the server's challenge to open a session
//   mine.key.forget()      sign out: delete it from this browser

(() => {
  const TOKEN = document.querySelector('meta[name="clearcast-token"]')?.content ?? "";
  const DAY = 86_400_000, WEEK = 7 * DAY;

  // ------------------------------------------------------------ storage
  // One object store, keys like "123/inbox". update() reads and writes in one
  // transaction, so two tabs changing the same thing can't lose either change.
  const memory = new Map();
  let dbp;
  const db = () =>
    (dbp ??= new Promise((resolve) => {
      try {
        const r = indexedDB.open("clearcast", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("mine");
        r.onsuccess = () => resolve(r.result);
        r.onerror = r.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));

  async function get(key) {
    const d = await db();
    if (!d) return clone(memory.get(key));
    return new Promise((resolve) => {
      try {
        const r = d.transaction("mine").objectStore("mine").get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(undefined);
      } catch {
        resolve(clone(memory.get(key)));
      }
    });
  }

  // fn gets the current value (or undefined) and returns the new one.
  async function update(key, fn) {
    const d = await db();
    const viaMemory = () => { const v = fn(clone(memory.get(key))); memory.set(key, clone(v)); return v; };
    if (!d) return viaMemory();
    return new Promise((resolve, reject) => {
      try {
        const tx = d.transaction("mine", "readwrite"), st = tx.objectStore("mine");
        let out;
        const r = st.get(key);
        r.onsuccess = () => { out = fn(r.result); st.put(out, key); };
        tx.oncomplete = () => resolve(out);
        tx.onerror = tx.onabort = () => reject(tx.error ?? new Error("couldn't save in this browser"));
      } catch {
        resolve(viaMemory());
      }
    });
  }

  // ------------------------------------------------- what older versions kept
  // Before ADR 003 the local server kept these in ~/.fc-client. Take them over
  // once per account. A hosted server answers null.
  const imported = new Map();
  function ready(fid) {
    if (!imported.has(fid)) imported.set(fid, (async () => {
      if (await get(`${fid}/imported`)) return;
      let old = null;
      try {
        const res = await fetch("/api/legacy", { headers: { "x-clearcast-token": TOKEN } });
        if (!res.ok) return; // try again next page load
        old = (await res.json()).data;
      } catch {
        return;
      }
      if (old?.inbox) await update(`${fid}/inbox`, (v) => v ?? old.inbox);
      if (old?.cleared) await update(`${fid}/cleared`, (v) => v ?? old.cleared);
      if (old?.visit) await update(`${fid}/visit`, (v) => v ?? old.visit);
      if (old?.presence) await update(`${fid}/presence`, (v) => v ?? old.presence);
      if (old?.device) await update("device", (v) => v ?? old.device);
      await update(`${fid}/imported`, () => true);
    })());
    return imported.get(fid);
  }

  // ------------------------------------------------------------ device
  const newId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
  async function device(fid) {
    if (fid) await ready(fid);
    const id = await update("device", (v) => v ?? newId());
    const status = fid ? (await get(`${fid}/presence`)) ?? "online" : "online";
    return { id, status };
  }
  async function setStatus(fid, status) {
    await ready(fid);
    await update(`${fid}/presence`, () => status);
  }

  // ------------------------------------------------------------ visits
  // A visit lasts until you've been away 30 minutes, so reloading doesn't
  // reset what counts as new. count: false peeks without counting this look.
  async function visit(fid, { count = false } = {}) {
    await ready(fid);
    const now = Date.now();
    let first = false;
    const r = count
      ? await update(`${fid}/visit`, (v) => {
          if (!v) { first = true; return { prev: now - DAY, lastActive: now }; }
          return now - v.lastActive > 30 * 60_000 ? { prev: v.lastActive, lastActive: now } : { ...v, lastActive: now };
        })
      : await get(`${fid}/visit`);
    if (!r) first = true;
    return { since: r?.prev ?? now - DAY, first };
  }

  // ------------------------------------------------------------ inbox
  const emptyInbox = () => ({ cleared: { casts: {}, likes: {}, replies: {}, followers: {} }, saved: [] });
  async function inbox(fid) {
    await ready(fid);
    return (await get(`${fid}/inbox`)) ?? emptyInbox();
  }
  // Cleared ids older than two weeks have left every view, so they're dropped.
  const prune = (s) => {
    const old = Date.now() - 2 * WEEK;
    for (const k of Object.keys(s.cleared)) for (const [id, at] of Object.entries(s.cleared[k])) if (at < old) delete s.cleared[k][id];
    return s;
  };
  async function clear(fid, kind, ids, on) {
    await ready(fid);
    return update(`${fid}/inbox`, (v) => {
      const s = v ?? emptyInbox();
      s.cleared[kind] ??= {};
      for (const id of ids) on ? (s.cleared[kind][id] = Date.now()) : delete s.cleared[kind][id];
      return prune(s);
    });
  }
  // A saved cast keeps a copy, so it stays readable after it leaves the 7 days.
  async function save(fid, cast, on) {
    await ready(fid);
    return update(`${fid}/inbox`, (v) => {
      const s = v ?? emptyInbox();
      s.saved = s.saved.filter((x) => x.hash !== cast.hash);
      if (on) s.saved.unshift({ hash: cast.hash, fid: cast.fid, savedAt: new Date().toISOString(), cast });
      return s;
    });
  }

  // ------------------------------------------------------------ classic feed
  // Per feed: "before" clears everything at or before a time (clear all);
  // "hashes" are casts after it, cleared one by one, with their times.
  const localDay = () => new Date().toLocaleDateString("en-CA");
  const emptyFeed = () => ({ hashes: {}, today: { day: localDay(), n: 0 } });
  const fresh = (c) => (c.today?.day === localDay() ? c : { ...c, today: { day: localDay(), n: 0 } });
  async function feedCleared(fid) {
    await ready(fid);
    return fresh((await get(`${fid}/cleared`)) ?? emptyFeed());
  }
  async function changeFeedCleared(fid, change) {
    await ready(fid);
    return update(`${fid}/cleared`, (v) => {
      const c = fresh(v ?? emptyFeed());
      for (const { hash, time } of change.add ?? []) c.hashes[hash] = time;
      for (const hash of change.remove ?? []) delete c.hashes[hash];
      if (change.before === null) delete c.before;
      else if (change.before) c.before = change.before;
      if (c.before) for (const [h, t] of Object.entries(c.hashes)) if (t <= c.before) delete c.hashes[h];
      c.today.n = Math.max(0, c.today.n + (change.counted ?? (change.add?.length ?? 0) - (change.remove?.length ?? 0)));
      return c;
    });
  }

  // ------------------------------------------------------------ your key
  // An Ed25519 key made by WebCrypto with extractable: false: the browser can
  // sign with it, but nothing (this page included) can read the private half
  // out. Only the public half is ever sent. IndexedDB stores the CryptoKey
  // itself. In memory only (no IndexedDB), it's gone when the tab closes.
  const hex = (buf) => "0x" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let supportedP;
  const key = {
    supported: () =>
      (supportedP ??= crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]).then(() => true, () => false)),
    async create() {
      const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
      const publicKey = hex(await crypto.subtle.exportKey("raw", pair.publicKey));
      await update("key-pending", () => ({ publicKey, privateKey: pair.privateKey }));
      return publicKey;
    },
    async confirm(fid) {
      const p = await get("key-pending");
      if (!p) throw new Error("no key is waiting for approval in this browser");
      await update("key", () => ({ fid, publicKey: p.publicKey, privateKey: p.privateKey }));
      await update("key-pending", () => undefined);
    },
    async get() {
      const k = await get("key");
      return k?.privateKey ? { fid: k.fid, publicKey: k.publicKey } : null;
    },
    async sign(text) {
      const k = await get("key");
      if (!k?.privateKey) throw new Error("no key in this browser: sign in first");
      return hex(await crypto.subtle.sign({ name: "Ed25519" }, k.privateKey, new TextEncoder().encode(text)));
    },
    // The same bytes the server checks (client/src/session.ts).
    async session() {
      const k = await key.get();
      if (!k) return false;
      const call = (path, body) =>
        fetch(path, { method: body ? "POST" : "GET", headers: { "x-clearcast-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) }, body: body && JSON.stringify(body) })
          .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => ({})) }));
      const ch = await call("/api/session/challenge");
      if (!ch.ok) return false;
      const { nonce, origin } = ch.json.data;
      const sig = await key.sign(`clearcast-session:v1:${origin}:${k.fid}:${k.publicKey}:${nonce}`);
      const r = await call("/api/session", { fid: k.fid, key: k.publicKey, nonce, sig });
      if (!r.ok) throw new Error(r.json.error ?? "couldn't open a session");
      return true;
    },
    async forget() {
      await update("key", () => undefined);
      await update("key-pending", () => undefined);
    },
  };

  window.mine = { device, setStatus, visit, inbox, clear, save, feedCleared, changeFeedCleared, key };
})();
