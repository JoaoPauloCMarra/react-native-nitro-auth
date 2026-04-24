#!/usr/bin/env node

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const colors = {
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  dim: (text) => `\x1b[2m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

const projectRoot = path.resolve(__dirname, "..");
const packageDir = path.join(projectRoot, "packages/react-native-nitro-auth");
const exampleDir = path.join(projectRoot, "apps/example");
const packageJsonPath = path.join(packageDir, "package.json");
const startedAt = Date.now();

const args = process.argv.slice(2);
const dryRun = hasFlag("--dry-run");
const skipChecks = hasFlag("--skip-checks");
const skipGitCheck = hasFlag("--skip-git-check");
const skipExpoDoctor = hasFlag("--skip-expo-doctor");
const quick = hasFlag("--quick");
const tag = getArgValue("--tag") || "latest";
const otp = getArgValue("--otp");

function hasFlag(name) {
  return args.includes(name);
}

function getArgValue(name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

function log(message, color = "green") {
  console.log(colors[color](message));
}

function run(command, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd: options.cwd || projectRoot,
    shell: true,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: {
      ...process.env,
      NO_COLOR: process.env.NO_COLOR || "1",
    },
  });

  const output = {
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
    durationMs: Date.now() - started,
  };

  return output;
}

function must(command, options = {}) {
  const label = options.label || command;
  log(`  • ${label}`, "cyan");
  const result = run(command, options);

  if (!result.ok) {
    throw new Error(`Command failed: ${command}`);
  }

  console.log(colors.dim(`    done in ${formatDuration(result.durationMs)}`));
  return result;
}

function readPackageJson() {
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function requireCleanGitStatus() {
  const status = run("git status --porcelain", { capture: true });

  if (!status.ok) {
    throw new Error("Unable to read git status.");
  }

  if (status.stdout === "") {
    console.log("  ✓ Git working directory is clean");
    return;
  }

  if (dryRun || skipGitCheck) {
    log(
      "  ! Git working directory has changes; continuing for validation only",
      "yellow",
    );
    return;
  }

  throw new Error(
    "Git working directory has changes. Commit or pass --skip-git-check.",
  );
}

function checkRegistryVersion(packageName, version) {
  const result = run(`bun pm view ${packageName}@${version} version`, {
    capture: true,
  });

  if (result.ok && result.stdout === version) {
    throw new Error(`${packageName}@${version} already exists on npm.`);
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

function checkPublishAuth() {
  if (dryRun) {
    console.log("  ✓ npm auth not required for dry run");
    return;
  }

  const whoami = run("bun pm whoami", { capture: true });
  if (!whoami.ok || whoami.stdout === "") {
    throw new Error("Not logged in to npm. Run: bunx npm login");
  }

  console.log(`  ✓ Logged in to npm as ${whoami.stdout}`);
}

function buildPublishArgs() {
  const publishArgs = [`--tag ${tag}`, "--access public", "--ignore-scripts"];

  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  if (otp) {
    publishArgs.push(`--otp ${otp}`);
  }

  return publishArgs;
}

function getReleaseSteps() {
  const steps = [
    [
      "bun install --frozen-lockfile",
      { label: "Install with frozen lockfile" },
    ],
    ["bun run verify:core-versions", { label: "Verify pinned core versions" }],
    ["bun run codegen", { label: "Generate Nitro specs" }],
    ["bun run build", { label: "Build package outputs" }],
    ["bun run check", { label: "Run lint, typecheck, and Jest" }],
    ["bun run test:cpp", { label: "Run C++ tests" }],
  ];

  if (!quick) {
    steps.push(
      [
        "bun run --cwd packages/react-native-nitro-auth test:coverage -- --runInBand",
        { label: "Run JS coverage gate" },
      ],
      [
        "bun run --cwd packages/react-native-nitro-auth test:cpp:coverage",
        { label: "Run C++ coverage gate" },
      ],
    );
  }

  if (!skipExpoDoctor) {
    steps.push([
      "bunx expo-doctor",
      { cwd: exampleDir, label: "Run Expo Doctor" },
    ]);
  }

  return steps;
}

function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function main() {
  const packageJson = readPackageJson();
  const publishArgs = buildPublishArgs();

  console.log("");
  log("Publishing react-native-nitro-auth", "bold");
  log(`Version: ${packageJson.version}`, "cyan");
  log(`Tag: ${tag}`, "cyan");
  log(`Mode: ${dryRun ? "dry run" : "publish"}`, dryRun ? "yellow" : "cyan");
  if (quick) log("Coverage checks: skipped by --quick", "yellow");
  console.log("");

  requireCleanGitStatus();
  checkRegistryVersion(packageJson.name, packageJson.version);
  checkPublishAuth();

  if (!skipChecks) {
    log("Running release checks...", "cyan");
    for (const [command, options] of getReleaseSteps()) {
      must(command, options);
    }
  } else {
    log("Skipping release checks by request", "yellow");
  }

  log("Syncing package docs...", "cyan");
  must("bun scripts/sync-package-docs.ts", {
    label: "Sync README, CHANGELOG, and LICENSE",
  });

  log("Checking package contents...", "cyan");
  must("bun pm pack --dry-run", { cwd: packageDir, label: "Pack dry run" });

  if (!dryRun) {
    const answer = await ask(
      `Publish ${packageJson.name}@${packageJson.version} to npm with tag "${tag}"? (yes/no): `,
    );

    if (answer !== "yes") {
      log("Publish cancelled", "yellow");
      return;
    }
  }

  log(dryRun ? "Running publish dry run..." : "Publishing to npm...", "cyan");
  must(`bun publish ${publishArgs.join(" ")}`, {
    cwd: packageDir,
    label: dryRun ? "Publish dry run" : "Publish package",
  });

  log(
    dryRun
      ? "Dry run complete. Package is publishable."
      : `Published ${packageJson.name}@${packageJson.version}.`,
    "green",
  );
  console.log(
    colors.dim(`Finished in ${formatDuration(Date.now() - startedAt)}`),
  );
}

main().catch((error) => {
  log(error.message, "red");
  process.exit(1);
});
