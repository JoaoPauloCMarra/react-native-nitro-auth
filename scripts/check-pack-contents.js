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

const packageDir = path.resolve(
  __dirname,
  "../packages/react-native-nitro-auth",
);
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
  "cpp/PlatformAuth.cpp",
  "nitrogen/generated/shared/c++/HybridNativeAuthAdapterSpec.hpp",
  "nitrogen/generated/shared/c++/AuthSessionSnapshot.hpp",
  "nitrogen/generated/shared/c++/AuthCredential.hpp",
  "ios/AuthAdapter.swift",
  "ios/AuthAdapter+Google.swift",
  "ios/AuthAdapter+Microsoft.swift",
  "ios/AuthAdapter+Helpers.swift",
  "ios/PlatformAuthErrorCode.swift",
  "ios/GeneratedOAuthErrorCodes.swift",
  "ios/HybridNativeAuthAdapter.swift",
  "android/src/main/java/com/auth/AuthAdapter.kt",
  "android/src/main/java/com/auth/AuthErrorCode.kt",
  "android/src/main/java/com/auth/MicrosoftAuthConfig.kt",
  "android/src/main/java/com/auth/MicrosoftAuthTypes.kt",
  "android/src/main/java/com/auth/GoogleSessionStore.kt",
  "android/src/main/java/com/auth/OAuthErrorCodes.kt",
  "android/src/main/java/com/margelo/nitro/com/auth/HybridNativeAuthAdapter.kt",
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
  "assets/fonts/GoogleSans-Medium.ttf",
  "assets/fonts/GoogleSans-OFL.txt",
  "src/ui/social-button-core.tsx",
  "src/ui/social-button-renderer.tsx",
  "src/ui/social-button-marks.ts",
  "src/ui/social-button-assets.ts",
  "src/ui/official-social-button-renderer.tsx",
  "src/ui/official-social-button.tsx",
  "src/ui/official-social-button.web.tsx",
  "src/official-buttons.ts",
  "src/official-buttons.web.ts",
  "lib/commonjs/official-buttons.js",
  "lib/module/official-buttons.js",
  "lib/typescript/commonjs/official-buttons.d.ts",
  "lib/typescript/module/official-buttons.d.ts",
  "official-buttons/package.json",
  "src/ui/social-button-svg-assets.ts",
  "src/ui/official-social-button-svg-renderer.tsx",
  "src/ui/official-social-button-svg.tsx",
  "src/ui/official-social-button-svg.web.tsx",
  "src/official-buttons-svg.ts",
  "src/official-buttons-svg.web.ts",
  "lib/commonjs/official-buttons-svg.js",
  "lib/module/official-buttons-svg.js",
  "lib/typescript/commonjs/official-buttons-svg.d.ts",
  "lib/typescript/module/official-buttons-svg.d.ts",
  "official-buttons/svg/package.json",
  "src/ui/assets/provenance.json",
];

for (const provider of ["google", "apple"]) {
  for (const platform of ["android", "ios"]) {
    for (const appearance of ["light", "dark"]) {
      for (const shape of ["pill", "rectangular"]) {
        const filename = `${provider}-${platform}-${appearance}-${shape}.png`;
        for (const base of ["src", "lib/module", "lib/commonjs"]) {
          requiredFiles.push(`${base}/ui/assets/${filename}`);
          requiredFiles.push(
            `${base}/ui/assets/${filename.replace(".png", "-icon.png")}`,
          );
        }
      }
    }
  }
}

for (const filename of [
  "google-logo.png",
  "apple-mark-light.png",
  "apple-mark-dark.png",
]) {
  for (const base of ["src", "lib/module", "lib/commonjs"]) {
    requiredFiles.push(`${base}/ui/assets/${filename}`);
  }
}

function collectExportTargets(target) {
  if (typeof target === "string") return [target];
  if (!target || typeof target !== "object") return [];
  return Object.values(target).flatMap(collectExportTargets);
}

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

  const manifest = JSON.parse(
    fs.readFileSync(path.join(packageDir, "package.json"), "utf8"),
  );
  const exportsMap = manifest.exports ?? {};
  const declaredSubpaths = Object.keys(exportsMap).filter(
    (subpath) => subpath !== "./package.json",
  );
  for (const subpath of declaredSubpaths) {
    const target = exportsMap[subpath];
    const candidates = collectExportTargets(target);
    const unpacked = candidates.filter(
      (file) => !files.has(file.replace(/^\.\//, "")),
    );
    if (candidates.length === 0 || unpacked.length > 0) {
      console.error(
        `Package content audit failed. Subpath export ${subpath} has unpacked targets: ${JSON.stringify(unpacked.length > 0 ? unpacked : target)}`,
      );
      process.exit(1);
    }
  }

  console.log(
    `Package content audit passed (${requiredFiles.length} required files, ${declaredSubpaths.length} subpath exports).`,
  );
}

main();
