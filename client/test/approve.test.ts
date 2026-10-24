import { test } from "node:test";
import assert from "node:assert/strict";
import { approvePage } from "../src/signin.ts";

// ADR 005: the hosted QR code opens this copy's /approve page, token in the fragment.
test("the QR code points at this copy's approve page", () => {
  assert.equal(approvePage("https://fameboyclear.example", "0xabc123"), "https://fameboyclear.example/approve#0xabc123");
});
