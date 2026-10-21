// clearcast inbox: casts from people you follow, likes on your casts, and
// replies to you. Clear what you've dealt with; it leaves the "waiting" count.
// Save casts to come back to. Cleared and saved stay on this computer.
// Purple marks what arrived since your last visit.

const { $, esc, api, tone, toast, SignedOut } = kit;
const enc = new TextEncoder();


// ------------------------------------------------------------------ sound, toast
const sfx = {
  move: () => tone(880, 0, 0.02, 0.02),
  tick: () => tone(660, 0, 0.03),
  clear: () => tone(392, 0, 0.08, 0.035),
  like: () => { tone(784, 0, 0.05); tone(1175, 0.05, 0.07); },
  save: () => { tone(988, 0, 0.05); tone(1319, 0.05, 0.08); },
  win: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.06, 0.1, 0.035)),
};

// ------------------------------------------------------------------ pieces
function ago(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
}
const profileUrl = (u) => `https://farcaster.xyz/${encodeURIComponent(u)}`;
const pic = (url, cls = "pf") => (url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="${cls} nopic"></span>`);
const freshMark = (on) => (on ? `<span class="fresh" title="new since your last visit"></span>` : "");
// Cast text with links: @names go to their Farcaster profile, URLs open in a new tab.
function rich(text) {
  return esc(text)
    .replace(/https?:\/\/[^\s<]+/g, (u) => kit.ext(u.replace(/&amp;/g, "&"), u.length > 60 ? u.slice(0, 57) + "…" : u))
    .replace(/(^|\s)@([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*)/gi, (m, pre, u) => `${pre}${kit.ext(profileUrl(u), `@${u}`)}`);
}
const isImage = (u) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(u) || /imagedelivery\.net|i\.imgur\.com|\.sslip\.io\/img\//.test(u);
function embeds(list) {
  const urls = (list ?? []).filter((u) => /^https?:\/\//.test(u));
  const imgs = urls.filter(isImage), links = urls.filter((u) => !isImage(u));
  return (imgs.length ? `<div class="pics">${imgs.map((u) => kit.ext(u, `<img src="${esc(u)}" alt="" loading="lazy" referrerpolicy="no-referrer">`, { arrow: false })).join("")}</div>` : "") +
    (links.length ? `<div class="links">${links.map((u) => kit.ext(u, esc(u))).join("")}</div>` : "");
}
const fixed = (label, n, attrs) => kit.button(`${label}${n ? ` ${n}` : ""}`, { fixed: true, disabled: !n, attrs });
const seg = (tabs, cur) => kit.seg(tabs, cur);

// Reply in place: a small composer under whatever you're answering.
function replyBox(to) {
  return `<div class="inline" data-reply-box="${esc(to.hash)}"><textarea placeholder="Reply to @${esc(to.username ?? to.fid)}" aria-label="Reply"></textarea>
    <div class="row"><span class="dim small">replying to @${esc(to.username ?? to.fid)}</span><span class="left">320</span>${kit.button("cast", { look: "primary", key: "⌘↵", attrs: "data-send" })}</div></div>`;
}
function wireReplyBox(to, done) {
  const box = document.querySelector(`[data-reply-box="${to.hash}"]`);
  if (!box) return;
  const ta = box.querySelector("textarea"), left = box.querySelector(".left");
  ta.focus();
  const paint = () => { const n = 320 - enc.encode(ta.value).length; left.textContent = n < 0 ? `${-n} over` : n; left.classList.toggle("over", n < 0); };
  const send = async () => {
    if (!ta.value.trim() || 320 - enc.encode(ta.value).length < 0) return;
    const b = box.querySelector("[data-send]");
    b.setAttribute("aria-disabled", "true"); b.textContent = "casting…";
    try {
      const r = await api("/api/cast", { text: ta.value, replyTo: { fid: to.fid, hash: to.hash } });
      sfx.win(); toast(r.landed ? "Replied. It's on Farcaster." : "Sent. It should land soon.");
      done();
    } catch (e) { toast(e.message, 3500); b.removeAttribute("aria-disabled"); b.innerHTML = "cast <kbd>⌘↵</kbd>"; }
  };
  ta.addEventListener("input", paint);
  ta.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send(); } if (e.key === "Escape") { e.stopPropagation(); done(); } });
  box.querySelector("[data-send]").addEventListener("click", send);
}

async function react(kind, cast, on = true) {
  try { await api("/api/react", { kind, target: { fid: cast.fid, hash: cast.hash }, on }); kind === "like" ? sfx.like() : sfx.tick(); toast(kind === "like" ? (on ? "Liked." : "Unliked.") : on ? "Recasted." : "Recast removed."); return true; }
  catch (e) { toast(e.message, 3500); return false; }
}
async function clearIds(kind, ids, on) {
  if (!ids.length) return;
  await api("/api/inbox/clear", { kind, ids, on });
  on ? sfx.clear() : sfx.tick();
}

// ------------------------------------------------------------------ state
const S = { view: "casts", me: null, since: null };
const C = { data: null, tab: "new", focus: null, checked: new Set(), anchor: null, undo: null, reply: null, counts: new Map(), liked: new Set() };
const L = { data: null, tab: "new", checked: new Set() };
const R = { data: null, tab: "new", checked: new Set(), reply: null };

function header(title, sub, fresh) {
  $("#title").textContent = title;
  $("#sub").textContent = sub;
  $("#legend").innerHTML = fresh ? `${freshMark(true)}${fresh} new since your last visit` : "";
  document.querySelectorAll(".views a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.view === S.view));
}

// ================================================================== casts
function castsShown() {
  if (!C.data) return [];
  if (C.tab === "saved") return C.data.saved.map((s) => ({ ...s.cast, saved: true }));
  return C.data.casts.filter((c) => (C.tab === "cleared") === c.cleared);
}
function renderCasts() {
  const d = C.data, shown = castsShown();
  const waitingN = d.casts.filter((c) => !c.cleared).length;
  header("casts", "from people you follow · last 7 days", d.casts.filter((c) => c.fresh && !c.cleared).length);
  if (!shown.some((c) => c.hash === C.focus)) C.focus = shown[0]?.hash ?? null;
  const n = C.checked.size;
  $("#tools").innerHTML = `${seg([["new", `waiting ${waitingN}`], ["cleared", `cleared ${d.casts.length - waitingN}`], ["saved", `★ saved ${d.saved.length}`]], C.tab)}
    ${C.tab === "cleared" ? fixed("bring back", n, 'data-bulk="unclear"') : fixed("clear", n, 'data-bulk="clear"')}
    ${fixed("★ save", n, 'data-bulk="save"')}
    <span class="hint"><kbd>j</kbd><kbd>k</kbd> move · <kbd>x</kbd> select · <kbd>e</kbd> clear · <kbd>s</kbd> save · <kbd>l</kbd> like · <kbd>r</kbd> reply · <kbd>u</kbd> undo<br>controller: d-pad move · A like · X select · Y save · B clear</span>`;
  const c = shown.find((x) => x.hash === C.focus);
  $("#view").innerHTML = `<div class="mail${C.reading ? " reading" : ""}">
    <section class="tile list" aria-label="Casts">
      <div class="lhead"><span class="ck${n && n === shown.length ? " on" : ""}" data-all title="Select all"></span><span>${shown.length} ${C.tab === "saved" ? "saved" : C.tab === "cleared" ? "cleared" : "waiting"}</span><span style="margin-left:auto">shift-click: a range</span></div>
      ${shown.length ? shown.map((x) => `
        <div class="item${x.hash === C.focus ? " focus" : ""}${C.checked.has(x.hash) ? " checked" : ""}" data-hash="${x.hash}">
          <span class="ck" data-ck></span>${pic(x.author?.pfp)}
          <div class="who">${freshMark(x.fresh && C.tab === "new")}<b>@${esc(x.author?.username ?? x.fid)}</b><span class="t">${ago(x.time)}</span></div>
          <div class="snip">${esc(x.text || (x.embeds?.length ? "[embed]" : ""))}</div>${x.saved || d.saved.some((s) => s.hash === x.hash) ? `<span class="star" title="saved">★</span>` : ""}
        </div>`).join("") : `<div class="empty">${C.tab === "new" ? "All clear. Nothing's waiting for you." : C.tab === "saved" ? "Nothing saved yet. Press s on a cast." : "Nothing cleared yet."}</div>`}
      ${C.tab === "new" && d.casts.length >= 390 ? `<p class="dim small" style="padding:10px">Showing the newest 400. Six per person you follow.</p>` : ""}
    </section>
    <section class="tile read" aria-live="polite">${c ? readPane(c) : `<div class="empty">Pick a cast on the left.</div>`}</section>
  </div>`;
  wireCasts(shown, c);
}
function readPane(c) {
  const saved = C.data.saved.some((s) => s.hash === c.hash), cleared = C.data.casts.find((x) => x.hash === c.hash)?.cleared;
  const counts = C.counts.get(c.hash);
  const u = c.author?.username;
  return `
    ${kit.button("← list", { cls: "mobile-back", attrs: 'data-back style="display:none;margin-bottom:12px"' })}
    <div class="head">${pic(c.author?.pfp, "")}<div><b>${esc(c.author?.display ?? u ?? c.fid)}</b><span>${u ? kit.ext(profileUrl(u), `@${esc(u)}`) : `fid ${c.fid}`} · ${ago(c.time)} ago${c.app ? ` · via ${esc(c.app.name)}` : ""}${c.channel ? ` · /${esc(c.channel)}` : ""}</span></div></div>
    <div class="text">${rich(c.text)}</div>
    ${embeds(c.embeds)}
    <div class="meta">${counts ? `<span>↩ ${counts.replies}</span><span>⟲ ${counts.recasts}</span><span>♥ ${counts.likes + (C.liked.has(c.hash) ? 1 : 0)}</span>` : `<span>counting<span class="blink">_</span></span>`}
      ${u ? kit.ext(`${profileUrl(u)}/${c.hash.slice(0, 10)}`, "open on Farcaster", { attrs: 'style="margin-left:auto"' }) : ""}</div>
    <div class="acts">
      ${kit.button(C.liked.has(c.hash) ? "♥ liked" : "♥ like", { key: "l", pressed: C.liked.has(c.hash), attrs: 'data-act="like"' })}
      ${kit.button("⟲ recast", { attrs: 'data-act="recast"' })}
      ${kit.button("↩ reply", { look: "primary", key: "r", pressed: C.reply === c.hash, attrs: 'data-act="reply"' })}
      ${kit.button(saved ? "★ saved" : "☆ save", { key: "s", pressed: saved, attrs: 'data-act="save"' })}
      ${C.tab === "saved" ? "" : kit.button(cleared ? "bring back" : "clear", { look: "quiet", key: "e", attrs: `data-act="${cleared ? "unclear" : "clear"}"` })}
    </div>
    ${C.reply === c.hash ? replyBox({ hash: c.hash, fid: c.fid, username: u }) : ""}
    <p class="dim small" style="margin-top:14px">Cleared and saved stay on this computer. Likes go to Farcaster.</p>`;
}
function wireCasts(shown, c) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { C.tab = b.dataset.tab; C.checked.clear(); C.reply = null; renderCasts(); }));
  document.querySelectorAll(".item").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("a")) return;
    const h = el.dataset.hash, order = shown.map((x) => x.hash);
    if (e.target.hasAttribute("data-ck") || e.metaKey || e.ctrlKey) { C.checked.has(h) ? C.checked.delete(h) : C.checked.add(h); C.anchor = h; sfx.tick(); }
    else if (e.shiftKey && C.anchor) { const [a, b] = [order.indexOf(C.anchor), order.indexOf(h)].sort((p, q) => p - q); order.slice(a, b + 1).forEach((x) => C.checked.add(x)); sfx.tick(); }
    else { C.focus = h; C.anchor = h; C.reply = null; C.reading = true; sfx.move(); }
    renderCasts();
  }));
  $("[data-all]")?.addEventListener("click", () => { if (C.checked.size === shown.length) C.checked.clear(); else shown.forEach((x) => C.checked.add(x.hash)); renderCasts(); });
  document.querySelectorAll("[data-bulk]").forEach((b) => b.addEventListener("click", () => { if (b.getAttribute("aria-disabled") !== "true") castAct(b.dataset.bulk, [...C.checked]); }));
  document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => castAct(b.dataset.act, [C.focus])));
  $("[data-back]")?.addEventListener("click", () => { C.reading = false; renderCasts(); });
  if (matchMedia("(max-width: 900px)").matches) document.querySelectorAll(".mobile-back").forEach((b) => (b.style.display = "inline-flex"));
  if (c && C.reply === c.hash) wireReplyBox({ hash: c.hash, fid: c.fid }, () => { C.reply = null; renderCasts(); });
  if (c && !C.counts.has(c.hash)) api(`/api/inbox/counts?fid=${c.fid}&hash=${c.hash}`).then((n) => { C.counts.set(c.hash, n); if (C.focus === c.hash && S.view === "casts") renderCasts(); }, () => {});
}
async function castAct(a, hashes) {
  hashes = hashes.filter(Boolean);
  if (!hashes.length) return;
  const find = (h) => C.data.casts.find((x) => x.hash === h) ?? C.data.saved.find((s) => s.hash === h)?.cast;
  if (a === "clear" || a === "unclear") {
    const on = a === "clear";
    const order = castsShown().map((x) => x.hash), next = order[Math.max(...hashes.map((h) => order.indexOf(h))) + 1];
    try { await clearIds("casts", hashes, on); } catch (e) { return toast(e.message); }
    hashes.forEach((h) => { const x = C.data.casts.find((c) => c.hash === h); if (x) x.cleared = on; });
    C.undo = { hashes, on };
    if (hashes.includes(C.focus)) C.focus = next ?? null;
    C.checked.clear();
    toast(`${on ? "Cleared" : "Brought back"} ${hashes.length}.${on ? " Press u to undo." : ""}`);
  } else if (a === "save") {
    const allSaved = hashes.every((h) => C.data.saved.some((s) => s.hash === h));
    for (const h of hashes) {
      const cast = find(h); if (!cast) continue;
      const on = hashes.length > 1 ? true : !allSaved;
      try { await api("/api/inbox/save", { cast, on }); } catch (e) { return toast(e.message); }
      C.data.saved = C.data.saved.filter((s) => s.hash !== h);
      if (on) C.data.saved.unshift({ hash: h, fid: cast.fid, savedAt: new Date().toISOString(), cast });
    }
    sfx.save(); toast(hashes.length > 1 ? `Saved ${hashes.length}.` : allSaved ? "Unsaved." : "Saved. Find it under ★ saved.");
    C.checked.clear();
  } else if (a === "like" || a === "recast") {
    const cast = find(hashes[0]); if (!cast) return;
    const on = a === "like" ? !C.liked.has(cast.hash) : true;
    if (await react(a, cast, on) && a === "like") on ? C.liked.add(cast.hash) : C.liked.delete(cast.hash);
  } else if (a === "reply") C.reply = C.reply === hashes[0] ? null : hashes[0];
  renderCasts();
}

// ================================================================== likes
function likeGroups() {
  const wantCleared = L.tab === "cleared";
  return (L.data?.groups ?? []).map((g) => ({ ...g, likes: g.likes.filter((l) => l.cleared === wantCleared) })).filter((g) => g.likes.length);
}
function renderLikes() {
  const all = L.data.groups.flatMap((g) => g.likes), waitingN = all.filter((l) => !l.cleared).length;
  header("likes", "on your casts · last 7 days", all.filter((l) => l.fresh && !l.cleared).length);
  const shown = likeGroups(), n = L.checked.size;
  $("#tools").innerHTML = `${seg([["new", `waiting ${waitingN}`], ["cleared", `cleared ${all.length - waitingN}`]], L.tab)}
    ${kit.button(shown.length && n === shown.length ? "select none" : "select all", { fixed: true, disabled: !shown.length, attrs: "data-all" })}
    ${fixed(L.tab === "cleared" ? "bring back" : "clear", n, `data-bulk="${L.tab === "cleared" ? "unclear" : "clear"}"`)}
    <span class="hint">click a card to select it · <kbd>e</kbd> clear</span>`;
  const me = S.me?.username;
  $("#view").innerHTML = `<div class="notes">${shown.length ? shown.map((g) => {
    const names = g.likes.map((l) => kit.ext(profileUrl(l.username ?? ""), `<b>@${esc(l.username ?? l.fid)}</b>`));
    const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
    return `<article class="note${L.checked.has(g.cast.hash) ? " checked" : ""}" data-hash="${g.cast.hash}">
      <span class="ck"></span>
      <div>
        <div class="yours">your cast · ${me ? kit.ext(`${profileUrl(me)}/${g.cast.hash.slice(0, 10)}`, esc(g.cast.text || "[embed]")) : esc(g.cast.text)}</div>
        <div class="line"><span class="heart">♥ ${g.likes.length}</span><span class="stack">${g.likes.slice(0, 6).map((l) => pic(l.pfp, "")).join("")}</span><span>${who} liked this</span>
          <span class="t">${freshMark(g.likes.some((l) => l.fresh) && L.tab === "new")}${ago(g.likes[0].time)}</span></div>
      </div></article>`;
  }).join("") : `<div class="tile empty">${L.tab === "cleared" ? "Nothing cleared yet." : "No likes waiting. All clear."}</div>`}</div>`;
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { L.tab = b.dataset.tab; L.checked.clear(); renderLikes(); }));
  document.querySelectorAll(".note").forEach((el) => el.addEventListener("click", (e) => { if (e.target.closest("a")) return; const h = el.dataset.hash; L.checked.has(h) ? L.checked.delete(h) : L.checked.add(h); sfx.tick(); renderLikes(); }));
  $("[data-all]").addEventListener("click", () => { if (!shown.length) return; if (L.checked.size === shown.length) L.checked.clear(); else shown.forEach((g) => L.checked.add(g.cast.hash)); renderLikes(); });
  $("[data-bulk]").addEventListener("click", (e) => { if (e.currentTarget.getAttribute("aria-disabled") !== "true") likesClear(e.currentTarget.dataset.bulk === "clear"); });
}
async function likesClear(on) {
  const ids = likeGroups().filter((g) => L.checked.has(g.cast.hash)).flatMap((g) => g.likes.map((l) => l.id));
  try { await clearIds("likes", ids, on); } catch (e) { return toast(e.message); }
  L.data.groups.forEach((g) => g.likes.forEach((l) => { if (ids.includes(l.id)) l.cleared = on; }));
  toast(`${on ? "Cleared" : "Brought back"} ${ids.length} ${ids.length === 1 ? "like" : "likes"}.`);
  L.checked.clear(); renderLikes();
}

// ================================================================== replies
function replyGroups() {
  const wantCleared = R.tab === "cleared";
  return (R.data?.groups ?? []).map((g) => ({ ...g, replies: g.replies.filter((r) => r.cleared === wantCleared) })).filter((g) => g.replies.length);
}
function renderReplies() {
  const all = R.data.groups.flatMap((g) => g.replies), waitingN = all.filter((r) => !r.cleared).length;
  header("replies", "to you · last 7 days", all.filter((r) => r.fresh && !r.cleared).length);
  const shown = replyGroups(), n = R.checked.size;
  $("#tools").innerHTML = `${seg([["new", `waiting ${waitingN}`], ["cleared", `cleared ${all.length - waitingN}`]], R.tab)}
    ${fixed(R.tab === "cleared" ? "bring back" : "clear", n, `data-bulk="${R.tab === "cleared" ? "unclear" : "clear"}"`)}
    <span class="hint">tick replies to select · <kbd>e</kbd> clear</span>`;
  const me = S.me?.username;
  $("#view").innerHTML = `<div class="notes">${shown.length ? shown.map((g) => `
    <article class="note" style="grid-template-columns:1fr">
      <div>
        <div class="yours">your cast · ${me ? kit.ext(`${profileUrl(me)}/${g.cast.hash.slice(0, 10)}`, esc(g.cast.text || "[embed]")) : esc(g.cast.text)}</div>
        ${g.replies.map((r) => `
          <div class="reply${R.checked.has(r.hash) ? " checked" : ""}" data-hash="${r.hash}">
            <span class="ck" data-rck></span>${pic(r.author?.pfp)}
            <div>
              <div class="rh">${freshMark(r.fresh && R.tab === "new")}${kit.ext(profileUrl(r.author?.username ?? ""), `<b style="font-weight:400">@${esc(r.author?.username ?? r.fid)}</b>`)}<span class="t dim small" style="margin-left:auto">${ago(r.time)}</span></div>
              <div class="rt">${rich(r.text)}</div>
              ${embeds(r.embeds)}
              <div class="line">${kit.button("↩ reply", { look: "primary", pressed: R.reply === r.hash, attrs: "data-rreply" })}${kit.button("♥ like", { attrs: "data-rlike" })}${kit.button(r.cleared ? "bring back" : "clear", { look: "quiet", attrs: "data-rclear" })}</div>
              ${R.reply === r.hash ? replyBox({ hash: r.hash, fid: r.fid, username: r.author?.username }) : ""}
            </div>
          </div>`).join("")}
      </div>
    </article>`).join("") : `<div class="tile empty">${R.tab === "cleared" ? "Nothing cleared yet." : "No replies waiting. All clear."}</div>`}</div>`;
  const byHash = (el) => all.find((r) => r.hash === el.closest(".reply").dataset.hash);
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => { R.tab = b.dataset.tab; R.checked.clear(); R.reply = null; renderReplies(); }));
  document.querySelectorAll("[data-rck]").forEach((b) => b.addEventListener("click", () => { const h = b.closest(".reply").dataset.hash; R.checked.has(h) ? R.checked.delete(h) : R.checked.add(h); sfx.tick(); renderReplies(); }));
  document.querySelectorAll("[data-rreply]").forEach((b) => b.addEventListener("click", () => { const r = byHash(b); R.reply = R.reply === r.hash ? null : r.hash; renderReplies(); }));
  document.querySelectorAll("[data-rlike]").forEach((b) => b.addEventListener("click", () => react("like", byHash(b))));
  document.querySelectorAll("[data-rclear]").forEach((b) => b.addEventListener("click", () => repliesClear([byHash(b).hash], !byHash(b).cleared)));
  $("[data-bulk]").addEventListener("click", (e) => { if (e.currentTarget.getAttribute("aria-disabled") !== "true") repliesClear([...R.checked], e.currentTarget.dataset.bulk === "clear"); });
  const open = all.find((r) => r.hash === R.reply);
  if (open) wireReplyBox({ hash: open.hash, fid: open.fid }, () => { R.reply = null; renderReplies(); });
}
async function repliesClear(hashes, on) {
  try { await clearIds("replies", hashes, on); } catch (e) { return toast(e.message); }
  R.data.groups.forEach((g) => g.replies.forEach((r) => { if (hashes.includes(r.hash)) r.cleared = on; }));
  toast(`${on ? "Cleared" : "Brought back"} ${hashes.length}.`);
  R.checked.clear(); renderReplies();
}

// ================================================================== keys and controller
function castsKey(k, e) {
  const order = castsShown().map((x) => x.hash), i = order.indexOf(C.focus);
  const move = (d) => { const n = order[Math.max(0, Math.min(order.length - 1, i + d))]; if (n && n !== C.focus) { C.focus = n; C.reply = null; sfx.move(); renderCasts(); document.querySelector(".item.focus")?.scrollIntoView({ block: "nearest" }); } };
  if (k === "j" || k === "arrowdown") return move(1), true;
  if (k === "k" || k === "arrowup") return move(-1), true;
  if (k === "x" && C.focus) { C.checked.has(C.focus) ? C.checked.delete(C.focus) : C.checked.add(C.focus); sfx.tick(); renderCasts(); return true; }
  if (k === "e") { const sel = C.checked.size ? [...C.checked] : [C.focus]; castAct(C.tab === "cleared" ? "unclear" : "clear", sel); return true; }
  if (k === "s") { castAct("save", C.checked.size ? [...C.checked] : [C.focus]); return true; }
  if (k === "l") { castAct("like", [C.focus]); return true; }
  if (k === "r") { castAct("reply", [C.focus]); e.preventDefault(); return true; }
  if (k === "u" && C.undo) { const u = C.undo; C.undo = null; castAct(u.on ? "unclear" : "clear", u.hashes).then(() => toast("Undone.")); return true; }
  if (k === "escape") { C.checked.clear(); renderCasts(); return true; }
}
addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (S.view === "casts" && C.data && castsKey(k, e)) { e.preventDefault(); return; }
  if (k === "e" && S.view === "likes" && L.checked.size) likesClear(L.tab !== "cleared");
  if (k === "e" && S.view === "replies" && R.checked.size) repliesClear([...R.checked], R.tab !== "cleared");
  if (k === "escape" && S.view !== "casts") location.href = "/";
});
// Controller, in casts: d-pad moves, A likes, X selects, Y saves, B clears.
const prev = {};
(function poll() {
  const pads = [...(navigator.getGamepads?.() || [])].filter(Boolean);
  $("#pad").textContent = pads.length ? "controller on" : "no controller";
  for (const p of pads) {
    const edge = (i) => p.buttons[i]?.pressed && !prev[p.index + ":" + i];
    if (S.view === "casts" && C.data) {
      if (edge(12)) castsKey("k", new Event("x"));
      if (edge(13)) castsKey("j", new Event("x"));
      if (edge(0)) castsKey("l", new Event("x"));
      if (edge(2)) castsKey("x", new Event("x"));
      if (edge(3)) castsKey("s", new Event("x"));
      if (edge(1)) castsKey("e", new Event("x"));
    }
    [0, 1, 2, 3, 12, 13].forEach((i) => (prev[p.index + ":" + i] = p.buttons[i]?.pressed));
  }
  requestAnimationFrame(poll);
})();

// ================================================================== views
async function show(view) {
  S.view = ["casts", "likes", "replies"].includes(view) ? view : "casts";
  header(S.view, "", 0);
  $("#tools").innerHTML = "";
  $("#view").innerHTML = `<div class="loading">looking<span class="blink">_</span>${S.view === "casts" ? " The first time takes a few seconds." : ""}</div>`;
  try {
    if (S.view === "casts") { C.data ??= await api("/api/inbox/casts"); renderCasts(); }
    if (S.view === "likes") { L.data ??= await api("/api/inbox/likes"); renderLikes(); }
    if (S.view === "replies") { R.data ??= await api("/api/inbox/replies"); renderReplies(); }
  } catch (e) {
    if (e instanceof SignedOut) location.href = "/signin";
    else $("#view").innerHTML = `<div class="tile empty">${esc(e.message)}</div>`;
  }
}
addEventListener("hashchange", () => show(location.hash.slice(1)));
(async () => {
  S.me = await api("/api/me").catch(() => null);
  if (!S.me) { location.href = "/signin"; return; }
  show(location.hash.slice(1) || "casts");
})();
