// clearcast home: boot, then four tiles that keep themselves fresh.
// Every number comes from this node (via the local server's /api) or from
// fc-companion on the same server. Nothing here is made up: when something
// isn't known yet, the tile says so.

const { $, wait, esc, api, tone, toast, SignedOut } = kit;
const fmt = (n) => Number(n).toLocaleString("en-US");


const S = { sound: kit.soundOn(), sel: 0, presence: "online", node: null, live: null, cond: null, lastHeights: {} };

// ------------------------------------------------------------------ sound
// Square-wave blips. Browsers allow sound only after the first click or key.
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
// The c blinks for as long as this node takes to answer, then the rest of
// the name lights up and the dashboard appears.
async function boot() {
  const b = $("#boot"), letters = [...b.querySelectorAll(".word span")], status = $("#boot-status");
  let on = false;
  const blink = setInterval(() => { on = !on; letters[0].classList.toggle("on", on); if (on) sfx.blink(); }, 260);
  status.textContent = "connecting to this node";
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
    const r = await api("/api/signout", { device: (await mine.device()).id });
    await mine.key.forget(); // hosted: the key lived in this browser
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
  unknown: ["................", "................", ".....######.....", "....##....##....", "....##....##....", "..........##....", ".........##.....", "........##......", ".......##.......", ".......##.......", "................", "................", ".......##.......", ".......##.......", "................", "................"],
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
  // A failed history run can't say what's usual, so it isn't "measuring" any more.
  const word = c?.state === "failed" ? "unknown" : weather(now, usualNow);
  const rate = now == null ? "" : `<b>${fmt(now)} messages a minute</b>`;
  const why =
    word === "unknown"
      ? `${now == null ? "Couldn't" : `${rate} right now. Can't tell if that's usual: couldn't`} read the past days (${esc(c.error)}).`
      : word === "measuring"
        ? now == null ? "Listening to this node…" : `${rate} right now. Working out what's usual for this time of day.`
        : `${WORDS[word]} ${rate}, usually ${fmt(usualNow)}.`;

  let chart;
  if (!c || c.state === "measuring") {
    const done = c?.total ? Math.round((c.done / c.total) * 30) : 0;
    chart = `<div class="measuring"><span>measuring the last few days, one hour at a time · ${c?.done ?? 0}/${c?.total || "?"}</span>
      <div class="progress">${Array.from({ length: 30 }, (_, i) => `<i class="${i < done ? "on" : ""}"></i>`).join("")}</div>
      <span class="small">first time only: past hours are kept on this computer</span></div>`;
  } else if (c.state === "failed") {
    const mins = Math.max(1, Math.ceil((Date.parse(c.retryAt) - Date.now()) / 60_000));
    chart = `<div class="measuring"><span>${Number.isFinite(mins) ? `trying again in ${mins} min` : "trying again soon"}</span></div>`;
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
// ------------------------------------------------------------------ waiting for you
// Counts go down as you clear things in the inbox. Purple marks what arrived
// since your last visit.
async function loadWaiting() {
  try {
    const me = await kit.me();
    if (!me) throw new SignedOut();
    // Opening home counts as a visit (it ends after 30 minutes away).
    const { since } = await mine.visit(me.fid, { count: true });
    const [w, st] = await Promise.all([api(`/api/waiting?since=${since}`), mine.inbox(me.fid)]);
    const count = (view) => {
      const left = w[view].filter((x) => !((st.cleared[view] ?? {})[x.id]));
      return { waiting: left.length, fresh: left.filter((x) => Date.parse(x.time) > since).length };
    };
    const d = { since: w.since, following: w.following, casts: count("casts"), likes: count("likes"), replies: count("replies"), followers: count("followers") };
    $("#since-title").textContent = "waiting for you";
    $("#since-ago").textContent = `last visit ${ago(d.since)}`;
    const row = (view, n, one, many, fresh) =>
      `<li><button data-open="${view}"><span class="count">${fmt(n)}</span><span>${n === 1 ? one : many}</span><span class="go">${fresh ? `<span class="fresh" title="new since your last visit"></span>${fmt(fresh)} new ` : ""}→</span></button></li>`;
    $("#since").innerHTML = `<ul class="waits">
        ${row("casts", d.casts.waiting, "cast from people you follow", "casts from people you follow", d.casts.fresh)}
        ${row("likes", d.likes.waiting, "like on your casts", "likes on your casts", d.likes.fresh)}
        ${row("replies", d.replies.waiting, "reply to you", "replies to you", d.replies.fresh)}
        ${row("followers", d.followers.waiting, "new follower", "new followers", d.followers.fresh)}
      </ul>${d.following ? "" : `<p class="note">You don't follow anyone yet.</p>`}`;
  } catch (e) {
    $("#since-ago").textContent = "";
    $("#since").innerHTML = e instanceof SignedOut ? `<p>Sign in to see what's waiting.</p><a class="k-btn primary" href="/signin">sign in</a>` : `<p class="dim">${esc(e.message)}</p>`;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("[data-open]");
  if (!b) return;
  sfx.open();
  if (b.dataset.open === "followers") openFollowers();
  else setTimeout(() => (location.href = `/inbox#${b.dataset.open}`), 150);
});

// ------------------------------------------------------------------ new followers
// A window over home: their pictures, a hover card, follow back, and clear.
const F = { list: [], tab: "new" };
async function openFollowers() {
  $("#followers").hidden = false;
  $("#fol-body").innerHTML = `<span class="dim">looking<span class="blink">_</span></span>`;
  try {
    const me = await kit.me(), { since } = await mine.visit(me.fid);
    const [d, st] = await Promise.all([api(`/api/inbox/followers?since=${since}`), mine.inbox(me.fid)]);
    F.list = d.followers.map((f) => ({ ...f, cleared: String(f.fid) in st.cleared.followers }));
  } catch (e) { $("#fol-body").innerHTML = `<p class="dim">${esc(e.message)}</p>`; return; }
  paintFollowers();
}
function closeFollowers() { $("#followers").hidden = true; loadWaiting(); }
function paintFollowers() {
  const shown = F.list.filter((f) => (F.tab === "cleared") === f.cleared);
  const waitingN = F.list.filter((f) => !f.cleared).length;
  $("#fol-count").textContent = `${waitingN} waiting`;
  const toFollow = shown.filter((f) => !f.following).length;
  $("#fol-body").innerHTML = `
    <div class="row" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:18px">
      ${kit.seg([["new", `waiting ${waitingN}`], ["cleared", `cleared ${F.list.length - waitingN}`]], F.tab, "data-ftab")}
      <span class="dim small" style="margin-left:auto">the last 7 days</span>
    </div>
    ${shown.length ? `<div class="fgrid">${shown.map((f) => `
      <div class="fol">
        ${kit.ext(`https://farcaster.xyz/${encodeURIComponent(f.username ?? "")}`, f.pfp ? `<img src="${esc(f.pfp)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : `<span class="nopic"></span>`, { cls: "pick", arrow: false, attrs: `data-fid="${f.fid}" aria-label="@${esc(f.username ?? f.fid)} on farcaster.xyz"` })}
        <span class="u">${f.fresh ? `<span class="fresh" title="new since your last visit"></span>` : ""}@${esc(f.username ?? f.fid)}</span>
        ${kit.button(f.following ? "following" : "follow back", { look: f.following ? undefined : "primary", pressed: f.following, cls: "act", attrs: `data-follow="${f.fid}"` })}
        ${kit.button(f.cleared ? "bring back" : "clear", { look: "quiet", cls: "act", attrs: `data-fclear="${f.fid}"` })}
      </div>`).join("")}</div>` : `<p class="dim">${F.tab === "cleared" ? "Nothing cleared yet." : "No one's waiting. All clear."}</p>`}
    <div style="display:flex;gap:12px;align-items:center;margin-top:22px;flex-wrap:wrap">
      ${F.tab === "new" && toFollow > 1 ? kit.button(`follow back all ${toFollow}`, { look: "primary", attrs: "data-follow-all" }) : ""}
      ${F.tab === "new" && shown.length > 1 ? kit.button(`clear all ${shown.length}`, { look: "quiet", attrs: "data-fclear-all" }) : ""}
      <span class="dim small" style="margin-left:auto"><kbd>esc</kbd> close</span>
    </div>`;
}
async function follow(f, on) {
  try { await api("/api/follow", { user: String(f.fid), on }); f.following = on; sfx.toggle(); toast(on ? `Following @${f.username}.` : `Unfollowed @${f.username}.`); }
  catch (e) { toast(e.message); }
}
async function clearFollowers(fids, on) {
  await mine.clear((await kit.me()).fid, "followers", fids.map(String), on).catch((e) => toast(e.message));
  F.list.forEach((f) => { if (fids.includes(f.fid)) f.cleared = on; });
  sfx.back();
}
document.addEventListener("click", async (e) => {
  const t = e.target.closest?.("button");
  if (!t || !t.closest("#followers")) return;
  if (t.dataset.ftab) F.tab = t.dataset.ftab;
  else if (t.dataset.follow) { const f = F.list.find((x) => x.fid === +t.dataset.follow); t.disabled = true; await follow(f, !f.following); }
  else if (t.dataset.fclear) { const f = F.list.find((x) => x.fid === +t.dataset.fclear); await clearFollowers([f.fid], !f.cleared); }
  else if (t.hasAttribute("data-follow-all")) { for (const f of F.list.filter((x) => !x.cleared && !x.following)) await follow(f, true); }
  else if (t.hasAttribute("data-fclear-all")) await clearFollowers(F.list.filter((x) => !x.cleared).map((x) => x.fid), true);
  else if (t.id === "fol-close") return closeFollowers();
  else return;
  paintFollowers();
});
document.addEventListener("click", (e) => { if (e.target.id === "followers") closeFollowers(); });
// The hover card: who they are, placed beside their picture and kept on screen.
function hoverCard(pick) {
  const f = F.list.find((x) => x.fid === +pick.dataset.fid), hc = $("#fol-hc");
  if (!f) return;
  hc.innerHTML = `<b>@${esc(f.username ?? `!${f.fid}`)}</b><span class="dim small">fid ${f.fid}${f.display ? ` · ${esc(f.display)}` : ""}</span>${f.bio ? `<p>${esc(f.bio)}</p>` : ""}<p class="dim small">click: their profile on farcaster.xyz ↗</p>`;
  hc.classList.add("on");
  const r = pick.getBoundingClientRect(), w = hc.offsetWidth, h = hc.offsetHeight;
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const top = r.bottom + 8 + h > innerHeight - 8 ? r.top - h - 8 : r.bottom + 8;
  hc.style.left = left + "px"; hc.style.top = Math.max(8, top) + "px";
}
document.addEventListener("pointerover", (e) => { const p = e.target.closest?.("#followers .pick"); if (p) hoverCard(p); });
document.addEventListener("pointerout", (e) => { if (e.target.closest?.("#followers .pick")) $("#fol-hc").classList.remove("on"); });
document.addEventListener("focusin", (e) => { const p = e.target.closest?.("#followers .pick"); if (p) hoverCard(p); });
document.addEventListener("focusout", (e) => { if (e.target.closest?.("#followers .pick")) $("#fol-hc").classList.remove("on"); });

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
    <div class="note">peer <span title="${esc(n.peerId)}">${esc(n.peerId.slice(0, 10))}…${esc(n.peerId.slice(-8))}</span>: this node's name on the network</div>`;
}

// ------------------------------------------------------------------ presence
function paintPresence(p) {
  if (!p.companion) {
    $("#online-n").textContent = "";
    $("#presence").innerHTML = `<p>fc-companion isn't running on this node yet, so clearcast can't see who's here.</p><p class="note">Run command 1 again on the server to add it, and open port 3390.</p>`;
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
    const me = await kit.me();
    if (!me) throw new SignedOut();
    if (setTo) await mine.setStatus(me.fid, setTo);
    paintPresence(await api("/api/presence", { device: await mine.device(me.fid) }));
  } catch (e) {
    $("#online-n").textContent = "";
    $("#presence").innerHTML = e instanceof SignedOut ? `<p>Sign in to show up here.</p><a class="k-btn primary" href="/signin">sign in</a>` : `<p class="dim">${esc(e.message)}</p>`;
  }
}
function togglePresence() {
  sfx.toggle();
  loadPresence(S.presence === "online" ? "invisible" : "online");
}

// ------------------------------------------------------------------ modes + input
const modes = [...document.querySelectorAll(".mode")];
// The bar is the same on every page (kit.modes): the solid highlight says
// where you are. Here on home, a cursor (the lifted button) picks where to go
// with the arrow keys, a controller or the mouse.
function select(i, sound = true) {
  const next = (i + modes.length) % modes.length;
  if (next !== S.sel && sound) sfx.move();
  S.sel = next;
  modes.forEach((m, j) => m.classList.toggle("cursor", j === S.sel));
}
function open() {
  const m = modes[S.sel], href = m.getAttribute("href");
  if (m.getAttribute("aria-disabled") === "true") { sfx.back(); return; } // kit says "coming soon"
  if (m.dataset.mode === "home") { sfx.move(); return; }
  sfx.open();
  if (href) setTimeout(() => (location.href = href), 220);
}
const back = () => { sfx.back(); $("#toast").classList.remove("show"); };
modes.forEach((m, j) => { m.addEventListener("mouseenter", () => select(j)); m.addEventListener("click", (e) => { e.preventDefault(); select(j, false); open(); }); });
document.addEventListener("click", (e) => {
  const go = e.target.closest?.("[data-mode-go]");
  if (go) { select(modes.findIndex((m) => m.dataset.mode === go.dataset.modeGo), false); open(); }
});

const ready = () => document.body.classList.contains("ready");
addEventListener("keydown", (e) => {
  kit.unlock();
  if (!ready() || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (["arrowleft", "arrowup", "h", "k"].includes(k)) { select(S.sel - 1); e.preventDefault(); }
  else if (["arrowright", "arrowdown", "l", "j"].includes(k)) { select(S.sel + 1); e.preventDefault(); }
  else if (k === "enter" || k === " " || k === "a") { open(); e.preventDefault(); }
  else if (k === "escape" && !$("#followers").hidden) closeFollowers();
  else if (k === "escape" || k === "b") back();
  else if (k === "o") togglePresence();
  else if (k === "m") { S.sound = !S.sound; kit.setSound(S.sound); $("#snd").textContent = S.sound ? "on" : "off"; }
  else if (/^[1-4]$/.test(k)) { select(+k - 1); open(); }
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
}
// Poll fast while measuring, come back when a failed run is due to retry, else every 10 minutes.
async function conditionsLoop() {
  for (;;) {
    await refreshConditions().catch(() => {});
    const c = S.cond;
    await wait(c?.state === "measuring" ? 3000 : c?.state === "failed" && c.retryAt ? Math.max(3000, Date.parse(c.retryAt) - Date.now() + 1000) : 10 * 60_000);
  }
}

(async () => {
  $("#snd").textContent = S.sound ? "on" : "off";
  select(0, false);
  paintClock(); setInterval(paintClock, 15_000);
  kit.me().then((me) => { S.me = me; paintClock(); });
  paintConditions();
  const home = await boot();
  S.home = home; paintNode(home);
  refreshLive().catch(() => {});
  loadWaiting(); loadPresence();
  conditionsLoop();
  every(10_000, refreshHome);
  every(20_000, refreshLive);
  every(30_000, () => loadPresence());
})();
