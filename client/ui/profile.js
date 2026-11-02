// fameboy profile: anyone's profile at /profile/<username> (or /profile/<fid>),
// read from your node, so fameboy links here instead of farcaster.xyz.
// Tiles: who they are (with follow), follow counts and casts a day over 30
// days, people you follow who follow them, the apps they cast from, and
// their casts and replies, newest first. Open to anyone; signed in, it also
// says whether they follow you.

const { $, esc, api, tone, toast, ago, pic, rich, embeds, castUrl, profileUrl, icon } = kit;

const WHO = decodeURIComponent(location.pathname.split("/")[2] ?? "").replace(/^@/, "");
const S = {
  me: null,
  view: null, // GET /api/profile
  follows: null, // GET /api/profile/follows: counts and people in common, slower
  tab: "casts",
  lists: { casts: null, replies: null },
  next: { casts: null, replies: null },
  loading: false,
  counts: new Map(), // hash -> { likes, recasts, replies, liked, recasted }
  busy: false,
};
const n = (x) => Number(x).toLocaleString("en-US");
// Big counts as "20K", so they fit the numbers tile.
const short = (x) => (x >= 10_000 ? Number(x).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 }) : n(x));
const when = (iso) => new Date(iso).toLocaleString([], { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
const handle = (p) => (p.username ? `@${p.username}` : `fid ${p.fid}`);

// ------------------------------------------------------------------ tiles
function who() {
  const v = S.view, p = v.profile;
  const follow = v.self
    ? `<a class="k-btn lg" href="/me"><span class="k-lbl">edit on your me page</span></a>`
    : kit.button(v.youFollow ? "following" : "follow", { size: "lg", look: v.youFollow ? "" : "primary", fixed: true, key: "f", pressed: v.youFollow, busy: S.busy, attrs: "data-follow" });
  return `<section class="tile span7"><h2><span>who</span><span>${v.followsYou ? "follows you" : v.self ? "you" : ""}</span></h2><div class="body pr-who">
    ${pic(p.pfp)}
    <div>
      <div class="pr-name">${esc(p.display || handle(p))}</div>
      <div class="dim">${esc(handle(p))}${p.username ? ` · fid ${p.fid}` : ""}</div>
      ${p.bio ? `<p>${rich(p.bio)}</p>` : `<p class="dim">No bio.</p>`}
      <div class="pr-btns">${follow}${kit.button("copy link", { size: "lg", look: "quiet", attrs: "data-copy" })}</div>
    </div>
  </div></section>`;
}

// Their casts from the last 30 days, sorted into this browser's local days.
function days() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const counts = new Array(30).fill(0);
  for (const t of S.view.casts) {
    const d = new Date(t); d.setHours(0, 0, 0, 0);
    const ago = Math.round((today - d) / 86_400_000);
    if (ago >= 0 && ago < 30) counts[29 - ago]++;
  }
  return counts;
}

function numbers() {
  const f = S.follows, d = days(), max = Math.max(1, ...d), total = d.reduce((a, b) => a + b, 0);
  const count = (c) => (f ? `${short(c.count)}${c.more ? "+" : ""}` : `<span class="blink">_</span>`);
  return `<section class="tile span5"><h2><span>numbers</span><span>${n(total)} casts in 30 days</span></h2><div class="body">
    <div class="pr-nums">
      <div><span class="count">${count(f?.followers)}</span><span class="dim">followers</span></div>
      <div><span class="count">${count(f?.following)}</span><span class="dim">following</span></div>
    </div>
    <div class="pr-days" role="img" aria-label="Casts a day over the last 30 days">${d.map((c, i) => `<span class="${c ? "" : "zero"}"${c ? ` style="height:${(c / max) * 100}%"` : ""} title="${c} cast${c === 1 ? "" : "s"}, ${29 - i === 0 ? "today" : `${29 - i}d ago`}"></span>`).join("")}</div>
    <div class="pr-days-l"><span>30d ago</span><span>15d</span><span>today</span></div>
  </div></section>`;
}

function common() {
  const v = S.view;
  if (!v.signedIn || v.self) return "";
  if (!S.follows) return `<section class="tile"><h2><span>in common</span><span></span></h2><div class="body dim">counting<span class="blink">_</span></div></section>`;
  const c = S.follows.common, link = (p) => `<a href="${profileUrl(p.username ?? p.fid)}">@${esc(p.username ?? p.fid)}</a>`;
  const words = !c.count ? "Nobody you follow follows them yet."
    : c.count === 1 ? `Followed by ${link(c.people[0])}.`
    : c.count === 2 ? `Followed by ${link(c.people[0])} and ${link(c.people[1])}.`
    : `Followed by ${link(c.people[0])}, ${link(c.people[1])} and ${n(c.count - 2)} others you follow.`;
  return `<section class="tile"><h2><span>in common</span><span>${n(c.count)} you follow</span></h2><div class="body">
    ${c.people.length ? `<div class="pr-stack">${c.people.map((p) => `<a href="${profileUrl(p.username ?? p.fid)}" title="@${esc(p.username ?? p.fid)}">${pic(p.pfp)}</a>`).join("")}</div>` : ""}
    <div>${words}</div>
  </div></section>`;
}

function apps() {
  const list = S.view.apps, total = list.reduce((a, b) => a + b.count, 0);
  if (!total) return `<section class="tile"><h2><span>casts from</span><span>30 days</span></h2><div class="body dim">No casts in the last 30 days.</div></section>`;
  const top = list[0].count;
  return `<section class="tile"><h2><span>casts from</span><span>by app key</span></h2><div class="body">
    <ul class="pr-apps">${list.slice(0, 5).map((a) => `<li><span>${a.name ? `<a href="${profileUrl(a.name)}">@${esc(a.name)}</a>` : `<span class="dim">unknown app</span>`}</span><i style="width:${(a.count / top) * 100}%"></i><span class="n">${Math.round((a.count / total) * 100)}%</span></li>`).join("")}</ul>
    <div class="pr-apps-note">The app whose key signed each cast, last 30 days.</div>
  </div></section>`;
}

// ------------------------------------------------------------------ casts
const num = (c, k) => (c ? n(c[k]) : "-");
function card(c) {
  const k = S.counts.get(c.hash);
  const tags = [c.replyTo ? "reply" : "", c.channel ? `/${esc(c.channel)}` : "", c.app ? `via @${esc(c.app.name)}` : ""].filter(Boolean).join(" · ");
  return `<article class="ct-c" data-href="${castUrl(c)}">
    ${pic(c.author?.pfp)}
    <div class="body">
      <div class="who"><b>${esc(c.author?.display ?? `@${c.author?.username ?? c.fid}`)}</b><span class="dim">${tags}</span><a class="t" href="${castUrl(c)}" title="${esc(when(c.time))}">${ago(c.time)}</a></div>
      <div class="tx">${rich(c.text)}</div>
      ${embeds(c.embeds)}
      ${kit.quotes(c.quotes)}
      <div class="ft me-acts">
        <a class="k-btn" href="${castUrl(c)}" title="Reply on the cast's page" aria-label="Reply"><span class="k-lbl">${icon("reply")}<span>${num(k, "replies")}</span></span></a>
        ${kit.button(`${icon("recast")}<span>${num(k, "recasts")}</span>`, { cls: k?.recasted ? "on" : "", disabled: !k, attrs: `data-act="recast" data-hash="${c.hash}" title="${k?.recasted ? "Undo recast" : "Recast"}" aria-label="${k?.recasted ? "Undo recast" : "Recast"}"` })}
        ${kit.button(`${icon(k?.liked ? "heart-on" : "heart")}<span>${num(k, "likes")}</span>`, { disabled: !k, attrs: `data-act="like" data-hash="${c.hash}" title="${k?.liked ? "Unlike" : "Like"}" aria-label="${k?.liked ? "Unlike" : "Like"}"` })}
        ${kit.button(`${icon("share")}<span class="me-word">share</span>`, { attrs: `data-act="share" data-hash="${c.hash}" title="Copy a link to this cast" aria-label="Share: copy a link"` })}
      </div>
    </div>
  </article>`;
}

function castsTile() {
  const list = S.lists[S.tab];
  const more = S.next[S.tab] ? `<div class="me-more">${kit.button(S.loading ? "loading…" : "older", { attrs: "data-more", busy: S.loading })}</div>` : "";
  const body = !list ? `<div class="loading">looking<span class="blink">_</span></div>`
    : list.length ? `<div class="me-list">${list.map(card).join("")}</div>${more}`
    : S.next[S.tab] ? `<p class="ct-note">None in their newest 100 messages.</p>${more}`
    : `<p class="ct-note">${S.tab === "casts" ? "No casts yet." : "No replies yet."}</p>`;
  return `<section class="tile span7 pr-casts"><h2><span>casts</span><span>newest first</span></h2><div class="body">
    ${kit.seg([["casts", "casts"], ["replies", "replies"]], S.tab)}${body}
  </div></section>`;
}

function render() {
  if (!S.view) return;
  $("#view").innerHTML = `<div class="grid">${who()}${numbers()}${castsTile()}<div class="span5 pr-side">${common()}${apps()}</div></div>`;
}

// ------------------------------------------------------------------ load
async function load(tab) {
  if (S.loading) return;
  S.loading = true;
  if (S.lists[tab]) render();
  try {
    const q = new URLSearchParams({ fid: S.view.profile.fid, replies: tab === "replies" ? "1" : "0" });
    if (S.next[tab]) q.set("next", S.next[tab]);
    const d = await api(`/api/profile/casts?${q}`);
    S.lists[tab] = [...(S.lists[tab] ?? []), ...d.casts];
    S.next[tab] = d.next;
  } catch (e) {
    toast(e.message, 3500);
    S.lists[tab] ??= [];
  } finally {
    S.loading = false;
  }
  render();
  counts();
}

// Likes, recasts and replies for each cast shown, six at a time.
let counting = false;
async function counts() {
  if (counting) return;
  counting = true;
  try {
    for (;;) {
      const todo = [...(S.lists.casts ?? []), ...(S.lists.replies ?? [])].filter((c) => !S.counts.has(c.hash)).slice(0, 6);
      if (!todo.length) break;
      await Promise.all(todo.map(async (c) => {
        const k = await api(`/api/inbox/counts?fid=${c.fid}&hash=${c.hash}`).catch(() => null);
        S.counts.set(c.hash, k ?? { likes: "?", recasts: "?", replies: "?" });
      }));
      render();
    }
  } finally {
    counting = false;
  }
}

function show(tab) {
  if (S.tab === tab) return;
  S.tab = tab;
  tone(880, 0, 0.02, 0.02);
  render();
  if (!S.lists[tab]) load(tab);
}

// ------------------------------------------------------------------ actions
const signIn = () => (location.href = `/signin?next=${encodeURIComponent(location.pathname)}`);
const find = (hash) => [...(S.lists.casts ?? []), ...(S.lists.replies ?? [])].find((c) => c.hash === hash);

async function follow() {
  const v = S.view;
  if (!v || v.self || S.busy) return;
  if (!S.me) return signIn();
  const on = !v.youFollow;
  S.busy = true; render();
  try {
    await api("/api/follow", { user: String(v.profile.fid), on });
    v.youFollow = on;
    if (S.follows) S.follows.followers.count += on ? 1 : -1;
    on ? (tone(784, 0, 0.05), tone(1175, 0.05, 0.07)) : tone(660, 0, 0.03);
    toast(on ? `Following ${handle(v.profile)}.` : `Unfollowed ${handle(v.profile)}.`);
  } catch (e) {
    toast(e.message, 3500);
  } finally {
    S.busy = false; render();
  }
}

async function react(c, kind) {
  const k = S.counts.get(c.hash);
  if (!k || S.busy) return;
  if (!S.me) return signIn();
  const key = kind === "like" ? "liked" : "recasted", count = kind === "like" ? "likes" : "recasts", on = !k[key];
  S.busy = true;
  try {
    await api("/api/react", { kind, target: { fid: c.fid, hash: c.hash }, on });
    k[key] = on;
    k[count] += on ? 1 : -1;
    if (kind === "like") { tone(784, 0, 0.05); tone(1175, 0.05, 0.07); } else tone(660, 0, 0.03);
    toast(kind === "like" ? (on ? "Liked." : "Unliked.") : on ? "Recasted." : "Recast removed.");
  } catch (e) {
    toast(e.message, 3500);
  } finally {
    S.busy = false;
    render();
  }
}

// A link someone else can open: this fameboy's own address when it's hosted;
// on your own computer (127.0.0.1) the farcaster.xyz address.
const hosted = () => !/^(127\.0\.0\.1|localhost|\[::1\])$/.test(location.hostname);
async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    tone(660, 0, 0.03);
    toast("Link copied.");
  } catch {
    toast(url, 6000);
  }
}
function shareCast(c) {
  const u = c.author?.username;
  copy(hosted() || !u ? `${location.origin}${castUrl(c)}` : `https://farcaster.xyz/${encodeURIComponent(u)}/${c.hash.slice(0, 10)}`);
}
function shareProfile() {
  const p = S.view.profile;
  copy(hosted() || !p.username ? `${location.origin}${profileUrl(p.username ?? p.fid)}` : `https://farcaster.xyz/${encodeURIComponent(p.username)}`);
}

const ACTS = { recast: (c) => react(c, "recast"), like: (c) => react(c, "like"), share: shareCast };

// ------------------------------------------------------------------ input
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-follow]")) return follow();
  if (t.closest("[data-copy]")) return shareProfile();
  const tab = t.closest("[data-tab]");
  if (tab) return show(tab.dataset.tab);
  if (t.closest("[data-more]")) return load(S.tab);
  const act = t.closest("[data-act]"), c0 = act && find(act.dataset.hash);
  if (c0) return ACTS[act.dataset.act]?.(c0);
  // A click on a cast opens its conversation, unless it was on a link or a
  // button, or the end of selecting some text.
  const c = t.closest(".ct-c[data-href]");
  if (c && !t.closest("a, button") && !String(getSelection?.() ?? "")) { tone(880, 0, 0.02, 0.02); location.href = c.dataset.href; }
});

addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "f") follow();
  else if (k === "c") show("casts");
  else if (k === "r") show("replies");
  else if (k === "escape") history.length > 1 ? history.back() : (location.href = "/");
});

(async () => {
  if (!WHO) { location.href = "/me"; return; }
  S.me = await kit.me();
  try {
    S.view = await api(`/api/profile?who=${encodeURIComponent(WHO)}`);
  } catch (e) {
    document.title = `not found · ${document.title}`;
    $("#sub").textContent = `@${WHO}`;
    $("#view").innerHTML = `<section class="tile pr-missing"><h2><span>not found</span><span></span></h2><div class="body">${esc(e.message)}<p>${kit.ext(`https://farcaster.xyz/${encodeURIComponent(WHO)}`, "try farcaster.xyz")}</p></div></section>`;
    return;
  }
  const p = S.view.profile;
  document.title = document.title.replace(/^profile/, handle(p));
  $("#sub").textContent = `${handle(p)}${p.username ? ` · fid ${p.fid}` : ""}`;
  $("#links").innerHTML = p.username ? kit.ext(`https://farcaster.xyz/${encodeURIComponent(p.username)}`, "on Farcaster") : "";
  render();
  api(`/api/profile/follows?fid=${p.fid}`).then((f) => { S.follows = f; render(); }, (e) => toast(e.message, 3500));
  await load("casts");
})();
