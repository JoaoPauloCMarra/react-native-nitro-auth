"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflowPath = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "npm-publish.yml",
);
const workflow = Bun.YAML.parse(fs.readFileSync(workflowPath, "utf8"));

assert.deepEqual(workflow.on.release.types, ["published"]);
assert.ok(Object.hasOwn(workflow.on, "workflow_dispatch"));
assert.equal(workflow.on.workflow_dispatch.inputs?.publish, undefined);
assert.equal(
  workflow.jobs.publish.if,
  "${{ github.event_name == 'release' && needs.validate.outputs.already_published != 'true' }}",
  "publish must require a release event and an unpublished version",
);
assert.equal(
  workflow.jobs.verify.if,
  "${{ always() && needs.validate.result == 'success' && github.event_name == 'release' }}",
  "registry verification must require a validated release event",
);
assert.notEqual(workflow.permissions, "write-all");
assert.notEqual(workflow.permissions?.["id-token"], "write");
assert.equal(workflow.jobs.publish.permissions?.["id-token"], "write");
for (const [name, job] of Object.entries(workflow.jobs)) {
  if (name === "publish") {
    continue;
  }
  assert.notEqual(job.permissions, "write-all", `${name} must not grant OIDC`);
  assert.notEqual(
    job.permissions?.["id-token"],
    "write",
    `${name} must not grant OIDC`,
  );
}

console.log(
  "Publish workflow keeps workflow_dispatch validation-only and publishes only on GitHub Release events.",
);
