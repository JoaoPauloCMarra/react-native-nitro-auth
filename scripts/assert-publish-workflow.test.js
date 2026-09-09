"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "npm-publish.yml"),
  "utf8",
);

function checkFixture(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nitro-publish-check-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    fs.copyFileSync(
      path.join(__dirname, "assert-publish-workflow.js"),
      path.join(root, "scripts", "assert-publish-workflow.js"),
    );
    fs.writeFileSync(
      path.join(root, ".github", "workflows", "npm-publish.yml"),
      contents,
    );
    return spawnSync(process.execPath, ["scripts/assert-publish-workflow.js"], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("accepts the release-only workflow", () => {
  const result = checkFixture(workflow);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects a publish condition preserved only in a comment", () => {
  const condition = Bun.YAML.parse(workflow).jobs.publish.if;
  const fixture = workflow.replace(
    `    if: ${condition}`,
    `    # if: ${condition}\n    if: always()`,
  );
  assert.notEqual(fixture, workflow);
  const result = checkFixture(fixture);
  assert.equal(result.status, 1, result.stdout);
});

test("rejects OIDC permission on another job", () => {
  const fixture = workflow.replace(
    "    name: Verify public registry",
    "    name: Verify public registry\n    permissions:\n      id-token: write",
  );
  assert.notEqual(fixture, workflow);
  const result = checkFixture(fixture);
  assert.equal(result.status, 1, result.stdout);
});
