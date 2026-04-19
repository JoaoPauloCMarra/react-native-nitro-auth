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
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
};

const projectRoot = path.resolve(__dirname, "..");
const packageDir = path.join(projectRoot, "packages/react-native-nitro-auth");
const packageJsonPath = path.join(packageDir, "package.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipChecks = args.includes("--skip-checks");
const skipGitCheck = args.includes("--skip-git-check");
const tag = getArgValue("--tag") || "latest";
const otp = getArgValue("--otp");

function getArgValue(name) {
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function log(message, color = "green") {
  console.log(colors[color](message));
}

function run(command, options = {}) {
  const result = spawnSync(command, {
    cwd: options.cwd || projectRoot,
    shell: true,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    env: process.env,
  });

  if (options.capture) {
    return {
      ok: result.status === 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  }

  return { ok: result.status === 0, stdout: "", stderr: "" };
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
    log("  ! Git working directory has changes; continuing for validation only", "yellow");
    return;
  }

  throw new Error("Git working directory has changes. Commit or pass --skip-git-check.");
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

function must(command, options = {}) {
  if (!run(command, options).ok) {
    throw new Error(`Command failed: ${command}`);
  }
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
  const publishArgs = [`--tag ${tag}`, "--access public"];

  if (dryRun) {
    publishArgs.push("--dry-run");
  }

  if (otp) {
    publishArgs.push(`--otp ${otp}`);
  }

  console.log("");
  log("Publishing react-native-nitro-auth", "bold");
  log(`Version: ${packageJson.version}`, "cyan");
  log(`Tag: ${tag}`, "cyan");
  log(`Mode: ${dryRun ? "dry run" : "publish"}`, dryRun ? "yellow" : "cyan");
  console.log("");

  requireCleanGitStatus();
  checkRegistryVersion(packageJson.name, packageJson.version);
  checkPublishAuth();

  if (!skipChecks) {
    log("Running release checks...", "cyan");
    must("bun install --frozen-lockfile");
    must("bun run verify:core-versions");
    must("bun run codegen");
    must("bun run build");
    must("bun run check");
    must("bun run test:cpp");
    must("bunx expo-doctor", { cwd: path.join(projectRoot, "apps/example") });
  } else {
    log("Skipping release checks by request", "yellow");
  }

  log("Syncing package docs...", "cyan");
  must("bun scripts/sync-package-docs.ts");

  log("Checking package contents...", "cyan");
  must("bun pm pack --dry-run", { cwd: packageDir });

  if (!dryRun) {
    const answer = await ask(
      `Publish ${packageJson.name}@${packageJson.version} to npm with tag "${tag}"? (yes/no): `
    );

    if (answer !== "yes") {
      log("Publish cancelled", "yellow");
      return;
    }
  }

  log(dryRun ? "Running publish dry run..." : "Publishing to npm...", "cyan");
  must(`bun publish ${publishArgs.join(" ")}`, { cwd: packageDir });

  log(
    dryRun
      ? "Dry run complete. Package is publishable."
      : `Published ${packageJson.name}@${packageJson.version}.`,
    "green"
  );
}

main().catch((error) => {
  log(error.message, "red");
  process.exit(1);
});
