// clearcast's UI kit: what every page shares. Components are functions that
// return HTML strings (the pages build their views from strings); the rest are
// small helpers (api, store, sound, toast) and the modes bar.
// Load it before the page's own script:
//   <link rel="stylesheet" href="/kit.css"> <script src="/kit.js"></script>
//
// kit.ext(href, label, opts)  a link that leaves clearcast. It always opens in
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
  const TOKEN = document.querySelector('meta[name="clearcast-token"]')?.content ?? "";

  // The local server's API. Only this page can call it: it sends the token the
  // server embedded in the page. 401 means signed out.
  // On a hosted clearcast a 401 can just mean the session ended (the server
  // restarted, say): if this browser has a key, sign a new challenge and retry once.
  class SignedOut extends Error {}
  let reauth;
  async function api(path, body, retried = false) {
    const res = await fetch(path, {
      method: body ? "POST" : "GET",
      headers: { "x-clearcast-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && !retried && window.mine) {
      reauth ??= mine.key.session().catch(() => false).finally(() => setTimeout(() => (reauth = undefined), 5000));
      if (await reauth) return api(path, body, true);
    }
    if (res.status === 401) throw new SignedOut(json.error);
    if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
    return json.data;
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
    // Every page but home (which has its own cursor) goes to a mode on 1-4.
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

  window.kit = { button, seg, $, wait, esc, ext, arrow, TOKEN, SignedOut, api, me, store, unlock, soundOn, setSound, tone, toast, modes, MODES };
})();
