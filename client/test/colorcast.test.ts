// node --test "test/*.test.ts"
import { test } from "node:test";
import assert from "node:assert/strict";
import { COLORS } from "../../node/colorcast.mjs";

test("512 distinct one-word colors, each short enough for a <color>cast fname", () => {
  assert.equal(COLORS.length, 512);
  assert.equal(new Set(COLORS).size, 512);
  for (const c of COLORS) assert.match(`${c}cast`, /^[a-z]{1,12}cast$/, c);
});
