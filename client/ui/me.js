// fameboy me: your own casts, newest first, with your replies on their own
// tab. Each one opens its conversation, and the "…" in its corner deletes it
// (kit.castMenu). Under each: reply, recast (or quote it), like, and share
// (copy its link). Counts, and whether you've liked or recast each, load
// after the list.

const { $, esc, api, tone, toast, ago, pic, rich, embeds, castUrl, profileUrl, icon } = kit;
const enc = new TextEncoder();

const S = {
  me: null,
  tab: "casts",
  lists: { casts: null, replies: null }, // casts loaded so far, per tab
  next: { casts: null, replies: null }, // where the next page starts; null: no more
  loading: false,
  counts: new Map(), // hash -> { likes, recasts, replies, liked, recasted }
  compose: null, // { hash, kind: "reply" | "quote" }: the box open under a cast
  draft: "", // what you've typed so far, kept across redraws
  pop: null, // the cast whose recast menu is open
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
      ${kit.quotes(c.quotes)}
      <div class="ft me-acts">
        ${kit.button(`${icon("reply")}<span>${num(n, "replies")}</span>`, { attrs: `data-act="reply" data-hash="${c.hash}" title="Reply" aria-label="Reply" aria-expanded="${S.compose?.hash === c.hash && S.compose.kind === "reply"}"` })}
        <span class="me-pop">${kit.button(`${icon("recast")}<span>${num(n, "recasts")}</span>`, { cls: n?.recasted ? "on" : "", disabled: !n, attrs: `data-act="recast-menu" data-hash="${c.hash}" title="${n?.recasted ? "You recast this. Undo, or quote it" : "Recast or quote"}" aria-label="Recast or quote" aria-haspopup="menu" aria-expanded="${S.pop === c.hash}"` })}${S.pop === c.hash ? recastMenu(c, n) : ""}</span>
        ${kit.button(`${icon(n?.liked ? "heart-on" : "heart")}<span>${num(n, "likes")}</span>`, { disabled: !n, attrs: `data-act="like" data-hash="${c.hash}" title="${n?.liked ? "Unlike" : "Like"}" aria-label="${n?.liked ? "Unlike" : "Like"}"` })}
        ${kit.button(`${icon("share")}<span class="me-word">share</span>`, { attrs: `data-act="share" data-hash="${c.hash}" title="Copy a link to this cast" aria-label="Share: copy a link"` })}
      </div>
      ${S.compose?.hash === c.hash ? composer(c) : ""}
    </div>
  </article>`;
}

const num = (n, k) => (n ? n[k] : "-");

// The recast button's menu: recast (or undo it), or quote the cast.
function recastMenu(c, n) {
  return `<div class="k-menu" role="menu">
    <button type="button" class="k-item" role="menuitem" data-act="recast" data-hash="${c.hash}">${n?.recasted ? "undo recast" : "recast"}</button>
    <button type="button" class="k-item" role="menuitem" data-act="quote" data-hash="${c.hash}">quote cast</button></div>`;
}

// Reply or quote in place, under the cast. A quote cast is a new cast of
// yours with this one embedded in it.
function composer(c) {
  const quote = S.compose.kind === "quote";
  const snip = c.text.replace(/\s+/g, " ").trim();
  return `<div class="inline" data-reply-box><textarea placeholder="${quote ? "Say something about it" : "Reply to your cast"}" aria-label="${quote ? "Quote cast" : "Reply"}">${esc(S.draft)}</textarea>
    ${quote ? `<div class="me-quoting">quoting “${esc(snip.length > 80 ? `${snip.slice(0, 79)}…` : snip || "your cast")}”</div>` : ""}
    <div class="row"><span class="dim small">${quote ? "new cast" : "replying to yourself"}</span><span class="left">320</span>${kit.button(quote ? "quote" : "cast", { look: "primary", key: "⌘↵", attrs: "data-send" })}</div></div>`;
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
  if (S.compose) wireReplyBox();
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
    if (e.key === "Escape") { e.stopPropagation(); S.compose = null; S.draft = ""; render(); }
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
      if (!kit.castMenu.open() && !S.compose && !S.pop) render();
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

function compose(c, kind) {
  const open = S.compose?.hash === c.hash && S.compose.kind === kind;
  S.compose = open ? null : { hash: c.hash, kind };
  S.draft = ""; S.pop = null;
  tone(880, 0, 0.02, 0.02);
  render();
}

function toggleMenu(c) {
  if (!S.counts.get(c.hash)) return;
  S.pop = S.pop === c.hash ? null : c.hash;
  tone(660, 0, 0.03);
  render();
}

// Start over on a tab, so it loads again with what you just posted.
function reset(tab) {
  S.lists[tab] = null; S.next[tab] = null; loaded[tab] = 0;
}

async function send() {
  const box = $("[data-reply-box]"), c = S.compose && find(S.compose.hash);
  if (!box || !c) return;
  const quote = S.compose.kind === "quote";
  const text = box.querySelector("textarea").value;
  // A quote can be just the quoted cast; a reply needs words.
  if ((!quote && !text.trim()) || 320 - enc.encode(text).length < 0) return;
  const b = box.querySelector("[data-send]");
  b.setAttribute("aria-disabled", "true"); b.textContent = quote ? "quoting…" : "casting…";
  try {
    const r = await api("/api/cast", quote ? { text, quote: { fid: c.fid, hash: c.hash } } : { text, replyTo: { fid: c.fid, hash: c.hash } });
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.06, 0.1, 0.035));
    toast(r.landed ? (quote ? "Quoted. It's on Farcaster." : "Replied. It's on Farcaster.") : "Sent. It should land soon.");
    S.compose = null; S.draft = "";
    if (quote) {
      reset("casts");
      if (S.tab === "casts") return load("casts");
    } else {
      const n = S.counts.get(c.hash);
      if (n) n.replies++;
      reset("replies");
    }
    render();
  } catch (e) {
    toast(e.message, 3500);
    b.removeAttribute("aria-disabled"); b.innerHTML = `${quote ? "quote" : "cast"} <kbd>⌘↵</kbd>`;
  }
}

const ACTS = {
  reply: (c) => compose(c, "reply"),
  "recast-menu": toggleMenu,
  recast: (c) => { S.pop = null; react(c, "recast"); },
  quote: (c) => compose(c, "quote"),
  like: (c) => react(c, "like"),
  share,
};

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
  // A click anywhere else closes the recast menu, and does nothing more.
  if (S.pop) { S.pop = null; return render(); }
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
  else if (k === "escape") {
    if (S.pop) { S.pop = null; render(); }
    else if (S.compose) { S.compose = null; S.draft = ""; render(); }
    else location.href = "/";
  }
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
