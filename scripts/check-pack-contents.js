#!/usr/bin/env node
/**
 * Package content audit (X4).
 *
 * Runs `bun pm pack --dry-run --ignore-scripts --json` and asserts that the
 * published package contains the real public surface: declarations, generated
 * Nitro bindings, native sources, the app plugin, required documentation, and
 * every declared subpath export. Auth-free and lifecycle-script-free by
 * construction.
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const packageDir = path.resolve(__dirname, "../packages/react-native-nitro-auth");
const projectRoot = path.resolve(__dirname, "..");
const docsSyncScript = path.join(projectRoot, "scripts/sync-package-docs.ts");

const requiredFiles = [
  "lib/typescript/commonjs/index.d.ts",
  "lib/typescript/module/index.d.ts",
  "lib/commonjs/index.js",
  "lib/module/index.js",
  "nitrogen/generated/shared/c++/HybridAuthSpec.hpp",
  "nitrogen/generated/shared/c++/AuthUser.hpp",
  "nitrogen/generated/shared/c++/AuthErrorCode.hpp",
  "nitrogen/generated/shared/c++/AuthEvent.hpp",
  "nitrogen/generated/shared/c++/AuthEventType.hpp",
  "cpp/HybridAuth.cpp",
  "cpp/HybridAuth.hpp",
  "cpp/AuthError.hpp",
  "cpp/PlatformAuth.hpp",
  "ios/AuthAdapter.swift",
  "ios/AuthAdapter+Google.swift",
  "ios/AuthAdapter+Microsoft.swift",
  "ios/AuthAdapter+Helpers.swift",
  "ios/AuthErrorCode.swift",
  "ios/GeneratedOAuthErrorCodes.swift",
  "ios/PlatformAuth+iOS.mm",
  "android/src/main/java/com/auth/AuthAdapter.kt",
  "android/src/main/java/com/auth/AuthErrorCode.kt",
  "android/src/main/java/com/auth/MicrosoftAuthConfig.kt",
  "android/src/main/java/com/auth/MicrosoftAuthTypes.kt",
  "android/src/main/java/com/auth/GoogleSessionStore.kt",
  "android/src/main/java/com/auth/OAuthErrorCodes.kt",
  "android/src/main/cpp/PlatformAuth+Android.cpp",
  "src/generated/oauth-error-codes.ts",
  "android/src/main/java/com/auth/NitroAuthModule.kt",
  "app.plugin.js",
  "react-native-nitro-auth.podspec",
  "nitro.json",
  "docs/error-contract.md",
  "README.md",
  "CHANGELOG.md",
  "SECURITY.md",
  "LICENSE",
];

function parsePackedFiles(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed.files)) {
      return new Set(
        parsed.files.map((entry) =>
          typeof entry === "string" ? entry : entry.path,
        ),
      );
    }
  } catch {
    // Bun prints a human-readable "packed <size> <path>" list instead.
  }
  const files = new Set();
  for (const line of stdout.split("\n")) {
    const match = line.match(/^packed\s+\S+\s+(.+)$/);
    if (match) {
      files.add(match[1]);
    }
  }
  return files;
}

function runDocsSync(mode) {
  const result = spawnSync("bun", [docsSyncScript, mode], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${mode} docs sync failed: ${result.stderr || result.stdout || "unknown error"}`,
    );
  }
}

function main() {
  let files;
  try {
    try {
      runDocsSync("prepare");
      const pack = spawnSync(
        "bun",
        ["pm", "pack", "--dry-run", "--ignore-scripts"],
        {
          cwd: packageDir,
          encoding: "utf8",
        },
      );
      if (pack.status !== 0) {
        throw new Error(pack.stderr || pack.stdout || "pack dry run failed");
      }

      files = parsePackedFiles(pack.stdout);
      if (files.size === 0) {
        throw new Error(`Unable to parse pack output:\n${pack.stdout}`);
      }
    } finally {
      runDocsSync("cleanup");
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }

  const missing = requiredFiles.filter((file) => !files.has(file));
  if (missing.length > 0) {
    console.error("Package content audit failed. Missing required files:");
    for (const file of missing) {
      console.error(`  - ${file}`);
    }
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"));
  const exportsMap = manifest.exports ?? {};
  const declaredSubpaths = Object.keys(exportsMap).filter(
    (subpath) => subpath !== "./package.json",
  );
  for (const subpath of declaredSubpaths) {
    const target = exportsMap[subpath];
    const candidates = [];
    if (typeof target === "string") {
      candidates.push(target);
    } else if (target && typeof target === "object") {
      for (const condition of ["import", "require", "react-native", "browser", "default"]) {
        const value = target[condition];
        if (typeof value === "string") {
          candidates.push(value);
        }
      }
    }
    if (candidates.length === 0 || !candidates.some((file) => files.has(file.replace(/^\.\//, "")))) {
      console.error(
        `Package content audit failed. Subpath export ${subpath} resolves to "${JSON.stringify(target)}" but none of its targets are packed.`,
      );
      process.exit(1);
    }
  }

  console.log(`Package content audit passed (${requiredFiles.length} required files, ${declaredSubpaths.length} subpath exports).`);
}

main();
