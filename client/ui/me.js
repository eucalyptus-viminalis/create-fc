// fameboy me: your own casts, newest first, with your replies on their own
// tab. Each one opens its conversation, and the "…" in its corner deletes it
// (kit.castMenu). Counts load after the list, a few at a time.

const { $, esc, api, tone, ago, pic, rich, embeds, castUrl, profileUrl } = kit;

const S = {
  me: null,
  tab: "casts",
  lists: { casts: null, replies: null }, // casts loaded so far, per tab
  next: { casts: null, replies: null }, // where the next page starts; null: no more
  loading: false,
  counts: new Map(), // hash -> { likes, recasts, replies }
};
const when = (iso) => new Date(iso).toLocaleString([], { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ render
function card(c) {
  const n = S.counts.get(c.hash);
  const tags = [c.replyTo ? "reply" : "", c.channel ? `/${esc(c.channel)}` : "", c.app ? `via @${esc(c.app.name)}` : ""].filter(Boolean).join(" · ");
  return `<article class="ct-c" data-href="${castUrl(c)}">
    ${pic(c.author?.pfp)}
    <div class="body">
      <div class="who"><b>${esc(c.author?.display ?? `@${c.author?.username ?? c.fid}`)}</b><span class="dim">${tags}</span><a class="t" href="${castUrl(c)}" title="${esc(when(c.time))}">${ago(c.time)}</a>${kit.castMenu.html(c, S.me)}</div>
      <div class="tx">${rich(c.text)}</div>
      ${embeds(c.embeds)}
      <div class="ft">${n ? `<span>↩ ${n.replies}</span><span>⟲ ${n.recasts}</span><span>♥ ${n.likes}</span>` : `<span>counting<span class="blink">_</span></span>`}</div>
    </div>
  </article>`;
}

function render() {
  const list = S.lists[S.tab];
  $("#tools").innerHTML = kit.seg([["casts", "casts"], ["replies", "replies"]], S.tab);
  if (!list) { $("#view").innerHTML = `<div class="loading">looking<span class="blink">_</span></div>`; return; }
  const more = S.next[S.tab]
    ? `<div class="me-more">${kit.button(S.loading ? "loading…" : "older", { attrs: "data-more", busy: S.loading })}</div>`
    : list.length ? `<p class="ct-note">That's all of them.</p>` : "";
  $("#view").innerHTML = list.length
    ? `<div class="me-list">${list.map(card).join("")}</div>${more}`
    : S.next[S.tab]
      ? `<p class="ct-note">None in your newest ${plural(pages(S.tab) * 100, "message")}.</p>${more}`
      : `<div class="tile empty">${S.tab === "casts" ? "No casts yet. Compose one." : "No replies yet."}</div>`;
}
const loaded = { casts: 0, replies: 0 };
const pages = (tab) => loaded[tab];

// ------------------------------------------------------------------ load
async function load(tab) {
  if (S.loading) return;
  S.loading = true;
  if (S.lists[tab]) render();
  try {
    const q = new URLSearchParams({ replies: tab === "replies" ? "1" : "0" });
    if (S.next[tab]) q.set("next", S.next[tab]);
    const d = await api(`/api/me/casts?${q}`);
    S.lists[tab] = [...(S.lists[tab] ?? []), ...d.casts];
    S.next[tab] = d.next;
    loaded[tab]++;
  } catch (e) {
    kit.toast(e.message, 3500);
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
        const n = await api(`/api/inbox/counts?fid=${c.fid}&hash=${c.hash}`).catch(() => null);
        S.counts.set(c.hash, n ?? { likes: "?", recasts: "?", replies: "?" });
      }));
      if (!kit.castMenu.open()) render();
    }
  } finally {
    counting = false;
  }
  render();
}

function show(tab) {
  if (S.tab === tab) return;
  S.tab = tab;
  tone(880, 0, 0.02, 0.02);
  render();
  if (!S.lists[tab]) load(tab);
}

// After a delete: take it out of the list.
function gone(hash) {
  for (const t of ["casts", "replies"]) if (S.lists[t]) S.lists[t] = S.lists[t].filter((c) => c.hash !== hash);
  render();
}

// ------------------------------------------------------------------ input
document.addEventListener("click", (e) => {
  const t = e.target;
  const tab = t.closest("[data-tab]");
  if (tab) return show(tab.dataset.tab);
  if (t.closest("[data-more]")) return load(S.tab);
  // A click on a cast opens its conversation, unless it was on a link or a
  // button, or the end of selecting some text.
  const c = t.closest(".ct-c[data-href]");
  if (c && !t.closest("a, button") && !String(getSelection?.() ?? "")) { tone(880, 0, 0.02, 0.02); location.href = c.dataset.href; }
});

addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "c") show("casts");
  else if (k === "r") show("replies");
  else if (k === "escape") location.href = "/";
});

kit.castMenu.wire(render, gone);

(async () => {
  S.me = await kit.me();
  if (!S.me) {
    $("#view").innerHTML = `<div class="tile empty">Sign in to see your casts.<p>${kit.button("sign in", { look: "primary", size: "lg", attrs: "data-signin" })}</p></div>`;
    $("#view").querySelector("[data-signin]").addEventListener("click", () => (location.href = "/signin?next=/me"));
    return;
  }
  const u = S.me.username;
  $("#sub").textContent = `${u ? `@${u}` : `fid ${S.me.fid}`} · your casts, newest first`;
  if (u) $("#links").innerHTML = kit.ext(profileUrl(u), "on Farcaster");
  render();
  await load("casts");
})();
