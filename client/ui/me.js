// fameboy me: your profile (picture, display name, username, fid and bio,
// each editable but the fid), then your own casts, newest first, with your
// replies on their own tab. Each one opens its conversation, and the "…" in its corner deletes it
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
  compose: null, // { hash, kind: "reply" | "quote" }: a reply opens under the cast, a quote in a window
  draft: "", // what you've typed so far, kept across redraws
  pop: null, // the cast whose recast menu is open
  busy: false,
};
const when = (iso) => new Date(iso).toLocaleString([], { hour: "numeric", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ------------------------------------------------------------------ profile
// Display name, picture and bio are USER_DATA_ADD messages your app key signs
// (POST /api/profile). A username also needs a name from Farcaster's fname
// server, which only the account's own key can claim: so it asks for the seed
// phrase, which this page uses to sign the claim and then forgets
// (vendor/phrase-browser.js). The phrase never leaves this browser.
const P = { edit: null, busy: false, rename: false, check: null, checking: 0, error: "", pfpDraft: "" };
const LIMIT = { display: 32, bio: 256 };
const bytes = (v) => enc.encode(v).length;

function profileCard() {
  const m = S.me;
  const row = (id, label, value, editor, editable = true) => `<div class="me-row${P.edit === id ? " editing" : ""}">
    <span class="me-k">${label}</span>
    ${P.edit === id ? `<div class="me-v">${editor()}</div>` : `<span class="me-v">${value}</span>${editable ? kit.button("edit", { attrs: `data-pedit="${id}" aria-label="Edit ${label}"` }) : `<span class="dim small me-lock">can't change</span>`}`}
  </div>`;
  return `<section class="tile me-card"><h2><span>profile</span><span>fid ${m.fid}</span></h2><div class="body">
    <div class="me-prof">
      <div class="me-pic">${m.pfp ? `<img src="${esc(m.pfp)}" alt="Your picture" referrerpolicy="no-referrer">` : `<span class="nopic" aria-label="No picture"></span>`}
        ${P.edit === "pfp" ? "" : kit.button("change", { attrs: 'data-pedit="pfp" aria-label="Change picture"' })}</div>
      <div class="me-fields">
        ${row("display", "name", m.display ? esc(m.display) : `<span class="dim">none</span>`, () => textEditor("display", m.display))}
        ${row("username", "username", m.username ? `@${esc(m.username)}` : `<span class="dim">none</span>`, nameEditor)}
        ${row("fid", "fid", `${m.fid} <span class="dim small">your account's number</span>`, null, false)}
        ${row("bio", "bio", m.bio ? rich(m.bio) : `<span class="dim">none</span>`, () => textEditor("bio", m.bio))}
      </div>
    </div>
    ${P.edit === "pfp" ? pfpEditor() : ""}
  </div></section>`;
}

const saveRow = (label = "save") =>
  `<div class="me-btns">${kit.button(P.busy ? "saving…" : label, { look: "primary", busy: P.busy, attrs: "data-psave" })}${kit.button("cancel", { attrs: "data-pcancel" })}</div>
  ${P.error ? `<p class="me-err">${esc(P.error)}</p>` : ""}`;

function textEditor(field, value) {
  const left = LIMIT[field] - bytes(value ?? "");
  const input = field === "bio"
    ? `<textarea id="pf-in" rows="3" aria-label="Bio" placeholder="A line or two about you">${esc(value ?? "")}</textarea>`
    : `<input id="pf-in" value="${esc(value ?? "")}" aria-label="Display name" placeholder="Your name" autocomplete="off">`;
  return `${input}<div class="me-meta"><span class="me-left${left < 0 ? " over" : ""}" id="pf-left">${left}</span><span class="dim small">${field === "bio" ? "Empty clears it." : "What people see above your casts."}</span></div>${saveRow()}`;
}

function pfpEditor() {
  return `<div class="me-pfp-edit">
    <div class="me-btns">${kit.button("upload a picture", { look: "primary", busy: P.busy, attrs: "data-pupload" })}${S.me.pfp ? kit.button("remove it", { attrs: "data-premove" }) : ""}${kit.button("cancel", { attrs: "data-pcancel" })}</div>
    <input type="file" id="pf-file" accept="image/png,image/jpeg,image/gif,image/webp" hidden>
    <p class="dim small">It goes on this node, like images in casts.</p>
    <form class="me-link" id="pf-link"><input id="pf-url" placeholder="or paste an https:// link to an image" value="${esc(P.pfpDraft)}" autocomplete="off" aria-label="Picture link">${kit.button("use link", { attrs: 'type="submit"' })}</form>
    ${P.error ? `<p class="me-err">${esc(P.error)}</p>` : ""}
  </div>`;
}

function nameEditor() {
  if (!P.rename) return `<p>Change it in the Farcaster app.</p><p class="dim small">This fameboy doesn't take seed phrases.</p><div class="me-btns">${kit.button("ok", { attrs: "data-pcancel" })}</div>`;
  const c = P.check;
  const status = !c ? `<span class="dim">1-16 letters, digits or hyphens.</span>`
    : c.error ? `<span class="me-bad">${esc(c.error)}</span>`
    : c.status === "already-yours" ? `<span>@${esc(c.name)} is yours already.</span>`
    : `<span>@${esc(c.name)} is free.${c.current ? ` You'd give up @${esc(c.current)}.` : ""}</span>`;
  const ready = c && !c.error && c.name !== S.me.username;
  return `<form id="pf-name" autocomplete="off">
    <div class="me-at"><span>@</span><input id="pf-in" value="${esc(P.typed ?? S.me.username ?? "")}" aria-label="Username" spellcheck="false" autocapitalize="off"></div>
    <p class="small me-status">${P.checking ? `checking<span class="blink">_</span>` : status}</p>
    ${ready ? `<div class="warn"><span class="bang">!</span><div><p>A new username needs your seed phrase.</p><p>This page signs with it, then forgets it.</p>${S.me.hosted ? "<p>Whoever runs this site serves this page.</p><p>Trust them? Go ahead. Unsure? Use the Farcaster app.</p>" : ""}<p class="dim">Names change once every 28 days.</p></div></div>
      <input type="password" id="pf-phrase" placeholder="seed phrase: 12 or 24 words" autocomplete="off" spellcheck="false" aria-label="Seed phrase">` : ""}
    ${saveRow(P.busy ? "changing…" : "change it")}
  </form>`;
}

function renderProfile() {
  const keep = document.activeElement?.id;
  $("#profile").innerHTML = profileCard();
  wireProfile(keep);
}

function wireProfile(keep) {
  const input = $("#pf-in");
  if (input) {
    if (keep === "pf-in" || P.justOpened) { input.focus(); const n = input.value.length; input.setSelectionRange?.(n, n); }
    P.justOpened = false;
    input.addEventListener("input", () => {
      const left = $("#pf-left");
      if (left && LIMIT[P.edit] !== undefined) { const l = LIMIT[P.edit] - bytes(input.value); left.textContent = l < 0 ? `${-l} over` : l; left.classList.toggle("over", l < 0); }
      if (P.edit === "username") { P.typed = input.value; checkName(input.value); }
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeEdit(); }
      if (e.key === "Enter" && P.edit !== "bio" && P.edit !== "username") { e.preventDefault(); saveText(); }
      if (e.key === "Enter" && P.edit === "bio" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveText(); }
    });
  }
  $("#pf-phrase")?.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); closeEdit(); } });
  $("#pf-name")?.addEventListener("submit", (e) => { e.preventDefault(); rename(); });
  $("#pf-link")?.addEventListener("submit", (e) => { e.preventDefault(); P.pfpDraft = $("#pf-url").value.trim(); if (P.pfpDraft) saveFields({ pfp: P.pfpDraft }); });
  $("#pf-file")?.addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) uploadPfp(f); });
}

function openEdit(id) {
  if (P.busy) return;
  Object.assign(P, { edit: id, error: "", check: null, typed: undefined, pfpDraft: "", justOpened: true });
  tone(880, 0, 0.02, 0.02);
  renderProfile();
}
function closeEdit() {
  if (P.busy) return;
  P.edit = null; P.error = "";
  renderProfile();
}

async function saveFields(fields) {
  if (P.busy) return;
  P.busy = true; P.error = ""; renderProfile();
  try {
    const r = await api("/api/profile", fields);
    Object.assign(S.me, { display: r.profile.display, pfp: r.profile.pfp, bio: r.profile.bio });
    P.edit = null;
    [523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.06, 0.1, 0.035));
    toast(r.changed.length ? "Saved. It's on Farcaster." : "Nothing changed.");
  } catch (e) {
    P.error = e.message;
    tone(220, 0, 0.12, 0.04);
  } finally {
    P.busy = false;
    renderProfile();
  }
}

function saveText() {
  const field = P.edit, v = $("#pf-in")?.value.trim() ?? "";
  if (field !== "display" && field !== "bio") return;
  if (bytes(v) > LIMIT[field]) { P.error = `That's ${bytes(v) - LIMIT[field]} bytes too long.`; return renderProfile(); }
  saveFields({ [field]: v });
}

// ---- picture: upload to this node (as the post page does), then use its URL
async function uploadPfp(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { P.error = "Only PNG, JPEG, GIF or WebP."; return renderProfile(); }
  P.busy = true; P.error = ""; renderProfile();
  let url;
  try {
    const blob = file.type === "image/gif" ? file : await shrink(file, 640);
    const device = await mine.device(S.me.fid);
    url = await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/images");
      x.setRequestHeader("x-fameboy-token", kit.TOKEN);
      x.setRequestHeader("x-fameboy-device", device.id);
      x.setRequestHeader("x-fameboy-status", device.status);
      x.setRequestHeader("content-type", "application/octet-stream");
      x.onload = () => {
        let json = {};
        try { json = JSON.parse(x.responseText); } catch {}
        if (x.status !== 200) return reject(new Error(json.error ?? `upload failed (${x.status})`));
        (json.sign ? mine.key.answer(json).then((j) => j.data) : Promise.resolve(json.data)).then((d) => resolve(d.url), reject);
      };
      x.onerror = () => reject(new Error("upload failed: is fameboy still running?"));
      x.send(blob);
    });
  } catch (e) {
    P.busy = false; P.error = e.message; tone(220, 0, 0.12, 0.04);
    return renderProfile();
  }
  P.busy = false;
  saveFields({ pfp: url });
}

// Big photos get scaled down to `max` px on the long side.
async function shrink(file, max) {
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise((r) => c.toBlob(r, type, 0.88));
  return blob && blob.size < file.size ? blob : file;
}

// ---- username
let checkTimer;
function checkName(raw) {
  const name = raw.trim().toLowerCase().replace(/^@/, "");
  clearTimeout(checkTimer);
  if (!name || name === S.me.username) { P.check = null; P.checking = 0; return paintName(); }
  if (!/^[a-z0-9][a-z0-9-]{0,15}$/.test(name)) { P.check = { name, error: "1-16 letters, digits or hyphens; no hyphen first." }; P.checking = 0; return paintName(); }
  const n = ++P.checking;
  paintName();
  checkTimer = setTimeout(async () => {
    try { P.check = await api(`/api/username/check?name=${encodeURIComponent(name)}`); }
    catch (e) { P.check = { name, error: e.message.replace(/^"[^"]*" isn't a valid fname: /, "") }; }
    if (n === P.checking) { P.checking = 0; paintName(); }
  }, 450);
}
// Redraw the username row but keep the cursor in the box.
const paintName = () => { if (P.edit === "username") renderProfile(); };

let cryptoP;
const phraseCrypto = () =>
  (cryptoP ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "/vendor/phrase-browser.js";
    el.onload = () => (window.phraseBrowser ? resolve(window.phraseBrowser) : reject(new Error("couldn't load the signing code")));
    el.onerror = () => { cryptoP = undefined; reject(new Error("couldn't load the signing code")); };
    document.head.append(el);
  }));

async function rename() {
  const c0 = P.check, box = $("#pf-phrase");
  if (P.busy || !c0 || c0.error || c0.name === S.me.username || !box) return;
  let words = box.value;
  box.value = ""; // the page keeps nothing
  if (!words.trim()) { P.error = "Type your seed phrase first."; return renderProfile(); }
  P.busy = true; P.error = ""; renderProfile();
  try {
    const pc = await phraseCrypto();
    // A fresh check: its timestamp is what the fname server wants signed.
    const c = await api(`/api/username/check?name=${encodeURIComponent(c0.name)}`);
    const acct = pc.custodyFor(words, c.custody);
    words = "";
    const t = (name, from, to) => acct.signName({ name, timestamp: c.timestamp }).then((signature) => ({ name, from, to, owner: acct.address, timestamp: c.timestamp, signature }));
    const body = { name: c.name };
    if (c.status === "replace") body.release = await t(c.current, S.me.fid, 0);
    if (c.status !== "already-yours") body.claim = await t(c.name, 0, S.me.fid);
    toast("Asking Farcaster for the name. This can take a minute.", 6000);
    const p = await api("/api/username", body);
    Object.assign(S.me, { username: p.username, pfp: p.pfp });
    P.edit = null;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.06, 0.1, 0.035));
    toast(`You're @${p.username} now.`);
    header();
  } catch (e) {
    P.error = /isn't the one for this account/.test(e.message) ? "That phrase isn't this account's." : /12 or 24 words|word list|checksum/.test(e.message) ? "Those words don't form a phrase." : e.message;
    tone(220, 0, 0.12, 0.04);
  } finally {
    P.busy = false;
    renderProfile();
  }
}

function header() {
  const u = S.me.username;
  $("#sub").textContent = `${u ? `@${u}` : `fid ${S.me.fid}`} · your casts, newest first`;
  $("#links").innerHTML = u ? kit.ext(profileUrl(u), "on Farcaster") : "";
}

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
      ${S.compose?.hash === c.hash && S.compose.kind === "reply" ? composer(c) : ""}
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

// A reply opens in place, under the cast.
function composer() {
  return `<div class="inline" data-reply-box><textarea placeholder="Reply to your cast" aria-label="Reply">${esc(S.draft)}</textarea>
    <div class="row"><span class="dim small">replying to yourself</span><span class="left">320</span>${kit.button("cast", { look: "primary", key: "⌘↵", attrs: "data-send" })}</div></div>`;
}

// A quote opens in a window over the page: your words on top, the cast
// you're quoting below them. A quote cast is a new cast of yours with this
// one embedded in it, so it shouldn't look like a reply.
function quoteWindow(c) {
  const a = c.author ?? {};
  return `<section class="tile modal me-qm" role="dialog" aria-modal="true" aria-labelledby="qm-t" data-reply-box>
    <h2><span id="qm-t">quote cast</span><span><button type="button" class="me-qm-x" data-qclose>close ×</button></span></h2>
    <div class="body inline">
      <div class="me-qm-you">${pic(S.me.pfp)}<textarea placeholder="Add a comment" aria-label="Your words about the cast">${esc(S.draft)}</textarea></div>
      <div class="ct-c me-qm-cast">
        ${pic(a.pfp)}
        <div class="me-qm-in">
          <div class="who"><b>${esc(a.display ?? `@${a.username ?? c.fid}`)}</b>${a.username ? `<span class="dim">@${esc(a.username)}</span>` : ""}<span class="t" title="${esc(when(c.time))}">${ago(c.time)}</span></div>
          ${c.text ? `<div class="tx">${rich(c.text)}</div>` : ""}
          ${embeds(c.embeds)}
        </div>
      </div>
      <div class="row"><span class="dim small">a new cast, with this one in it</span><span class="left">320</span>${kit.button("quote", { look: "primary", key: "⌘↵", attrs: "data-send" })}</div>
    </div>
  </section>`;
}

function openQuote(c) {
  closeQuote();
  const el = document.createElement("div");
  el.className = "scrim";
  el.id = "qm";
  el.innerHTML = quoteWindow(c);
  document.body.append(el);
  document.body.classList.add("me-held");
  wireReplyBox();
}

function closeQuote() {
  const el = $("#qm");
  if (!el) return;
  el.remove();
  document.body.classList.remove("me-held");
}

// Close whichever box is open, dropping what was typed. After a quote,
// focus goes back to the cast's recast button.
function closeCompose() {
  const was = S.compose;
  S.compose = null; S.draft = "";
  if (was?.kind === "quote") {
    closeQuote();
    render();
    $(`[data-act="recast-menu"][data-hash="${was.hash}"]`)?.focus();
  } else render();
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
  if (S.compose?.kind === "reply") wireReplyBox();
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
    if (e.key === "Escape") { e.stopPropagation(); closeCompose(); }
  });
  box.querySelector("[data-send]").addEventListener("click", send);
  // In the quote window, Tab stays inside it.
  if (box.matches("[role=dialog]")) box.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = [...box.querySelectorAll("textarea, button, a[href]")].filter((x) => x.offsetParent);
    const first = f[0], last = f.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
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
  closeQuote();
  S.compose = open ? null : { hash: c.hash, kind };
  S.draft = ""; S.pop = null;
  tone(880, 0, 0.02, 0.02);
  render();
  if (S.compose?.kind === "quote") openQuote(c);
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
      closeQuote();
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
  // the quote window: close it, or a click on the dimmed page around it
  // does when nothing's typed yet
  const qm = t.closest("#qm");
  if (qm) {
    if (t.closest("[data-qclose]") || (t === qm && !qm.querySelector("textarea").value.trim())) closeCompose();
    return;
  }
  // the profile card
  const pe = t.closest("[data-pedit]");
  if (pe) return openEdit(pe.dataset.pedit);
  if (t.closest("[data-pcancel]")) return closeEdit();
  if (t.closest("[data-psave]")) { if (P.edit === "username") rename(); else saveText(); return; }
  if (t.closest("[data-pupload]")) return P.busy || $("#pf-file")?.click();
  if (t.closest("[data-premove]")) return saveFields({ pfp: "" });
  if (t.closest("#profile")) return;
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
    else if (S.compose) closeCompose();
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
  header();
  renderProfile();
  api("/api/profile/edit").then((r) => { P.rename = r.rename; if (P.edit === "username") renderProfile(); }, () => {});
  render();
  await load("casts");
})();
