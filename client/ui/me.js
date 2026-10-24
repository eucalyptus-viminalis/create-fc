// fameboy me: your own casts, newest first, with your replies on their own
// tab. Each one opens its conversation, and the "…" in its corner deletes it
// (kit.castMenu). Under each: reply, recast, like and share (copy its link).
// Counts, and whether you've liked or recast each, load after the list.

const { $, esc, api, tone, toast, ago, pic, rich, embeds, castUrl, profileUrl } = kit;
const enc = new TextEncoder();

const S = {
  me: null,
  tab: "casts",
  lists: { casts: null, replies: null }, // casts loaded so far, per tab
  next: { casts: null, replies: null }, // where the next page starts; null: no more
  loading: false,
  counts: new Map(), // hash -> { likes, recasts, replies, liked, recasted }
  reply: null, // the cast you're replying to
  draft: "", // what you've typed so far, kept across redraws
  busy: false,
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
      <div class="ft">
        ${kit.button(`↩ ${n ? n.replies : "-"}`, { look: "quiet", pressed: S.reply === c.hash, attrs: `data-act="reply" data-hash="${c.hash}" title="Reply"` })}
        ${kit.button(`⟲ ${n ? n.recasts : "-"}`, { pressed: Boolean(n?.recasted), disabled: !n, attrs: `data-act="recast" data-hash="${c.hash}" title="${n?.recasted ? "Undo your recast" : "Recast"}"` })}
        ${kit.button(`♥ ${n ? n.likes : "-"}`, { pressed: Boolean(n?.liked), disabled: !n, attrs: `data-act="like" data-hash="${c.hash}" title="${n?.liked ? "Unlike" : "Like"}"` })}
        ${kit.button("share", { look: "quiet", attrs: `data-act="share" data-hash="${c.hash}" title="Copy a link to this cast"` })}
      </div>
      ${S.reply === c.hash ? replyBox(c) : ""}
    </div>
  </article>`;
}

// Reply in place, under the cast you're answering.
function replyBox(c) {
  return `<div class="inline" data-reply-box><textarea placeholder="Reply to your cast" aria-label="Reply">${esc(S.draft)}</textarea>
    <div class="row"><span class="dim small">replying to yourself</span><span class="left">320</span>${kit.button("cast", { look: "primary", key: "⌘↵", attrs: "data-send" })}</div></div>`;
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
  if (S.reply) wireReplyBox();
}

function wireReplyBox() {
  const box = $("[data-reply-box]");
  if (!box) return;
  const ta = box.querySelector("textarea"), left = box.querySelector(".left");
  const paint = () => { const n = 320 - enc.encode(ta.value).length; left.textContent = n < 0 ? `${-n} over` : n; left.classList.toggle("over", n < 0); };
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  paint();
  ta.addEventListener("input", () => { S.draft = ta.value; paint(); });
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
    if (e.key === "Escape") { e.stopPropagation(); S.reply = null; S.draft = ""; render(); }
  });
  box.querySelector("[data-send]").addEventListener("click", send);
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
      if (!kit.castMenu.open() && !S.reply) render();
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

// ------------------------------------------------------------------ actions
const find = (hash) => [...(S.lists.casts ?? []), ...(S.lists.replies ?? [])].find((c) => c.hash === hash);

async function react(c, kind) {
  const n = S.counts.get(c.hash);
  if (!n || S.busy) return;
  const key = kind === "like" ? "liked" : "recasted", count = kind === "like" ? "likes" : "recasts", on = !n[key];
  S.busy = true;
  try {
    await api("/api/react", { kind, target: { fid: c.fid, hash: c.hash }, on });
    n[key] = on;
    n[count] += on ? 1 : -1;
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
// on your own computer (127.0.0.1) the cast's farcaster.xyz address.
async function share(c) {
  const u = c.author?.username;
  const url = S.me.hosted || !u ? `${location.origin}${castUrl(c)}` : `${profileUrl(u)}/${c.hash.slice(0, 10)}`;
  try {
    await navigator.clipboard.writeText(url);
    tone(660, 0, 0.03);
    toast("Link copied.");
  } catch {
    toast(url, 6000);
  }
}

function toggleReply(c) {
  S.reply = S.reply === c.hash ? null : c.hash;
  S.draft = "";
  tone(880, 0, 0.02, 0.02);
  render();
}

async function send() {
  const box = $("[data-reply-box]"), c = find(S.reply);
  if (!box || !c) return;
  const text = box.querySelector("textarea").value;
  if (!text.trim() || 320 - enc.encode(text).length < 0) return;
  const b = box.querySelector("[data-send]");
  b.setAttribute("aria-disabled", "true"); b.textContent = "casting…";
  try {
    const r = await api("/api/cast", { text, replyTo: { fid: c.fid, hash: c.hash } });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.06, 0.1, 0.035));
    toast(r.landed ? "Replied. It's on Farcaster." : "Sent. It should land soon.");
    const n = S.counts.get(c.hash);
    if (n) n.replies++;
    S.reply = null; S.draft = "";
    // The replies tab loads again next time, with this one in it.
    S.lists.replies = null; S.next.replies = null; loaded.replies = 0;
    render();
  } catch (e) {
    toast(e.message, 3500);
    b.removeAttribute("aria-disabled"); b.innerHTML = "cast <kbd>⌘↵</kbd>";
  }
}

const ACTS = { reply: toggleReply, recast: (c) => react(c, "recast"), like: (c) => react(c, "like"), share };

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
  const act = t.closest("[data-act]"), c0 = act && find(act.dataset.hash);
  if (c0) return ACTS[act.dataset.act]?.(c0);
  // A click on a cast opens its conversation, unless it was on a link or a
  // button, or the end of selecting some text.
  const c = t.closest(".ct-c[data-href]");
  if (c && !t.closest("a, button, .inline") && !String(getSelection?.() ?? "")) { tone(880, 0, 0.02, 0.02); location.href = c.dataset.href; }
});

addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "c") show("casts");
  else if (k === "r") show("replies");
  else if (k === "escape") { if (S.reply) { S.reply = null; S.draft = ""; render(); } else location.href = "/"; }
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
