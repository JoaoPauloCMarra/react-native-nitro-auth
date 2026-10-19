#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { securitySupportsVersion } = require("./assert-security-support");

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

const projectRoot = path.resolve(__dirname, "..");
const packageDir = path.join(projectRoot, "packages/react-native-nitro-auth");
const packageJsonPath = path.join(packageDir, "package.json");
const startedAt = Date.now();

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function log(message, color = "green") {
  console.log(colors[color](message));
}

function run(command) {
  const result = spawnSync(command, {
    cwd: projectRoot,
    shell: true,
    stdio: "pipe",
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: process.env.NO_COLOR || "1",
    },
  });

  return {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function reportGitStatus() {
  const status = run("git status --porcelain");

  if (!status.ok) {
    throw new Error("Unable to read git status.");
  }

  if (status.stdout === "") {
    console.log("  ✓ Git working directory is clean");
    return;
  }

  console.log(
    "  • Git working directory has changes; continuing for validation only",
  );
}

function checkRegistryVersion(packageName, version) {
  const result = run(`bun pm view ${packageName}@${version} version`);

  if (result.ok && result.stdout === version) {
    log(
      `  ! ${packageName}@${version} already exists on npm; continuing dry-run validation`,
      "yellow",
    );
    return;
  }

  const registryMessage = `${result.stdout}\n${result.stderr}`;
  const versionNotFound =
    registryMessage.includes("No version of") ||
    registryMessage.includes("not found") ||
    registryMessage.includes("404");

  if (!result.ok && !versionNotFound) {
    log("  ! Could not verify existing npm version; continuing", "yellow");
    return;
  }

  console.log(`  ✓ ${packageName}@${version} is not published`);
}

function recordCurrentRegistryState(packageName) {
  const result = run(`bun pm view ${packageName} dist-tags --json`);
  if (!result.ok || result.stdout === "") {
    log(
      `  ! Could not read current dist-tags for ${packageName}; continuing`,
      "yellow",
    );
    return;
  }
  try {
    const tags = JSON.parse(result.stdout);
    console.log(`  ✓ Current registry dist-tags: ${JSON.stringify(tags)}`);
  } catch {
    console.log(`  ✓ Current registry dist-tags: ${result.stdout}`);
  }
}

function assertReleaseTag(version) {
  const expected = `v${version}`;
  const result = run("git tag --points-at HEAD");
  const tags = result.ok
    ? result.stdout
        .split("\n")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];

  if (tags.includes(expected)) {
    console.log(`  ✓ HEAD is exactly tagged ${expected}`);
    return;
  }
  log(
    `  ! HEAD is not tagged ${expected}; release existence/provenance stays PENDING in dry run`,
    "yellow",
  );
}

function assertSecurityPolicySupports(version) {
  const security = fs.readFileSync(
    path.join(projectRoot, "SECURITY.md"),
    "utf8",
  );
  if (!securitySupportsVersion(security, version)) {
    throw new Error(`SECURITY.md does not list ${version} as supported.`);
  }
  console.log(`  ✓ SECURITY.md supports ${version}`);
}

function assertChangelogCovers(version) {
  const changelogPath = path.join(packageDir, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  const topEntry = changelog
    .match(/^##\s+([^\s]+)/m)?.[1]
    ?.replace(/^[[]|]$/g, "");

  if (topEntry === version) {
    console.log(`  ✓ CHANGELOG.md top entry covers ${version}`);
    return;
  }

  if (topEntry === "Unreleased") {
    log(
      "  ! CHANGELOG.md top entry is Unreleased; rename it to the release version before publishing",
      "yellow",
    );
    return;
  }

  throw new Error(
    `CHANGELOG.md top entry is ${topEntry ?? "missing"}, expected ${version}.`,
  );
}

function main() {
  const packageJson = readPackageJson();

  console.log("");
  log("Publish dry run: react-native-nitro-auth", "bold");
  log(`Version: ${packageJson.version}`, "cyan");
  log(
    "Live publishing runs only in .github/workflows/npm-publish.yml; pack contents are checked by audit:package.",
    "cyan",
  );
  console.log("");

  reportGitStatus();
  assertReleaseTag(packageJson.version);
  assertChangelogCovers(packageJson.version);
  assertSecurityPolicySupports(packageJson.version);
  checkRegistryVersion(packageJson.name, packageJson.version);
  recordCurrentRegistryState(packageJson.name);

  log("Dry run complete. Release metadata is consistent.", "green");
  console.log(`Finished in ${formatDuration(Date.now() - startedAt)}`);
}

try {
  main();
} catch (error) {
  log(error.message, "red");
  process.exit(1);
}
