// Checks a membership application from the microsite's NDA Form 1.
// Returns { ok: true, member } with cleaned fields, or { ok: false, errors } keyed by form item.

const FID = /^\d{1,10}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Item 1 takes either a Farcaster ID or an e-mail address.
export function contactKind(value) {
  const v = String(value ?? '').trim();
  if (FID.test(v) && Number(v) > 0) return 'fid';
  if (v.length <= 254 && EMAIL.test(v)) return 'email';
  return null;
}

// Part IV: the server reimbursement. Where the node is, so the Authority can check it's in sync,
// and any EVM address to pay. Both are needed to claim.
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-f:]+$/i;
const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const EVM = /^0x[0-9a-fA-F]{40}$/;
export function nodeAddress(value) {
  // forgive a pasted URL: http://203.0.113.7:3381/ becomes 203.0.113.7
  let v = String(value ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if ((v.match(/:/g) || []).length === 1) v = v.replace(/:\d{1,5}$/, '');   // a port; IPv6 has several colons
  if (IPV4.test(v) || HOST.test(v) || (v.includes(':') && v.length <= 45 && IPV6.test(v))) return v.toLowerCase();
  return null;
}
export const payoutAddress = value => { const v = String(value ?? '').trim(); return EVM.test(v) ? v : null; };

// Strip control characters and squeeze spaces, then cap the length.
const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

export function checkApplication(body) {
  const errors = {};
  const raw = String(body?.contact ?? '').trim();
  const kind = contactKind(raw);
  if (!kind) errors.contact = 'Enter your FID (numbers only) or an e-mail address.';
  if (body?.certify?.sync !== true || body?.certify?.cast !== true) errors.certify = 'Both certifications are required.';
  const signature = clean(body?.signature, 60);
  if (!signature) errors.signature = 'Sign to apply.';   // the form signs with item 2, or "anon", so one letter is fine
  // A claim comes as { node, payout }; no claim, no reimbursement details.
  let node = null, payout = null;
  if (body?.claim) {
    node = nodeAddress(body.claim.node);
    payout = payoutAddress(body.claim.payout);
    if (!node) errors.node = "Enter your node's address: its IP, like 203.0.113.7.";
    if (!payout) errors.payout = 'Enter an EVM address: 0x and 40 letters or numbers.';
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    member: {
      kind,
      // FIDs lose leading zeros; e-mail addresses are compared case-insensitively.
      contact: kind === 'fid' ? String(Number(raw)) : raw.toLowerCase(),
      name: clean(body?.name, 40) || signature,
      signature,
      bulletins: body?.bulletins === true,
      node,
      payout,
    },
  };
}

// "No. 000042"
export const memberNo = n => 'No. ' + String(n).padStart(6, '0');

// "23 OCT 2026", from D1's "2026-10-23 08:15:00" (UTC)
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function enrolledDate(sqlTime) {
  const d = new Date(String(sqlTime).replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
