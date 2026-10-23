// fameboy's UI kit: what every page shares. Components are functions that
// return HTML strings (the pages build their views from strings); the rest are
// small helpers (api, store, sound, toast) and the modes bar.
// Load it before the page's own script:
//   <link rel="stylesheet" href="/kit.css"> <script src="/kit.js"></script>
//
// kit.ext(href, label, opts)  a link that leaves fameboy. It always opens in
//                             a new tab, says so to screen readers, and shows
//                             a small pixel arrow (↗) after text labels.
//   href    where it goes (escaped here)
//   label   the link's content, as HTML: escape any text you pass in
//   opts    { cls, title, arrow, attrs }: arrow defaults to true; pass false
//           when the label is a picture, where an arrow would look like part
//           of it. attrs: extra attributes, as HTML (escape their values)

(() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // A 7x7 pixel diagonal arrow, drawn in the text colour.
  const ARROW_CELLS = [[2, 0], [3, 0], [4, 0], [5, 0], [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [5, 1], [4, 2], [3, 3], [2, 4], [1, 5], [0, 6]];
  const arrow = `<svg class="ext-arrow" viewBox="0 0 7 7" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${ARROW_CELLS.map(([x, y]) => `<rect x="${x}" y="${y}" width="1" height="1"/>`).join("")}</svg>`;

  function ext(href, label, opts = {}) {
    const { cls = "", title, arrow: withArrow = true, attrs = "" } = opts;
    return `<a class="ext${cls ? ` ${cls}` : ""}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ""}${attrs ? ` ${attrs}` : ""}>${label}${withArrow ? arrow : ""}<span class="sr"> (opens in a new tab)</span></a>`;
  }

  // ---------------------------------------------------------------- basics
  const $ = (sel) => document.querySelector(sel);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const TOKEN = document.querySelector('meta[name="fameboy-token"]')?.content ?? "";

  // The local server's API. Only this page can call it: it sends the token the
  // server embedded in the page. 401 means signed out.
  // On a hosted fameboy a 401 can just mean the session ended (the server
  // restarted, say): if this browser has a key, sign a new challenge and retry once.
  class SignedOut extends Error {}
  let reauth;
  async function api(path, body, retried = false) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "x-fameboy-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    // "/api/me" answers null rather than 401 when the session is gone, so treat
    // that the same way when this browser holds a key.
    const gone = res.status === 401 || (path === "/api/me" && res.ok && json.data === null && (await window.mine?.key.get()));
    if (gone && !retried && window.mine) {
      reauth ??= mine.key.session().catch(() => false).finally(() => setTimeout(() => (reauth = undefined), 5000));
      if (await reauth) return api(path, body, true);
    }
    if (res.status === 401) throw new SignedOut(json.error);
    if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
    // Hosted: the server may pause the request until this browser signs (mine.js).
    const done = json.sign ? await mine.key.answer(json) : json;
    // Every answer lists the node calls behind it: the requests panel shows them.
    if (done.calls?.length) requests.add(done.calls);
    return done.data;
  }

  // Who's signed in ({ fid, username, pfp, ... }) or null. Asked once per page.
  let meP;
  const me = () => (meP ??= api("/api/me").catch(() => null));

  // This browser's storage, as JSON. It can be missing (private windows), so
  // every call is wrapped.
  const store = {
    get: (k) => { try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };

  // ---------------------------------------------------------------- sound
  // Square-wave blips. Browsers allow sound only after the first click or key,
  // so the first one unlocks it. "m" on home turns sound on and off everywhere.
  let ac = null;
  const unlock = () => { if (!ac) try { ac = new AudioContext(); } catch { return; } if (ac.state === "suspended") ac.resume(); };
  addEventListener("pointerdown", unlock);
  addEventListener("keydown", unlock);
  const soundOn = () => { try { return localStorage.getItem("cc-sound") !== "off"; } catch { return true; } };
  const setSound = (on) => { try { localStorage.setItem("cc-sound", on ? "on" : "off"); } catch {} };
  // tone(frequency, start, length, volume or { vol, to }): `to` slides the pitch.
  function tone(f, at, dur, opt = 0.035) {
    const { vol = 0.035, to } = typeof opt === "number" ? { vol: opt } : opt;
    if (!ac || !soundOn() || ac.state !== "running") return;
    const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
    o.type = "square"; o.frequency.setValueAtTime(f, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- toast
  let toastT;
  function toast(msg, ms = 2000) {
    const t = $("#toast");
    if (!t) return;
    t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms);
  }

  // ---------------------------------------------------------------- modes bar
  // The same bar on every page; only the highlight moves. A page marks where it
  // goes with <nav class="bar" data-modes="<current>"><div class="in">…hint…</div></nav>
  // and the buttons are put in front of its hint.
  const MODES = [
    { id: "home", label: "home", href: "/" },
    { id: "inbox", label: "inbox", href: "/inbox" },
    { id: "compose", label: "compose", href: "/post" },
    { id: "apps", label: "apps", href: "/apps" },
    { id: "keys", label: "keys", href: "/keys" },
    { id: "create", label: "create", soon: true },
  ];
  function modes(current) {
    return MODES.map((m, i) =>
      m.soon
        ? `<button class="mode" type="button" data-mode="${m.id}" aria-disabled="true" title="coming soon"><span class="k">${i + 1}</span>${m.label}<span class="soon">soon</span></button>`
        : `<a class="mode" href="${m.href}" data-mode="${m.id}"${m.id === current ? ' aria-current="page"' : ""}><span class="k">${i + 1}</span>${m.label}</a>`,
    ).join("");
  }
  const bar = document.querySelector("[data-modes]");
  if (bar) {
    const inner = bar.querySelector(".in") ?? bar;
    inner.insertAdjacentHTML("afterbegin", modes(bar.dataset.modes));
    // Every page but home (which has its own cursor) goes to a mode on its number.
    if (bar.dataset.modes !== "home")
      addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
        const m = MODES[Number(e.key) - 1];
        if (m?.href && m.id !== bar.dataset.modes) location.href = m.href;
        else if (m?.soon) toast(`${m.label} is coming soon`);
      });
    inner.addEventListener("click", (e) => { const b = e.target.closest?.('.mode[aria-disabled="true"]'); if (b) toast(`${b.dataset.mode} is coming soon`); });
  }

  // ---------------------------------------------------------------- buttons
  // kit.button(label, { size: "lg", look: "primary" | "quiet", key: "⌘↵",
  //   pressed, disabled, busy, fixed, push, attrs }). label is HTML: escape text.
  function button(label, o = {}) {
    const cls = ["k-btn", o.size === "lg" && "lg", o.look, o.fixed && "fixed", o.push && "push", o.cls].filter(Boolean).join(" ");
    const state = [o.pressed !== undefined && `aria-pressed="${Boolean(o.pressed)}"`, o.disabled && `aria-disabled="true"`, o.busy && `aria-busy="true"`].filter(Boolean).join(" ");
    const type = /\btype=/.test(o.attrs ?? "") ? "" : ' type="button"'; // a form's submit button passes its own
    return `<button${type} class="${cls}"${state ? ` ${state}` : ""}${o.attrs ? ` ${o.attrs}` : ""}><span class="k-lbl">${label}</span>${o.key ? ` <kbd>${esc(o.key)}</kbd>` : ""}</button>`;
  }
  // kit.seg([[id, label], ...], current, attr = "data-tab"): one choice on.
  const seg = (choices, current, attr = "data-tab") =>
    `<span class="k-seg" role="group">${choices.map(([id, label]) => `<button type="button" ${attr}="${esc(id)}" aria-pressed="${current === id}">${label}</button>`).join("")}</span>`;

  // ---------------------------------------------------------------- apps filter
  // Which apps' casts to show (the apps page sets it, the inbox and home use
  // it). Kept in this browser only. Apps are fids; "?" is casts whose app is
  // unknown. { only: fid | null, hide: [fid], names: { fid: "name" } }
  const FARCASTER_APP = 9152; // the Farcaster app's fid, still named @warpcast
  const APPS_KEY = "fameboy-apps";
  const appFilter = {
    get: () => {
      const f = store.get(APPS_KEY) ?? {};
      return { only: f.only ?? null, hide: Array.isArray(f.hide) ? f.hide : [], names: f.names ?? {} };
    },
    set: (f) => store.set(APPS_KEY, f),
    clear: () => store.del(APPS_KEY),
    // Does a cast through this app (fid or undefined) pass?
    keeps(app, f = appFilter.get()) {
      const k = app ?? "?";
      return f.only !== null ? k === f.only : !f.hide.includes(k);
    },
    on: (f = appFilter.get()) => f.only !== null || f.hide.length > 0,
    name: (k, f = appFilter.get()) => (k === "?" ? "unknown apps" : `@${f.names[k] ?? `!${k}`}`),
    // "only @x" or "hiding @warpcast, @y", for a page to say what it's leaving out.
    describe(f = appFilter.get()) {
      if (f.only !== null) return `only ${appFilter.name(f.only, f)}`;
      return f.hide.length ? `hiding ${f.hide.map((k) => appFilter.name(k, f)).join(", ")}` : "";
    },
  };

  // ---------------------------------------------------------------- requests
  // Every answer from the local server lists the node calls it made. This
  // panel collects them for the page, grouped by route, each one a curl
  // command away. It opens from a tab above the bottom bar, or with `.
  const WHY = {
    "/v1/info": "node status",
    "/v1/linksByFid": "who an account follows",
    "/v1/linksByTargetFid": "who follows an account",
    "/v1/linkById": "does one account follow another",
    "/v1/castsByFid": "latest casts from an account",
    "/v1/castsByParent": "replies to a cast",
    "/v1/castById": "one cast, to confirm a write",
    "/v1/reactionsByCast": "likes or recasts on a cast",
    "/v1/reactionById": "one like or recast, to confirm a write",
    "/v1/signersByFid": "an account's app keys, and which app asked for each",
    "/v1/signer": "is this key active",
    "/v1/userDataByFid": "names and avatars",
    "/v1/userNameProofByName": "username to account number",
    "/v1/storageLimitsByFid": "storage the account has",
    "/v1/onChainEventsByFid": "keys added on chain",
    "/v1/events": "recent blocks, for activity",
    "/v1/validateMessage": "check a signed message",
    "/v1/submitMessage": "send a signed message",
  };
  const requests = (() => {
    const list = []; // { call, at, ms } or { note }, oldest first
    const open = new Set(); // routes left open across repaints
    let node = null, el, tab, body, isOpen = false;
    const clock = (t) => new Date(t).toLocaleTimeString([], { hour12: false });
    const real = () => list.filter((c) => !c.note);
    const routeOf = (c) => c.call.split("?")[0];

    function add(calls, note) {
      if (note) list.push({ note });
      for (const c of calls) if (c?.call) list.push(c);
      if (list.length > 6000) list.splice(0, list.length - 6000);
      paint(true);
    }

    function table(calls) {
      return `<table><tbody>${calls.slice().reverse().slice(0, 150).map((c) => {
        const sp = c.call.indexOf(" "), method = c.call.slice(0, sp), path = c.call.slice(sp + 1);
        const curl = node && method === "GET" ? `curl "${node}${path}"` : "";
        return `<tr><td class="t">${clock(c.at)}</td><td class="p">${method === "GET" ? "" : `<b>${esc(method)}</b> `}${esc(path).replace(/([?&])/g, "<wbr>$1")}</td><td class="ms">${c.ms} ms</td>
          <td class="cp">${curl ? `<button type="button" class="rq-copy" data-curl="${esc(curl)}">copy curl</button>` : ""}</td></tr>`;
      }).join("")}${calls.length > 150 ? `<tr><td colspan="4" class="t">…and ${calls.length - 150} older</td></tr>` : ""}</tbody></table>`;
    }

    function paint(fresh) {
      if (!tab) return;
      const n = real().length;
      tab.querySelector(".rq-n").textContent = n;
      if (fresh && !isOpen) { tab.classList.remove("ping"); void tab.offsetWidth; tab.classList.add("ping"); }
      if (!isOpen) return;
      if (!n && !list.length) { body.innerHTML = `<p class="dim">No calls yet. Each view lists the node calls behind it here.</p>`; return; }
      const groups = new Map();
      for (const c of real()) {
        const k = routeOf(c), g = groups.get(k) ?? { k, calls: [], first: c.at, ms: 0 };
        g.calls.push(c); g.ms += c.ms; groups.set(k, g);
      }
      const rows = [...groups.values()];
      const max = Math.max(1, ...rows.map((g) => g.calls.length));
      const r = real(), span = r.length ? (Math.max(...r.map((c) => c.at + c.ms)) - Math.min(...r.map((c) => c.at))) / 1000 : 0;
      const keep = body.scrollTop;
      body.innerHTML = `<div class="rq-sum"><span><b>${n}</b> call${n === 1 ? "" : "s"}</span><span><b>${rows.length}</b> route${rows.length === 1 ? "" : "s"}</span><span><b>${span.toFixed(1)} s</b> first to last</span>
          <span class="dim">to ${node ? esc(node) : "your node"}</span></div>
        ${list.filter((c) => c.note).map((c) => `<p class="rq-note">${esc(c.note)}</p>`).join("")}
        <div class="rq-routes">${rows.map((g, i) => {
          const sp = g.k.indexOf(" "), method = g.k.slice(0, sp), path = g.k.slice(sp + 1);
          return `<details data-k="${esc(g.k)}"${open.has(g.k) ? " open" : ""}><summary>
            <span class="i">${i + 1}</span>
            <span class="r">${method === "GET" ? "" : `<b>${esc(method)}</b> `}${esc(path.replace("/v1/", ""))}<span class="why">${esc(WHY[path] ?? "")}</span></span>
            <span class="rbar"><i style="width:${Math.max(4, (g.calls.length / max) * 100)}%"></i></span>
            <span class="n">${g.calls.length}×</span><span class="ms">avg ${Math.round(g.ms / g.calls.length)} ms</span>
          </summary>${table(g.calls)}</details>`;
        }).join("")}</div>
        <p class="dim small">Copy a request and run it yourself: your node gives the same answer.</p>`;
      body.scrollTop = keep;
    }

    function toggle(on = !isOpen) {
      if (!el) return;
      isOpen = on;
      el.classList.toggle("open", on);
      tab.setAttribute("aria-expanded", String(on));
      body.closest(".rq-panel").hidden = !on;
      tab.classList.remove("ping");
      if (on && !node) api("/api/status").then((s) => { node = s.node; paint(); }, () => {});
      paint();
    }

    // Sit just above whatever is fixed to the bottom: the modes bar, or a footer.
    function mount() {
      const dock = document.querySelector("[data-modes], body > .foot");
      el = document.createElement("div");
      el.className = "rq";
      el.innerHTML = `<button type="button" class="rq-tab" aria-expanded="false" aria-controls="rq-panel" title="The node calls behind this page (\`)"><span class="arr" aria-hidden="true"></span>requests <span class="rq-n">0</span></button>
        <section class="rq-panel" id="rq-panel" role="region" aria-label="Requests" hidden>
          <h2><span>requests</span><span><span class="rq-what">this page's calls to your node · </span><button type="button" class="rq-x">close <kbd>esc</kbd></button></span></h2>
          <div class="rq-body"></div>
        </section>`;
      document.body.append(el);
      tab = el.querySelector(".rq-tab"); body = el.querySelector(".rq-body");
      const place = () => el.style.setProperty("--dock", `${dock ? dock.offsetHeight : 0}px`);
      place();
      if (dock && window.ResizeObserver) new ResizeObserver(place).observe(dock);
      tab.addEventListener("click", () => toggle());
      el.querySelector(".rq-x").addEventListener("click", () => toggle(false));
      el.addEventListener("toggle", (e) => { const d = e.target; if (d.dataset?.k) d.open ? open.add(d.dataset.k) : open.delete(d.dataset.k); }, true);
      el.addEventListener("click", async (e) => {
        const b = e.target.closest(".rq-copy");
        if (!b) return;
        try { await navigator.clipboard.writeText(b.dataset.curl); b.textContent = "copied"; }
        catch { b.textContent = "couldn't copy"; }
        setTimeout(() => (b.textContent = "copy curl"), 1400);
      });
      // Before the page's own keys, so esc closes this instead of leaving the page.
      addEventListener("keydown", (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
        if (e.key === "`") { toggle(); e.preventDefault(); e.stopImmediatePropagation(); }
        else if (e.key === "Escape" && isOpen) { toggle(false); e.preventDefault(); e.stopImmediatePropagation(); }
      }, true);
      paint();
    }
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", mount);
    else mount();
    return { add, toggle, list };
  })();

  window.kit = { button, seg, $, wait, esc, ext, arrow, TOKEN, SignedOut, api, me, store, unlock, soundOn, setSound, tone, toast, modes, MODES, requests, appFilter, FARCASTER_APP };
})();
