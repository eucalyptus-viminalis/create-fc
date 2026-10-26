// fameboy cast page: one cast and the conversation around it, like a post
// page on farcaster.xyz, Bluesky or X. The casts it answers sit above it,
// replies below. The address is the one farcaster.xyz uses,
// /<username>/<hash>, so swapping the domain on a farcaster.xyz link opens
// it here. Anyone can open it; signing in adds like, recast, quote and reply.

const { $, esc, api, tone, toast, ago, pic, rich, embeds, profileUrl, castUrl } = kit;
const enc = new TextEncoder();

const sfx = {
  move: () => tone(880, 0, 0.02, 0.02),
  tick: () => tone(660, 0, 0.03),
  like: () => { tone(784, 0, 0.05); tone(1175, 0.05, 0.07); },
  win: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.06, 0.1, 0.035)),
};

const [, rawWho = "", rawHash = ""] = location.pathname.match(/^\/([^/]+)\/(0x[0-9a-f]+)\/?$/i) ?? [];
const S = { me: null, d: null, liked: false, recasted: false, reply: null, first: true };

const name = (c) => (c.author?.username ? `@${c.author.username}` : `!${c.fid}`);
const when = (iso) => new Date(iso).toLocaleString([], { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ pieces
// A cast above or below the open one. Clicking anywhere on it opens it.
function card(c, extra = "") {
  return `<article class="ct-c" data-href="${castUrl(c)}">
    ${pic(c.author?.pfp)}
    <div class="body">
      <div class="who"><b>${esc(c.author?.display ?? name(c))}</b><span class="dim">${esc(name(c))}</span><a class="t" href="${castUrl(c)}" title="${esc(when(c.time))}">${ago(c.time)}</a>${kit.castMenu.html(c, S.me)}</div>
      <div class="tx">${rich(c.text)}</div>
      ${embeds(c.embeds)}
      ${kit.quotes(c.quotes)}
      ${extra}
    </div>
  </article>`;
}

// Reply in place: a small composer under whatever you're answering.
function replyBox(to) {
  return `<div class="inline" data-reply-box><textarea placeholder="Reply to ${esc(name(to))}" aria-label="Reply"></textarea>
    <div class="row"><span class="dim small">replying to ${esc(name(to))}</span><span class="left">320</span>${kit.button("cast", { look: "primary", key: "⌘↵", attrs: "data-send" })}</div></div>`;
}

function signIn() {
  location.href = `/signin?next=${encodeURIComponent(location.pathname)}`;
}

// ------------------------------------------------------------------ render
function render() {
  const d = S.d, c = d.cast, u = c.author?.username;
  $("#sub").textContent = `${name(c)} · ${plural(c.replies, "reply", "replies")}`;
  $("#links").innerHTML = `${kit.button("copy link", { look: "quiet", key: "c", attrs: "data-copy" })}${u ? kit.ext(`${profileUrl(u)}/${c.hash.slice(0, 10)}`, "on Farcaster") : ""}`;

  const above = d.ancestors.length
    ? `<div class="ct-up">
        ${d.gone ? `<p class="ct-note">A cast above this one was deleted.</p>` : ""}
        ${d.earlier ? `<p class="ct-note"><a href="${castUrl(d.ancestors[0])}">↑ earlier in the conversation</a></p>` : ""}
        ${d.ancestors.map((a) => card(a)).join("")}
      </div>`
    : d.gone ? `<p class="ct-note">This replies to a cast that was deleted.</p>` : "";

  const acts = S.me
    ? `${kit.button(S.liked ? "♥ liked" : "♥ like", { key: "l", pressed: S.liked, attrs: 'data-act="like"' })}
       ${kit.button(S.recasted ? "⟲ recasted" : "⟲ recast", { pressed: S.recasted, attrs: 'data-act="recast"' })}
       ${kit.button("❝ quote", { key: "q", attrs: 'data-act="quote" title="Quote this cast in a new one of yours"' })}
       ${kit.button("↩ reply", { look: "primary", key: "r", pressed: S.reply === c.hash, attrs: 'data-act="reply"' })}`
    : `${kit.button("sign in to like or reply", { look: "primary", attrs: "data-signin" })}<span class="dim small">Anyone can read this. Signing in lets you join in.</span>`;

  const focus = `<article class="tile read ct-focus" id="focus">
    <div class="head">${pic(c.author?.pfp, "")}<div><b>${esc(c.author?.display ?? name(c))}</b><span>${u ? kit.ext(profileUrl(u), `@${esc(u)}`) : `fid ${c.fid}`}${c.app ? ` · via @${esc(c.app.name)}` : ""}${c.channel ? ` · /${esc(c.channel)}` : ""}</span></div>${kit.castMenu.html(c, S.me)}</div>
    <div class="text">${rich(c.text)}</div>
    ${embeds(c.embeds)}
    ${kit.quotes(c.quotes)}
    <div class="meta"><span>${esc(when(c.time))}</span><span>↩ ${c.replies}</span><span>⟲ ${c.recasts}</span><span>♥ ${c.likes}</span></div>
    <div class="acts">${acts}</div>
    ${S.reply === c.hash ? replyBox(c) : ""}
  </article>`;

  const replies = d.replies.length
    ? `<h2 class="ct-h">${plural(c.replies, "reply", "replies")}</h2>
      <div class="ct-replies">${d.replies.map((r) => {
        const more = r.replyCount - r.children.length;
        const foot = `<div class="ft">
            ${r.replyCount ? `<a href="${castUrl(r)}" title="Open this reply's conversation">↩ ${r.replyCount}</a>` : `<span>↩ 0</span>`}
            ${S.me ? kit.button("reply", { look: "quiet", pressed: S.reply === r.hash, attrs: `data-reply="${r.hash}"` }) : ""}
          </div>
          ${S.reply === r.hash ? replyBox(r) : ""}
          ${r.children.length ? `<div class="kids">${r.children.map((k) => card(k)).join("")}</div>` : ""}
          ${more > 0 ? `<a class="ct-more" href="${castUrl(r)}">${plural(more, "more reply", "more replies")} →</a>` : ""}`;
        return card(r, foot);
      }).join("")}</div>
      ${d.more > 0 ? `<p class="ct-note">Showing the first ${d.replies.length}. ${plural(d.more, "more reply", "more replies")} not shown.</p>` : ""}`
    : `<p class="ct-note">No replies yet.${S.me ? " Press r to start one." : ""}</p>`;

  $("#view").innerHTML = `<div class="ct">${above}${focus}${replies}</div>`;
  wire();
  if (S.first) {
    S.first = false;
    if (d.ancestors.length) $("#focus").scrollIntoView({ block: "start" });
  }
}

function wire() {
  const open = S.reply && [S.d.cast, ...S.d.replies].find((x) => x.hash === S.reply);
  if (open) wireReplyBox(open);
}

function wireReplyBox(to) {
  const box = $("[data-reply-box]"), ta = box.querySelector("textarea"), left = box.querySelector(".left");
  ta.focus();
  const paint = () => { const n = 320 - enc.encode(ta.value).length; left.textContent = n < 0 ? `${-n} over` : n; left.classList.toggle("over", n < 0); };
  const send = async () => {
    if (!ta.value.trim() || 320 - enc.encode(ta.value).length < 0) return;
    const b = box.querySelector("[data-send]");
    b.setAttribute("aria-disabled", "true"); b.textContent = "casting…";
    try {
      const r = await api("/api/cast", { text: ta.value, replyTo: { fid: to.fid, hash: to.hash } });
      sfx.win(); toast(r.landed ? "Replied. It's on Farcaster." : "Sent. It should land soon.");
      S.reply = null;
      await load(true);
    } catch (e) { toast(e.message, 3500); b.removeAttribute("aria-disabled"); b.innerHTML = "cast <kbd>⌘↵</kbd>"; }
  };
  ta.addEventListener("input", paint);
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); }
    if (e.key === "Escape") { e.stopPropagation(); S.reply = null; render(); }
  });
  box.querySelector("[data-send]").addEventListener("click", send);
}

// ------------------------------------------------------------------ actions
async function react(kind) {
  if (!S.me) return signIn();
  const c = S.d.cast, key = kind === "like" ? "liked" : "recasted", on = !S[key];
  try {
    await api("/api/react", { kind, target: { fid: c.fid, hash: c.hash }, on });
    S[key] = on;
    c[kind === "like" ? "likes" : "recasts"] += on ? 1 : -1;
    kind === "like" ? sfx.like() : sfx.tick();
    toast(kind === "like" ? (on ? "Liked." : "Unliked.") : on ? "Recasted." : "Recast removed.");
    render();
  } catch (e) { toast(e.message, 3500); }
}

// Quote the open cast in kit's window.
function quote() {
  if (!S.me) return signIn();
  if (S.reply) { S.reply = null; render(); }
  kit.quoteCast(S.d.cast, { me: S.me, focus: () => $('[data-act="quote"]') });
}

function toggleReply(hash) {
  if (!S.me) return signIn();
  S.reply = S.reply === hash ? null : hash;
  render();
}

// After a delete: the open cast is gone, so go up to the cast it answered,
// or home. A reply or a cast above: show the conversation without it.
async function gone(hash) {
  if (hash === S.d.cast.hash) {
    const up = S.d.ancestors[S.d.ancestors.length - 1];
    await kit.wait(700);
    return location.replace(up ? castUrl(up) : "/");
  }
  await load(true);
}

async function copyLink() {
  try { await navigator.clipboard.writeText(location.href); toast("Link copied."); sfx.tick(); }
  catch { toast("Copy it from the address bar."); }
}

document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-signin]")) return signIn();
  if (t.closest("[data-copy]")) return copyLink();
  const act = t.closest("[data-act]")?.dataset.act;
  if (act === "like" || act === "recast") return react(act);
  if (act === "reply") return toggleReply(S.d.cast.hash);
  if (act === "quote") return quote();
  const r = t.closest("[data-reply]");
  if (r) return toggleReply(r.dataset.reply);
  // A click on a card opens that cast, unless it was on a link, a button,
  // the composer, or the end of selecting some text.
  const c = t.closest(".ct-c[data-href]");
  if (c && !t.closest("a, button, textarea, .inline") && !String(getSelection?.() ?? "")) { sfx.move(); location.href = c.dataset.href; }
});

addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey || !S.d) return;
  const k = e.key.toLowerCase();
  if (k === "l") react("like");
  else if (k === "r") { e.preventDefault(); toggleReply(S.d.cast.hash); }
  else if (k === "q") { e.preventDefault(); quote(); }
  else if (k === "c") copyLink();
  else if (k === "escape") { if (S.reply) { S.reply = null; render(); } else if (history.length > 1) history.back(); else location.href = S.me ? "/inbox" : "/"; }
});

// ------------------------------------------------------------------ load
async function load(fresh = false) {
  const d = await api(`/api/thread?who=${encodeURIComponent(decodeURIComponent(rawWho))}&hash=${encodeURIComponent(rawHash)}${fresh ? "&fresh=1" : ""}`);
  S.d = d;
  S.liked = d.mine?.liked ?? false;
  S.recasted = d.mine?.recasted ?? false;
  // Settle on the cast's own address: its username and full hash. A short
  // hash from a farcaster.xyz link needed a search; this one won't.
  const canonical = castUrl(d.cast);
  if (location.pathname !== canonical) history.replaceState(null, "", canonical);
  const snip = d.cast.text.replace(/\s+/g, " ").trim();
  document.title = `${name(d.cast)}${snip ? `: “${snip.length > 50 ? `${snip.slice(0, 49)}…` : snip}”` : ""} · ${window.theme?.name ?? "fameboy"}`;
  render();
}

kit.castMenu.wire(render, gone);

(async () => {
  if (!rawHash) { $("#view").innerHTML = `<div class="tile empty">That's not a cast address.</div>`; return; }
  S.me = await kit.me();
  if (!S.me) $("#hint").innerHTML = `<kbd>c</kbd> copy link · <kbd>esc</kbd> back`;
  try { await load(); }
  catch (e) {
    $("#view").innerHTML = `<div class="tile empty">${esc(e.message)}<p><a href="${S.me ? "/inbox" : "/"}">${S.me ? "back to the inbox" : "fameboy home"}</a></p></div>`;
  }
})();
