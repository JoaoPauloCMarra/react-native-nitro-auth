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

const publishSteps = workflow.jobs.publish.steps;
const checkoutIndex = publishSteps.findIndex((step) =>
  step.uses?.startsWith("actions/checkout@"),
);
assert.notEqual(checkoutIndex, -1, "publish must check out validated source");
assert.equal(
  publishSteps[checkoutIndex].with?.ref,
  "${{ needs.validate.outputs.release_commit }}",
  "publish must use the commit that passed validation",
);
const sourceCheckIndex = publishSteps.findIndex(
  (step) => step.id === "validated_source",
);
assert.ok(sourceCheckIndex > checkoutIndex, "publish must check its checkout");
assert.equal(
  publishSteps[sourceCheckIndex].env?.RELEASE_COMMIT,
  "${{ needs.validate.outputs.release_commit }}",
);
const publishIndex = publishSteps.findIndex(
  (step) => step.name === "Publish to npm with Trusted Publishing",
);
assert.ok(
  publishIndex > sourceCheckIndex,
  "source verification must finish before publication",
);

console.log(
  "Publish workflow validates source identity and publishes only on GitHub Release events.",
);
