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

const bunCachePath = "~/.bun/install/cache";
const bunCacheKey = "bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}";

function assertBunCacheBeforeInstall(jobName, steps, cacheAction) {
  const installIndex = steps.findIndex(
    (step) => step.run === "bun install --frozen-lockfile",
  );
  assert.notEqual(installIndex, -1, `${jobName} must install dependencies`);
  const cacheStep = steps[installIndex - 1];
  assert.equal(
    cacheStep?.uses,
    cacheAction,
    `${jobName} must run ${cacheAction} right before bun install`,
  );
  assert.equal(cacheStep.with?.path, bunCachePath);
  assert.equal(cacheStep.with?.key, bunCacheKey);
}

assertBunCacheBeforeInstall(
  "validate",
  workflow.jobs.validate.steps,
  "actions/cache@v6",
);
assertBunCacheBeforeInstall(
  "publish",
  publishSteps,
  "actions/cache/restore@v6",
);

const ciPath = path.join(__dirname, "..", ".github", "workflows", "ci.yml");
const ci = Bun.YAML.parse(fs.readFileSync(ciPath, "utf8"));
const ciJobs = Object.values(ci.jobs);
assert.ok(ciJobs.length > 0, "ci must define a job");
for (const job of ciJobs) {
  assert.equal(job["runs-on"], "ubuntu-26.04", "ci must run on Linux only");
  const checkout = job.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  assert.equal(checkout?.with?.["persist-credentials"], false);
  assertBunCacheBeforeInstall("ci", job.steps, "actions/cache@v6");
  const coverageRuns = job.steps.filter((step) =>
    step.run?.includes("test:coverage"),
  );
  assert.equal(
    coverageRuns.length,
    0,
    "ci must not run coverage outside release:preflight",
  );
}

console.log(
  "Publish workflow validates source identity and publishes only on GitHub Release events.",
);
