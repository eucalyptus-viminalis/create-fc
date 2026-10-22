// clearcast post mode: write a cast, @-mention people, attach up to two images.
// Images upload to your own node (fc-companion) and the cast links to them.
// The counter counts bytes, the way Farcaster does: mentions are cut out of
// the text before it's sent, so they're free.

const { $, esc, api, store, tone, toast, SignedOut } = kit;
const LIMIT = 320, MAX_EMBEDS = 2, MB = 1024 * 1024;
const enc = new TextEncoder();
// A name can hold dots (vitalik.eth) but never ends in one, so "@alice." is @alice.
const MENTION = /(^|\s)@([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*)/gi;


// ------------------------------------------------------------------ sound
const sfx = {
  move: () => tone(880, 0, 0.025, 0.02),
  pick: () => { tone(660, 0, 0.04); tone(990, 0.04, 0.05); },
  add: () => tone(523, 0, 0.05),
  over: () => tone(165, 0, 0.12, 0.04),
  step: () => tone(783.99, 0, 0.05),
  win: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.12, 0.04)),
};

// ------------------------------------------------------------------ state
const ta = $("#text");
const S = {
  me: null,
  atts: [], // { id, preview, name?, url?, size, progress (0-10), error? }
  link: null, // the first link in the text: { url, stage (1 reach, 2 read, 3 image), card?, error? }
  dismissed: new Set(), // links whose card you removed: they stay text only
  verified: new Map(), // username -> profile; these mentions are free
  usage: null,
  menu: { open: false, items: [], sel: 0, start: 0, q: "" },
};
const DRAFT = "cc-post-draft";

// ------------------------------------------------------------------ bytes
function measure(text) {
  let mentions = 0;
  const sent = text.replace(MENTION, (m, pre, u) => (S.verified.has(u.toLowerCase()) ? (mentions++, pre) : m));
  return {
    bytes: enc.encode(sent).length,
    mentions,
    emoji: [...text].filter((ch) => enc.encode(ch).length >= 3).length, // most emoji are 4 bytes, some 3
    letters: [...text].length,
  };
}

function paint() {
  const t = ta.value, m = measure(t), left = LIMIT - m.bytes, over = left < 0;
  const on = Math.min(32, Math.ceil((m.bytes / LIMIT) * 32));
  $("#cells").className = "cells" + (over ? " over" : "");
  $("#cells").innerHTML = Array.from({ length: 32 }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("");
  $("#left").className = "left" + (over ? " over" : "");
  $("#left").textContent = over ? `${-left} over` : `${left}`;
  $("#left").title = over ? "Cut some words to cast." : `${left} bytes left`;

  const ready = S.atts.filter((a) => a.url);
  const used = S.atts.length + (S.link ? 1 : 0);
  const busy = S.atts.some((a) => !a.url && !a.error);
  const empty = !t.trim() && !ready.length;
  const block = over ? "Cut some words first." : empty ? "Write something first." : busy ? "Wait for images to upload." : "";
  $("#cast").setAttribute("aria-disabled", String(Boolean(block)));
  $("#cast").title = block;
  $("#slots").textContent = `${used} of ${MAX_EMBEDS} embeds`;
  const noHosting = S.usage && !S.usage.hosting;
  $("#add-image").setAttribute("aria-disabled", String(used >= MAX_EMBEDS || Boolean(noHosting)));

  $("#pv-text").innerHTML = t.trim()
    ? esc(t).replace(MENTION, (m, pre, u) => (S.verified.has(u.toLowerCase()) ? `${pre}<span class="m">@${u}</span>` : m))
    : `<span class="dim">Your cast shows up here.</span>`;
  $("#pv-pics").innerHTML = S.atts.map((a) => `<img src="${esc(a.url ?? a.preview)}" alt="">`).join("");
  $("#pv-link").innerHTML = S.link?.card ? card(S.link, true) : "";
  $("#counts").innerHTML = `
    <tr><td>letters typed</td><td>${m.letters}</td></tr>
    <tr><td>bytes sent</td><td>${m.bytes} of ${LIMIT}</td></tr>
    <tr><td>mentions, free</td><td>${m.mentions}</td></tr>
    <tr><td>emoji, 3 or 4 bytes each</td><td>${m.emoji}</td></tr>
    <tr><td>embeds${S.link ? ", 1 link" : ""}</td><td>${S.atts.length + (S.link ? 1 : 0)} of ${MAX_EMBEDS}</td></tr>`;
  saveDraft();
}

// Keep the draft on this computer, so a reload or a crash loses nothing.
let saveT;
function saveDraft() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const att = S.atts.filter((a) => a.url).map(({ url, name, size }) => ({ url, name, size }));
    if (!ta.value && !att.length) { store.del(DRAFT); $("#saved").textContent = ""; return; }
    store.set(DRAFT, { text: ta.value, atts: att, mentions: [...S.verified.values()], dismissed: [...S.dismissed] });
    $("#saved").textContent = "draft saved";
  }, 300);
}

// ------------------------------------------------------------------ @ menu
function caretXY() {
  const mirror = $("#mirror");
  mirror.style.width = ta.offsetWidth + "px";
  mirror.textContent = ta.value.slice(0, ta.selectionStart);
  const mark = document.createElement("span");
  mark.textContent = "​";
  mirror.appendChild(mark);
  return { x: mark.offsetLeft, y: mark.offsetTop - ta.scrollTop + 28 };
}

let lookup = 0;
async function updateMenu() {
  const before = ta.value.slice(0, ta.selectionStart);
  const m = before.match(/(^|\s)@([a-z0-9.-]{0,20})$/i);
  if (!m) return closeMenu();
  const q = m[2].toLowerCase(), start = ta.selectionStart - m[2].length - 1;
  const run = ++lookup;
  let res;
  try { res = await api(`/api/mentions?q=${encodeURIComponent(q)}`); } catch { return closeMenu(); }
  if (run !== lookup) return;
  const items = res.people;
  S.menu = { open: true, items, sel: q === S.menu.q ? Math.min(S.menu.sel, Math.max(0, items.length - 1)) : 0, start, q };
  drawMenu(res);
  // Profiles of the people you follow are still arriving: ask again shortly.
  if (res.loading) setTimeout(() => { if (S.menu.open && run === lookup) updateMenu(); }, 800);
}
function drawMenu(res) {
  const { items, sel, q } = S.menu;
  const { x, y } = caretXY();
  const el = $("#menu");
  el.style.left = Math.max(0, Math.min(x, ta.offsetWidth - 300)) + "px";
  el.style.top = y + 6 + "px";
  el.classList.add("open");
  const foot = res?.loading ? "Loading people you follow…" : q.length > 1 && !items.some((p) => p.username === q) ? "Type the full name for anyone else." : "↑↓ choose · ↵ or tab to add";
  el.innerHTML = `<div class="hd">mention</div>` +
    (items.length
      ? items.map((p, i) => `<button role="option" aria-selected="${i === sel}" data-i="${i}">${p.pfp ? `<img class="av" src="${esc(p.pfp)}" alt="" referrerpolicy="no-referrer">` : `<span class="av"></span>`}<span class="nm"><b>@${esc(p.username)}</b> <span>${esc(p.display ?? "")}</span></span><span class="rel">${esc(p.relation)}</span></button>`).join("")
      : `<div class="ft">${q ? "No one you follow matches." : "Start typing a name."}</div>`) +
    `<div class="ft">${foot}</div>`;
  el.querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); S.menu.sel = +b.dataset.i; pick(); }));
}
function closeMenu() { lookup++; S.menu.open = false; $("#menu").classList.remove("open"); }
function pick() {
  const p = S.menu.items[S.menu.sel];
  if (!p) return;
  const v = ta.value, end = ta.selectionStart;
  ta.value = v.slice(0, S.menu.start) + "@" + p.username + " " + v.slice(end);
  const pos = S.menu.start + p.username.length + 2;
  ta.setSelectionRange(pos, pos);
  S.verified.set(p.username.toLowerCase(), p);
  closeMenu(); sfx.pick(); paint(); ta.focus();
}

// A name typed by hand becomes a mention once this node knows it.
let checkT;
function checkTypedMentions() {
  clearTimeout(checkT);
  checkT = setTimeout(async () => {
    const names = [...ta.value.matchAll(MENTION)].map((m) => m[2].toLowerCase()).filter((u) => !S.verified.has(u));
    for (const u of new Set(names)) {
      const res = await api(`/api/mentions?q=${encodeURIComponent(u)}`).catch(() => null);
      const hit = res?.people.find((p) => p.username?.toLowerCase() === u);
      if (hit) { S.verified.set(u, hit); paint(); }
    }
  }, 600);
}

ta.addEventListener("input", () => { paint(); updateMenu(); checkTypedMentions(); scheduleLink(); });
ta.addEventListener("click", updateMenu);
ta.addEventListener("blur", () => setTimeout(closeMenu, 150));
ta.addEventListener("keydown", (e) => {
  const mn = S.menu;
  if (mn.open && mn.items.length) {
    if (e.key === "ArrowDown") { mn.sel = (mn.sel + 1) % mn.items.length; sfx.move(); drawMenu(); e.preventDefault(); return; }
    if (e.key === "ArrowUp") { mn.sel = (mn.sel + mn.items.length - 1) % mn.items.length; sfx.move(); drawMenu(); e.preventDefault(); return; }
    if (e.key === "Enter" || e.key === "Tab") { pick(); e.preventDefault(); return; }
  }
  if (mn.open && e.key === "Escape") { closeMenu(); e.preventDefault(); e.stopPropagation(); }
});
$("#add-at").addEventListener("click", () => {
  const p = ta.selectionStart, v = ta.value, pad = p && !/\s$/.test(v.slice(0, p)) ? " " : "";
  ta.value = v.slice(0, p) + pad + "@" + v.slice(p);
  ta.focus();
  ta.setSelectionRange(p + pad.length + 1, p + pad.length + 1);
  paint(); updateMenu();
});

// ------------------------------------------------------------------ images
// Shrink big photos before they leave this computer: 1600 px wide is plenty
// for a cast, and it keeps your image space for more pictures. GIFs stay as
// they are, so they keep moving.
async function shrink(file) {
  if (file.type === "image/gif" || (file.size < 1.5 * MB && file.type !== "image/heic")) return file;
  const img = await createImageBitmap(file).catch(() => null);
  if (!img) return file;
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise((r) => c.toBlob(r, type, 0.85));
  return blob && blob.size < file.size ? blob : file;
}

async function upload(blob, att) {
  // Uploading needs a presence heartbeat, which names this browser.
  const device = await mine.device((await kit.me())?.fid);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/images");
    x.setRequestHeader("x-clearcast-token", kit.TOKEN);
    x.setRequestHeader("x-clearcast-device", device.id);
    x.setRequestHeader("x-clearcast-status", device.status);
    x.setRequestHeader("content-type", "application/octet-stream");
    x.upload.onprogress = (e) => { if (e.lengthComputable) { att.progress = Math.min(9, Math.floor((e.loaded / e.total) * 10)); renderAtts(); } };
    x.onload = () => {
      let json = {};
      try { json = JSON.parse(x.responseText); } catch {}
      if (x.status !== 200) return reject(new Error(json.error ?? `upload failed (${x.status})`));
      // Hosted: the upload waits for this browser to sign it (mine.js).
      json.sign ? mine.key.answer(json).then((j) => resolve(j.data), reject) : resolve(json.data);
    };
    x.onerror = () => reject(new Error("upload failed: is clearcast still running?"));
    x.send(blob);
  });
}

async function addFiles(files) {
  for (const f of files) {
    if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast("Only PNG, JPEG, GIF or WebP."); continue; }
    if (S.atts.length + (S.link ? 1 : 0) >= MAX_EMBEDS) { sfx.over(); toast(S.link ? "Two embeds max. Remove the link card or an image." : "Two embeds max. Remove one first."); break; }
    if (S.usage && !S.usage.hosting) { toast("This node doesn't host images yet."); break; }
    const att = { id: Math.random().toString(36).slice(2), preview: URL.createObjectURL(f), size: f.size, progress: 0 };
    S.atts.push(att); sfx.add(); renderAtts(); paint();
    try {
      const blob = await shrink(f);
      att.size = blob.size;
      if (S.usage && blob.size > S.usage.fileCap) throw new Error(`Images max out at ${S.usage.fileCap / MB} MB.`);
      const r = await upload(blob, att);
      Object.assign(att, { url: r.url, name: r.name, size: r.size, progress: 10 });
      S.usage = { ...S.usage, ...r.usage, hosting: true };
      paintSpace();
    } catch (e) {
      att.error = e.message;
      sfx.over();
      toast(e.message, 3500);
    }
    renderAtts(); paint();
  }
}

async function removeAtt(id) {
  const i = S.atts.findIndex((a) => a.id === id);
  if (i < 0) return;
  const [a] = S.atts.splice(i, 1);
  renderAtts(); paint();
  // Not cast yet, so nothing links to it: give its space back.
  if (a.name) api("/api/images/delete", { name: a.name }).then((r) => { S.usage = { ...S.usage, ...r.usage }; paintSpace(); }, () => {});
}

function renderAtts() {
  $("#atts").innerHTML = S.atts.map((a) => {
    const status = a.error ? "failed" : a.url ? "on this node" : "uploading";
    const bar = !a.url && !a.error ? `<div class="up">${Array.from({ length: 10 }, (_, j) => `<i class="${j < a.progress ? "on" : ""}"></i>`).join("")}</div>` : "";
    return `<div class="att${a.error ? " failed" : ""}" title="${esc(a.error ?? "")}"><img src="${esc(a.url ?? a.preview)}" alt=""><div class="meta"><span>${status}</span><span>${Math.max(1, Math.round(a.size / 1024))} KB</span></div>${bar}<button class="x" data-id="${a.id}" aria-label="Remove image">x</button></div>`;
  }).join("");
  $("#atts").querySelectorAll(".x").forEach((b) => b.addEventListener("click", () => removeAtt(b.dataset.id)));
}

$("#add-image").addEventListener("click", () => { if ($("#add-image").getAttribute("aria-disabled") !== "true") $("#file").click(); });
$("#file").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
ta.addEventListener("paste", (e) => { const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); addFiles(files); } });
const box = $("#compose");
box.addEventListener("dragover", (e) => { e.preventDefault(); box.classList.add("drop"); });
box.addEventListener("dragleave", () => box.classList.remove("drop"));
box.addEventListener("drop", (e) => { e.preventDefault(); box.classList.remove("drop"); addFiles([...e.dataTransfer.files]); });

// ------------------------------------------------------------------ link cards
// The first link in the text gets a card, like other Farcaster apps show, and
// rides along as an embed so they show it too. Cards come from the page's
// Open Graph tags (https://ogp.me), with X's twitter: tags as a fallback. Three steps you can watch:
// reach the site, read its preview tags, load its image. (A page's size isn't
// known ahead, so the steps are what's measurable, not bytes.)
const LINK = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
let linkT, linkRun = 0;
function scheduleLink() { clearTimeout(linkT); linkT = setTimeout(findLink, 600); }
function findLink() {
  const url = [...ta.value.matchAll(LINK)].map((m) => m[0]).find((u) => !S.dismissed.has(u) && !S.atts.some((a) => a.url === u));
  if (!url) { if (S.link) { S.link = null; paint(); } renderLink(); return; }
  if (S.link?.url === url) return;
  if (S.atts.length >= MAX_EMBEDS) { S.link = null; renderLink(); paint(); return; } // no slot: it stays text
  startLink(url);
}
async function startLink(url) {
  const run = ++linkRun;
  S.link = { url, stage: 1 };
  renderLink(); paint();
  let card;
  try { card = await api(`/api/unfurl?url=${encodeURIComponent(url)}`); }
  catch (e) { if (run === linkRun) { S.link = { url, stage: 3, error: e.message }; renderLink(); paint(); } return; }
  if (run !== linkRun) return;
  S.link = { url, stage: 2, card };
  sfx.add(); renderLink(); paint();
  if (!card.image) { S.link.stage = 3; renderLink(); return; }
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.onload = () => { if (run === linkRun) { S.link.stage = 3; renderLink(); paint(); } };
  img.onerror = () => { if (run === linkRun) { S.link.card = { ...card, image: undefined }; S.link.stage = 3; renderLink(); paint(); } };
  img.src = card.image;
}
const STAGES = ["reaching", "reading", "loading image"];
function card(l, mini = false) {
  const c = l.card ?? {}, host = (() => { try { return new URL(l.url).hostname.replace(/^www\./, ""); } catch { return l.url; } })();
  const loading = l.stage < 3;
  const bar = loading ? `<div class="lbar" title="${STAGES[l.stage - 1]} ${esc(host)}">${[1, 2, 3].map((i) => `<i class="${i < l.stage ? "on" : i === l.stage ? "now" : ""}"></i>`).join("")}</div>` : "";
  const img = c.image && l.stage === 3 ? `<img class="limg" src="${esc(c.image)}" alt="" referrerpolicy="no-referrer">` : c.image ? `<div class="limg wait"></div>` : "";
  const none = `No ${kit.ext("https://ogp.me", "OG", { title: "Open Graph, the tags pages use for link cards" })} metadata found.`;
  const text = l.error
    ? `<div class="lsite">${esc(host)}</div><div class="ldesc">${none}</div>`
    : c.title || c.description
      ? `<div class="lsite">${esc(c.site ?? host)}</div>${c.title ? `<div class="ltitle">${esc(c.title)}</div>` : ""}${c.description && !mini ? `<div class="ldesc">${esc(c.description)}</div>` : ""}`
      : `<div class="lsite">${esc(host)}</div><div class="ldesc">${loading ? `${STAGES[l.stage - 1]}…` : none}</div>`;
  return `<div class="lcard${mini ? " mini" : ""}">${img}${bar}<div class="lmeta">${text}</div>${mini ? "" : `<button class="x" id="link-x" aria-label="Remove the link card">x</button>`}</div>`;
}
function renderLink() {
  // A removed card can come back while its link is still in the text.
  const back = !S.link && S.atts.length < MAX_EMBEDS ? [...ta.value.matchAll(LINK)].map((m) => m[0]).find((u) => S.dismissed.has(u)) : null;
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  $("#linkcard").innerHTML = S.link ? card(S.link) : back ? kit.button(`+ card for ${esc(host(back))}`, { attrs: `id="link-back" data-url="${esc(back)}"` }) : "";
  $("#link-back")?.addEventListener("click", (e) => { S.dismissed.delete(e.currentTarget.dataset.url); sfx.add(); saveDraft(); findLink(); });
  $("#link-x")?.addEventListener("click", () => {
    S.dismissed.add(S.link.url); S.link = null; linkRun++;
    renderLink(); paint(); toast("Card removed. The link stays as text.");
    findLink();
  });
}

// ------------------------------------------------------------------ image space
const fmtMB = (b) => (!b ? "0 MB" : b >= 1024 * MB ? `${(b / 1024 / MB).toFixed(1)} GB` : b >= MB ? `${(b / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
function paintSpace() {
  const u = S.usage, el = $("#space");
  if (!u) return;
  if (!u.hosting) {
    el.innerHTML = `<p>This node doesn't host images yet.</p><p class="note">Its owner can re-run command 1.</p>`;
    return;
  }
  const on = Math.round((u.used / u.cap) * 25);
  el.innerHTML = `<p><span class="count">${fmtMB(u.used)}</span> <span class="dim">of ${fmtMB(u.cap)}</span></p>
    <div class="space" title="${Math.round((u.used / u.cap) * 100)}% used">${Array.from({ length: 25 }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("")}</div>
    <p class="dim small">${u.files} ${u.files === 1 ? "image" : "images"} · ${fmtMB(u.cap - u.used)} left · ${fmtMB(u.fileCap)} per image</p>
    <p class="note">This node holds ${fmtMB(u.nodeUsed)} of ${fmtMB(u.nodeCap)} for everyone. Images live as long as this server.</p>`;
}
async function loadSpace() {
  try { S.usage = await api("/api/images/usage"); }
  catch (e) { $("#space").innerHTML = `<p class="dim">${esc(/companion/.test(e.message) ? "This node's companion isn't answering." : e.message)}</p>`; return; }
  paintSpace(); paint();
}

// ------------------------------------------------------------------ cast
const STEPS = ["Sign it with your app key", "Send it to this node", "Wait for it to land"];
function drawSteps(at) {
  return `<ul class="steps">${STEPS.map((s, i) => `<li class="${i <= at ? "" : "todo"}"><span class="mk">${i < at ? "■" : i === at ? '<span class="blink">▶</span>' : "□"}</span><span>${s}</span></li>`).join("")}</ul>`;
}
async function cast() {
  if ($("#cast").getAttribute("aria-disabled") === "true") { sfx.over(); toast($("#cast").title); return; }
  const ov = $("#overlay");
  ov.classList.add("open");
  $("#ov-r").textContent = "";
  let at = 0;
  $("#ov").innerHTML = drawSteps(at);
  // The steps happen inside one request; move the checklist along while it runs.
  const tick = setInterval(() => { if (at < 2) { at++; sfx.step(); $("#ov").innerHTML = drawSteps(at); } }, 700);
  let r;
  try {
    r = await api("/api/cast", { text: ta.value, embeds: [...S.atts.filter((a) => a.url).map((a) => a.url), ...(S.link ? [S.link.url] : [])].slice(0, MAX_EMBEDS) });
  } catch (e) {
    clearInterval(tick); sfx.over();
    $("#ov-r").textContent = "didn't send";
    $("#ov").innerHTML = `<div class="err"><p>${esc(e.message)}</p></div><div class="row">${kit.button("back", { size: "lg", key: "esc", attrs: 'id="ov-back"' })}</div>`;
    $("#ov-back").addEventListener("click", () => ov.classList.remove("open"));
    return;
  }
  clearInterval(tick);
  const link = S.me?.username ? `https://farcaster.xyz/${encodeURIComponent(S.me.username)}/${r.hash.slice(0, 10)}` : null;
  $("#ov-r").textContent = r.landed ? "landed" : "sent";
  if (r.landed) sfx.win();
  $("#ov").innerHTML = `<p class="count" style="margin:6px 0 10px">${r.landed ? "cast!" : "sent"}</p>
    <p>${r.landed ? "Your cast is on Farcaster." : "This node hasn't seen it yet."}</p>
    <p class="dim">${r.landed ? "Every node has it now." : "It usually lands within a minute."}</p>
    <div class="row">${kit.button("write another", { size: "lg", look: "primary", key: "A", attrs: 'id="again"' })}${link ? kit.ext(link, "see it", { cls: "k-btn lg" }) : ""}<a class="k-btn lg" href="/">home</a></div>`;
  // The images now belong to a cast, so clearing the draft keeps them.
  ta.value = ""; S.atts = []; S.link = null; S.dismissed.clear(); S.verified.clear(); store.del(DRAFT); renderAtts(); renderLink(); paint();
  $("#again").addEventListener("click", () => { ov.classList.remove("open"); ta.focus(); });
}
$("#cast").addEventListener("click", cast);

// ------------------------------------------------------------------ keys
addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === "Enter") { e.preventDefault(); if (!$("#overlay").classList.contains("open")) cast(); return; }
  if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); $("#add-image").click(); return; }
  if (e.key === "Escape") {
    if ($("#overlay").classList.contains("open")) { $("#overlay").classList.remove("open"); return; }
    if (!S.menu.open) location.href = "/";
  }
  if ($("#overlay").classList.contains("open") && (e.key === "a" || e.key === "Enter")) { $("#again")?.click(); }
});

// ------------------------------------------------------------------ start
(async () => {
  try {
    S.me = await api("/api/me");
  } catch {}
  if (!S.me) { location.href = "/signin"; return; }
  $("#who").innerHTML = `<b>@${esc(S.me.username ?? `!${S.me.fid}`)}</b> · fid ${S.me.fid} · <a href="/">home</a>`;
  $("#pv-av").innerHTML = S.me.pfp ? `<img class="av" src="${esc(S.me.pfp)}" alt="" referrerpolicy="no-referrer">` : `<span class="av"></span>`;
  $("#pv-who").innerHTML = `<b>${esc(S.me.display ?? S.me.username ?? "you")}</b> <span>@${esc(S.me.username ?? S.me.fid)} · now</span>`;
  const d = store.get(DRAFT);
  if (d) {
    ta.value = d.text ?? "";
    for (const p of d.mentions ?? []) if (p.username) S.verified.set(p.username.toLowerCase(), p);
    S.atts = (d.atts ?? []).map((a) => ({ id: Math.random().toString(36).slice(2), url: a.url, name: a.name, size: a.size, progress: 10 }));
    for (const u of d.dismissed ?? []) S.dismissed.add(u);
    renderAtts();
    findLink();
  }
  paint();
  ta.focus();
  api("/api/mentions?q=").catch(() => {}); // start loading the people you follow
  loadSpace();
})();
