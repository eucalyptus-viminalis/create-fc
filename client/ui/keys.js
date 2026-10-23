// fameboy keys: who can post as you. Every app you've signed in to holds a
// key that can sign for your account. This lists them all, straight from your
// node (GET /api/keys, which reads /v1/signersByFid), grouped by the app that
// asked for each, and marks the one fameboy uses here.

const { $, esc, api, SignedOut } = kit;
const fmt = (n) => Number(n).toLocaleString("en-US");
const day = (t) => (t ? new Date(t * 1000).toISOString().slice(0, 10) : null);
const pic = (url) => (url ? `<img class="pf" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="pf nopic">?</span>`);
const short = (k) => `${k.slice(0, 8)}…${k.slice(-6)}`;
const scopeText = (s) => s.toLowerCase().replaceAll("_", " ");

function paint(me, keys) {
  const here = me.hosted ? "this browser" : "this computer";
  const mineKey = (k) => me.publicKey && k.key.toLowerCase() === me.publicKey.toLowerCase();
  const groups = new Map();
  for (const k of keys) {
    const id = k.app ? k.app.fid : "?";
    if (!groups.has(id)) groups.set(id, { app: k.app, keys: [] });
    groups.get(id).keys.push(k);
  }
  const anything = keys.filter((k) => k.source === "onchain").length;
  const list = [...groups.values()]
    .map((g) => ({ ...g, mine: g.keys.some(mineKey) }))
    .sort((a, b) => b.mine - a.mine || b.keys.length - a.keys.length);
  $("#sub").textContent = `who can post as @${me.username ?? me.fid}`;
  $("#view").innerHTML = `
    <div class="grid">
      <section class="tile span4"><h2><span>keys</span></h2><div class="body"><div class="big">${fmt(keys.length)}</div><p>can post as you</p></div></section>
      <section class="tile span4"><h2><span>apps</span></h2><div class="body"><div class="big">${fmt(groups.size)}</div><p>hold them</p></div></section>
      <section class="tile span4"><h2><span>unlimited</span></h2><div class="body"><div class="big">${fmt(anything)}</div><p>can sign any kind of message</p></div></section>
    </div>
    <div class="kapps">${list.map((g) => groupHtml(g, here, mineKey)).join("")}</div>
    <p class="dim foot">Remove an app's key in the Farcaster app, under connected apps. ${me.hosted ? "Signing out deletes this browser's key." : "Signing out on home revokes this computer's key."} More: ${kit.ext("https://createfc.org/docs/guide/app-key", "your app key")}</p>`;
}

function groupHtml({ app, keys: ks, mine }, here, mineKey) {
  const onchain = ks.filter((k) => k.source === "onchain").length, scoped = ks.length - onchain;
  const oldest = Math.min(...ks.map((k) => k.addedAt ?? Infinity));
  const expires = ks.map((k) => k.expiresAt).filter(Boolean);
  const scopes = [...new Set(ks.flatMap((k) => k.scopes))];
  const name = app ? `@${esc(app.name ?? `!${app.fid}`)}` : "unknown app";
  const meta = [
    `${ks.length} key${ks.length === 1 ? "" : "s"}`,
    Number.isFinite(oldest) ? `since ${day(oldest)}` : "",
    expires.length ? `gasless, expire${expires.length === 1 ? "s" : ""} ${day(Math.max(...expires))} unless used` : "",
  ].filter(Boolean).join(" · ");
  const rows = ks
    .slice()
    .sort((a, b) => mineKey(b) - mineKey(a) || (b.addedAt ?? 0) - (a.addedAt ?? 0))
    .map((k) => `<tr class="${mineKey(k) ? "me" : ""}">
      <td class="key" title="${esc(k.key)}">${esc(short(k.key))}</td>
      <td>${k.source === "onchain" ? "onchain · signs anything" : `gasless · ${esc(k.scopes.map(scopeText).join(", ") || "scoped")}`}</td>
      <td class="d">${day(k.addedAt) ? `added ${day(k.addedAt)}` : ""}</td>
      <td class="d">${k.expiresAt ? `expires ${day(k.expiresAt)}` : ""}</td>
      <td class="d">${mineKey(k) ? `<b>◀ ${here}</b>` : ""}</td>
    </tr>`).join("");
  return `<article class="tile kapp${mine ? " mine" : ""}">
    <div class="khead">
      ${pic(app?.pfp)}
      <div class="kname">
        <div>${app?.name ? kit.ext(`https://farcaster.xyz/${encodeURIComponent(app.name)}`, name) : name}${app ? ` <span class="dim small">fid ${app.fid}</span>` : ""}${app?.fid === kit.FARCASTER_APP ? ` <span class="dim small">the Farcaster app</span>` : ""}${mine ? ` <span class="here">includes ${here}'s key</span>` : ""}</div>
        <div class="dim small">${meta}${scopes.length ? `<br>can: ${esc(scopes.map(scopeText).join(", "))}` : ""}</div>
      </div>
      <span class="power${onchain ? " all" : ""}">${onchain ? `${onchain > 1 ? `${onchain} ` : ""}can sign anything` : `${scoped} scoped key${scoped === 1 ? "" : "s"}`}</span>
    </div>
    <details${mine || ks.length <= 3 ? " open" : ""}><summary>${ks.length === 1 ? "the key" : `all ${ks.length} keys`}</summary><table>${rows}</table></details>
  </article>`;
}

addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) location.href = "/";
});

(async () => {
  try {
    const me = await kit.me();
    if (!me) throw new SignedOut();
    paint(me, await api("/api/keys"));
  } catch (e) {
    if (e instanceof SignedOut) location.href = "/signin";
    else $("#view").innerHTML = `<div class="tile empty">${esc(e.message)}</div>`;
  }
})();
