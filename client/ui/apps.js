// fameboy apps: which apps the casts in your feed came through. Every cast is
// signed by an app key, and every app key names the app that asked for it, so
// your node can tell (client/src/filter.ts). Show only one app's casts, or
// hide some (the Farcaster app, say): the inbox and home follow the choice,
// which stays in this browser (kit.appFilter).

const { $, esc, api, toast, SignedOut } = kit;
const AF = kit.appFilter;
const fmt = (n) => Number(n).toLocaleString("en-US");
const S = { feed: null, sel: 0 };

const pic = (url) => (url ? `<img class="pf" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pf nopic"></span>`);
const sfx = {
  move: () => kit.tone(880, 0, 0.02, 0.02),
  toggle: () => { kit.tone(660, 0, 0.04, { vol: 0.03 }); kit.tone(440, 0.05, 0.06, { vol: 0.03 }); },
};

// One row per app, most casts first. "?" is casts whose key we can't place
// (expired or revoked since, or no metadata).
function counts() {
  const m = new Map();
  for (const c of S.feed.casts) {
    const k = c.app ? c.app.fid : "?";
    const e = m.get(k) ?? { k, name: c.app?.name ?? null, pfp: c.app?.pfp ?? null, n: 0, fresh: 0 };
    e.n++;
    m.set(k, e);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

// Remember names, so other pages can say "hiding @warpcast" without asking again.
function save(f) {
  for (const a of counts()) if (a.k !== "?" && a.name) f.names[a.k] = a.name;
  AF.set(f);
}

function paint() {
  const all = S.feed.casts, rows = counts(), f = AF.get();
  if (!all.length) {
    $("#view").innerHTML = `<div class="tile empty">${S.feed.following ? "No recent casts from the people you follow." : "You don't follow anyone yet, so there's nothing to count."}</div>`;
    return;
  }
  const pct = (n) => (n / all.length) * 100;
  const pctLabel = (n) => (pct(n) < 1 ? "<1%" : `${Math.round(pct(n))}%`);
  const top = rows[0], shown = all.filter((c) => AF.keeps(c.app?.fid, f)).length;
  const known = rows.filter((a) => a.k !== "?").length;
  S.sel = Math.min(S.sel, rows.length - 1);
  const mode = f.only !== null ? "only" : f.hide.length === 1 && f.hide[0] === kit.FARCASTER_APP ? "nofc" : f.hide.length ? "custom" : "all";
  $("#sub").textContent = `the latest ${fmt(all.length)} casts from the ${fmt(S.feed.following)} accounts you follow`;
  $("#view").innerHTML = `
    <div class="grid">
      <section class="tile span5">
        <h2><span>the big one</span><span>${known} app${known === 1 ? "" : "s"} in all</span></h2>
        <div class="body top">
          <div class="big">${pctLabel(top.n)}</div>
          <p>of your feed came through <b>${top.k === "?" ? "apps fameboy can't name" : `@${esc(top.name)}`}</b>.${rows[1] ? ` Next: ${rows[1].k === "?" ? "unknown apps" : `@${esc(rows[1].name)}`}, ${pctLabel(rows[1].n)}.` : ""}</p>
        </div>
      </section>
      <section class="tile span7">
        <h2><span>how fameboy knows</span><span>signersByFid</span></h2>
        <div class="body how">
          <p>Every cast is signed by an app key. Each key was added by an app, and your node remembers which one. fameboy asks your node for each author's keys and matches them up.</p>
          <p class="dim small">The calls are in requests, below. Casts whose key has since expired or been removed count as unknown.</p>
        </div>
      </section>
      <section class="tile span12">
        <h2><span>show casts from</span><span>${AF.on(f) ? `${esc(AF.describe(f))} · ${fmt(shown)} of ${fmt(all.length)} casts` : `every app · ${fmt(all.length)} casts`}</span></h2>
        <div class="body">
          <div class="tools">
            ${kit.seg([["all", "all apps"], ["nofc", "hide @warpcast"]], mode, "data-mode-set")}
            ${mode === "only" || mode === "custom" ? `<span class="dim">${esc(AF.describe(f))}</span>` : ""}
            <a class="k-btn primary push" href="/inbox#casts">read them in inbox →</a>
          </div>
          <ol class="apps">${rows.map((a, i) => {
            const hidden = !AF.keeps(a.k === "?" ? undefined : a.k, f), only = f.only === a.k;
            const label = a.k === "?" ? "unknown app" : `@${esc(a.name)}`;
            return `<li class="${hidden ? "off" : ""}${i === S.sel ? " sel" : ""}" data-i="${i}">
              ${a.k === "?" ? `<span class="pf nopic">?</span>` : pic(a.pfp)}
              <span class="name">${a.k === "?" ? label : kit.ext(`https://farcaster.xyz/${encodeURIComponent(a.name ?? "")}`, label, { title: `@${a.name} on farcaster.xyz` })}${a.k === kit.FARCASTER_APP ? `<span class="dim small"> the Farcaster app</span>` : ""}</span>
              <span class="track" title="${fmt(a.n)} of ${fmt(all.length)} casts"><i style="width:${Math.max(1, pct(a.n))}%"></i></span>
              <span class="pct">${pctLabel(a.n)}</span>
              <span class="n dim">${fmt(a.n)}</span>
              <span class="acts">${kit.button("only", { pressed: only, attrs: `data-only="${a.k}" title="Show only casts via ${esc(label)}"` })}${kit.button(hidden && !only && f.only === null ? "show" : "hide", { look: "quiet", pressed: hidden && f.only === null, attrs: `data-hide="${a.k}" title="${hidden ? "Show" : "Hide"} casts via ${esc(label)}"` })}</span>
            </li>`;
          }).join("")}</ol>
        </div>
      </section>
    </div>`;
}

const keyOf = (v) => (v === "?" ? "?" : Number(v));
function only(k) {
  const f = AF.get();
  f.only = f.only === k ? null : k;
  if (f.only !== null) f.hide = [];
  save(f); sfx.toggle(); paint();
  toast(f.only === null ? "Showing every app." : `Only ${AF.name(k, AF.get())} now, here, in your inbox and on home.`);
}
function hide(k) {
  const f = AF.get();
  if (f.only !== null) { f.only = null; f.hide = []; }
  f.hide = f.hide.includes(k) ? f.hide.filter((x) => x !== k) : [...f.hide, k];
  save(f); sfx.toggle(); paint();
}

document.addEventListener("click", (e) => {
  const o = e.target.closest?.("[data-only]");
  if (o) return only(keyOf(o.dataset.only));
  const h = e.target.closest?.("[data-hide]");
  if (h) return hide(keyOf(h.dataset.hide));
  const m = e.target.closest?.("[data-mode-set]");
  if (m) {
    const f = AF.get();
    f.only = null;
    f.hide = m.dataset.modeSet === "nofc" ? [kit.FARCASTER_APP] : [];
    save(f); sfx.toggle(); paint();
  }
});

addEventListener("keydown", (e) => {
  if (!S.feed?.casts.length || e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
  const rows = counts(), k = e.key.toLowerCase();
  if (k === "j" || k === "arrowdown") { S.sel = Math.min(rows.length - 1, S.sel + 1); sfx.move(); paint(); }
  else if (k === "k" || k === "arrowup") { S.sel = Math.max(0, S.sel - 1); sfx.move(); paint(); }
  else if (k === "o") only(rows[S.sel].k);
  else if (k === "h") hide(rows[S.sel].k);
  else if (k === "i") location.href = "/inbox#casts";
  else if (k === "escape") location.href = "/";
  else return;
  e.preventDefault();
  document.querySelector(".apps li.sel")?.scrollIntoView({ block: "nearest" });
});

(async () => {
  try {
    if (!(await kit.me())) throw new SignedOut();
    const feed = await api("/api/feed");
    // A feed is kept for 2 minutes. When this one came from there, show the calls that built it.
    const age = Math.round((Date.now() - feed.builtAt) / 1000);
    if (age > 2) kit.requests.add(feed.calls, `Your feed was built ${age} s ago and is kept for 2 minutes. These are the calls that built it.`);
    S.feed = feed;
    paint();
  } catch (e) {
    if (e instanceof SignedOut) location.href = "/signin";
    else $("#view").innerHTML = `<div class="tile empty">${esc(e.message)}</div>`;
  }
})();
