// fameboy sign in. The ways shown depend on what this fameboy can do
// (GET /api/signin/options):
//   - approve on your phone: with this computer's own app account, or the
//     node's (fc-companion), which needs an invite code from the node's owner
//   - your seed phrase: on this computer, the local server signs with it; on
//     a hosted fameboy (browserPhrase), this page signs with it and the
//     server never sees it (ADR 006)
//   - a terminal, and making an account: only on your own computer
// On a hosted fameboy (browser: true) this browser makes the app key and
// keeps it (mine.key); only its public half goes to the server.
// Copy rule: active voice, max 7 words a sentence.

const { $, wait, esc, api, tone, toast } = kit;
const DOCS = "https://createfc.org/docs";


// ------------------------------------------------------------------ sound
const sfx = {
  move: () => tone(880, 0, 0.025, 0.025),
  open: () => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.04, 0.07)),
  back: () => tone(392, 0, 0.09),
  step: () => tone(783.99, 0, 0.05, 0.03),
  error: () => { tone(220, 0, 0.12, 0.04); tone(165, 0.12, 0.2, 0.04); },
  win: () => [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => tone(f, i * 0.07, 0.12, 0.04)),
};


// ------------------------------------------------------------------ pieces
const head = (sub) => `<div class="title"><h1>sign in</h1><span class="dim">${sub ?? ""}</span></div>`;
const tile = (title, right, body) => `<section class="tile"><h2><span>${title}</span><span>${right ?? ""}</span></h2><div class="body">${body}</div></section>`;
const go = (label, key, attrs = "") => kit.button(label, { size: "lg", look: "primary", key, attrs });
const copyable = (cmd) => `<div class="cmd"><code>${esc(cmd)}</code>${kit.button("copy", { attrs: `data-copy="${esc(cmd)}"` })}</div>`;
const steps = (names, at, notes = {}) =>
  `<ul class="steps">${names
    .map((s, i) => `<li class="${i < at ? "" : i === at ? "now" : "todo"}"><span class="mark">${i < at ? "■" : i === at ? '<span class="blink">▶</span>' : "□"}</span><span>${s}${notes[i] ? ` <span class="dim">· ${esc(notes[i])}</span>` : ""}</span></li>`)
    .join("")}</ul>`;
const waiting = (text) => `<p class="dim small">${text}<span class="blink">_</span></p>`;

// ------------------------------------------------------------------ state
const S = { opts: null, ways: [], sel: 0, screen: "choose", run: 0 };
let keyHandler = null; // the current screen's extra keys

function show(html, foot) {
  $("#screen").innerHTML = html;
  $("#foot").innerHTML = foot ?? `<span><kbd>B</kbd>/<kbd>esc</kbd> back</span><a class="dim" href="/">back home</a>`;
  document.querySelector("[autofocus]")?.focus();
}

// ------------------------------------------------------------------ choose
function waysFrom(o) {
  const phoneReady = Boolean(o.app) || Boolean(o.node?.phone);
  const ways = [
    {
      id: "phone",
      name: "approve on your phone",
      tag: phoneReady ? "best" : "needs setup",
      desc: phoneReady
        ? ["Scan a code with your phone.", "Approve it in the Farcaster app.", "Your seed phrase stays there."]
        : ["This node can't vouch for keys yet.", "One command turns this on."],
    },
  ];
  // Hosted: the phrase stays in this browser. Only use a copy you trust.
  if (o.browserPhrase) {
    ways.push({ id: "phrase", name: "use your seed phrase", tag: "stays in this browser", desc: ["Type your phrase on this page.", "It never leaves this browser.", "Only do this on sites you trust."] });
  }
  if (o.phrase) {
    ways.push(
      { id: "phrase", name: "use your seed phrase", tag: "stays on this computer", desc: ["Type your phrase on this page.", "Your phrase never leaves this computer.", "fameboy signs one key, then forgets it."] },
      { id: "terminal", name: "use a terminal", tag: "", desc: ["Run <code>fameboy login</code> instead.", "This page notices when you finish."] },
      { id: "new", name: "make an account", tag: "about $0.20", desc: ["No account yet? Make one.", "Run <code>fameboy new-account</code> in a terminal.", "It costs about $0.20 of ETH."] },
    );
  }
  return ways;
}

function choose() {
  S.screen = "choose"; S.run++;
  const ways = S.ways;
  const intro = `<div class="lede"><p>fameboy needs an app key.</p><p class="dim">The key posts, likes and follows. It can't move your account.</p></div>`;
  const menu = ways
    .map((w, i) => `<button class="opt"${i === S.sel ? " aria-current" : ""} data-i="${i}"><span class="cur">▶</span><span class="name">${w.name}</span>${w.tag ? `<span class="tag">${w.tag}</span>` : "<span></span>"}<span class="desc">${w.desc.map((d) => `<p>${d}</p>`).join("")}</span></button>`)
    .join("");
  const hosted = S.opts.phrase || S.opts.browserPhrase ? "" : `<p class="dim" style="margin-top:18px">Someone else runs this fameboy. So it never asks for your phrase.</p>`;
  show(
    head() + intro + `<section class="tile"><h2><span>${ways.length > 1 ? "choose a way" : "one way in"}</span><span>${ways.length > 1 ? `${ways.length} ways` : "shared fameboy"}</span></h2><div>${menu}</div></section>` + hosted,
    `<span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>A</kbd>/<kbd>↵</kbd> go</span><a class="dim" href="/">back home</a>`,
  );
  document.querySelectorAll(".opt").forEach((el) => {
    el.addEventListener("mouseenter", () => { if (S.sel !== +el.dataset.i) { S.sel = +el.dataset.i; sfx.move(); choose(); } });
    el.addEventListener("click", () => { S.sel = +el.dataset.i; open(); });
  });
  keyHandler = (k) => {
    if (k === "arrowdown" || k === "j") { S.sel = (S.sel + 1) % ways.length; sfx.move(); choose(); return true; }
    if (k === "arrowup" || k === "k") { S.sel = (S.sel + ways.length - 1) % ways.length; sfx.move(); choose(); return true; }
    if (k === "enter" || k === "a" || k === " ") { open(); return true; }
    if (k === "escape" || k === "b") { location.href = "/"; return true; }
  };
}

function open() {
  sfx.open();
  const id = S.ways[S.sel].id;
  if (id === "phone") return S.opts.app ? phoneStart() : S.opts.node?.phone ? (S.opts.node.inviteRequired ? invite() : phoneStart()) : setup();
  if (id === "phrase") return S.opts.browserPhrase && S.opts.node?.inviteRequired && !S.typedInvite ? invite(undefined, "phrase") : phrase();
  if (id === "terminal") return terminal("use a terminal", "fameboy login", ["Run this in your own terminal.", "It asks for your seed phrase there."]);
  if (id === "new") return terminal("make an account", "fameboy new-account", ["Run this in your own terminal.", "It costs about $0.20 of ETH.", "Then sign in here."]);
}

// ------------------------------------------------------------------ phone: setup / invite
function setup() {
  S.screen = "setup";
  show(
    head("approve on your phone") +
      tile("one setup step first", "this node", `
        <p>Phone approval needs an app account.</p>
        <p class="dim">It vouches for each sign-in.</p>
        <p>Run this on the node's server:</p>
        ${copyable("fc-node app-account")}
        <p class="dim">Use an account made for this. Then reload this page.</p>
        <div class="warn"><span class="bang">?</span><div><p>Not your node? Ask its owner.</p></div></div>`),
  );
  keyHandler = backKeys;
}

// then: which way asked for the code, "phone" or "phrase".
function invite(error, then = "phone") {
  S.screen = "invite";
  show(
    head(then === "phrase" ? "use your seed phrase" : "approve on your phone") +
      tile("invite code", "from a friend", `
        <p>Got a code from a friend? Pop it in.</p>
        <p class="dim">Codes keep this node for friends only. ${kit.ext(`${DOCS}/guide/share-your-node#why-codes`, "Why?")}</p>
        <form class="field" id="invite-form" autocomplete="off">
          <input id="invite-input" autofocus value="${esc(S.typedInvite ?? S.opts.node?.invite ?? "")}" placeholder="K7Q2-X9MP" spellcheck="false" aria-label="Invite code">
          ${go("next", "↵", 'type="submit"')}
        </form>
        ${error ? `<div class="err">${inviteError(error).map((l) => `<p>${esc(l)}</p>`).join("")}</div>` : ""}`),
  );
  $("#invite-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const code = $("#invite-input").value.trim();
    if (!code) return;
    S.typedInvite = code;
    then === "phrase" ? phrase() : phoneStart(code);
  });
  keyHandler = backKeys;
}

// The companion's errors, in this page's voice.
function inviteError(message) {
  if (/invite code doesn't work/.test(message)) return ["That code doesn't work here.", "Check it with this node's owner."];
  if (/too many sign-ins/.test(message)) return ["Too many tries from here.", "Wait an hour, then try again."];
  if (/no longer owns|no app account/.test(message)) return ["This node's app account needs fixing.", "Its owner can run fc-node app-account."];
  if (/can't reach/.test(message)) return ["This node's companion isn't answering.", "Try again in a minute."];
  if (/signer-request service/.test(message)) return ["Farcaster's sign-in service said no.", message];
  return [message];
}

// ------------------------------------------------------------------ phone: scan and wait
const PHONE_STEPS = ["Show the code", "Approve on your phone", "This node sees the key", "You're in"];

async function phoneStart(code) {
  S.screen = "phone";
  const run = ++S.run;
  show(head("approve on your phone") + tile("getting a code", "", steps(PHONE_STEPS, 0)));
  const browser = S.opts.browser;
  if (browser && !(await mine.key.supported()))
    return show(head("approve on your phone") + tile("this browser can't sign in", "", `<div class="err"><p>It can't make the key fameboy needs.</p><p>Try a recent Chrome, Safari or Firefox.</p></div>`));
  let req;
  try {
    req = browser
      ? await api("/api/signin/browser", { key: await mine.key.create(), invite: code ?? "" })
      : await api("/api/signin/app", code ? { invite: code } : {});
  } catch (e) {
    sfx.error();
    if (code) return invite(e.message);
    return show(head("approve on your phone") + tile("no code this time", "", `<div class="err"><p>${esc(e.message)}</p></div>`));
  }
  if (run !== S.run) return;
  const fee = req.sponsored ? "fameboy pays the network fee." : "You may be asked to pay a small fee.";
  const paint = (at) =>
    show(
      head("approve on your phone") +
        tile(at < 2 ? "scan this with your phone" : "you approved it", at < 2 ? "lasts 24 h" : "almost there", `
          <div class="qrwrap"><div class="qr">${req.qr}</div><div>
            <p>Open your camera and scan.</p>
            <p class="dim">${browser ? "Tap open Farcaster. Then tap approve." : "The Farcaster app opens. Tap approve."}</p>
            <p class="dim">${fee}</p>
            <p class="mobile-only"><a href="${esc(req.url)}">On this phone? Open the link.</a></p>
            <div style="margin-top:14px">${steps(PHONE_STEPS, at)}</div></div></div>
          ${at < 2 ? waiting("Waiting for you") : waiting("This node is picking up the key")}`),
    );
  paint(1);
  keyHandler = backKeys;
  let at = 1;
  while (run === S.run) {
    await wait(2000);
    if (run !== S.run) return;
    let st;
    try {
      st = await api(`/api/signin/${browser ? "browser" : "app"}?token=${encodeURIComponent(req.token)}`);
      // Approved: this browser keeps the key, then proves it to the server.
      if (st.state === "ready") { await mine.key.confirm(st.fid); await mine.key.session(); st.state = "signed-in"; }
    }
    catch (e) { sfx.error(); return show(head("approve on your phone") + tile("this code stopped working", "", `<div class="err"><p>${esc(e.message)}</p></div><div class="row">${go("start again", "A", 'id="again"')}</div>`)), $("#again").addEventListener("click", () => phoneStart(code)); }
    if (st.state === "signed-in") return done();
    const next = st.state === "pending" ? 1 : 2;
    if (next !== at) { at = next; sfx.step(); paint(at); }
  }
}

// ------------------------------------------------------------------ seed phrase
const PHRASE_STEPS = ["Find your account", "Check your storage", "Sign a new key", "Send it to this node", "Wait for it to land"];

function phrase(error) {
  S.screen = "phrase"; S.run++;
  const browser = S.opts.browserPhrase;
  const warning = browser
    ? `<div class="warn"><span class="bang">!</span><div><p>Whoever holds a phrase owns the account.</p><p>Whoever runs this site serves this page.</p><p>Trust them? Go ahead. Unsure? Use your phone.</p></div></div>`
    : `<div class="warn"><span class="bang">!</span><div><p>Whoever holds a phrase owns the account.</p></div></div>`;
  show(
    head("use your seed phrase") +
      tile("type your seed phrase", browser ? "stays in this browser" : "stays on this computer", `
        <p>${browser ? "This page signs one key, then forgets it." : "fameboy signs one key, then forgets it."}</p>
        <p class="dim">${browser ? "The phrase never leaves this browser." : "It saves and sends nothing else."}</p>
        <form class="field" id="phrase-form" autocomplete="off">
          <input type="password" id="phrase-input" autofocus placeholder="12 or 24 words" autocomplete="off" spellcheck="false" aria-label="Seed phrase">
          ${go(error ? "try again" : "sign in", "↵", 'type="submit"')}
        </form>
        ${error ? `<div class="err">${error.map((l) => `<p>${esc(l)}</p>`).join("")}</div>` : warning}`),
  );
  $("#phrase-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#phrase-input");
    const words = input.value;
    input.value = ""; // the page keeps nothing
    if (words.trim()) (browser ? browserPhraseRun : phraseRun)(words);
  });
  keyHandler = backKeys;
}

// Turn the server's log lines into checklist progress.
function phraseProgress(lines) {
  const all = lines.join("\n");
  let at = 0;
  const notes = {};
  const tried = (all.match(/m\/44'\/60'\/0'\/0\/\d/g) ?? []).length;
  const found = all.match(/Found fid (\d+)/);
  if (found) { at = 1; notes[0] = `fid ${found[1]}`; } else if (tried) notes[0] = `address ${Math.min(tried, 10)} of 10`;
  const units = all.match(/storage: (\d+) unit/);
  if (units) { at = 2; notes[1] = `${units[1]} ${units[1] === "1" ? "unit" : "units"}`; }
  if (/app key: /.test(all)) at = 3;
  if (/sending to your node/.test(all)) at = 4;
  if (/^done\./m.test(all)) at = 5;
  return { at, notes, slow: /not at index 0/.test(all), tried };
}

function phraseError(message) {
  if (/none of the first/.test(message)) return ["No account uses this phrase.", "fameboy checked ten addresses."];
  if (/too many/.test(message)) return ["Too many tries from here.", "Wait an hour, then try again."];
  if (/seed phrase sign-in is off|too old for seed phrase/.test(message)) return ["This node turned seed phrases off.", "Sign in with your phone instead."];
  if (/gasless keys, the maximum/.test(message)) return ["This account has too many keys.", "Remove some in the Farcaster app."];
  if (/invalid|checksum|words|mnemonic|phrase/i.test(message) && !/node/i.test(message)) return ["These words don't form a phrase.", "Check spelling and word order."];
  if (/no storage units/.test(message)) return ["This account has no storage.", "Rent storage, then try again."];
  if (/didn't appear within/.test(message)) return ["This node never saw the key.", "Check that this node is in sync."];
  return [message];
}

async function phraseRun(words) {
  S.screen = "working";
  const run = ++S.run;
  const paint = (p) =>
    show(
      head("use your seed phrase") +
        tile("signing you in", p.at === 0 ? "searching" : "", `
          ${steps(PHRASE_STEPS, p.at, p.notes)}
          ${p.at === 0 && p.slow ? `<div class="bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < p.tried ? "on" : ""}"></i>`).join("")}</div><p class="dim small">The first address had no account. Each check takes a while. This can take three minutes.</p>` : ""}
          ${p.at >= 2 ? `<p class="dim small">fameboy already forgot your phrase.</p>` : `<p class="dim small">This can take up to a minute.</p>`}`),
      `<a class="dim" href="/">back home</a>`,
    );
  paint({ at: 0, notes: {}, slow: false, tried: 0 });
  keyHandler = null;
  let job;
  try { job = (await api("/api/signin/phrase", { phrase: words })).job; }
  catch (e) { sfx.error(); return phrase(phraseError(e.message)); }
  let last = -1;
  while (run === S.run) {
    await wait(1000);
    let st;
    try { st = await api(`/api/signin/phrase?job=${encodeURIComponent(job)}`); }
    catch (e) { sfx.error(); return phrase(phraseError(e.message)); }
    if (st.error) { sfx.error(); return phrase(phraseError(st.error)); }
    const p = phraseProgress(st.lines);
    if (p.at !== last) { if (last >= 0) sfx.step(); last = p.at; }
    paint(p);
    if (st.done) return done();
  }
}

// Hosted (ADR 006): this page does what fameboy login does. The phrase and
// the account key it unlocks stay in vendor/phrase-browser.js; the server
// gets an address, two signatures and this browser's new app key.
let cryptoP;
const phraseCrypto = () =>
  (cryptoP ??= new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "/vendor/phrase-browser.js";
    el.onload = () => (window.phraseBrowser ? resolve(window.phraseBrowser) : reject(new Error("couldn't load the signing code")));
    el.onerror = () => { cryptoP = undefined; reject(new Error("couldn't load the signing code")); };
    document.head.append(el);
  }));
const hexBytes = (h) => new Uint8Array(h.slice(2).match(/../g).map((b) => parseInt(b, 16)));

async function browserPhraseRun(words) {
  S.screen = "working";
  const run = ++S.run;
  const p = { at: 0, notes: {}, slow: false, tried: 0 };
  const paint = () =>
    show(
      head("use your seed phrase") +
        tile("signing you in", p.at === 0 ? "searching" : "", `
          ${steps(PHRASE_STEPS, p.at, p.notes)}
          ${p.at === 0 && p.slow ? `<div class="bar">${Array.from({ length: 10 }, (_, i) => `<i class="${i < p.tried ? "on" : ""}"></i>`).join("")}</div><p class="dim small">The first address had no account. Checking nine more.</p>` : ""}
          ${p.at >= 3 ? `<p class="dim small">This page already forgot your phrase.</p>` : p.at === 0 && p.slow ? "" : `<p class="dim small">This can take up to a minute.</p>`}`),
      `<a class="dim" href="/">back home</a>`,
    );
  const step = (at, note) => { if (note) p.notes[p.at] = note; if (at !== p.at) sfx.step(); p.at = at; if (run === S.run) paint(); };
  paint();
  keyHandler = null;
  if (!(await mine.key.supported())) return phrase(["This browser can't make the key.", "Try a recent Chrome, Safari or Firefox."]);
  try {
    const pc = await phraseCrypto();
    // 1. Find the account: m/44'/60'/0'/0/0 first, as most wallets use it.
    const look = async (i) => {
      const c = pc.custody(words, i);
      const a = await api("/api/signin/phrase/account", { address: c.address });
      p.tried++;
      if (run === S.run && p.at === 0) paint();
      return a.fid ? { c, a } : null;
    };
    let found = await look(0);
    if (!found) {
      p.slow = true; paint();
      found = (await Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(look))).find(Boolean);
    }
    words = ""; // from here only the one account key is kept, until it signs
    if (!found) throw new Error("none of the first 10 addresses");
    let { c, a } = found;
    step(1, `fid ${a.fid}`);
    // 2. Storage, and room for one more key.
    if (!a.storage) throw new Error("no storage units");
    if (a.full) throw new Error("gasless keys, the maximum");
    step(2, `${a.storage} ${a.storage === 1 ? "unit" : "units"}`);
    // 3. A new app key for this browser, approved by the account key.
    const key = await mine.key.create();
    const sigs = await c.sign({ fid: a.fid, key, nonce: a.nonce, deadline: a.deadline });
    const address = c.address;
    c = found = null;
    step(3);
    const prep = await api("/api/signin/phrase/prepare", { address, fid: a.fid, key, nonce: a.nonce, deadline: a.deadline, keyAdd: sigs.keyAdd, request: sigs.request, invite: S.typedInvite ?? "" });
    // 4. The new key signs the message that adds it. 5. Wait for the node.
    const sig = await mine.key.signPending(hexBytes(prep.hash));
    step(4);
    const r = await api("/api/signin/phrase/finish", { id: prep.id, sig });
    await mine.key.confirm(r.fid);
    await mine.key.session();
    if (run === S.run) return done();
  } catch (e) {
    if (run !== S.run) return;
    sfx.error();
    if (/invite code doesn't work/.test(e.message)) { S.typedInvite = undefined; return invite(e.message, "phrase"); }
    return phrase(phraseError(e.message));
  }
}

// ------------------------------------------------------------------ terminal
async function terminal(title, cmd, lines) {
  S.screen = "terminal";
  const run = ++S.run;
  show(head(title) + tile("in a terminal", "", `${lines.map((l, i) => `<p class="${i ? "dim" : ""}">${l}</p>`).join("")}${copyable(cmd)}${waiting("Waiting for you")}`));
  keyHandler = backKeys;
  while (run === S.run) {
    await wait(3000);
    if (run !== S.run) return;
    const me = await api("/api/me").catch(() => null);
    if (me) return done();
  }
}

// ------------------------------------------------------------------ done
// Where to go once you're in: back to the page that sent you (a cast page
// passes ?next=/<user>/<hash>), else home. Only paths on this site.
const NEXT = (() => { const n = new URLSearchParams(location.search).get("next") ?? ""; return /^\/(?![/\\])/.test(n) ? n : "/"; })();
async function done(already = false) {
  S.screen = "done"; S.run++;
  const me = await api("/api/me").catch(() => null);
  if (!already) sfx.win();
  const name = me?.username ? `@${esc(me.username)}` : me ? `fid ${me.fid}` : "you";
  show(
    `<section class="tile" style="margin-top:40px"><h2><span>signed in</span><span>${me ? `fid ${me.fid}` : ""}</span></h2><div class="done">
      ${me?.pfp ? `<img class="avatar" src="${esc(me.pfp)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar"></span>`}
      <h2>${already ? "already in" : "you're in"}</h2><p>${already ? `You're signed in as ${name}.` : `Welcome, ${name}.`}</p>
      <p class="dim">Your ${kit.ext(`${DOCS}/guide/app-key`, "app key")} has been saved ${me?.hosted ? "in this browser. It never leaves it" : "on this computer"}.</p>
      <p class="dim">You can now start interacting with Farcaster on this device.</p>
      <div class="row">${go("start", "A", 'id="start"')}</div></div></section>`,
    `<span><kbd>A</kbd>/<kbd>↵</kbd> start</span>`,
  );
  $("#start").addEventListener("click", () => (location.href = NEXT));
  keyHandler = (k) => { if (k === "enter" || k === "a" || k === " ") { location.href = NEXT; return true; } };
}

// ------------------------------------------------------------------ input
const backKeys = (k) => { if (k === "escape") { sfx.back(); choose(); return true; } };
addEventListener("keydown", (e) => {
  kit.unlock();
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const typing = e.target.tagName === "INPUT";
  const k = e.key.toLowerCase();
  if (typing && k !== "escape") return;
  if (k === "b" && !typing && S.screen !== "choose" && S.screen !== "working" && S.screen !== "done") { sfx.back(); choose(); e.preventDefault(); return; }
  if (keyHandler?.(k)) e.preventDefault();
});
document.addEventListener("click", async (e) => {
  const c = e.target.closest?.("[data-copy]");
  if (!c) return;
  try { await navigator.clipboard.writeText(c.dataset.copy); toast("Copied."); } catch { toast("Copy it by hand."); }
});

(async () => {
  try {
    if (await api("/api/me")) return done(true);
    S.opts = await api("/api/signin/options");
  } catch (e) {
    return show(head() + tile("can't start", "", `<div class="err"><p>${esc(e.message)}</p></div>`));
  }
  S.ways = waysFrom(S.opts);
  // No phone sign-in here yet: start on the seed phrase, if offered.
  if (S.ways[0].tag === "needs setup") S.sel = Math.max(0, S.ways.findIndex((w) => w.id === "phrase"));
  choose();
})();
