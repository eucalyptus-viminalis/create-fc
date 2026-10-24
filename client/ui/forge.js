// fameboy link forge: a small tool with one job. Drop a Farcaster cast link
// on the anvil, the hammer strikes it three times, and out comes the same
// cast's address on fameboy (the demo copy at demo.createfc.org), ready to
// copy. fameboy's cast pages use farcaster.xyz's path, /<username>/<hash>,
// so forging is really swapping the domain; the anvil makes it more fun.
// While the hammer works, your node looks the cast up, which checks it
// exists and gets its full hash, so the link opens with one lookup.

const { $, esc, api, tone, toast } = kit;

const DEMO = "https://demo.createfc.org";
const HASH = /^0x[0-9a-f]{8,40}$/i;
// Hosts whose cast links are /<username>/<hash>. sslip.io: a hosted fameboy.
const FARCASTER = ["farcaster.xyz", "warpcast.com"];
const FAMEBOY = ["demo.createfc.org", location.hostname];
const COUNT_KEY = "fameboy-forged";
const still = matchMedia("(prefers-reduced-motion: reduce)").matches;

const sfx = {
  clank: (n) => { tone(1568 - n * 120, 0, 0.05, { vol: 0.05, to: 700 }); tone(196, 0, 0.09, 0.04); },
  ding: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.07, 0.12, 0.035)),
  bonk: () => tone(220, 0, 0.18, { vol: 0.05, to: 90 }),
  tick: () => tone(660, 0, 0.03),
  blip: () => tone(988, 0, 0.04, 0.025),
};

const S = { found: null, busy: false, url: "", run: 0 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ recognise
// What's in the slot? { who, hash, from } for a cast link, else { why }.
function read(raw) {
  const s = raw.trim();
  if (!s) return null;
  // "kenny/0xd0c4ec07" or "@kenny 0xd0c4ec07", without a domain
  const bare = s.match(/^@?([a-z0-9][a-z0-9.-]*|![0-9]+)[/\s]+(0x[0-9a-f]+)\/?$/i);
  if (bare && HASH.test(bare[2])) return { who: bare[1], hash: bare[2].toLowerCase(), from: "a name and a hash" };
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`); } catch { return { why: "That's not a link." }; }
  const host = u.hostname.replace(/^www\./, "").toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (!host.includes(".") && host !== "localhost") return { why: "That's not a link." };
  const known = FARCASTER.includes(host) || FAMEBOY.includes(host) || host.endsWith(".sslip.io");
  if (host === "firefly.social" || host === "firefly.xyz") return { why: "Firefly links don't say who posted. Copy the cast's link from farcaster.xyz." };
  if (!known) return { why: `${host} isn't a Farcaster app this forge knows.` };
  if (parts[0] === "~") return { why: "This link doesn't name who posted. Open the cast and copy its own link." };
  if (parts.length < 2 || !HASH.test(parts[1])) return { why: parts.length === 1 ? `That's @${parts[0]}'s profile, not a cast.` : "No cast in this link." };
  const already = FAMEBOY.includes(host) || host.endsWith(".sslip.io");
  return { who: parts[0].replace(/^@/, ""), hash: parts[1].toLowerCase(), from: host, already };
}

const pathOf = (f) => `/${encodeURIComponent(f.who)}/${f.hash}`;

function scan() {
  const f = read($("#link").value);
  S.found = f?.hash ? f : null;
  const el = $("#scan");
  if (!f) el.innerHTML = `<span class="dim">waiting for a link<span class="blink">_</span></span>`;
  else if (f.why) el.innerHTML = `<span class="fg-tag bad">?</span> ${esc(f.why)}`;
  else el.innerHTML = `<span class="fg-tag">!</span> cast found: <b>@${esc(f.who.replace(/^!/, "fid "))}</b> · ${esc(f.hash.slice(0, 10))}${f.hash.length < 42 ? "…" : ""} <span class="dim">from ${esc(f.from)}${f.already ? ", already fameboy" : ""}</span>`;
  $("#go").setAttribute("aria-disabled", String(!S.found || S.busy));
  $("#ingot").classList.toggle("on", Boolean(S.found));
  return f;
}

// ------------------------------------------------------------------ forge
function sparks() {
  const box = $("#sparks");
  box.innerHTML = Array.from({ length: 9 }, (_, i) => {
    const a = Math.PI * (1.05 + (i / 8) * 0.9), d = 30 + Math.random() * 40;
    return `<i style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--s:${Math.random() < 0.4 ? 6 : 4}px"></i>`;
  }).join("");
  box.classList.remove("go"); void box.offsetWidth; box.classList.add("go");
}

async function strike(n) {
  const h = $("#hammer"), stage = $("#stage");
  h.classList.remove("hit"); void h.offsetWidth; h.classList.add("hit");
  await wait(110); // the swing comes down
  sfx.clank(n);
  sparks();
  stage.classList.remove("shake"); void stage.offsetWidth; stage.classList.add("shake");
  $("#ingot").dataset.heat = String(n + 1);
  await wait(190);
}

async function forge() {
  const f = scan();
  if (S.busy) return;
  if (!f?.hash) {
    sfx.bonk();
    const st = $("#stage"); st.classList.remove("miss"); void st.offsetWidth; st.classList.add("miss");
    $("#status").textContent = f ? "clunk. nothing to forge." : "the anvil's empty. paste a link.";
    return;
  }
  S.busy = true; const run = ++S.run;
  $("#go").setAttribute("aria-busy", "true");
  $("#out").hidden = true;
  // Ask the node while the hammer works; the link is ready either way.
  const lookup = api(`/api/thread?who=${encodeURIComponent(f.who)}&hash=${encodeURIComponent(f.hash)}`).then((d) => ({ d }), (e) => ({ e }));
  if (still) { $("#status").textContent = "forging…"; await wait(200); }
  else for (let n = 0; n < 3; n++) { $("#status").textContent = `${"clang! ".repeat(n + 1).trim()}`; await strike(n); }
  if (run !== S.run) return;
  S.busy = false;
  $("#go").removeAttribute("aria-busy");
  scan();
  show(f);
  sfx.ding();
  const n = (kit.store.get(COUNT_KEY) ?? 0) + 1;
  kit.store.set(COUNT_KEY, n); count();
  $("#status").textContent = "done! one fameboy link.";
  const { d, e } = await lookup;
  if (run !== S.run) return;
  if (d) {
    // The node knows its username and full hash: a better link, same cast.
    const c = d.cast, full = { who: c.author?.username ?? `!${c.fid}`, hash: c.hash };
    const snip = c.text.replace(/\s+/g, " ").trim();
    show(full, `<span class="fg-tag">✓</span> <b>@${esc(c.author?.username ?? `fid ${c.fid}`)}</b>${snip ? `: “${esc(snip.length > 90 ? `${snip.slice(0, 89)}…` : snip)}”` : ""} <span class="dim">· ↩ ${c.replies} · ♥ ${c.likes}</span>`,
      f.hash.length < 42 ? "full hash · opens fast" : "checked on your node");
  } else {
    $("#who").innerHTML = `<span class="fg-tag bad">?</span> ${esc(e.message)}. <span class="dim">The link may still work once the cast reaches the node.</span>`;
    $("#out-tag").textContent = "not checked";
  }
}

function show(f, who, tag) {
  S.url = DEMO + pathOf(f);
  $("#out").hidden = false;
  $("#url").innerHTML = `<span class="dim">${esc(DEMO.replace("https://", ""))}</span>${esc(pathOf(f))}`;
  const here = location.origin !== DEMO;
  $("#acts").innerHTML = `${kit.button("copy", { look: "primary", size: "lg", key: "c", attrs: "data-copy" })}
    ${kit.ext(S.url, "open on the demo", { cls: "k-btn lg", arrow: true })}
    ${here ? `<a class="k-btn lg quiet" href="${esc(pathOf(f))}" title="Open it on this copy of fameboy">view here</a>` : ""}`;
  $("#who").innerHTML = who ?? `<span class="dim">checking the cast on your node<span class="blink">_</span></span>`;
  $("#out-tag").textContent = tag ?? "";
  if (!still) { const o = $("#out"); o.classList.remove("pop"); void o.offsetWidth; o.classList.add("pop"); }
}

async function copy() {
  if (!S.url) return;
  try { await navigator.clipboard.writeText(S.url); sfx.blip(); toast("Copied. Paste it anywhere."); }
  catch { toast("Couldn't copy. Select the link and copy it."); }
  const b = $("[data-copy] .k-lbl");
  if (b) { b.textContent = "copied!"; setTimeout(() => (b.textContent = "copy"), 1400); }
}

async function paste() {
  try {
    const t = await navigator.clipboard.readText();
    $("#link").value = t.trim();
    sfx.tick();
    if (scan()?.hash) forge();
  } catch { toast("Your browser kept the clipboard. Paste with ⌘V."); $("#link").focus(); }
}

function clear() {
  S.run++; S.busy = false; S.url = "";
  $("#link").value = ""; $("#out").hidden = true; $("#status").textContent = "ready";
  $("#ingot").dataset.heat = "0";
  scan(); $("#link").focus();
}

const count = () => {
  const n = kit.store.get(COUNT_KEY) ?? 0;
  $("#count").innerHTML = n ? `${kit.hammer("ico")} <b>${n}</b> forged` : "";
};

// ------------------------------------------------------------------ wire
$("#hammer").innerHTML = kit.hammer("fg-hammer-px");
$("#paste-slot").outerHTML = kit.button("paste", { size: "lg", attrs: "data-paste" });
$("#go-slot").outerHTML = kit.button("forge", { size: "lg", look: "primary", key: "↵", attrs: 'id="go" type="submit" aria-disabled="true"' });
$("#form").addEventListener("submit", (e) => { e.preventDefault(); forge(); });
$("#link").addEventListener("input", () => { const had = S.found?.hash; scan(); if (S.found && S.found.hash !== had) sfx.tick(); });
// A pasted cast link forges straight away: the tool's whole job.
$("#link").addEventListener("paste", () => setTimeout(() => { if (scan()?.hash) forge(); }, 0));
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-copy]")) copy();
  else if (e.target.closest("[data-paste]")) paste();
});
addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "Escape") { e.preventDefault(); clear(); return; }
  if (e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (k === "c") copy();
  else if (k === "o" && S.url) window.open(S.url, "_blank", "noopener");
  else if (k === "enter" || k === "a") forge();
});

// ?link=… fills the slot, so another page (or a bookmarklet) can hand one over.
const given = new URLSearchParams(location.search).get("link");
if (given) $("#link").value = given;
count();
if (scan()?.hash && given) forge();
else $("#link").focus();
