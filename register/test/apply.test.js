import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApplication, contactKind, memberNo, enrolledDate, nodeAddress, payoutAddress } from '../src/apply.js';
import { cardSvg } from '../src/card.js';
import { confirmationEmail } from '../src/bulletins.js';

const good = { contact: '1234', name: '@fameboyteal', signature: 'Ada Operator', certify: { sync: true, cast: true }, bulletins: false };

test('item 1 takes an FID or an e-mail address', () => {
  assert.equal(contactKind('3'), 'fid');
  assert.equal(contactKind(' you@example.com '), 'email');
  assert.equal(contactKind('0'), null);
  assert.equal(contactKind('@fameboyteal'), null);
  assert.equal(contactKind('12345678901'), null);
});

test('a complete form is accepted and cleaned', () => {
  const r = checkApplication({ ...good, contact: '0042', name: '  @teal\ncast  ' });
  assert.equal(r.ok, true);
  assert.equal(r.member.contact, '42');
  assert.equal(r.member.name, '@teal cast');
  assert.equal(checkApplication({ ...good, contact: 'You@Example.com' }).member.contact, 'you@example.com');
});

test('the name falls back to the signature', () => {
  assert.equal(checkApplication({ ...good, name: '' }).member.name, 'Ada Operator');
});

test('missing items are returned for correction', () => {
  const r = checkApplication({ contact: 'nope', certify: { sync: true }, signature: '' });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.errors).sort(), ['certify', 'contact', 'signature']);
});

test('member numbers and dates are printed like the form', () => {
  assert.equal(memberNo(42), 'No. 000042');
  assert.equal(enrolledDate('2026-10-23 08:15:00'), '23 OCT 2026');
});

test('typed values are escaped in the card image', () => {
  const svg = cardSvg({ name: '<script>&', number: 'No. 000001', enrolled: '23 OCT 2026', signature: '"x"' });
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;&amp;'));
});

test('the confirmation e-mail carries the link and comes from the Authority', () => {
  const e = confirmationEmail({ to: 'ada@example.com', from: 'register@createfc.org', link: 'https://register.createfc.org/confirm?t=abc' });
  assert.equal(e.to, 'ada@example.com');
  assert.deepEqual(e.from, { email: 'register@createfc.org', name: 'Network Decentralization Authority' });
  assert.ok(e.text.includes('https://register.createfc.org/confirm?t=abc'));
  assert.ok(e.html.includes('href="https://register.createfc.org/confirm?t=abc"'));
});

test('Part IV: a claim needs the node and an EVM address to pay', () => {
  const pay = '0x97547ffbA3F3e5a7553aA36948F618f39647F2Ea';
  const r = checkApplication({ ...good, claim: { node: ' http://203.0.113.7:3381/ ', payout: pay } });
  assert.equal(r.ok, true);
  assert.equal(r.member.node, '203.0.113.7');
  assert.equal(r.member.payout, pay);
  const bad = checkApplication({ ...good, claim: { node: 'my server', payout: 'name.eth' } });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['node', 'payout']);
});

test('no claim, no reimbursement details', () => {
  const r = checkApplication(good);
  assert.equal(r.member.node, null);
  assert.equal(r.member.payout, null);
});

test('node addresses: IPv4, IPv6 or a host name', () => {
  assert.equal(nodeAddress('91.99.76.223'), '91.99.76.223');
  assert.equal(nodeAddress('2001:db8::1'), '2001:db8::1');
  assert.equal(nodeAddress('Node.Example.com:3381'), 'node.example.com');
  assert.equal(nodeAddress('300.1.1.1'), null);
  assert.equal(nodeAddress(''), null);
  assert.equal(payoutAddress('0x' + 'a'.repeat(40)), '0x' + 'a'.repeat(40));
  assert.equal(payoutAddress('0x' + 'a'.repeat(39)), null);
});
