import { test } from "node:test";
import assert from "node:assert/strict";
import { cut, graphemes, privateIp, wrap } from "../src/og-card.ts";

const text = (line: { s: string }[]) => line.map((g) => g.s).join("");

test("wrap breaks at spaces and keeps every line within its columns", () => {
  const lines = wrap("the quick brown fox jumps over the lazy dog", 10);
  assert.deepEqual(lines.map(text), ["the quick", "brown fox", "jumps over", "the lazy", "dog"]);
});

test("wrap breaks a word longer than a line, and keeps blank lines between paragraphs", () => {
  assert.deepEqual(wrap("abcdefghijkl\n\nend", 5).map(text), ["abcde", "fghij", "kl", "", "end"]);
});

test("emoji take two columns", () => {
  assert.deepEqual(wrap("gm 🌞 gm", 5).map(text), ["gm 🌞", "gm"]);
  assert.equal(graphemes("👨‍👩‍👧").length, 1);
});

test("cut ends a line in an ellipsis within its columns", () => {
  assert.equal(text(cut(graphemes("hello wonderful world"), 10, "…")), "hello won…");
  assert.equal(text(cut(graphemes("hello world"), 7, "…")), "hello…");
});

test("pictures are never fetched from private addresses", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) assert.equal(privateIp(ip), true, ip);
  for (const ip of ["91.99.76.223", "104.16.0.1", "2606:4700::1111"]) assert.equal(privateIp(ip), false, ip);
});
