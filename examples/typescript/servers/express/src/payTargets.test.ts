import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { selectPayTargetNetworks } from "./payTargets.js";

const originalPayTargets = process.env.PAY_TARGETS;
const networks = ["tron:3448148188", "tron:2494104990", "tron:728126428"] as const;

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
  assert.deepEqual(selectPayTargetNetworks(networks), networks);

  process.env.PAY_TARGETS = "tron:";
  assert.deepEqual(selectPayTargetNetworks(networks), networks);
});

test("selects only the requested TRON network", () => {
  process.env.PAY_TARGETS = "tron:2494104990@USDT";
  assert.deepEqual(selectPayTargetNetworks(networks), ["tron:2494104990"]);
});

test("rejects a target outside the TRON family", () => {
  process.env.PAY_TARGETS = "eip155:8453";
  assert.throws(() => selectPayTargetNetworks(networks), /TRON/);
});

test("rejects a mixed selection instead of silently skipping unsupported targets", () => {
  process.env.PAY_TARGETS = "tron:3448148188@USDT,eip155:8453";
  assert.throws(() => selectPayTargetNetworks(networks), /TRON/);
});
