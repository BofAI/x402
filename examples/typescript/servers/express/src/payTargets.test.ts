import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { selectPayTargetNetworks } from "./payTargets.js";

const originalPayTargets = process.env.PAY_TARGETS;
const networks = ["eip155:8453", "tron:3448148188"] as const;

afterEach(() => {
  if (originalPayTargets === undefined) {
    delete process.env.PAY_TARGETS;
  } else {
    process.env.PAY_TARGETS = originalPayTargets;
  }
});

test("keeps all configured networks when PAY_TARGETS is unset", () => {
  delete process.env.PAY_TARGETS;
  assert.deepEqual(selectPayTargetNetworks(networks), networks);
});

test("matches a deprecated hexadecimal TRON alias with a token suffix", () => {
  process.env.PAY_TARGETS = "tron:0xcd8690dc@USDT";
  assert.deepEqual(selectPayTargetNetworks(networks), ["tron:3448148188"]);
});

test("matches both namespace spellings", () => {
  process.env.PAY_TARGETS = "tron";
  assert.deepEqual(selectPayTargetNetworks(networks), ["tron:3448148188"]);

  process.env.PAY_TARGETS = "tron:";
  assert.deepEqual(selectPayTargetNetworks(networks), ["tron:3448148188"]);
});

test("keeps exact non-TRON and canonical TRON matching", () => {
  process.env.PAY_TARGETS = "eip155:8453,tron:3448148188";
  assert.deepEqual(selectPayTargetNetworks(networks), networks);
});
