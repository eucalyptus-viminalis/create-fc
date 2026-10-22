// clearcast in the browser. Talks only to the local clearcast server (which talks only
// to your node). Everything from the network is escaped before it's shown.

const TOKEN = document.querySelector('meta[name="clearcast-token"]').content;
const FARCASTER_APP = 9152; // the Farcaster app's FID (still named @warpcast)
const $ = (sel) => document.querySelector(sel);

const state = {
  node: "",
  me: null,
  viewAs: null, // you: { fid, username, pfp, following }. The feed is always your own.
  feed: null, // { following, casts }
  feedFor: null,
  hidden: new Set(), // app fids (or "?") hidden from the feed
  keysFor: null,
  log: [],
  // What's been cleared from the feed being viewed: { before, hashes, today }
  cleared: { before: null, hashes: new Set(), today: 0 },
  showCleared: false,
  undo: [], // inverse changes, newest last
  selected: 0, // keyboard position in the visible list
};

// ------------------------------------------------------------------ utils

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 0) return "now";
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// A profile picture, or the name's first letter when there isn't one.
const pic = (url, cls = "", name = "") =>
  url && /^https:\/\//.test(url)
    ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="${cls} ph" aria-hidden="true">${esc(String(name).replace(/^[@!]/, "").charAt(0).toUpperCase())}</span>`;

// A message at the bottom of the page, with an Undo button when `undo` is given.
function toast(msg, undo) {
  const t = $("#toast");
  $("#toast-text").textContent = msg;
  $("#toast-undo").hidden = !undo;
  toast.undo = undo;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), undo ? 5000 : 2600);
  window.Tangerine?.announce?.(msg);
}

const loading = (msg) => `<div class="empty"><span class="tg-spinner" aria-hidden="true"></span><p>${esc(msg)}</p></div>`;
const empty = (msg) => `<div class="empty"><p>${esc(msg)}</p></div>`;

// ------------------------------------------------------------------- API

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-clearcast-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (res.status === 401) showSignedOut(); // the key was removed, e.g. from a terminal
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  if (json.sign) json = await mine.key.answer(json); // hosted: sign in this browser (mine.js)
  for (const c of json.calls ?? []) state.log.unshift(c);
  state.log.length = Math.min(state.log.length, 300);
  renderLog();
  return json;
}

// Recorded node calls ({ call, at, ms }) as a table: when, what, how long,
// and a button that copies the request as a curl command. Identical calls in
// a row (the 15-second status check, say) collapse into one row with a count.
const clock = (t) => new Date(t).toLocaleTimeString([], { hour12: false });
const curlFor = (call) => `curl "${state.node}${call.slice(4)}"`;

function runs(calls) {
  const out = [];
  for (let i = 0; i < calls.length; ) {
    if (calls[i].note) {
      out.push({ note: calls[i].note });
      i++;
      continue;
    }
    let j = i + 1;
    while (j < calls.length && calls[j].call === calls[i].call) j++;
    out.push({ ...calls[i], count: j - i, first: Math.min(...calls.slice(i, j).map((c) => c.at)) });
    i = j;
  }
  return out;
}

function callTable(calls, limit) {
  const rows = runs(calls);
  const max = Math.max(1, ...rows.filter((r) => !r.note).map((r) => r.ms));
  const body = rows
    .slice(0, limit)
    .map((r) => {
      if (r.note) return `<tr class="note"><td colspan="4">${esc(r.note.replace(/^#\s*/, ""))}</td></tr>`;
      const [method, path] = [r.call.slice(0, r.call.indexOf(" ")), r.call.slice(r.call.indexOf(" ") + 1)];
      const isGet = method === "GET";
      const why = r.count > 1 && path.startsWith("/v1/info") ? `<span class="calls-why">status check, every 15 s</span>` : "";
      return `<tr>
        <td class="ct-time" title="${r.count > 1 ? `${r.count} times, ${clock(r.first)} to ${clock(r.at)}` : ""}">${clock(r.at)}${r.count > 1 ? ` <span class="ct-count">×${r.count}</span>` : ""}</td>
        <td class="ct-req"><span class="ct-method">${esc(method)}</span> <span class="ct-path">${esc(path).replace(/([?&])/g, "<wbr>$1")}</span>${why}</td>
        <td class="ct-took"><span class="ct-took-in"><i style="width:${Math.max(2, Math.round((r.ms / max) * 56))}px"></i>${r.ms} ms</span></td>
        <td class="ct-copy">${isGet ? `<button type="button" class="ct-btn" data-curl="${esc(curlFor(r.call))}">Copy curl</button>` : ""}</td>
      </tr>`;
    })
    .join("");
  const more = rows.length > limit ? `<tr class="note"><td colspan="4">…and ${rows.length - limit} more rows</td></tr>` : "";
  return `<table class="calltable"><thead><tr><th>Time</th><th>Request to your node</th><th class="ct-took">Took</th><th></th></tr></thead><tbody>${body}${more}</tbody></table>`;
}

// The same calls grouped by route (the path without its query), one row per
// route in the order it was first called, so a view reads as the steps that
// built it. Each row opens to its own calls.
const WHY = {
  "/v1/info": "node status",
  "/v1/linksByFid": "who an account follows",
  "/v1/linkById": "does one account follow another",
  "/v1/castsByFid": "latest casts from each account",
  "/v1/castById": "one cast, to confirm a write",
  "/v1/reactionById": "one like or recast, to confirm a write",
  "/v1/signersByFid": "which app signed each cast",
  "/v1/signer": "is this key active",
  "/v1/userDataByFid": "names and avatars",
  "/v1/userNameProofByName": "username to account number",
  "/v1/storageLimitsByFid": "storage the account has",
  "/v1/onChainEventsByFid": "keys added on chain",
  "/v1/validateMessage": "check a signed message",
  "/v1/submitMessage": "send a signed message",
};
const routeOf = (c) => c.call.slice(0, c.call.indexOf("?") === -1 ? undefined : c.call.indexOf("?"));
const openRoutes = new Set(); // "<container id> <route>" rows left open across re-renders

function callsByRoute(id, calls, { log = false } = {}) {
  const notes = calls.filter((c) => c.note).map((c) => c.note.replace(/^#\s*/, ""));
  const real = calls.filter((c) => !c.note);
  const groups = new Map();
  for (const c of real) {
    const key = routeOf(c);
    const g = groups.get(key) ?? { key, calls: [], first: Infinity, ms: 0 };
    g.calls.push(c);
    g.first = Math.min(g.first, c.at);
    g.ms += c.ms;
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => a.first - b.first);
  const max = Math.max(1, ...list.map((g) => g.calls.length));
  const start = Math.min(...real.map((c) => c.at));
  const span = log
    ? `<div><b>${clock(start)}</b><span>first call</span></div>`
    : `<div><b>${((Math.max(...real.map((c) => c.at + c.ms)) - start) / 1000).toFixed(1)} s</b><span>start to finish</span></div>`;
  return `<div class="calls-sum"><div><b>${real.length}</b><span>call${real.length === 1 ? "" : "s"}</span></div><div><b>${list.length}</b><span>distinct route${list.length === 1 ? "" : "s"}</span></div>${span}</div>
    ${notes.map((n) => `<p class="calls-note">${esc(n)}</p>`).join("")}
    <div class="routes">${list
      .map((g, i) => {
        const [method, path] = g.key.split(" ");
        return `<details class="route" data-key="${esc(`${id} ${g.key}`)}"${openRoutes.has(`${id} ${g.key}`) ? " open" : ""}><summary>
          <span class="route__step">${i + 1}</span>
          <span class="route__name">${method === "GET" ? "" : `<span class="ct-method">${esc(method)}</span> `}${esc(path.replace("/v1/", ""))}<span class="route__why">${esc(WHY[path] ?? "")}</span></span>
          <span class="route__bar"><i style="width:${(g.calls.length / max) * 100}%"></i></span>
          <span class="route__n">${g.calls.length} <small>×</small></span>
          <span class="route__ms">avg ${Math.round(g.ms / g.calls.length)} ms</span>
          <span class="route__chev" aria-hidden="true">›</span>
        </summary><div class="route__calls">${callTable(g.calls, 150)}</div></details>`;
      })
      .join("")}</div>`;
}

document.addEventListener(
  "toggle",
  (e) => {
    const d = e.target;
    if (!d.classList?.contains("route")) return;
    d.open ? openRoutes.add(d.dataset.key) : openRoutes.delete(d.dataset.key);
  },
  true,
);

function showCalls(id, calls) {
  const real = calls.filter((c) => !c.note);
  $(id).innerHTML = `<summary>Show the ${real.length} API call${real.length === 1 ? "" : "s"} to your node behind this view</summary>
    <div class="calltable-card calls-card">${callsByRoute(id, calls)}</div>`;
}

function renderLog() {
  $("#call-log").innerHTML = state.log.length ? callsByRoute("#call-log", state.log, { log: true }) : `<p class="empty">Nothing yet.</p>`;
}

// ----------------------------------------------------------------- status

async function refreshStatus() {
  try {
    const { data } = await api("/api/status");
    state.node = data.node;
    const lag = Math.max(...data.shards.map((s) => s.blockDelay));
    const pill = $("#node-pill");
    pill.classList.toggle("is-synced", lag < 10);
    pill.classList.toggle("is-behind", lag >= 10);
    // How fast is it catching up? Compare with the previous reading.
    const now = Date.now();
    const prev = state.lastLag;
    state.lastLag = { lag, at: now };
    let eta = "";
    if (prev && lag >= 10 && now - prev.at > 5000) {
      const gain = (prev.lag - lag) / ((now - prev.at) / 1000); // seconds of lag closed per second
      if (gain > 0.2) {
        const h = lag / gain / 3600;
        eta = h >= 1 ? ` · ~${h.toFixed(1)} h to go` : ` · ~${Math.max(1, Math.round(h * 60))} min to go`;
      }
    }
    $("#node-pill-text").textContent = lag < 10 ? `in sync · ${new URL(data.node).hostname}` : `catching up · ${(lag / 3600).toFixed(1)} h behind${eta}`;
    pill.title = lag < 10 ? "Your node is in sync." : "Your node is still fetching blocks made since its snapshot. Reads work; the newest casts may be missing.";
    $("#node-card").innerHTML = `
      <dl><dt>Address</dt><dd>${esc(data.node)}</dd><dt>Snapchain</dt><dd>${esc(data.version)}</dd>
      <dt>Status</dt><dd>${lag < 10 ? "in sync" : `catching up, ${(lag / 3600).toFixed(1)} h behind. Recent casts may be missing.`}</dd></dl>
      <div class="shards">${data.shards
        .map(
          (s) =>
            `<div class="shard"><span>Shard ${s.shardId}</span><span>height ${s.maxHeight.toLocaleString()}</span><span class="shard__lag">${s.blockDelay}s behind</span></div>`,
        )
        .join("")}</div>`;
  } catch (e) {
    $("#node-pill-text").textContent = "node unreachable";
    $("#node-card").innerHTML = empty(`Can't reach your node: ${e.message}`);
  }
}

// ------------------------------------------------------------------- feed

function appCounts(casts) {
  const counts = new Map();
  for (const c of casts) {
    const k = c.app ? c.app.fid : "?";
    const e = counts.get(k) ?? { fid: k, name: c.app?.name ?? "unknown app", pfp: null, n: 0 };
    e.n++;
    counts.set(k, e);
  }
  return [...counts.values()].sort((a, b) => b.n - a.n);
}

async function loadFeed() {
  if (!state.viewAs) return;
  if (state.feedFor === state.viewAs.fid && state.feed) return renderFeed();
  $("#feed-list").innerHTML = loading("Building your feed from your node…");
  $("#filterbar").hidden = true;
  try {
    const fresh = loadFeed.fresh ? "?fresh=1" : "";
    loadFeed.fresh = false;
    const [{ data }, cleared] = await Promise.all([api(`/api/feed${fresh}`), mine.feedCleared(state.viewAs.fid)]);
    setCleared(cleared);
    const calls = data.calls;
    const age = Math.round((Date.now() - data.builtAt) / 1000);
    if (age > 2) calls.unshift({ note: `# built ${age}s ago and kept for 2 minutes; these are the calls that built it` });
    if (age <= 2) {
      for (const c of calls) state.log.unshift(c);
      state.log.length = Math.min(state.log.length, 300);
      renderLog();
    }
    state.feed = data;
    state.feedFor = state.viewAs.fid;
    for (const c of data.casts) if (c.app?.pfp) appPfps.set(c.app.fid, c.app.pfp);
    showCalls("#calls-feed", calls);
    showCalls("#calls-apps", calls);
    renderFeed();
    renderApps();
  } catch (e) {
    $("#feed-list").innerHTML = empty(e.message);
  }
}

// ------------------------------------------------------------------ clear
// Clearing a cast is like archiving an email: it leaves your feed, privately,
// in this browser (mine.js). The server never sees the list.

function setCleared(c) {
  state.cleared = { before: c.before ?? null, hashes: new Set(Object.keys(c.hashes)), today: c.today.n };
}

const isCleared = (c) => (state.cleared.before && c.time <= state.cleared.before) || state.cleared.hashes.has(c.hash);
const notHidden = (c) => !state.hidden.has(c.app ? c.app.fid : "?");

async function changeCleared(change, inverse, message) {
  try {
    setCleared(await mine.changeFeedCleared(state.viewAs.fid, change));
    if (inverse) {
      state.undo.push(inverse);
      toast(message, true);
    }
  } catch (e) {
    toast(e.message);
  }
  renderFeed();
}

// Clear these casts, after a short slide-out.
function clearCasts(casts, message) {
  casts = casts.filter((c) => !isCleared(c));
  if (!casts.length) return;
  const hashes = new Set(casts.map((c) => c.hash));
  document.querySelectorAll(".cast[data-hash]").forEach((el) => hashes.has(el.dataset.hash) && el.classList.add("is-clearing"));
  setTimeout(
    () =>
      changeCleared(
        { add: casts.map((c) => ({ hash: c.hash, time: c.time })) },
        { remove: [...hashes] },
        message ?? (casts.length === 1 ? "Cleared" : `Cleared ${casts.length}`),
      ),
    casts.length > 30 ? 0 : 260,
  );
}

// Everything up to a time, as one line in the file ("clear all").
function clearBefore(time, n, message) {
  changeCleared({ before: time, counted: n }, { before: state.cleared.before, counted: -n }, message);
}

function undoClear() {
  const inverse = state.undo.pop();
  if (!inverse) return toast("Nothing to undo");
  $("#toast").hidden = true;
  changeCleared(inverse);
}

function unread() {
  return (state.feed?.casts ?? []).filter((c) => notHidden(c) && !isCleared(c));
}

function renderInbox(all, left) {
  const el = $("#inbox");
  el.hidden = all.length === 0;
  if (!all.length) return;
  el.classList.toggle("is-clear", left.length === 0);
  const clearedHere = all.filter(notHidden).length - left.length;
  const midnight = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
  const older = left.filter((c) => c.time < midnight).length;
  el.innerHTML = `<div class="inbox__count"><b>${left.length}</b><span>left to read · ${state.cleared.today} cleared today</span></div>
    <div class="inbox__actions">
      ${left.length ? `<button type="button" class="glass-btn" data-clear-all>✓ Clear all</button>` : ""}
      ${older && older < left.length ? `<button type="button" class="glass-btn glass-btn--quiet" data-clear-older>Clear before today (${older})</button>` : ""}
      <button type="button" class="glass-btn glass-btn--quiet" data-refresh title="Ask your node again for the newest casts">↻ Check for new</button>
      ${clearedHere ? `<button type="button" class="link-btn" data-show-cleared aria-pressed="${state.showCleared}">${state.showCleared ? "Hide" : "Show"} ${clearedHere} cleared</button>` : ""}
    </div>`;
  document.title = left.length ? `(${left.length}) clearcast` : "clearcast";
}

function castHtml(c, i) {
  const name = c.author.username ?? `!${c.fid}`;
  const via = c.app
    ? `<button type="button" class="via" data-hide="${c.app.fid}" title="Hide casts from @${esc(c.app.name)}">via @${esc(c.app.name)}</button>`
    : `<span class="via via--unknown">via unknown app</span>`;
  const actions = state.me
    ? `<div class="cast__actions">
        <button type="button" class="act" data-act="like" data-i="${i}" aria-pressed="false">♡ Like</button>
        <button type="button" class="act" data-act="recast" data-i="${i}" aria-pressed="false">↻ Recast</button>
      </div>`
    : "";
  const done = isCleared(c);
  const clear = `<div class="cast__clear">
      ${done ? `<button type="button" class="clear-btn" data-unclear="${i}">Bring back</button>` : `<button type="button" class="clear-btn" data-clear="${i}" title="Clear (e)">✓ Clear</button>`}
    </div>`;
  return `<article class="cast card${done ? " is-cleared" : ""}" data-hash="${esc(c.hash)}" data-i="${i}">
    ${pic(c.author.pfp, "avatar", name)}
    <div class="cast__body">
      <div class="cast__head">
        <span class="cast__name">${esc(c.author.display || name)}</span>
        <span class="cast__meta">@${esc(name)} · ${ago(c.time)}${c.channel ? ` · /${esc(c.channel)}` : ""}${c.replyTo ? " · reply" : ""}</span>
        ${via}
      </div>
      <div class="cast__text">${linkify(c.text)}</div>
      ${c.embeds.length ? `<div class="cast__embeds">${c.embeds.map((u) => (u.startsWith("http") ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : `<span>${esc(u)}</span>`)).join("")}</div>` : ""}
      <div class="cast__foot">${actions}${clear}</div>
    </div>
  </article>`;
}

function renderFeed() {
  const all = state.feed?.casts ?? [];
  const left = unread();
  renderInbox(all, left);
  const shown = state.showCleared ? all.filter(notHidden) : left;
  const counts = appCounts(all);
  $("#filterbar").hidden = all.length === 0;
  $("#appchips").innerHTML = counts
    .map(
      (a) =>
        `<button type="button" class="appchip" data-app="${a.fid}" aria-pressed="${!state.hidden.has(a.fid)}">${a.fid === "?" ? "" : pic(feedAppPfp(a.fid))}${a.fid === "?" ? "" : "@"}${esc(a.name)} <span class="n">${a.n}</span></button>`,
    )
    .join("");
  $("#keys-hint").hidden = !shown.length;
  state.selected = Math.min(state.selected, Math.max(0, Math.min(shown.length, 120) - 1));
  $("#feed-list").innerHTML = shown.length
    ? shown.slice(0, 120).map((c) => castHtml(c, all.indexOf(c))).join("")
    : all.filter(notHidden).length
      ? `<div class="all-clear"><b>All clear.</b><p>You've read everything here. New casts show up when you check again.</p><button type="button" class="glass-btn" data-refresh>↻ Check for new</button></div>`
      : all.length
      ? empty("Every app in your feed is hidden. Click a chip above to show it again.")
      : `<div class="empty"><p>${state.feed?.following ? "No recent casts from the accounts you follow." : "You don't follow anyone yet, so your feed is empty."}</p>
         <p>Follow someone above, for example <button type="button" class="link-btn" data-follow="dwr">@dwr</button> or <button type="button" class="link-btn" data-follow="vitalik.eth">@vitalik.eth</button>.</p></div>`;
  select(state.selected);
}

function select(n, scroll) {
  const items = [...document.querySelectorAll("#feed-list .cast")];
  if (!items.length) return;
  state.selected = Math.max(0, Math.min(items.length - 1, n));
  items.forEach((el, k) => el.classList.toggle("is-selected", k === state.selected));
  if (scroll) items[state.selected].scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

// App avatars come from the profiles the server already looked up.
const appPfps = new Map();
const feedAppPfp = (fid) => appPfps.get(fid);

// Your feed's header, with a box to follow someone by name.
function renderWho() {
  const v = state.viewAs;
  const el = $("#who");
  el.hidden = false;
  el.innerHTML = `${pic(v.pfp, "avatar", v.username ?? String(v.fid))}<div class="who__text"><b>Your feed</b><br />The latest casts from the ${v.following?.toLocaleString() ?? "?"} accounts you follow</div>
    <form class="follow-form" id="follow-form"><input name="user" autocomplete="off" spellcheck="false" placeholder="@username" aria-label="Username to follow" /><button class="glass-btn" type="submit">Follow</button></form>`;
}

async function followUser(user, on = true) {
  try {
    const { data } = await api("/api/follow", { user, on });
    const name = `@${data.user.username ?? data.user.fid}`;
    toast(data.landed ? `${on ? "Following" : "Unfollowed"} ${name}. Check for new to see their casts.` : "Sent, but not visible on your node yet");
    if (data.landed) state.viewAs.following = (state.viewAs.following ?? 0) + (on ? 1 : -1), renderWho();
  } catch (e) {
    toast(e.message);
  }
}

// --------------------------------------------------------- apps in feed

function renderApps() {
  const all = state.feed?.casts ?? [];
  if (!all.length) {
    $("#apps-bars").innerHTML = empty("Open the feed first: this view is built from it.");
    return;
  }
  const counts = appCounts(all);
  const top = counts[0];
  const pct = (n) => Math.round((n / all.length) * 100);
  $("#apps-top").innerHTML = `<strong class="tg-numeral">${pct(top.n)}%</strong>
    <p>of the latest ${all.length} casts from the ${state.feed.following.toLocaleString()} accounts you follow came through <b>@${esc(top.name)}</b>. ${counts.length} apps in total.</p>`;
  $("#apps-bars").innerHTML = counts
    .map(
      (a) => `<button type="button" class="bar" data-only="${a.fid}" title="Show only @${esc(a.name)} in the feed">
        <span class="bar__name">${a.fid === "?" ? "" : pic(feedAppPfp(a.fid))}${a.fid === "?" ? "" : "@"}${esc(a.name)}</span>
        <span class="bar__track"><span class="bar__fill" style="width:${Math.max(1, pct(a.n))}%"></span></span>
        <span class="bar__pct">${pct(a.n) || "<1"}%</span>
      </button>`,
    )
    .join("");
}

// ----------------------------------------------------- who can post as …

async function loadKeys() {
  if (!state.viewAs) return;
  if (state.keysFor === state.viewAs.fid) return;
  $("#keys-list").innerHTML = loading("Asking your node for your keys…");
  $("#keys-summary").innerHTML = "";
  try {
    const { data: keys, calls } = await api("/api/keys");
    state.keysFor = state.viewAs.fid;
    showCalls("#calls-keys", calls);
    const groups = new Map();
    for (const k of keys) {
      const id = k.app ? k.app.fid : "?";
      if (!groups.has(id)) groups.set(id, { app: k.app, keys: [] });
      groups.get(id).keys.push(k);
      if (k.app?.pfp) appPfps.set(k.app.fid, k.app.pfp);
    }
    const anything = keys.filter((k) => k.source === "onchain").length;
    $("#keys-summary").innerHTML = `
      <div><strong class="tg-numeral">${keys.length}</strong><span>keys can post as you</span></div>
      <div><strong class="tg-numeral">${groups.size}</strong><span>apps hold them</span></div>
      <div><strong class="tg-numeral">${anything}</strong><span>can sign anything</span></div>`;
    const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : "?");
    $("#keys-list").innerHTML = [...groups.values()]
      .sort((a, b) => b.keys.length - a.keys.length)
      .map(({ app, keys: ks }) => {
        const onchain = ks.filter((k) => k.source === "onchain").length;
        const scoped = ks.length - onchain;
        const oldest = Math.min(...ks.map((k) => k.addedAt ?? Infinity));
        const expires = ks.filter((k) => k.expiresAt).map((k) => k.expiresAt);
        const scopes = [...new Set(ks.flatMap((k) => k.scopes))];
        const mine = state.me && ks.some((k) => k.key.toLowerCase() === state.me.publicKey?.toLowerCase());
        return `<article class="keyapp card${mine ? " keyapp--mine" : ""}">
          ${pic(app?.pfp, "avatar", app?.name ?? "?")}
          <div>
            <div class="keyapp__name">${app ? `@${esc(app.name ?? app.fid)}` : "Unknown app"} <span class="cast__meta">${app ? `fid ${app.fid}` : ""}</span>${mine ? `<span class="mine-tag">includes this computer's key</span>` : ""}</div>
            <div class="keyapp__meta">${ks.length} key${ks.length === 1 ? "" : "s"}${Number.isFinite(oldest) ? ` · since ${day(oldest)}` : ""}${
              expires.length ? ` · gasless, expires ${day(Math.max(...expires))} unless used` : ""
            }${scopes.length ? `<br />can: ${esc(scopes.join(", ").toLowerCase().replaceAll("_", " "))}` : ""}</div>
          </div>
          <span class="keyapp__power ${onchain ? "power--all" : "power--scoped"}">${onchain ? "can sign anything" : `${scoped} scoped key${scoped === 1 ? "" : "s"}`}</span>
        </article>`;
      })
      .join("");
    if (state.feed) renderFeed(), renderApps();
  } catch (e) {
    $("#keys-list").innerHTML = empty(e.message);
  }
}

// ------------------------------------------------------- signed in or out

// Signed out, the page only explains how to sign in, and checks every few
// seconds whether you have.
function showSignedOut() {
  if (!$("#signin").hidden) return;
  state.me = state.viewAs = state.feed = null;
  state.keysFor = null;
  $("#app").hidden = true;
  $("#signin").hidden = false;
  $("#me-chip").hidden = true;
  $("#signout-btn").hidden = true;
  document.title = "clearcast";
  $("#app-body").innerHTML = `<button type="button" class="tg-btn tg-btn--ink tg-btn--sm" id="app-start">Show the code</button>`;
  loadSignInOptions();
  clearInterval(showSignedOut.poll);
  showSignedOut.poll = setInterval(async () => {
    const me = await api("/api/me").then((r) => r.data, () => null);
    if (me) {
      clearInterval(showSignedOut.poll);
      showSignedIn(me);
    }
  }, 3000);
}

async function showSignedIn(me) {
  state.me = me;
  const name = me.username ?? `!${me.fid}`;
  $("#signin").hidden = true;
  $("#app").hidden = false;
  const chip = $("#me-chip");
  chip.hidden = false;
  chip.innerHTML = `${pic(me.pfp, "avatar", name)}<span><small>Signed in as</small><b>@${esc(name)}</b></span>`;
  chip.title = `This computer holds an app key for @${name}, so you can cast, like and follow.`;
  $("#signout-btn").hidden = false;
  $("#composer").hidden = false;
  $("#composer .avatar").outerHTML = pic(me.pfp, "avatar", name);
  try {
    const { data } = await api("/api/profile");
    state.viewAs = { fid: data.fid, username: data.username, pfp: data.pfp, following: data.following };
  } catch (e) {
    return toast(e.message);
  }
  state.feed = null;
  state.hidden.clear();
  state.undo = [];
  state.showCleared = false;
  state.selected = 0;
  renderWho();
  const view = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.view;
  if (view === "keys") loadKeys();
  else loadFeed();
}

// ---------------------------------------------------------------- sign in

async function loadSignInOptions() {
  const { data } = await api("/api/signin/options").catch(() => ({ data: { app: null, phrase: false } }));
  $("#way-phrase").hidden = !data.phrase;
  if (!data.app)
    $("#app-body").innerHTML = `<p class="signin__off">Not set up here yet. Whoever runs this clearcast sets it up once, in a terminal: <code>clearcast app-account</code></p>`;
  else signInApp.app = data.app;
}

// 1. Approve in the Farcaster app: show a QR code, then poll until the key is
// on chain and your node has it.
async function signInApp() {
  const body = $("#app-body");
  body.innerHTML = loading("Asking Farcaster for a sign-in code…");
  let req;
  try {
    req = (await api("/api/signin/app", {})).data;
  } catch (e) {
    body.innerHTML = `<p class="signin__err">${esc(e.message)}</p><button type="button" class="glass-btn" id="app-start">Try again</button>`;
    return;
  }
  const app = signInApp.app;
  body.innerHTML = `<div class="signin__qr">${req.qr}</div>
    <div class="signin__steps">
      <p>Scan with your phone's camera and approve in the Farcaster app. On a phone? <a href="${esc(req.url)}">Open the Farcaster app</a>.</p>
      <p class="signin__fine">It will say <b>@${esc(app?.username ?? app?.fid)}</b>${app?.display ? ` (${esc(app.display)})` : ""} is asking to post on your behalf: that's the account whoever runs this clearcast set up to ask. Approving adds the key on chain${req.sponsored ? ", and the fee is covered" : "; the app may ask you to cover a small fee"}.</p>
      <p class="signin__status" id="app-status"><span class="tg-spinner" aria-hidden="true"></span> Waiting for you to approve…</p>
    </div>`;
  const labels = { pending: "Waiting for you to approve…", approved: "Approved. Adding the key on chain…", completed: "On chain. Waiting for your node to see it…", syncing: "On chain. Waiting for your node to see it…" };
  clearInterval(signInApp.poll);
  signInApp.poll = setInterval(async () => {
    if ($("#signin").hidden) return clearInterval(signInApp.poll);
    try {
      const { data } = await api(`/api/signin/app?token=${encodeURIComponent(req.token)}`);
      if (data.state === "signed-in") {
        clearInterval(signInApp.poll);
        const me = (await api("/api/me")).data;
        if (me) showSignedIn(me);
        return;
      }
      $("#app-status").innerHTML = `<span class="tg-spinner" aria-hidden="true"></span> ${labels[data.state] ?? esc(data.state)}`;
    } catch (e) {
      clearInterval(signInApp.poll);
      $("#app-status").innerHTML = `${esc(e.message)} <button type="button" class="link-btn" id="app-start">Start again</button>`;
    }
  }, 2000);
}

// 2. Seed phrase, this computer only: the same steps as clearcast login.
$("#phrase-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#phrase-input");
  const phrase = input.value;
  input.value = ""; // don't leave it sitting in the page
  if (!phrase.trim()) return;
  const log = $("#phrase-log");
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  log.hidden = false;
  log.innerHTML = "";
  const show = (lines, cls = "") => (log.innerHTML = lines.map((l) => `<li class="${cls}">${esc(l)}</li>`).join(""));
  try {
    const { data } = await api("/api/signin/phrase", { phrase });
    const poll = setInterval(async () => {
      try {
        const { data: job } = await api(`/api/signin/phrase?job=${data.job}`);
        show(job.lines);
        if (!job.done) return;
        clearInterval(poll);
        btn.disabled = false;
        if (job.error) return log.insertAdjacentHTML("beforeend", `<li class="signin__err">${esc(job.error)}</li>`);
        const me = (await api("/api/me")).data;
        if (me) showSignedIn(me);
      } catch (err) {
        clearInterval(poll);
        btn.disabled = false;
        log.insertAdjacentHTML("beforeend", `<li class="signin__err">${esc(err.message)}</li>`);
      }
    }, 1000);
  } catch (err) {
    btn.disabled = false;
    show([err.message], "signin__err");
  }
});

document.addEventListener("click", (e) => {
  if (e.target.closest("#app-start")) signInApp();
});

$("#signout-btn").addEventListener("click", () => {
  $("#signout-name").textContent = `@${state.me?.username ?? state.me?.fid}`;
  $("#signout-dialog").showModal();
});
$("#signout-dialog").addEventListener("close", async () => {
  if ($("#signout-dialog").returnValue !== "signout") return;
  try {
    await api("/api/signout", { device: (await mine.device()).id });
    toast("Signed out. The app key is gone from this computer.");
  } catch (e) {
    return toast(e.message);
  }
  showSignedOut();
});

// ----------------------------------------------------------------- events

document.addEventListener("submit", (e) => {
  if (e.target.id !== "follow-form") return;
  e.preventDefault();
  const user = e.target.user.value.trim().replace(/^@/, "");
  if (user) followUser(user).then(() => (e.target.user.value = ""));
});

document.addEventListener("click", async (e) => {
  const cb = e.target.closest(".ct-btn");
  if (cb) {
    try {
      await navigator.clipboard.writeText(cb.dataset.curl);
      cb.textContent = "Copied";
    } catch {
      cb.textContent = "Couldn't copy";
    }
    setTimeout(() => (cb.textContent = "Copy curl"), 1400);
    return;
  }
  if (e.target.closest("#toast-undo")) return undoClear();
  const casts = state.feed?.casts ?? [];
  const cl = e.target.closest("[data-clear]");
  if (cl) return clearCasts([casts[Number(cl.dataset.clear)]]);
  const un = e.target.closest("[data-unclear]");
  if (un) {
    const c = casts[Number(un.dataset.unclear)];
    if (state.cleared.hashes.has(c.hash)) return changeCleared({ remove: [c.hash], counted: -1 }, { add: [{ hash: c.hash, time: c.time }] }, "Back in your feed");
    return toast("This one was cleared with \"Clear all\". Undo that to bring it back.");
  }
  if (e.target.closest("[data-clear-all]")) {
    const left = unread();
    // With some apps hidden, clear only what's showing; otherwise one line in the file covers it.
    if (state.hidden.size) return clearCasts(left, `Cleared ${left.length}`);
    return clearBefore(casts[0].time, left.length, `Cleared all ${left.length}`);
  }
  if (e.target.closest("[data-clear-older]")) {
    const midnight = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const older = unread().filter((c) => c.time < midnight);
    if (state.hidden.size) return clearCasts(older);
    return clearBefore(new Date(Date.parse(midnight) - 1).toISOString(), older.length, `Cleared ${older.length} from before today`);
  }
  if (e.target.closest("[data-show-cleared]")) {
    state.showCleared = !state.showCleared;
    return renderFeed();
  }
  if (e.target.closest("[data-refresh]")) {
    loadFeed.fresh = true;
    state.feed = null;
    return loadFeed();
  }
  const card = e.target.closest("#feed-list .cast");
  if (card && !e.target.closest("a, button")) select([...document.querySelectorAll("#feed-list .cast")].indexOf(card));
  const fl = e.target.closest("[data-follow]");
  if (fl) return followUser(fl.dataset.follow);
  const cp = e.target.closest("[data-copy]");
  if (cp) {
    try {
      await navigator.clipboard.writeText(cp.dataset.copy);
      cp.textContent = "Copied";
    } catch {
      cp.textContent = "Couldn't copy";
    }
    return setTimeout(() => (cp.textContent = "Copy"), 1400);
  }
  const chip = e.target.closest(".appchip");
  if (chip) {
    const k = chip.dataset.app === "?" ? "?" : Number(chip.dataset.app);
    state.hidden.has(k) ? state.hidden.delete(k) : state.hidden.add(k);
    return renderFeed();
  }
  const via = e.target.closest(".via[data-hide]");
  if (via) {
    state.hidden.add(Number(via.dataset.hide));
    toast("Hidden. Click its chip above to bring it back.");
    return renderFeed();
  }
  const only = e.target.closest(".bar[data-only]");
  if (only) {
    const keep = only.dataset.only === "?" ? "?" : Number(only.dataset.only);
    state.hidden = new Set(appCounts(state.feed.casts).map((a) => a.fid).filter((f) => f !== keep));
    renderFeed();
    return $("#tab-feed").click();
  }
  if (e.target.closest("#hide-farcaster")) {
    state.hidden.add(FARCASTER_APP);
    return renderFeed();
  }
  if (e.target.closest("#show-all")) {
    state.hidden.clear();
    return renderFeed();
  }
  const act = e.target.closest(".act");
  if (act) {
    const c = state.feed.casts[Number(act.dataset.i)];
    const on = act.getAttribute("aria-pressed") !== "true";
    act.disabled = true;
    try {
      const { data } = await api("/api/react", { kind: act.dataset.act, on, target: { fid: c.fid, hash: c.hash } });
      act.setAttribute("aria-pressed", String(on));
      toast(data.landed ? `${act.dataset.act === "like" ? "Liked" : "Recast"} through your node` : "Sent, but not visible on your node yet");
    } catch (err) {
      toast(err.message);
    } finally {
      act.disabled = false;
    }
  }
});

document.querySelectorAll('[role="tab"]').forEach((t) =>
  t.addEventListener("click", () => {
    const v = t.dataset.view;
    location.hash = v;
    if (v === "feed") loadFeed();
    if (v === "keys") loadKeys();
    if (v === "apps") state.feed ? renderApps() : loadFeed();
    if (v === "node") refreshStatus();
  }),
);

// Keyboard, like an email inbox: j/k move, e clears, u undoes.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest("input, textarea, [contenteditable]")) return;
  if ($("#view-feed").hidden) return;
  const items = [...document.querySelectorAll("#feed-list .cast")];
  if (e.key === "j") select(state.selected + 1, true);
  else if (e.key === "k") select(state.selected - 1, true);
  else if (e.key === "e" && items[state.selected]) {
    const c = state.feed.casts[Number(items[state.selected].dataset.i)];
    if (!isCleared(c)) clearCasts([c]);
  } else if (e.key === "u") undoClear();
  else return;
  e.preventDefault();
});

// On touch screens, swipe a cast to the right to clear it.
let swipe = null;
document.addEventListener("pointerdown", (e) => {
  const card = e.target.closest("#feed-list .cast:not(.is-cleared)");
  if (!card || e.pointerType !== "touch" || e.target.closest("a, button")) return;
  swipe = { card, x: e.clientX, y: e.clientY, dx: 0 };
});
document.addEventListener("pointermove", (e) => {
  if (!swipe) return;
  swipe.dx = e.clientX - swipe.x;
  if (Math.abs(e.clientY - swipe.y) > 30 && Math.abs(swipe.dx) < 30) return (swipe = null);
  if (swipe.dx > 0) swipe.card.style.transform = `translateX(${swipe.dx}px)`;
  swipe.card.style.opacity = String(Math.max(0.3, 1 - swipe.dx / 300));
});
const endSwipe = () => {
  if (!swipe) return;
  const { card, dx } = swipe;
  swipe = null;
  card.style.transform = "";
  card.style.opacity = "";
  if (dx > 90) clearCasts([state.feed.casts[Number(card.dataset.i)]]);
};
document.addEventListener("pointerup", endSwipe);
document.addEventListener("pointercancel", endSwipe);

$("#composer-text").addEventListener("input", (e) => {
  $("#composer-count").textContent = `${new TextEncoder().encode(e.target.value).length} / 320`;
});

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("#composer-text").value.trim();
  if (!text) return;
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  btn.textContent = "Casting…";
  try {
    const { data } = await api("/api/cast", { text });
    $("#composer-text").value = "";
    $("#composer-count").textContent = "0 / 320";
    toast(data.landed ? `Cast ${data.hash.slice(0, 10)} is on your node` : "Sent, but not on your node yet. Try again if it doesn't show.");
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Cast";
  }
});

// ------------------------------------------------------------------- boot

(async function boot() {
  renderLog();
  await refreshStatus();
  setInterval(refreshStatus, 15_000);
  const me = await api("/api/me").then((r) => r.data, () => null);
  const tab = location.hash.slice(1);
  if (["keys", "apps", "node"].includes(tab)) document.querySelector(`[data-view="${tab}"]`)?.click();
  me ? showSignedIn(me) : showSignedOut();
})();
