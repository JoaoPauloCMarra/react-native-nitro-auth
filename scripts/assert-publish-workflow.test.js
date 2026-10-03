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

test("rejects publishing from a tag instead of the validated commit", () => {
  const fixture = Bun.YAML.parse(workflow);
  const checkout = fixture.jobs.publish.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  checkout.with.ref =
    "refs/tags/${{ steps.validate_inputs.outputs.release_tag }}";
  const result = checkFixture(Bun.YAML.stringify(fixture));
  assert.equal(result.status, 1, result.stdout);
});

test("rejects a missing pre-publish commit check", () => {
  const fixture = Bun.YAML.parse(workflow);
  fixture.jobs.publish.steps = fixture.jobs.publish.steps.filter(
    (step) => step.id !== "validated_source",
  );
  const result = checkFixture(Bun.YAML.stringify(fixture));
  assert.equal(result.status, 1, result.stdout);
});

for (const [name, releaseCommit, checkedOutCommit, expectedStatus] of [
  ["accepts the validated commit", "a".repeat(40), "a".repeat(40), 0],
  ["rejects a changed checkout", "a".repeat(40), "b".repeat(40), 1],
  ["rejects a missing commit", "", "a".repeat(40), 1],
  ["rejects a ref instead of a full commit", "main", "a".repeat(40), 1],
]) {
  test(name, () => {
    const step = Bun.YAML.parse(workflow).jobs.publish.steps.find(
      (candidate) => candidate.id === "validated_source",
    );
    assert.ok(step, "publish must check its source before publishing");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "nitro-commit-check-"));
    try {
      fs.writeFileSync(
        path.join(root, "git"),
        '#!/bin/sh\n[ "$1" = "rev-parse" ] && [ "$2" = "HEAD" ] || exit 64\nprintf "%s\\n" "$TEST_CHECKED_OUT_COMMIT"\n',
        { mode: 0o755 },
      );
      const result = spawnSync("bash", ["-c", step.run], {
        cwd: root,
        env: {
          ...process.env,
          PATH: `${root}${path.delimiter}${process.env.PATH ?? ""}`,
          RELEASE_COMMIT: releaseCommit,
          TEST_CHECKED_OUT_COMMIT: checkedOutCommit,
        },
        encoding: "utf8",
      });
      assert.equal(
        result.status,
        expectedStatus,
        result.stdout + result.stderr,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}
