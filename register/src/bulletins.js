// E-mail bulletins wait for the address's owner to say yes. Ticking the box on the form only sends a
// confirmation e-mail; the link in it opens a page whose button confirms. (A button, not the link
// itself, because mail scanners open links on their own.) Only confirmed addresses get bulletins,
// and only the owner can change that, through links sent to the address. Nothing typed on the form
// can unsubscribe someone, or subscribe a stranger.
//
// Sent with Cloudflare Email Sending (the EMAIL binding). On localhost nothing is sent: the link is
// logged and returned, so the flow can be tried without a real inbox.

export const MAX_PER_DAY = 200;   // confirmation e-mails across all addresses, so the form can't be used to mass-mail people

const newToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');

// After a filing asks for bulletins at `email`. Returns what the form should tell the visitor:
//   confirmed  already confirmed: nothing to do
//   sent       a confirmation e-mail is on its way (or went out in the last day)
//   unsent     couldn't send one now
export async function requestBulletins(env, email, { origin, local }) {
  const sub = await env.DB.prepare(
    "SELECT status, token, sent_at > datetime('now', '-1 day') AS recent FROM subscribers WHERE email = ?1",
  ).bind(email).first();
  if (sub?.status === 'confirmed') return { state: 'confirmed' };
  if (sub?.recent) return { state: 'sent' };   // one confirmation e-mail per address per day
  const { n } = await env.DB.prepare("SELECT count(*) AS n FROM subscribers WHERE sent_at > datetime('now', '-1 day')").first();
  if (n >= MAX_PER_DAY) return { state: 'unsent' };

  const token = sub?.token ?? newToken();
  await env.DB.prepare(
    `INSERT INTO subscribers (email, status, token, sent_at) VALUES (?1, 'pending', ?2, CURRENT_TIMESTAMP)
     ON CONFLICT(email) DO UPDATE SET status = 'pending', sent_at = CURRENT_TIMESTAMP`,
  ).bind(email, token).run();

  const link = `${origin}/confirm?t=${token}`;
  if (local) { console.log(`[dev] bulletin confirmation for ${email}: ${link}`); return { state: 'sent', confirm: link }; }
  try {
    await env.EMAIL.send(confirmationEmail({ to: email, from: env.MAIL_FROM, link }));
    return { state: 'sent' };
  } catch (e) {
    console.error('confirmation e-mail failed', e.code, e.message);
    await env.DB.prepare('UPDATE subscribers SET sent_at = NULL WHERE email = ?1').bind(email).run();   // so the next filing can try again
    return { state: 'unsent' };
  }
}

export function confirmationEmail({ to, from, link }) {
  const text = `Someone, hopefully you, asked for Network Decentralization Authority bulletins at this address when they filed NDA Form 1 on createfc.org. Bulletins are rare: new releases, snapshot changes, and when nodes need an upgrade.

To confirm, open this link and press the button:
${link}

Didn't ask? Ignore this e-mail. Nothing is sent to this address unless you confirm.

Network Decentralization Authority · create-fc`;
  const html = `<div style="font:15px/1.5 system-ui,sans-serif;color:#1c1c1a;max-width:520px">
<p>Someone, hopefully you, asked for Network Decentralization Authority bulletins at this address when they filed NDA Form 1 on createfc.org. Bulletins are rare: new releases, snapshot changes, and when nodes need an upgrade.</p>
<p><a href="${link}" style="display:inline-block;padding:10px 16px;background:#24493b;color:#fff;text-decoration:none;font-weight:700">Confirm bulletins</a></p>
<p style="color:#55554f">Didn't ask? Ignore this e-mail. Nothing is sent to this address unless you confirm.</p>
<p style="color:#55554f;font-size:13px">Network Decentralization Authority · create-fc</p></div>`;
  return { to, from: { email: from, name: 'Network Decentralization Authority' }, subject: 'Confirm Authority bulletins', text, html };
}

// The confirm and unsubscribe links. GET shows a button; POST (the button) makes the change.
const ACTIONS = {
  confirm: { ask: 'Send Authority bulletins to this address?', button: 'Yes, send me bulletins', set: 'confirmed',
    done: "Confirmed. You'll get Authority bulletins at this address, rarely. Each one has a link to stop them." },
  unsubscribe: { ask: 'Stop Authority bulletins to this address?', button: 'Stop bulletins', set: 'unsubscribed',
    done: "Done. This address won't get any more bulletins." },
};

export async function linkPage(request, env, action) {
  const a = ACTIONS[action];
  const token = request.method === 'POST'
    ? String((await request.formData().catch(() => null))?.get('t') ?? '')
    : new URL(request.url).searchParams.get('t') ?? '';
  const sub = /^[0-9a-f]{32}$/.test(token) && await env.DB.prepare('SELECT status FROM subscribers WHERE token = ?1').bind(token).first();
  if (!sub) return small('That link has expired or was copied incompletely.', 404);
  if (request.method !== 'POST') {
    return small(`<p>${a.ask}</p><form method="post"><input type="hidden" name="t" value="${token}"><button>${a.button}</button></form>`);
  }
  await env.DB.prepare(
    `UPDATE subscribers SET status = ?2, confirmed_at = CASE WHEN ?2 = 'confirmed' THEN CURRENT_TIMESTAMP ELSE confirmed_at END WHERE token = ?1`,
  ).bind(token, a.set).run();
  return small(`<p>${a.done}</p>`);
}

const small = (body, status = 200) => new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Bulletins · Network Decentralization Authority</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;padding:24px 16px;background:#c9c7bc;font:500 17px/1.45 system-ui,sans-serif;color:#1c1c1a;text-align:center;max-width:520px;margin:auto}
h1{font:800 13px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#24493b}button{font:700 15px/1 system-ui,sans-serif;padding:12px 18px;border:0;background:#24493b;color:#fff;cursor:pointer}</style>
</head><body><h1>Network Decentralization Authority</h1>${body.startsWith('<') ? body : `<p>${body}</p>`}</body></html>`,
{ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
