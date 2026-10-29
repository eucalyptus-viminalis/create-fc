// fameboy post mode: write a cast, @-mention people, attach up to two images.
// The box you write in is composer.js (the quote cast window uses it too):
// it counts bytes, looks up mentions, uploads images to your own node
// (fc-companion) and makes a card for the first link. This page adds what's
// around it: a preview, what counts, your image space, and drafts.

const { $, esc, api, store, tone, toast, SignedOut } = kit;
const { LIMIT, MAX_EMBEDS, MENTION } = composer;
const MB = 1024 * 1024;

// ------------------------------------------------------------------ sound
const sfx = {
  pick: () => { tone(660, 0, 0.04); tone(990, 0.04, 0.05); },
  add: () => tone(523, 0, 0.05),
  over: () => tone(165, 0, 0.12, 0.04),
  step: () => tone(783.99, 0, 0.05),
  win: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.12, 0.04)),
};

// ------------------------------------------------------------------ state
const S = {
  me: null,
  usage: null,
  draftId: null, // the saved draft open in the composer, if any
  held: [], // { names, until }: images an undo can still bring back
  asking: false, // clear or open is asking about an unsaved cast
};
// The composer's working copy, kept on every change so a reload loses nothing.
// Saved drafts are separate (see "drafts" below).
const DRAFT = "cc-post-draft";

let cz; // the composer (composer.js)
cz = composer.create($("#editor"), {
  placeholder: "What's clear to you today?",
  drop: $("#compose"),
  // An image stays on the node while a saved draft or an undo still needs it.
  keeps: (name) => drafts().some((d) => d.atts.some((a) => a.name === name)) || S.held.some((h) => h.until > Date.now() && h.names.includes(name)),
  onChange: () => cz && paint(),
  onUsage: (u, err) => {
    if (err) $("#space").innerHTML = `<p class="dim">${esc(/companion/.test(err.message) ? "This node's companion isn't answering." : err.message)}</p>`;
    else { S.usage = u; paintSpace(); }
  },
});
const ta = cz.ta;
const release = (names) => cz.release(names);

// ------------------------------------------------------------------ paint
function paint() {
  const t = ta.value, m = cz.state(), ready = cz.atts.filter((a) => a.url);
  const block = m.block;
  $("#cast").setAttribute("aria-disabled", String(Boolean(block)));
  $("#cast").title = block;

  $("#pv-text").innerHTML = t.trim()
    ? esc(t).replace(MENTION, (x, pre, u) => (cz.verified.has(u.toLowerCase()) ? `${pre}<span class="m">@${u}</span>` : x))
    : `<span class="dim">Your cast shows up here.</span>`;
  $("#pv-pics").innerHTML = cz.atts.map((a) => `<img src="${esc(a.url ?? a.preview)}" alt="">`).join("");
  $("#pv-link").innerHTML = cz.link?.card ? composer.card(cz.link, true) : "";
  $("#counts").innerHTML = `
    <tr><td>letters typed</td><td>${m.letters}</td></tr>
    <tr><td>bytes sent</td><td>${m.bytes} of ${LIMIT}</td></tr>
    <tr><td>mentions, free</td><td>${m.mentions}</td></tr>
    <tr><td>emoji, 3 or 4 bytes each</td><td>${m.emoji}</td></tr>
    <tr><td>embeds${cz.link ? ", 1 link" : ""}</td><td>${cz.atts.length + (cz.link ? 1 : 0)} of ${MAX_EMBEDS}</td></tr>`;

  const st = draftState(), saved = findDraft(S.draftId);
  $("#title").textContent = saved ? "draft" : "new cast";
  $("#saved").textContent = st === "saved" ? `draft saved ${since(saved.at)}` : st === "changed" ? "changes not saved" : st === "new" ? "not saved" : "";
  $("#saved").classList.toggle("unsaved", st === "new" || st === "changed");
  $("#save .k-lbl").textContent = st === "changed" ? "save changes" : "save draft";
  const noSave = m.busy ? "Wait for images to upload." : !t.trim() && !ready.length ? "Write something first." : st === "saved" ? "Already saved." : "";
  $("#save").setAttribute("aria-disabled", String(Boolean(noSave)));
  $("#save").title = noSave;
  const noClear = !touched() ? "Nothing to clear." : "";
  $("#clear").setAttribute("aria-disabled", String(Boolean(noClear)));
  $("#clear").title = noClear;
  renderDrafts();
  keepWorkingCopy();
}

// Keep the working copy on this computer, so a reload or a crash loses nothing.
let saveT;
function keepWorkingCopy() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const now = snapshot();
    if (!now.text && !now.atts.length && !S.draftId) return store.del(DRAFT);
    store.set(DRAFT, { ...now, id: S.draftId });
  }, 300);
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

// ------------------------------------------------------------------ drafts
// Saved drafts live in this browser, one list per account. A draft keeps what
// the working copy keeps: text, images on this node, the people mentioned, the
// link cards you removed. Clear and open ask first when they'd lose words.
const UNDO_MS = 6000;
const draftsKey = () => (S.me ? `fameboy-drafts-${S.me.fid}` : null);
function drafts() {
  const k = draftsKey(), list = k && store.get(k);
  return Array.isArray(list) ? list : [];
}
const putDrafts = (list) => store.set(draftsKey(), list);
const findDraft = (id) => (id ? drafts().find((d) => d.id === id) ?? null : null);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const since = (iso) => { const a = kit.ago(iso); return a === "now" ? "just now" : `${a} ago`; };

const snapshot = () => cz.snapshot();
// What a cast would send: its words, its images, the link cards it drops.
const sig = (d) => JSON.stringify([d.text ?? "", (d.atts ?? []).map((a) => a.url), [...(d.dismissed ?? [])].sort()]);
const uploading = () => cz.state().busy;
const isEmpty = () => !ta.value.trim() && !cz.atts.some((a) => !a.error);
const touched = () => ta.value !== "" || cz.atts.length > 0 || S.draftId !== null;

// empty · new (words, not saved) · saved (matches its draft) · changed
function draftState() {
  const d = findDraft(S.draftId);
  if (!d) return isEmpty() ? "empty" : "new";
  return !uploading() && sig(d) === sig(snapshot()) ? "saved" : "changed";
}

// Put a draft (or a working copy) in the composer. id: the saved draft it is.
function load(d, id = null) {
  S.draftId = id;
  cz.load(d);
}
const reset = () => load({});

function saveAsDraft(quiet = false) {
  if (uploading()) { toast("Wait for images to upload."); return false; }
  if (isEmpty()) { toast("Write something first."); return false; }
  if (draftState() === "saved") { if (!quiet) toast("Already saved."); return true; }
  const list = drafts(), old = list.find((d) => d.id === S.draftId);
  const d = { id: old?.id ?? newId(), ...snapshot(), at: new Date().toISOString() };
  if (old) list[list.indexOf(old)] = d; else list.unshift(d);
  putDrafts(list);
  if (!findDraft(d.id)) { toast("Couldn't save. This browser's storage is off or full.", 3500); return false; }
  S.draftId = d.id;
  if (old) release(old.atts.map((a) => a.name)); // images this version dropped
  sfx.add(); paint();
  if (!quiet) toast(old ? "Draft updated." : "Saved as a draft.");
  return true;
}

// Images an undo could bring back stay on the node until the undo is gone.
function undoable(msg, names, run) {
  const now = Date.now();
  S.held = S.held.filter((h) => h.until > now);
  S.held.push({ names, until: now + UNDO_MS });
  setTimeout(() => release(names), UNDO_MS + 200);
  toast(msg, UNDO_MS, { label: "undo", run });
}

// Before clear or open drops unsaved words: ask. Resolves "clean" (nothing to
// lose), "save" (saved it), "discard", or null (keep writing).
async function guard(kind) {
  const st = draftState();
  if ((st !== "new" && st !== "changed") || isEmpty()) return "clean";
  const ch = await ask(kind, st);
  if (ch === "save" && !saveAsDraft(true)) return null;
  return ch === "cancel" ? null : ch;
}

async function clearAll() {
  if (!touched()) return toast("Nothing to clear.");
  if (uploading()) return toast("Wait for images to upload.");
  const kept = draftState() === "saved";
  const r = await guard("clear");
  if (!r) return ta.focus();
  const before = { ...snapshot(), id: S.draftId };
  reset(); ta.focus(); sfx.step();
  if (r === "save") toast("Saved as a draft. Cleared.");
  else if (kept) toast("Cleared. The draft stays saved.");
  else undoable("Cleared.", before.atts.map((a) => a.name), () => {
    if (!isEmpty()) return toast("You've started writing. Can't undo.");
    load(before, findDraft(before.id) ? before.id : null); ta.focus();
  });
}

async function openDraft(id) {
  if (id === S.draftId) return ta.focus();
  if (uploading()) return toast("Wait for images to upload.");
  const r = await guard("open");
  if (!r) return ta.focus();
  const d = findDraft(id);
  if (!d) return toast("That draft is gone.");
  const before = { ...snapshot(), id: S.draftId };
  load(d, d.id); ta.focus(); sfx.pick();
  if (r === "save") toast("Saved. Opened the other draft.");
  else if (r === "discard") undoable("Opened without saving.", before.atts.map((a) => a.name), () => {
    if (S.draftId !== d.id || draftState() !== "saved") return toast("You've changed it since. Can't undo.");
    load(before, findDraft(before.id) ? before.id : null); ta.focus();
  });
}

function deleteDraft(id) {
  const list = drafts(), i = list.findIndex((d) => d.id === id);
  if (i < 0) return;
  const [d] = list.splice(i, 1);
  putDrafts(list); paint();
  undoable("Draft deleted.", d.atts.map((a) => a.name), () => {
    const now = drafts();
    if (!now.some((x) => x.id === d.id)) { now.splice(Math.min(i, now.length), 0, d); putDrafts(now); }
    paint();
  });
}

// The question takes over the modes bar: save first, drop it, or go back.
function ask(kind, st) {
  const changed = st === "changed", bar = $(".bar"), box = $("#ask");
  box.innerHTML = `<span class="q">${changed ? "Your changes aren't saved yet." : "This cast isn't saved as a draft."}</span>` +
    kit.button(`${changed ? "save changes" : "save draft"}, then ${kind}`, { size: "lg", look: "primary", key: "↵", attrs: 'data-ch="save"' }) +
    kit.button(kind === "clear" ? "clear anyway" : "open without saving", { size: "lg", attrs: 'data-ch="discard"' }) +
    kit.button("keep writing", { size: "lg", look: "quiet", key: "esc", attrs: 'data-ch="cancel"' });
  S.asking = true; cz.setReadOnly(true); bar.classList.add("asking"); sfx.over();
  const btns = [...box.querySelectorAll("[data-ch]")];
  btns[0].focus();
  return new Promise((res) => {
    const done = (ch) => {
      removeEventListener("keydown", key, true); box.onclick = null;
      bar.classList.remove("asking"); box.innerHTML = ""; S.asking = false; cz.setReadOnly(false);
      res(ch);
    };
    const key = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done("cancel"); }
      else if (e.key === "Tab") { e.preventDefault(); const i = Math.max(0, btns.indexOf(document.activeElement)); btns[(i + (e.shiftKey ? btns.length - 1 : 1)) % btns.length].focus(); }
    };
    addEventListener("keydown", key, true);
    box.onclick = (e) => { const b = e.target.closest("[data-ch]"); if (b) done(b.dataset.ch); };
  });
}

// Each draft drawn the way its cast would look.
let draftsHTML = "";
function renderDrafts() {
  const list = drafts().sort((a, b) => Date.parse(b.at) - Date.parse(a.at)), st = draftState(), me = S.me ?? {};
  const av = me.pfp ? `<img class="av" src="${esc(me.pfp)}" alt="" referrerpolicy="no-referrer">` : `<span class="av"></span>`;
  const who = `<b>${esc(me.display ?? me.username ?? "you")}</b> <span>draft</span>`;
  const html = list.length
    ? list.map((d) => {
        const on = d.id === S.draftId, known = new Set((d.mentions ?? []).map((p) => p.username?.toLowerCase()));
        const text = esc(d.text ?? "").replace(MENTION, (m, pre, u) => (known.has(u.toLowerCase()) ? `${pre}<span class="m">@${u}</span>` : m));
        return `<article class="dcard${on ? " cur" : ""}">
          <div class="cast">${av}<div><div class="who">${who}</div><div class="text">${text || '<span class="dim">(images only)</span>'}</div><div class="pics">${(d.atts ?? []).map((a) => `<img src="${esc(a.url)}" alt="">`).join("")}</div></div></div>
          <div class="acts"><span class="meta">${on ? `<span class="tag">${st === "changed" ? "editing *" : "editing"}</span>` : ""}saved ${since(d.at)}</span>${on ? "" : kit.button("open", { attrs: `data-open="${esc(d.id)}"` })}<button class="del" type="button" data-del="${esc(d.id)}" aria-label="Delete this draft" title="Delete">x</button></div>
        </article>`;
      }).join("")
    : `<p class="dim">No drafts yet. ⌘S saves what you're writing.</p>`;
  if (html !== draftsHTML) $("#drafts").innerHTML = draftsHTML = html;
}
$("#drafts").addEventListener("click", (e) => {
  if (S.asking) return;
  const o = e.target.closest("[data-open]");
  if (o) return openDraft(o.dataset.open);
  const x = e.target.closest("[data-del]");
  if (x) deleteDraft(x.dataset.del);
});
$("#save").addEventListener("click", () => {
  if (S.asking) return;
  if ($("#save").getAttribute("aria-disabled") === "true") return toast($("#save").title);
  saveAsDraft();
});
$("#clear").addEventListener("click", () => { if (!S.asking) clearAll(); });

// ------------------------------------------------------------------ cast
const STEPS = ["Sign it with your app key", "Send it to this node", "Wait for it to land"];
function drawSteps(at) {
  return `<ul class="steps">${STEPS.map((s, i) => `<li class="${i <= at ? "" : "todo"}"><span class="mk">${i < at ? "■" : i === at ? '<span class="blink">▶</span>' : "□"}</span><span>${s}</span></li>`).join("")}</ul>`;
}
async function cast() {
  if (S.asking) return;
  if ($("#cast").getAttribute("aria-disabled") === "true") { sfx.over(); toast($("#cast").title); return; }
  const ov = $("#overlay");
  ov.classList.add("open");
  // The title says what's happening; once it's over, it names the cast and
  // the right side says how it went.
  $("#ov-l").textContent = "casting";
  $("#ov-r").textContent = "";
  let at = 0;
  $("#ov").innerHTML = drawSteps(at);
  // The steps happen inside one request; move the checklist along while it runs.
  const tick = setInterval(() => { if (at < 2) { at++; sfx.step(); $("#ov").innerHTML = drawSteps(at); } }, 700);
  let r;
  try {
    r = await api("/api/cast", { text: ta.value, embeds: cz.embeds() });
  } catch (e) {
    clearInterval(tick); sfx.over();
    $("#ov-l").textContent = "cast";
    $("#ov-r").textContent = "didn't send";
    $("#ov").innerHTML = `<div class="err"><p>${esc(e.message)}</p></div><div class="row">${kit.button("back", { size: "lg", key: "esc", attrs: 'id="ov-back"' })}</div>`;
    $("#ov-back").addEventListener("click", () => ov.classList.remove("open"));
    return;
  }
  clearInterval(tick);
  // fameboy's own cast page. Only once it's landed: until this node has the
  // cast, that page couldn't find it.
  const link = r.landed ? kit.castUrl({ username: S.me.username, fid: S.me.fid, hash: r.hash }) : null;
  $("#ov-l").textContent = "cast";
  $("#ov-r").textContent = r.landed ? "landed" : "sent";
  if (r.landed) sfx.win();
  $("#ov").innerHTML = `<p class="count" style="margin:6px 0 10px">${r.landed ? "cast!" : "sent"}</p>
    <p>${r.landed ? "Your cast is on Farcaster." : "This node hasn't seen it yet."}</p>
    <p class="dim">${r.landed ? "Every node has it now." : "It usually lands within a minute."}</p>
    <div class="row">${kit.button("write another", { size: "lg", look: "primary", key: "A", attrs: 'id="again"' })}${link ? `<a class="k-btn lg" href="${esc(link)}">see it</a>` : ""}<a class="k-btn lg" href="/">home</a></div>`;
  // The images now belong to a cast, so clearing keeps them. A draft that
  // was cast is done: it leaves the drafts.
  if (S.draftId) putDrafts(drafts().filter((d) => d.id !== S.draftId));
  reset(); store.del(DRAFT);
  $("#again").addEventListener("click", () => { ov.classList.remove("open"); ta.focus(); });
}
$("#cast").addEventListener("click", cast);

// ------------------------------------------------------------------ keys
addEventListener("keydown", (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === "s") e.preventDefault(); // never the browser's save dialog
  if (S.asking) return; // the question in the modes bar has the keys
  if (mod && e.key.toLowerCase() === "s") { if (!$("#overlay").classList.contains("open")) saveAsDraft(); return; }
  if (mod && e.shiftKey && e.key === "Backspace") { e.preventDefault(); if (!$("#overlay").classList.contains("open")) clearAll(); return; }
  if (mod && e.key === "Enter") { e.preventDefault(); if (!$("#overlay").classList.contains("open")) cast(); return; }
  if (mod && e.key.toLowerCase() === "i") { e.preventDefault(); cz.pickImage(); return; }
  if (e.key === "Escape") {
    if ($("#overlay").classList.contains("open")) { $("#overlay").classList.remove("open"); return; }
    if (!cz.menuOpen()) location.href = "/";
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
  if (d) load(d, findDraft(d.id) ? d.id : null);
  // Another tab saved or deleted a draft: show it here too.
  addEventListener("storage", (e) => { if (e.key === draftsKey()) paint(); });
  paint();
  ta.focus();
})();
