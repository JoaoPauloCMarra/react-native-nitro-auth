"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const {
  createPackageDocLifecycle,
} = require("../../../scripts/package-doc-lifecycle.js");

const packageRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(packageRoot, "../..");
const requiredFiles = [
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "LICENSE",
  "docs/error-contract.md",
];
const lifecycle = createPackageDocLifecycle({
  repoRoot,
  packageRoot,
  entries: [
    { source: "README.md", target: "README.md" },
    { source: "CHANGELOG.md", target: "CHANGELOG.md" },
    { source: "LICENSE", target: "LICENSE" },
    { source: "SECURITY.md", target: "SECURITY.md" },
    { source: "docs", target: "docs", persistent: false },
    {
      source: "docs/error-contract.md",
      target: "docs/error-contract.md",
      persistent: false,
      copy: false,
    },
  ],
});

function parsePackedFiles(output) {
  const files = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^packed\s+\S+\s+(.+)$/);
    if (!match) continue;
    let entry = match[1].trim();
    if (entry.startsWith('"') && entry.endsWith('"')) {
      entry = entry.slice(1, -1);
    }
    files.push(entry);
  }
  return files;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} exited with ${result.status}`,
    );
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function checkPackedFiles(output) {
  const packedFiles = parsePackedFiles(output);
  if (packedFiles.length === 0) {
    throw new Error("bun pm pack produced no file list");
  }
  for (const required of requiredFiles) {
    if (!packedFiles.includes(required)) {
      throw new Error(`Missing required packed file: ${required}`);
    }
  }
  return packedFiles.length;
}

const mode = process.argv[2] || "pack";
if (mode !== "pack" && mode !== "publish") {
  process.stderr.write(
    "Usage: node scripts/package-dry-run.js <pack|publish>\n",
  );
  process.exitCode = 1;
} else {
  let prepared = false;
  try {
    lifecycle.prepare();
    prepared = true;
    const packOutput = run("bun", [
      "pm",
      "pack",
      "--dry-run",
      "--ignore-scripts",
    ]);
    const packedCount = checkPackedFiles(packOutput);
    if (mode === "publish") {
      process.stdout.write(
        "Publish dry-run uses the auth-free pack proof; no publish command was sent.\n",
      );
    }
    process.stdout.write(
      `Package artifact dry-run passed (${packedCount} files).\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  } finally {
    if (prepared) {
      try {
        lifecycle.cleanup();
      } catch (error) {
        process.stderr.write(
          `Lifecycle cleanup failed; preserve ${lifecycle.stateRoot}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    }
  }
}
