// node --test "test/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLORS, PALETTE, colorOf } from "../../node/fameboy-name.mjs";

test("one-word colours, each short enough for a fameboy<color> fname, each with a hex value", () => {
  assert.ok(COLORS.length >= 400, `only ${COLORS.length} colours`);
  for (const c of COLORS) {
    assert.match(`fameboy${c}`, /^fameboy[a-z]{1,9}$/, c);
    assert.match(PALETTE[c]!, /^#[0-9a-f]{6}$/, c);
  }
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
