// clearcast in the browser. Talks only to the local clearcast server (which talks only
// to your node). Everything from the network is escaped before it's shown.

const TOKEN = document.querySelector('meta[name="clearcast-token"]').content;
const FARCASTER_APP = 9152; // the Farcaster app's FID (still named @warpcast)
const $ = (sel) => document.querySelector(sel);

const state = {
  node: "",
  me: null,
  viewAs: null, // { fid, username }
  feed: null, // { following, casts }
  feedFor: null,
  hidden: new Set(), // app fids (or "?") hidden from the feed
  keysFor: null,
  log: [],
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

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
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
  const json = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
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

function showCalls(id, calls) {
  const real = calls.filter((c) => !c.note);
  $(id).innerHTML = `<summary>Show the ${real.length} API call${real.length === 1 ? "" : "s"} to your node behind this view</summary>
    <div class="calltable-card">${callTable(calls, 40)}</div>`;
}

function renderLog() {
  $("#call-log").innerHTML = state.log.length ? callTable(state.log, 150) : `<p class="empty">Nothing yet.</p>`;
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
  $("#feed-list").innerHTML = loading(`Building @${state.viewAs.username ?? state.viewAs.fid}'s feed from your node…`);
  $("#filterbar").hidden = true;
  try {
    const { data } = await api(`/api/feed?user=${state.viewAs.fid}`);
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
  return `<article class="cast card">
    ${pic(c.author.pfp, "avatar", name)}
    <div class="cast__body">
      <div class="cast__head">
        <span class="cast__name">${esc(c.author.display || name)}</span>
        <span class="cast__meta">@${esc(name)} · ${ago(c.time)}${c.channel ? ` · /${esc(c.channel)}` : ""}${c.replyTo ? " · reply" : ""}</span>
        ${via}
      </div>
      <div class="cast__text">${linkify(c.text)}</div>
      ${c.embeds.length ? `<div class="cast__embeds">${c.embeds.map((u) => (u.startsWith("http") ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>` : `<span>${esc(u)}</span>`)).join("")}</div>` : ""}
      ${actions}
    </div>
  </article>`;
}

function renderFeed() {
  const all = state.feed?.casts ?? [];
  const shown = all.filter((c) => !state.hidden.has(c.app ? c.app.fid : "?"));
  const counts = appCounts(all);
  $("#filterbar").hidden = all.length === 0;
  $("#appchips").innerHTML = counts
    .map(
      (a) =>
        `<button type="button" class="appchip" data-app="${a.fid}" aria-pressed="${!state.hidden.has(a.fid)}">${a.fid === "?" ? "" : pic(feedAppPfp(a.fid))}${a.fid === "?" ? "" : "@"}${esc(a.name)} <span class="n">${a.n}</span></button>`,
    )
    .join("");
  $("#feed-list").innerHTML = shown.length
    ? shown.slice(0, 120).map((c) => castHtml(c, all.indexOf(c))).join("")
    : all.length
      ? empty("Every app in this feed is hidden. Click a chip above to show it again.")
      : `<div class="empty"><p>${state.feed?.following ? "No recent casts from the accounts this feed follows." : "This account doesn't follow anyone yet, so its feed is empty."}</p>
         <p>Try someone else's: <button type="button" class="link-btn" data-view-as="dwr">@dwr</button> · <button type="button" class="link-btn" data-view-as="vitalik.eth">@vitalik.eth</button> · <button type="button" class="link-btn" data-view-as="balajis.eth">@balajis.eth</button></p></div>`;
}

// App avatars come from the profiles the server already looked up.
const appPfps = new Map();
const feedAppPfp = (fid) => appPfps.get(fid);

// Whose feed this is, with a follow button when it isn't yours.
async function renderWho() {
  const v = state.viewAs;
  const el = $("#who");
  const mine = state.me && state.me.fid === v.fid;
  el.hidden = false;
  el.innerHTML = `${pic(v.pfp, "avatar", v.username ?? String(v.fid))}<div class="who__text"><b>${mine ? "Your feed" : `@${esc(v.username ?? v.fid)}'s feed`}</b><br />The latest casts from the ${v.following?.toLocaleString() ?? "?"} accounts ${mine ? "you follow" : "they follow"}</div>`;
  if (!state.me || mine) return;
  const { data } = await api(`/api/relationship?user=${v.fid}`).catch(() => ({ data: {} }));
  if (data.following === null || data.following === undefined) return;
  el.insertAdjacentHTML("beforeend", `<button type="button" class="tg-btn ${data.following ? "tg-btn--pill" : "tg-btn--ink"} tg-btn--sm" id="follow-btn" data-on="${!data.following}">${data.following ? "Unfollow" : "Follow"}</button>`);
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
    <p>of the latest ${all.length} casts from the ${state.feed.following.toLocaleString()} accounts @${esc(state.viewAs.username ?? state.viewAs.fid)} follows came through <b>@${esc(top.name)}</b>. ${counts.length} apps in total.</p>`;
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
  const who = `@${state.viewAs.username ?? state.viewAs.fid}`;
  const mine = state.me && state.me.fid === state.viewAs.fid;
  $("#keys-title").textContent = mine ? "Who can post as you" : `Who can post as ${who}`;
  $("#keys-intro").textContent = mine
    ? "Every app you've signed in to holds a key that can post as you. Here's the full list, straight from your node."
    : `Every app ${who} has signed in to holds a key that can post as them. Here's the full list, straight from your node.`;
  if (state.keysFor === state.viewAs.fid) return;
  $("#keys-list").innerHTML = loading(`Asking your node for ${who}'s keys…`);
  $("#keys-summary").innerHTML = "";
  try {
    const { data: keys, calls } = await api(`/api/keys?user=${state.viewAs.fid}`);
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
      <div><strong class="tg-numeral">${keys.length}</strong><span>keys can post as ${esc(who)}</span></div>
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

// -------------------------------------------------------------- view as

async function setViewAs(who) {
  const q = String(who).trim().replace(/^@/, "");
  if (!q) return;
  try {
    const { data } = await api(`/api/profile?user=${encodeURIComponent(q)}`);
    state.viewAs = { fid: data.fid, username: data.username, pfp: data.pfp, following: data.following };
    $("#viewas-input").value = data.username ?? String(data.fid);
    try { localStorage.setItem("clearcast.viewAs", $("#viewas-input").value); } catch {}
    state.feed = null;
    state.keysFor = null;
    state.hidden.clear();
    renderWho();
    const view = document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.view;
    if (view === "keys") loadKeys();
    else loadFeed();
  } catch (e) {
    toast(e.message);
  }
}

// ----------------------------------------------------------------- events

$("#viewas").addEventListener("submit", (e) => {
  e.preventDefault();
  setViewAs($("#viewas-input").value);
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
  if (e.target.closest("#me-chip") && state.me) return setViewAs(state.me.username ?? state.me.fid);
  const va = e.target.closest("[data-view-as]");
  if (va) return setViewAs(va.dataset.viewAs);
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
  const fb = e.target.closest("#follow-btn");
  if (fb) {
    const on = fb.dataset.on === "true";
    fb.disabled = true;
    try {
      const { data } = await api("/api/follow", { fid: state.viewAs.fid, on });
      toast(data.landed ? `${on ? "Following" : "Unfollowed"} @${state.viewAs.username ?? state.viewAs.fid}` : "Sent, but not visible on your node yet");
      renderWho();
    } catch (err) {
      toast(err.message);
      fb.disabled = false;
    }
    return;
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
  try {
    state.me = (await api("/api/me")).data;
  } catch {}
  const chip = $("#me-chip");
  chip.hidden = false;
  if (state.me) {
    $("#composer").hidden = false;
    const name = state.me.username ?? `!${state.me.fid}`;
    $("#composer-avatar").outerHTML = pic(state.me.pfp, "avatar", name);
    chip.innerHTML = `${pic(state.me.pfp, "avatar", name)}<span><small>Signed in as</small><b>@${esc(name)}</b></span>`;
    chip.title = `This computer holds an app key for @${name}, so you can cast, like and follow. Click to see your own feed.`;
  } else {
    $("#readonly-note").hidden = false;
    chip.classList.add("me-chip--readonly");
    chip.textContent = "Read-only";
    chip.title = "No app key on this computer. Run clearcast login in a terminal to post, like and follow.";
  }
  let saved = null;
  try { saved = localStorage.getItem("clearcast.viewAs"); } catch {}
  const start = new URLSearchParams(location.search).get("user") ?? saved ?? state.me?.username ?? state.me?.fid ?? "dwr";
  const tab = location.hash.slice(1);
  if (["keys", "apps", "node"].includes(tab)) document.querySelector(`[data-view="${tab}"]`)?.click();
  await setViewAs(start);
})();
