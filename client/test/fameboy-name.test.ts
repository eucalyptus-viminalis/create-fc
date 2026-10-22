// node --test "test/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { COLORS, PALETTE, avatarFor, colorOf } from "../../node/fameboy-name.mjs";

test("one-word colours, each short enough for a fameboy<color> fname, each with a hex value", () => {
  assert.ok(COLORS.length >= 400, `only ${COLORS.length} colours`);
  for (const c of COLORS) {
    assert.match(`fameboy${c}`, /^fameboy[a-z]{1,9}$/, c);
    assert.match(PALETTE[c]!, /^#[0-9a-f]{6}$/, c);
  }
});

test("every colour has a built avatar, and other names get the clear one", () => {
  for (const c of COLORS) assert.ok(existsSync(new URL(`../../site/img/avatars/fameboy${c}.jpg`, import.meta.url)), `site/img/avatars/fameboy${c}.jpg is missing: run node client/logo/scripts/build-avatars.cjs ${c}`);
  assert.equal(avatarFor("fameboyteal"), "https://eucalyptus-viminalis.github.io/create-fc/img/avatars/fameboyteal.jpg");
  assert.equal(avatarFor("fameboyclear"), "https://eucalyptus-viminalis.github.io/create-fc/img/fameboy-avatar.png");
});

test("a name says its colour only when it's fameboy plus a colour from the list", () => {
  assert.deepEqual(colorOf("fameboyteal"), { color: "teal", hex: "#008080" });
  assert.deepEqual(colorOf("@FameboyTeal"), { color: "teal", hex: "#008080" });
  assert.equal(colorOf("fameboyclear"), undefined);
  assert.equal(colorOf("fameboy"), undefined);
  assert.equal(colorOf("tealcast"), undefined);
  assert.equal(colorOf("fameboyconstructor"), undefined);
  assert.equal(colorOf(undefined), undefined);
});
