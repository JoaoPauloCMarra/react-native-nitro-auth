const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { flowIdPattern, readValidatedSuites } = require("./replay-manifest");

const projectRoot = path.resolve(__dirname, "..");
const coveragePath = path.join(projectRoot, "e2e", "auth-replay-coverage.json");

function usage() {
  return [
    "Usage:",
    "  bun scripts/run-example-replay.js --platform ios --udid <exact-target> [--flow <manifest-flow-id>]",
    "  bun scripts/run-example-replay.js --platform android --serial <exact-target> [--flow <manifest-flow-id>]",
    "",
    "Without --flow, the runner executes every flow in e2e/auth-replay-coverage.json.",
    "The selected release example must already be installed and signed out.",
  ].join("\n");
}

function parseArgs(argv) {
  const options = {};
  const flows = [];
  const allowed = new Set(["--platform", "--udid", "--serial", "--flow"]);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!allowed.has(flag)) {
      throw new Error(`Unknown replay option: ${flag}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value\n${usage()}`);
    }
    if (flag === "--flow") {
      if (!flowIdPattern.test(value)) {
        throw new Error(`Invalid replay flow id: ${value}`);
      }
      if (flows.includes(value)) {
        throw new Error(`Replay flow may only be selected once: ${value}`);
      }
      flows.push(value);
      index += 1;
      continue;
    }
    if (Object.hasOwn(options, flag)) {
      throw new Error(`Replay option may only be supplied once: ${flag}`);
    }
    options[flag] = value;
    index += 1;
  }

  const platform = options["--platform"];
  if (platform !== "ios" && platform !== "android") {
    throw new Error(`--platform must be ios or android\n${usage()}`);
  }
  const targetFlag = platform === "ios" ? "--udid" : "--serial";
  const otherTargetFlag = platform === "ios" ? "--serial" : "--udid";
  if (options[otherTargetFlag] !== undefined) {
    throw new Error(`${otherTargetFlag} does not select a ${platform} target`);
  }
  const target = options[targetFlag];
  if (!target || target.trim() === "") {
    throw new Error(
      `Provide one exact ${platform} target with ${targetFlag}\n${usage()}`,
    );
  }
  if (target.includes(",")) {
    throw new Error(
      `${targetFlag} must identify one target; comma-separated targets are ambiguous`,
    );
  }
  return { platform, targetFlag, target: target.trim(), flowIds: flows };
}

function readSuites(manifestFile = coveragePath, selectedFlowIds = []) {
  const root = path.resolve(path.dirname(manifestFile), "..");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.suites)) {
    throw new Error(
      "Auth replay coverage manifest must use version 1 and list suites",
    );
  }
  if (manifest.suites.length === 0) {
    throw new Error(
      "Auth replay coverage manifest must list at least one flow",
    );
  }
  const suites = readValidatedSuites(root, manifest.suites).map(
    ({ suite }) => suite,
  );
  const ids = new Set(suites.map((suite) => suite.id));
  const unknownFlow = selectedFlowIds.find((id) => !ids.has(id));
  if (unknownFlow) {
    throw new Error(`Unknown replay flow: ${unknownFlow}`);
  }
  return selectedFlowIds.length === 0
    ? suites
    : suites.filter((suite) => selectedFlowIds.includes(suite.id));
}

function isWithinDirectory(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function createArtifactsDirectory(makeTempDirectory = fs.mkdtempSync) {
  const directory = makeTempDirectory(
    path.join(os.tmpdir(), "nitro-auth-agent-device-"),
  );
  if (
    !isWithinDirectory(os.tmpdir(), directory) ||
    isWithinDirectory(projectRoot, directory)
  ) {
    throw new Error(
      "Replay artifacts must use a unique directory under the OS temporary directory",
    );
  }
  return directory;
}

function runExampleReplay({
  argv,
  env = process.env,
  spawn = spawnSync,
  makeTempDirectory = fs.mkdtempSync,
  uuid = randomUUID,
  manifestFile = coveragePath,
  cwd = projectRoot,
} = {}) {
  const options = parseArgs(argv ?? []);
  const suites = readSuites(manifestFile, options.flowIds);
  if (suites.length === 0) {
    throw new Error("Replay selection contains no flows");
  }
  const artifactsDirectory = createArtifactsDirectory(makeTempDirectory);
  const runId = String(uuid());
  if (!/^[A-Za-z0-9-]+$/.test(runId)) {
    throw new Error("Replay session id source returned an unsafe value");
  }
  const session = `nitro-auth-replay-${runId}`;
  const targetArgs = [options.targetFlag, options.target];
  const args = [
    "test",
    ...suites.map((suite) => suite.path),
    ...targetArgs,
    "--session",
    session,
    "--artifacts-dir",
    artifactsDirectory,
    "--fail-fast",
    "--retries",
    "0",
    "--timeout",
    "180000",
  ];

  let result;
  try {
    result = spawn("agent-device", args, { cwd, env, stdio: "inherit" });
  } catch (error) {
    result = { status: null, error };
  }

  if (result.error) {
    process.stderr.write(
      `Could not start agent-device: ${result.error.message ?? "spawn failed"}\n`,
    );
  }
  const status = Number.isInteger(result.status) ? result.status : 1;
  if (result.error || status !== 0) {
    return status === 0 ? 1 : status;
  }
  return 0;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  return runExampleReplay({ argv });
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  parseArgs,
  readSuites,
  runExampleReplay,
};
