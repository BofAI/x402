import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const validator = fileURLToPath(new URL("./check_pr_metadata.mjs", import.meta.url));
const validBody = "## Description\n\nExplain the change and why it is needed.\n\n## Tests\n\nRan tests.";

function validate(title, body) {
  return spawnSync(process.execPath, [validator, title, body], {
    encoding: "utf8",
    env: {},
  });
}

test("accepts a valid conventional title and description", () => {
  const result = validate("ci: add branch policy validators", validBody);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects an unsupported title type", () => {
  const result = validate("opt: add branch policy validators", validBody);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must match type\(scope\): description/);
});

test("rejects a capitalized description and trailing period", () => {
  const result = validate("ci: Add branch policy validators.", validBody);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /start the description/);
});

test("ignores HTML comments when measuring the Description section", () => {
  const result = validate(
    "ci: add branch policy validators",
    "## Description\n\n<!-- This text must not count toward the description. -->\n\n## Tests\n\nNone",
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least 20 characters; got 0/);
});

test("rejects a missing Description section", () => {
  const result = validate("ci: add branch policy validators", "## Tests\n\nRan tests.");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /at least 20 characters; got 0/);
});

test("enforces the 72-character title limit", () => {
  const result = validate(`ci: ${"a".repeat(69)}`, validBody);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must be 10-72 characters/);
});
