// fameboy's composer: the box you write a cast in. The post page and the
// quote cast window (kit.quoteCast) both use it, so they write casts the same
// way: a byte counter, @-mentions looked up as you type, images (pick, paste
// or drop; they upload to your own node), and a card for the first link,
// which you can remove and bring back.
//
// The counter counts bytes, the way Farcaster does: mentions are cut out of
// the text before it's sent, so they're free.
//
// Load it after kit.js (and mine.js, which uploads need):
//   <link rel="stylesheet" href="/composer.css"> <script src="/composer.js"></script>
//
// composer.create(root, opts) draws the composer into root and returns it.
//   opts.placeholder   the empty box's words
//   opts.label         what screen readers call the box
//   opts.tools         where the toolbar goes (default: the end of root)
//   opts.drop          where images can be dropped (default: root)
//   opts.reserved      embeds something else takes (a quote takes one).
//                      A cast holds two embeds at most.
//   opts.allowEmpty    a cast with no words or images can go (a quote can)
//   opts.keeps(name)   true if an image is still used elsewhere (say, by a
//                      saved draft), so removing it here keeps it on the node
//   opts.onChange()    runs after every change
//   opts.onUsage(u)    runs when your image space on the node changes
// It returns:
//   text, atts, link, verified, dismissed     what's in it now
//   state()       { bytes, mentions, emoji, letters, over, empty, busy, block }:
//                 block says why it can't be cast yet ("" when it can)
//   embeds()      the URLs a cast sends: images, then the link card's link
//   snapshot()    what a draft keeps; load(snapshot) puts one back
//   focus(), pickImage(), menuOpen(), setReadOnly(on)
//   release(names)  give images' space back, unless something uses them
//   discard()     drop it unsent: frees its images' space
// composer.card(link, mini) draws a link card (the post page's preview uses it).

(() => {
  const { esc, api, tone, toast } = kit;
  const LIMIT = 320, MAX_EMBEDS = 2, MB = 1024 * 1024;
  const enc = new TextEncoder();
  // A name can hold dots (vitalik.eth) but never ends in one, so "@alice." is @alice.
  const MENTION = /(^|\s)@([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*)/gi;
  const LINK = /https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]/gi;
  const STAGES = ["reaching", "reading", "loading image"];

  const sfx = {
    move: () => tone(880, 0, 0.025, 0.02),
    pick: () => { tone(660, 0, 0.04); tone(990, 0.04, 0.05); },
    add: () => tone(523, 0, 0.05),
    over: () => tone(165, 0, 0.12, 0.04),
  };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
  const newId = () => Math.random().toString(36).slice(2);

  // ------------------------------------------------------------------ bytes
  function measure(text, verified) {
    let mentions = 0;
    const sent = text.replace(MENTION, (m, pre, u) => (verified.has(u.toLowerCase()) ? (mentions++, pre) : m));
    return {
      bytes: enc.encode(sent).length,
      mentions,
      emoji: [...text].filter((ch) => enc.encode(ch).length >= 3).length, // most emoji are 4 bytes, some 3
      letters: [...text].length,
    };
  }

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

  // progress(0-9) as it goes. Resolves { url, name, size, usage }.
  async function upload(blob, progress) {
    // Uploading needs a presence heartbeat, which names this browser.
    const device = await mine.device((await kit.me())?.fid);
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", "/api/images");
      x.setRequestHeader("x-fameboy-token", kit.TOKEN);
      x.setRequestHeader("x-fameboy-device", device.id);
      x.setRequestHeader("x-fameboy-status", device.status);
      x.setRequestHeader("content-type", "application/octet-stream");
      x.upload.onprogress = (e) => { if (e.lengthComputable) progress(Math.min(9, Math.floor((e.loaded / e.total) * 10))); };
      x.onload = () => {
        let json = {};
        try { json = JSON.parse(x.responseText); } catch {}
        if (x.status !== 200) return reject(new Error(json.error ?? `upload failed (${x.status})`));
        // Hosted: the upload waits for this browser to sign it (mine.js).
        json.sign ? mine.key.answer(json).then((j) => resolve(j.data), reject) : resolve(json.data);
      };
      x.onerror = () => reject(new Error("upload failed: is fameboy still running?"));
      x.send(blob);
    });
  }

  // Your image space on this node, asked once per page and kept up to date.
  let usage = null, usageP = null;
  const loadUsage = () => (usageP ??= api("/api/images/usage").then((u) => (usage = u)));

  // ------------------------------------------------------------------ link cards
  // The first link in the text gets a card, like other Farcaster apps show, and
  // rides along as an embed so they show it too. Cards come from the page's
  // Open Graph tags (https://ogp.me), with X's twitter: tags as a fallback.
  // Three steps you can watch: reach the site, read its preview tags, load its
  // image. (A page's size isn't known ahead, so the steps are what's
  // measurable, not bytes.)
  function card(l, mini = false) {
    const c = l.card ?? {}, host = hostOf(l.url);
    const loading = l.stage < 3;
    const bar = loading ? `<div class="lbar" title="${STAGES[l.stage - 1]} ${esc(host)}">${[1, 2, 3].map((i) => `<i class="${i < l.stage ? "on" : i === l.stage ? "now" : ""}"></i>`).join("")}</div>` : "";
    const img = c.image && l.stage === 3 ? `<img class="limg" src="${esc(c.image)}" alt="" referrerpolicy="no-referrer">` : c.image ? `<div class="limg wait"></div>` : "";
    const none = `No ${kit.ext("https://ogp.me", "OG", { title: "Open Graph, the tags pages use for link cards" })} metadata found.`;
    const text = l.error
      ? `<div class="lsite">${esc(host)}</div><div class="ldesc">${none}</div>`
      : c.title || c.description
        ? `<div class="lsite">${esc(c.site ?? host)}</div>${c.title ? `<div class="ltitle">${esc(c.title)}</div>` : ""}${c.description && !mini ? `<div class="ldesc">${esc(c.description)}</div>` : ""}`
        : `<div class="lsite">${esc(host)}</div><div class="ldesc">${loading ? `${STAGES[l.stage - 1]}…` : none}</div>`;
    return `<div class="lcard${mini ? " mini" : ""}">${img}${bar}<div class="lmeta">${text}</div>${mini ? "" : `<button class="x" type="button" data-cz-link-x aria-label="Remove the link card">x</button>`}</div>`;
  }

  // ------------------------------------------------------------------ one composer
  function create(root, o = {}) {
    const reserved = o.reserved ?? 0, free = MAX_EMBEDS - reserved;
    root.classList.add("cz");
    root.innerHTML = `<div class="cz-editor">
        <textarea class="cz-text" placeholder="${esc(o.placeholder ?? "")}" spellcheck="true" aria-label="${esc(o.label ?? "Cast text")}"></textarea>
        <div class="cz-mirror" aria-hidden="true"></div>
        <div class="cz-menu" role="listbox" aria-label="Mention someone"></div>
      </div>
      <div class="cz-atts"></div>
      <div class="cz-link"></div>
      <input type="file" class="cz-file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>`;
    const tools = o.tools ?? root.appendChild(document.createElement("div"));
    tools.classList.add("cz-tools");
    tools.insertAdjacentHTML("afterbegin", `<button class="k-btn" type="button" data-cz-image>+ image <kbd>⌘I</kbd></button>
      <button class="k-btn" type="button" data-cz-at>@ mention</button>
      <span class="dim small cz-slots"></span>
      <span class="cz-counter" title="Farcaster counts bytes, not letters"><span class="cz-cells"></span><span class="cz-left">${LIMIT}</span></span>`);
    const q = (s) => root.querySelector(s) ?? tools.querySelector(s);
    const ta = q(".cz-text"), mirror = q(".cz-mirror"), menuEl = q(".cz-menu"), attsEl = q(".cz-atts"), linkEl = q(".cz-link"), file = q(".cz-file");
    const addImage = q("[data-cz-image]"), cells = q(".cz-cells"), left = q(".cz-left"), slotsEl = q(".cz-slots");
    const S = {
      atts: [], // { id, preview, name?, url?, size, progress (0-10), error? }
      link: null, // the first link in the text: { url, stage (1 reach, 2 read, 3 image), card?, error? }
      dismissed: new Set(), // links whose card you removed: they stay text only
      verified: new Map(), // username -> profile; these mentions are free
      menu: { open: false, items: [], sel: 0, start: 0, q: "" },
    };
    const used = () => S.atts.length + (S.link ? 1 : 0);

    function state() {
      const m = measure(ta.value, S.verified), over = m.bytes > LIMIT;
      const busy = S.atts.some((a) => !a.url && !a.error);
      const empty = !ta.value.trim() && !S.atts.some((a) => a.url);
      const block = over ? "Cut some words first." : empty && !o.allowEmpty ? "Write something first." : busy ? "Wait for images to upload." : "";
      return { ...m, over, empty, busy, block };
    }

    function paint() {
      const st = state(), l = LIMIT - st.bytes;
      const on = Math.min(32, Math.ceil((st.bytes / LIMIT) * 32));
      cells.className = "cz-cells" + (st.over ? " over" : "");
      cells.innerHTML = Array.from({ length: 32 }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("");
      left.className = "cz-left" + (st.over ? " over" : "");
      left.textContent = st.over ? `${-l} over` : `${l}`;
      left.title = st.over ? "Cut some words to cast." : `${l} bytes left`;
      slotsEl.textContent = `${used() + reserved} of ${MAX_EMBEDS} embeds${reserved ? ", with the quote" : ""}`;
      addImage.setAttribute("aria-disabled", String(used() >= free || Boolean(usage && !usage.hosting)));
      o.onChange?.();
    }

    // -------------------------------------------------------------- @ menu
    function caretXY() {
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
      const qy = m[2].toLowerCase(), start = ta.selectionStart - m[2].length - 1;
      const run = ++lookup;
      let res;
      try { res = await api(`/api/mentions?q=${encodeURIComponent(qy)}`); } catch { return closeMenu(); }
      if (run !== lookup) return;
      const items = res.people;
      S.menu = { open: true, items, sel: qy === S.menu.q ? Math.min(S.menu.sel, Math.max(0, items.length - 1)) : 0, start, q: qy };
      drawMenu(res);
      // Profiles of the people you follow are still arriving: ask again shortly.
      if (res.loading) setTimeout(() => { if (S.menu.open && run === lookup) updateMenu(); }, 800);
    }
    function drawMenu(res) {
      const { items, sel, q: qy } = S.menu;
      const { x, y } = caretXY();
      menuEl.style.left = Math.max(0, Math.min(x, ta.offsetWidth - 300)) + "px";
      menuEl.style.top = y + 6 + "px";
      menuEl.classList.add("open");
      const foot = res?.loading ? "Loading people you follow…" : qy.length > 1 && !items.some((p) => p.username === qy) ? "Type the full name for anyone else." : "↑↓ choose · ↵ or tab to add";
      menuEl.innerHTML = `<div class="hd">mention</div>` +
        (items.length
          ? items.map((p, i) => `<button type="button" role="option" aria-selected="${i === sel}" data-i="${i}">${p.pfp ? `<img class="av" src="${esc(p.pfp)}" alt="" referrerpolicy="no-referrer">` : `<span class="av"></span>`}<span class="nm"><b>@${esc(p.username)}</b> <span>${esc(p.display ?? "")}</span></span><span class="rel">${esc(p.relation)}</span></button>`).join("")
          : `<div class="ft">${qy ? "No one you follow matches." : "Start typing a name."}</div>`) +
        `<div class="ft">${foot}</div>`;
      menuEl.querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); S.menu.sel = +b.dataset.i; pick(); }));
    }
    function closeMenu() { lookup++; S.menu.open = false; menuEl.classList.remove("open"); }
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

    // -------------------------------------------------------------- images
    async function addFiles(files) {
      for (const f of files) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) { toast("Only PNG, JPEG, GIF or WebP."); continue; }
        if (used() >= free) {
          sfx.over();
          toast(reserved ? (S.link ? "Two embeds max, and the quote is one. Remove the link card first." : "Two embeds max, and the quote is one. Remove the image first.")
            : S.link ? "Two embeds max. Remove the link card or an image." : "Two embeds max. Remove one first.");
          break;
        }
        if (usage && !usage.hosting) { toast("This node doesn't host images yet."); break; }
        const att = { id: newId(), preview: URL.createObjectURL(f), size: f.size, progress: 0 };
        S.atts.push(att); sfx.add(); renderAtts(); renderLink(); paint();
        try {
          const blob = await shrink(f);
          att.size = blob.size;
          if (usage && blob.size > usage.fileCap) throw new Error(`Images max out at ${usage.fileCap / MB} MB.`);
          const r = await upload(blob, (p) => { att.progress = p; renderAtts(); });
          Object.assign(att, { url: r.url, name: r.name, size: r.size, progress: 10 });
          usage = { ...usage, ...r.usage, hosting: true };
          o.onUsage?.(usage);
          // Removed while it uploaded: nothing will use it, so give its space back.
          if (!S.atts.includes(att)) { release([r.name]); continue; }
        } catch (e) {
          att.error = e.message;
          sfx.over();
          toast(e.message, 3500);
        }
        renderAtts(); paint();
      }
    }
    function removeAtt(id) {
      const i = S.atts.findIndex((a) => a.id === id);
      if (i < 0) return;
      const [a] = S.atts.splice(i, 1);
      renderAtts(); paint(); findLink(); // a free slot can bring the link card back
      // Not cast yet: give its space back, unless something else uses it.
      if (a.name) release([a.name]);
    }
    // Delete images from this node that nothing uses any more.
    function release(names) {
      for (const name of new Set(names)) {
        if (!name || S.atts.some((a) => a.name === name) || o.keeps?.(name)) continue;
        api("/api/images/delete", { name }).then((r) => { usage = { ...usage, ...r.usage }; o.onUsage?.(usage); }, () => {});
      }
    }
    function renderAtts() {
      attsEl.innerHTML = S.atts.map((a) => {
        const status = a.error ? "failed" : a.url ? "on this node" : "uploading";
        const bar = !a.url && !a.error ? `<div class="up">${Array.from({ length: 10 }, (_, j) => `<i class="${j < a.progress ? "on" : ""}"></i>`).join("")}</div>` : "";
        return `<div class="att${a.error ? " failed" : ""}" title="${esc(a.error ?? "")}"><img src="${esc(a.url ?? a.preview)}" alt=""><div class="meta"><span>${status}</span><span>${Math.max(1, Math.round(a.size / 1024))} KB</span></div>${bar}<button class="x" type="button" data-cz-att-x="${a.id}" aria-label="Remove image">x</button></div>`;
      }).join("");
    }
    const pickImage = () => { if (addImage.getAttribute("aria-disabled") !== "true") file.click(); };

    // -------------------------------------------------------------- link card
    let linkT, linkRun = 0;
    const links = () => [...ta.value.matchAll(LINK)].map((m) => m[0]);
    function scheduleLink() { clearTimeout(linkT); linkT = setTimeout(findLink, 600); }
    function findLink() {
      const url = links().find((u) => !S.dismissed.has(u) && !S.atts.some((a) => a.url === u));
      if (!url) { if (S.link) { S.link = null; paint(); } renderLink(); return; }
      if (S.link?.url === url) return;
      if (S.atts.length >= free) { S.link = null; renderLink(); paint(); return; } // no slot: it stays text
      startLink(url);
    }
    async function startLink(url) {
      const run = ++linkRun;
      S.link = { url, stage: 1 };
      renderLink(); paint();
      let c;
      try { c = await api(`/api/unfurl?url=${encodeURIComponent(url)}`); }
      catch (e) { if (run === linkRun) { S.link = { url, stage: 3, error: e.message }; renderLink(); paint(); } return; }
      if (run !== linkRun) return;
      S.link = { url, stage: 2, card: c };
      sfx.add(); renderLink(); paint();
      if (!c.image) { S.link.stage = 3; renderLink(); return; }
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => { if (run === linkRun) { S.link.stage = 3; renderLink(); paint(); } };
      img.onerror = () => { if (run === linkRun) { S.link.card = { ...c, image: undefined }; S.link.stage = 3; renderLink(); paint(); } };
      img.src = c.image;
    }
    function renderLink() {
      // A removed card can come back while its link is still in the text.
      const back = !S.link && S.atts.length < free ? links().find((u) => S.dismissed.has(u)) : null;
      linkEl.innerHTML = S.link ? card(S.link) : back ? kit.button(`+ card for ${esc(hostOf(back))}`, { attrs: `data-cz-link-back="${esc(back)}"` }) : "";
    }
    function dismissLink() {
      S.dismissed.add(S.link.url); S.link = null; linkRun++;
      renderLink(); paint(); toast("Card removed. The link stays as text.");
      findLink();
    }

    // -------------------------------------------------------------- wiring
    ta.addEventListener("input", () => { paint(); updateMenu(); checkTypedMentions(); scheduleLink(); });
    ta.addEventListener("click", updateMenu);
    ta.addEventListener("blur", () => setTimeout(closeMenu, 150));
    ta.addEventListener("keydown", (e) => {
      const mn = S.menu;
      if (mn.open && mn.items.length) {
        if (e.key === "ArrowDown") { mn.sel = (mn.sel + 1) % mn.items.length; sfx.move(); drawMenu(); e.preventDefault(); return; }
        if (e.key === "ArrowUp") { mn.sel = (mn.sel + mn.items.length - 1) % mn.items.length; sfx.move(); drawMenu(); e.preventDefault(); return; }
        if ((e.key === "Enter" && !e.metaKey && !e.ctrlKey) || e.key === "Tab") { pick(); e.preventDefault(); return; }
      }
      if (mn.open && e.key === "Escape") { closeMenu(); e.preventDefault(); e.stopPropagation(); }
    });
    ta.addEventListener("paste", (e) => { const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/")); if (files.length) { e.preventDefault(); addFiles(files); } });
    file.addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
    const drop = o.drop ?? root;
    drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("cz-drop"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("cz-drop"));
    drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("cz-drop"); addFiles([...e.dataTransfer.files]); });
    const onClick = (e) => {
      const t = e.target;
      if (t.closest("[data-cz-image]")) return pickImage();
      if (t.closest("[data-cz-at]")) {
        const p = ta.selectionStart, v = ta.value, pad = p && !/\s$/.test(v.slice(0, p)) ? " " : "";
        ta.value = v.slice(0, p) + pad + "@" + v.slice(p);
        ta.focus();
        ta.setSelectionRange(p + pad.length + 1, p + pad.length + 1);
        paint(); updateMenu();
        return;
      }
      const x = t.closest("[data-cz-att-x]");
      if (x) return removeAtt(x.dataset.czAttX);
      if (t.closest("[data-cz-link-x]")) return dismissLink();
      const back = t.closest("[data-cz-link-back]");
      if (back) { S.dismissed.delete(back.dataset.czLinkBack); sfx.add(); paint(); findLink(); }
    };
    root.addEventListener("click", onClick);
    if (!root.contains(tools)) tools.addEventListener("click", onClick);

    // -------------------------------------------------------------- drafts
    const snapshot = () => ({
      text: ta.value,
      atts: S.atts.filter((a) => a.url).map(({ url, name, size }) => ({ url, name, size })),
      mentions: [...S.verified.values()],
      dismissed: [...S.dismissed],
    });
    function load(d) {
      ta.value = d.text ?? "";
      S.verified.clear();
      for (const p of d.mentions ?? []) if (p.username) S.verified.set(p.username.toLowerCase(), p);
      S.atts = (d.atts ?? []).map((a) => ({ id: newId(), url: a.url, name: a.name, size: a.size, progress: 10 }));
      S.dismissed.clear();
      for (const u of d.dismissed ?? []) S.dismissed.add(u);
      S.link = null; linkRun++;
      closeMenu(); renderAtts(); renderLink(); findLink(); paint();
    }

    loadUsage().then(() => { o.onUsage?.(usage); paint(); }, (e) => o.onUsage?.(null, e));
    api("/api/mentions?q=").catch(() => {}); // start loading the people you follow
    paint();

    return {
      ta,
      get text() { return ta.value; },
      get atts() { return S.atts; },
      get link() { return S.link; },
      get verified() { return S.verified; },
      get dismissed() { return S.dismissed; },
      state,
      embeds: () => [...S.atts.filter((a) => a.url).map((a) => a.url), ...(S.link ? [S.link.url] : [])].slice(0, free),
      snapshot,
      load,
      focus: () => ta.focus(),
      pickImage,
      menuOpen: () => S.menu.open,
      setReadOnly: (on) => { ta.readOnly = on; if (on) closeMenu(); },
      release,
      discard: () => { const names = S.atts.map((a) => a.name); S.atts = []; release(names); },
    };
  }

  window.composer = { create, card, measure, MENTION, LIMIT, MAX_EMBEDS };
})();
