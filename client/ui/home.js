// clearcast home: boot, then four tiles that keep themselves fresh.
// Every number comes from your node (via the local server's /api) or from
// fc-companion on the same server. Nothing here is made up: when something
// isn't known yet, the tile says so.

const $ = (s) => document.querySelector(s);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = (n) => Number(n).toLocaleString("en-US");
const TOKEN = document.querySelector('meta[name="clearcast-token"]').content;

class SignedOut extends Error {}
async function api(path, body) {
  const res = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "x-clearcast-token": TOKEN, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401) throw new SignedOut(json.error);
  if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
  return json.data;
}

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const S = { sound: store.get("cc-sound") !== "off", sel: 0, presence: "online", node: null, live: null, cond: null, lastHeights: {} };

// ------------------------------------------------------------------ sound
// Square-wave blips. Browsers allow sound only after the first click or key.
let ac = null;
function unlock() {
  if (!ac) try { ac = new AudioContext(); } catch { return; }
  if (ac.state === "suspended") ac.resume();
}
function tone(f, at, dur, { vol = 0.05, to } = {}) {
  if (!ac || !S.sound || ac.state !== "running") return;
  const t = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = "square"; o.frequency.setValueAtTime(f, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
const STEPS = [0, 2, 4, 7, 9, 12, 14, 16];
const sfx = {
  blink: () => tone(196, 0, 0.03, { vol: 0.02 }),
  letter: (i) => tone(523.25 * 2 ** (STEPS[i % 8] / 12), 0, 0.05, { vol: 0.035 }),
  chime: () => { tone(1046.5, 0, 0.08); tone(2093, 0.08, 0.55, { vol: 0.045 }); },
  move: () => tone(880, 0, 0.025, { vol: 0.025 }),
  open: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.04, 0.07, { vol: 0.035 })),
  back: () => tone(392, 0, 0.09, { vol: 0.035, to: 196 }),
  toggle: () => { tone(660, 0, 0.04, { vol: 0.03 }); tone(440, 0.05, 0.06, { vol: 0.03 }); },
};

// ------------------------------------------------------------------ boot
// The c blinks for as long as your node takes to answer, then the rest of
// the name lights up and the dashboard appears.
async function boot() {
  const b = $("#boot"), letters = [...b.querySelectorAll(".word span")], status = $("#boot-status");
  let on = false;
  const blink = setInterval(() => { on = !on; letters[0].classList.toggle("on", on); if (on) sfx.blink(); }, 260);
  status.textContent = "connecting to your node";
  let home;
  for (;;) {
    try { home = await api("/api/home"); break; }
    catch (e) { status.textContent = `${e.message} · trying again`; await wait(5000); }
  }
  clearInterval(blink);
  letters[0].classList.add("on");
  status.textContent = `${new URL(home.node.url).host} · ${home.node.inSync ? "in sync" : "catching up"}`;
  for (let i = 1; i < letters.length; i++) { await wait(46); letters[i].classList.add("on"); sfx.letter(i - 1); }
  await wait(80); sfx.chime(); await wait(380);
  b.classList.add("out"); document.body.classList.add("ready");
  setTimeout(() => (b.hidden = true), 300);
  return home;
}

// ------------------------------------------------------------------ top line
function paintClock() {
  const d = new Date(), h = d.getHours();
  $("#hello").textContent = h < 5 ? "up late" : h < 12 ? "good morning" : h < 18 ? "good afternoon" : "good evening";
  $("#when").textContent = d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toLowerCase();
  const time = d.toTimeString().slice(0, 5);
  $("#who").innerHTML = S.me
    ? `<b>@${esc(S.me.username ?? `!${S.me.fid}`)}</b> · fid ${S.me.fid} · <button class="link" id="signout">${S.confirmSignOut ? "click again to sign out" : "sign out"}</button> · ${time}`
    : `<a href="/signin">sign in</a> · ${time}`;
}

// Signing out deletes the app key from this computer, so it takes two clicks.
document.addEventListener("click", async (e) => {
  if (e.target.id !== "signout") return;
  if (!S.confirmSignOut) {
    S.confirmSignOut = true;
    sfx.back();
    // The note stays up for as long as the second click counts.
    toast("Sign out revokes this computer's key. Click again to confirm.", 6000);
    paintClock();
    setTimeout(() => { S.confirmSignOut = false; paintClock(); }, 6000);
    return;
  }
  try {
    $("#signout").textContent = "signing out…";
    const r = await api("/api/signout", {});
    sfx.toggle();
    // Keys approved in the Farcaster app can't revoke themselves; say so before reloading.
    if (r.revoked.startsWith("not revoked")) { toast("Deleted here. Remove it in the Farcaster app.", 5000); await wait(5000); }
    location.reload();
  } catch (err) {
    toast(err.message);
  }
});

// ------------------------------------------------------------------ conditions
// Pixel weather, 16x16: # ink, + mid grey.
const ICONS = {
  calm: ["................", "................", "................", "................", "................", "..######........", ".#......#.......", "#........######.", "................", "................", "..######........", ".#......#.......", "#........######.", "................", "................", "................"],
  mild: ["................", ".......#........", "...#.......#....", "................", ".....#####......", "....#.....#.....", ".#..#.....#..#..", "....#.....#.....", ".....#####......", "................", "...#.......#....", ".......#........", "................", "...++++++++++...", "................", "................"],
  brisk: ["................", "..........##....", ".........#..#...", "............#...", "###########.#...", "................", ".......+++++++..", "................", "##############..", "...............#", "..............#.", "..........###...", "................", "....+++++++.....", "................", "................"],
  stormy: ["................", ".....####.......", "...##....##.....", "..#........###..", ".#...........#..", ".#............#.", "..############..", ".......##.......", "......##........", ".....######.....", ".......##.......", "......##........", ".....#..........", "..+.......+.....", ".+.......+......", "................"],
  measuring: ["................", "................", "................", "................", "................", "................", "................", "..##..##..##....", "..##..##..##....", "................", "................", "................", "................", "................", "................", "................"],
};
const icon = (name) => `<svg class="icon" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${ICONS[name].flatMap((row, y) => [...row].map((c, x) => (c === "." ? "" : `<rect x="${x}" y="${y}" width="1" height="1" fill="${c === "#" ? "var(--g3)" : "var(--g1)"}"/>`))).join("")}</svg>`;

const WORDS = {
  calm: "Quieter than usual for this time of day.",
  mild: "About usual for this time of day.",
  brisk: "Busier than usual for this time of day.",
  stormy: "Much busier than usual. Something's happening.",
};
function weather(now, usual) {
  if (now == null || !usual) return "measuring";
  const r = now / usual;
  return r < 0.7 ? "calm" : r < 1.15 ? "mild" : r < 1.6 ? "brisk" : "stormy";
}

function paintConditions() {
  const c = S.cond, now = S.live?.perMinute, h = new Date().getHours();
  const usualNow = c?.hours?.[h]?.usual;
  const word = weather(now, usualNow);
  const rate = now == null ? "" : `<b>${fmt(now)} messages a minute</b>`;
  const why =
    word === "measuring"
      ? now == null ? "Listening to your node…" : `${rate} right now. Working out what's usual for this time of day.`
      : `${WORDS[word]} ${rate}, usually ${fmt(usualNow)}.`;

  let chart;
  if (!c || c.state === "measuring") {
    const done = c?.total ? Math.round((c.done / c.total) * 30) : 0;
    chart = `<div class="measuring"><span>measuring the last few days, one hour at a time · ${c?.done ?? 0}/${c?.total || "?"}</span>
      <div class="progress">${Array.from({ length: 30 }, (_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("")}</div>
      <span class="small">first time only: past hours are kept on this computer</span></div>`;
  } else if (c.state === "failed") {
    chart = `<div class="measuring"><span>couldn't measure the past days: ${esc(c.error)}</span></div>`;
  } else {
    const vals = c.hours.map((x, i) => (i < h ? x.today : i === h ? now : x.usual) ?? 0);
    const max = Math.max(1, ...vals, ...c.hours.map((x) => x.usual ?? 0));
    const bars = c.hours.map((x, i) => {
      const v = i < h ? x.today : i === h ? now : x.usual;
      const cls = v == null ? "none" : i > h ? "later" : i === h ? "now" : "";
      const tip = i < h ? `${i}:00 · ${x.today ?? "?"} a minute (usually ${x.usual ?? "?"})` : i === h ? `now · ${now ?? "?"} a minute` : `${i}:00 · usually ${x.usual ?? "?"}`;
      return `<span class="${cls}" title="${tip}" style="height:${Math.max(3, Math.round(((v ?? max * 0.04) / max) * 100 / 6) * 6)}%"></span>`;
    });
    chart = `<div class="hours">${bars.join("")}</div>
      <div class="hlabels"><span>00</span><span>03</span><span>06</span><span>09</span><span>12</span><span>15</span><span>18</span><span>21</span></div>
      <div class="legend"><span><i></i>messages a minute, today</span><span><i class="later"></i>usual, from the last ${c.historyDays} days</span></div>`;
  }
  $("#conditions").innerHTML = `<div class="cond">${icon(word)}<div class="word">${word}</div><div class="why">${why}</div></div>${chart}`;
}

// ------------------------------------------------------------------ since
const ago = (iso) => {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
};
async function loadSince() {
  try {
    const d = await api("/api/since");
    $("#since-title").textContent = d.first ? "in the last day" : "since you last checked in";
    $("#since-ago").textContent = d.first ? "first visit" : ago(d.since);
    const f = d.followers;
    $("#since").innerHTML = `<ul class="since">
        <li><span class="count">${fmt(d.casts)}</span><span>${d.casts === 1 ? "cast" : "casts"} from people you follow</span></li>
        <li><span class="count">${fmt(d.likes)}</span><span>${d.likes === 1 ? "like" : "likes"} on your casts</span></li>
        <li><span class="count">${fmt(d.replies)}</span><span>${d.replies === 1 ? "reply" : "replies"} to you</span></li>
        <li><span class="count">${fmt(f.count)}</span><span>new ${f.count === 1 ? "follower" : "followers"}${f.names.length ? `: ${f.names.map((n) => `<b>@${esc(n)}</b>`).join(", ")}${f.count > f.names.length ? "…" : ""}` : ""}</span></li>
      </ul>
      ${d.casts ? `<button class="prompt" data-mode-go="curate"><span class="blink">▶</span><span class="btn">A</span><span>curate the ${fmt(d.casts)}, one at a time</span></button>` : d.following ? `<p class="note">All quiet. Nothing new from the people you follow.</p>` : `<p class="note">You don't follow anyone yet, so there's nothing to catch up on.</p>`}`;
  } catch (e) {
    $("#since-ago").textContent = "";
    $("#since").innerHTML = e instanceof SignedOut ? `<p>Sign in to see what you missed.</p><a class="btn" href="/signin">sign in</a>` : `<p class="dim">${esc(e.message)}</p>`;
  }
}

// ------------------------------------------------------------------ node
function since(iso) {
  if (!iso) return null;
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 3600 ? `${Math.round(s / 60)} min` : s < 172800 ? `${Math.round(s / 3600)} h` : `${Math.round(s / 86400)} days`;
}
function paintNode(home) {
  const n = home.node, c = home.companion, now = Date.now();
  $("#host").textContent = new URL(n.url).host;
  for (const s of n.shards) {
    const last = S.lastHeights[s.id];
    if (!last || last.height !== s.height) S.lastHeights[s.id] = { height: s.height, at: now };
  }
  const recent = new Map((S.live?.shards ?? []).map((s) => [s.id, s.recent]));
  const lat = n.latencyMs < 1000 ? `${n.latencyMs} ms` : `${(n.latencyMs / 1000).toFixed(1)} s`;
  const up = c ? (c.snapchainStartedAt ? `up ${since(c.snapchainStartedAt)}` : "uptime unknown") : "uptime needs fc-companion";
  const behind = n.behindSeconds < 120 ? `${n.behindSeconds} s` : n.behindSeconds < 7200 ? `${Math.round(n.behindSeconds / 60)} min` : `${(n.behindSeconds / 3600).toFixed(1)} h`;
  $("#node").innerHTML = `
    <div class="state${n.inSync ? "" : " behind"}"><b>${n.inSync ? "in sync" : "catching up"}</b><span class="dim">${n.inSync ? "" : `${behind} behind · `}${lat} · v${esc(n.version)} · ${up}</span></div>
    <div class="shards">${n.shards
      .map((s) => {
        const r = recent.get(s.id);
        const max = Math.max(1, ...(r ?? [1]));
        const strip = r ? r.map((v) => `<span class="${v ? "hit" : ""}" style="height:${Math.max(10, Math.round((v / max) * 5) * 20)}%" title="${v} new"></span>`).join("") : "";
        return `<div class="shard"><span class="lbl">shard ${s.id}</span><span>${fmt(s.height)}</span><span class="strip" title="${s.id === 0 ? "shard 0 orders the others; messages live in shards 1 and up" : "new messages per block, last 60 blocks"}">${strip}</span><span class="ago">${s.behind} s</span></div>`;
      })
      .join("")}</div>
    <div class="totals"><span><b>${fmt(n.totals.messages)}</b> messages</span><span><b>${fmt(n.totals.accounts)}</b> accounts</span><span><b>${fmt(Math.round(n.totals.bytes / 1e9))} GB</b> on disk</span></div>
    <div class="note">peer <span title="${esc(n.peerId)}">${esc(n.peerId.slice(0, 10))}…${esc(n.peerId.slice(-8))}</span>: your node's name on the network</div>`;
}

// ------------------------------------------------------------------ presence
function paintPresence(p) {
  if (!p.companion) {
    $("#online-n").textContent = "";
    $("#presence").innerHTML = `<p>fc-companion isn't running on your node yet, so clearcast can't see who's here.</p><p class="note">Run command 1 again on the server to add it, and open port 3390.</p>`;
    return;
  }
  S.presence = p.status;
  const visible = p.people.filter((x) => !x.you || p.status === "online");
  $("#online-n").textContent = `${visible.length} online`;
  $("#presence").innerHTML = `
    <div class="count">${p.people.length}</div>
    <ul class="people">${p.people
      .map((x) => {
        const name = x.username ? `@${esc(x.username)}` : `!${x.fid}`;
        const dev = x.devices.length > 1 ? ` · ${x.devices.length} devices` : x.you ? ` · ${esc(x.devices[0]?.label ?? "")}` : "";
        const rel = x.you ? (p.status === "invisible" ? "you · invisible" : "you") : x.relation;
        return `<li>${x.pfp ? `<img src="${esc(x.pfp)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="nopfp"></span>`}<span class="name">${x.you ? "▶ " : ""}${name}<span class="dim small">${dev}</span></span><span class="rel">${esc(rel)}</span></li>`;
      })
      .join("")}</ul>
    ${p.people.length === 1 ? `<p class="note">Just you. Friends who use this node show up here while they're on.</p>` : ""}
    <button class="toggle" id="appear"><span class="btn">O</span><span>${p.status === "online" ? "appear offline" : "appear online"}</span></button>
    ${p.status === "invisible" ? `<p class="note">You're invisible: others on this node can't see you.</p>` : ""}`;
  $("#appear").addEventListener("click", togglePresence);
}
async function loadPresence(setTo) {
  try {
    paintPresence(await api("/api/presence", setTo ? { status: setTo } : undefined));
  } catch (e) {
    $("#online-n").textContent = "";
    $("#presence").innerHTML = e instanceof SignedOut ? `<p>Sign in to show up here.</p><a class="btn" href="/signin">sign in</a>` : `<p class="dim">${esc(e.message)}</p>`;
  }
}
function togglePresence() {
  sfx.toggle();
  loadPresence(S.presence === "online" ? "invisible" : "online");
}

// ------------------------------------------------------------------ modes + input
const modes = [...document.querySelectorAll(".mode")];
function select(i, sound = true) {
  const next = (i + modes.length) % modes.length;
  if (next !== S.sel && sound) sfx.move();
  S.sel = next;
  modes.forEach((m, j) => m.toggleAttribute("aria-current", j === S.sel));
}
let toastT;
function toast(msg, ms = 1600) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), ms); }
function open() {
  const m = modes[S.sel];
  sfx.open();
  if (m.dataset.href) setTimeout(() => (location.href = m.dataset.href), 220);
  else toast(`${m.dataset.mode} is coming next`);
}
const back = () => { sfx.back(); $("#toast").classList.remove("show"); };
modes.forEach((m, j) => { m.addEventListener("mouseenter", () => select(j)); m.addEventListener("click", () => { select(j, false); open(); }); });
document.addEventListener("click", (e) => {
  const go = e.target.closest?.("[data-mode-go]");
  if (go) { select(modes.findIndex((m) => m.dataset.mode === go.dataset.modeGo), false); open(); }
});

const ready = () => document.body.classList.contains("ready");
addEventListener("pointerdown", unlock);
addEventListener("keydown", (e) => {
  unlock();
  if (!ready() || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (["arrowleft", "arrowup", "h", "k"].includes(k)) { select(S.sel - 1); e.preventDefault(); }
  else if (["arrowright", "arrowdown", "l", "j"].includes(k)) { select(S.sel + 1); e.preventDefault(); }
  else if (k === "enter" || k === " " || k === "a") { open(); e.preventDefault(); }
  else if (k === "escape" || k === "b") back();
  else if (k === "o") togglePresence();
  else if (k === "m") { S.sound = !S.sound; store.set("cc-sound", S.sound ? "on" : "off"); $("#snd").textContent = S.sound ? "on" : "off"; }
  else if (/^[1-5]$/.test(k)) { select(+k - 1); open(); }
});

// Game controllers: d-pad or left stick to choose, A to go, B to go back.
const prev = {};
(function poll() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  $("#pad").textContent = pads.length ? "controller on" : "no controller";
  for (const p of pads) {
    const down = (i) => p.buttons[i]?.pressed, edge = (i) => down(i) && !prev[p.index + ":" + i];
    const left = p.axes[0] < -0.6, right = p.axes[0] > 0.6;
    if (ready()) {
      if (edge(14) || edge(12) || (left && !prev[p.index + "L"])) select(S.sel - 1);
      if (edge(15) || edge(13) || (right && !prev[p.index + "R"])) select(S.sel + 1);
      if (edge(0)) open();
      if (edge(1)) back();
      if (edge(3)) togglePresence();
    }
    [0, 1, 3, 12, 13, 14, 15].forEach((i) => (prev[p.index + ":" + i] = down(i)));
    prev[p.index + "L"] = left; prev[p.index + "R"] = right;
  }
  requestAnimationFrame(poll);
})();

// ------------------------------------------------------------------ refresh loops
async function every(ms, fn) { for (;;) { await wait(ms); await fn().catch(() => {}); } }
async function refreshHome() { const h = await api("/api/home"); S.home = h; paintNode(h); }
async function refreshLive() { S.live = await api("/api/live"); paintConditions(); if (S.home) paintNode(S.home); }
async function refreshConditions() {
  S.cond = await api("/api/conditions");
  paintConditions();
  return S.cond.state === "measuring";
}

(async () => {
  $("#snd").textContent = S.sound ? "on" : "off";
  select(0, false);
  paintClock(); setInterval(paintClock, 15_000);
  api("/api/me").then((me) => { S.me = me; paintClock(); }, () => {});
  paintConditions();
  const home = await boot();
  S.home = home; paintNode(home);
  refreshLive().catch(() => {});
  loadSince(); loadPresence();
  (async () => { while (await refreshConditions().catch(() => false)) await wait(3000); every(10 * 60_000, refreshConditions); })();
  every(10_000, refreshHome);
  every(20_000, refreshLive);
  every(30_000, () => loadPresence());
})();
