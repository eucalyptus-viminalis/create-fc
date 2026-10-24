// /approve#<token>: the page a sign-in QR code opens (ADR 005).
// Only a signed key request token is accepted, so this can't send the
// phone anywhere but the Farcaster app.
(() => {
  const token = location.hash.slice(1);
  const ok = /^0x[0-9a-f]{16,128}$/i.test(token);
  document.getElementById(ok ? "ok" : "bad").hidden = false;
  document.getElementById("get").hidden = !ok;
  if (ok) document.getElementById("open").href = `farcaster://signed-key-request?token=${token}`;
})();
