import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const {
  checkReplayFreshness,
  collectRuntimeFiles,
  readCoverageManifest,
  refreshReplayLock,
} =
  require("./check-example-replay-freshness.js") as typeof import("./check-example-replay-freshness.js");
const { parseArgs, readSuites, runExampleReplay } =
  require("./run-example-replay.js") as typeof import("./run-example-replay.js");

const projectRoot = path.resolve(__dirname, "..");

function writeFile(root: string, relativePath: string, contents: string): void {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function createReplayFixture(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "nitro-auth-replay-test-"),
  );
  writeFile(
    root,
    "packages/react-native-nitro-auth/src/index.ts",
    "export const apiVersion = 1;\n",
  );
  writeFile(
    root,
    "packages/react-native-nitro-auth/android/src/main/AuthAdapter.kt",
    "class AuthAdapter\n",
  );
  writeFile(
    root,
    "packages/react-native-nitro-auth/ios/AuthAdapter.swift",
    "final class AuthAdapter\n",
  );
  writeFile(
    root,
    "packages/react-native-nitro-auth/cpp/HybridAuth.cpp",
    "void authenticate() {}\n",
  );
  writeFile(
    root,
    "packages/react-native-nitro-auth/nitrogen/generated/android/Auth.kt",
    "class AuthBinding\n",
  );
  writeFile(root, "packages/react-native-nitro-auth/nitro.json", "{}\n");
  writeFile(root, "packages/react-native-nitro-auth/package.json", "{}\n");
  writeFile(root, "apps/example/app/e2e.tsx", "export const screen = true;\n");
  writeFile(
    root,
    "apps/example/components/probe.tsx",
    '<Button testID="probe-run" /><Text testID="probe-status">pass:probe</Text>\nconst result = value === undefined;\n',
  );
  writeFile(root, "apps/example/assets/icon.svg", "<svg />\n");
  writeFile(root, "apps/example/app.config.js", "module.exports = {};\n");
  writeFile(root, "apps/example/package.json", "{}\n");
  writeFile(
    root,
    "e2e/probe.ad",
    'open "com.auth.example"\nwait id="probe-screen"\npress id="probe-run"\nwait id="probe-status"\nwait text "pass:probe"\nclose\n',
  );
  writeFile(
    root,
    "e2e/auth-replay-coverage.json",
    `${JSON.stringify(
      {
        version: 1,
        entry: "scripts/run-example-replay.js",
        suites: [
          {
            id: "probe",
            path: "e2e/probe.ad",
            purpose: "Probe a public result",
          },
        ],
        features: [
          {
            id: "probe.result",
            coverage: "replay-asserted",
            kind: "public-api",
            transport: "Local public API result",
            suite: "e2e/probe.ad",
            source: "apps/example/components/probe.tsx",
            controlId: "probe-run",
            statusId: "probe-status",
            expectedText: "pass:probe",
            assertion: "value === undefined",
          },
        ],
        pending: [
          {
            id: "provider.pending",
            state: "pending-prerequisites",
            reason: "Requires configured provider staging evidence",
            prerequisites: ["Approved test account"],
            acceptance: "Verify the provider result and server-side session.",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return root;
}

function removeTempDirectories(directories: string[]): void {
  for (const directory of directories) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("the checked-in Auth replay manifest and source lock are current", () => {
  const result = checkReplayFreshness({ root: projectRoot });
  assert.equal(result.fresh, true, result.reason);
});

test("runtime source drift invalidates the lock until an explicit refresh", () => {
  const root = createReplayFixture();
  const manifestPath = "e2e/auth-replay-coverage.json";
  const lockPath = "e2e/auth-replay-source-lock.json";
  try {
    const initial = refreshReplayLock({ root, manifestPath, lockPath });
    assert.equal(
      checkReplayFreshness({ root, manifestPath, lockPath }).fresh,
      true,
    );

    writeFile(
      root,
      "packages/react-native-nitro-auth/src/index.ts",
      "export const apiVersion = 2;\n",
    );
    const stale = checkReplayFreshness({ root, manifestPath, lockPath });
    assert.equal(stale.fresh, false);
    assert.notEqual(
      stale.expected?.runtimeSourceSha256,
      initial.runtimeSourceSha256,
    );

    const refreshed = refreshReplayLock({ root, manifestPath, lockPath });
    assert.notEqual(refreshed.runtimeSourceSha256, initial.runtimeSourceSha256);
    assert.equal(
      checkReplayFreshness({ root, manifestPath, lockPath }).fresh,
      true,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("freshness covers runtime wiring and excludes tests and generated app projects", () => {
  const root = createReplayFixture();
  try {
    writeFile(root, "apps/example/android/app/src/main/Main.kt", "generated\n");
    writeFile(root, "apps/example/ios/AppDelegate.swift", "generated\n");
    writeFile(root, "apps/example/.env.local", "DO_NOT_HASH_ME\n");
    writeFile(
      root,
      "packages/react-native-nitro-auth/src/__tests__/unit.test.ts",
      "test\n",
    );
    writeFile(
      root,
      "packages/react-native-nitro-auth/android/src/test/AuthTest.kt",
      "test\n",
    );

    const files = collectRuntimeFiles(root);
    assert.ok(files.includes("packages/react-native-nitro-auth/src/index.ts"));
    assert.ok(
      files.includes(
        "packages/react-native-nitro-auth/android/src/main/AuthAdapter.kt",
      ),
    );
    assert.ok(
      files.includes(
        "packages/react-native-nitro-auth/nitrogen/generated/android/Auth.kt",
      ),
    );
    assert.ok(files.includes("apps/example/components/probe.tsx"));
    assert.ok(files.includes("apps/example/assets/icon.svg"));
    assert.ok(files.includes("apps/example/app.config.js"));
    assert.ok(
      !files.some((file) => file.includes("/__tests__/")),
      "unit tests must not enter the runtime digest",
    );
    assert.ok(
      !files.some((file) => file.startsWith("apps/example/android/")),
      "generated Android app projects must not enter the runtime digest",
    );
    assert.ok(
      !files.some((file) => file.startsWith("apps/example/ios/")),
      "generated iOS app projects must not enter the runtime digest",
    );
    assert.ok(!files.includes("apps/example/.env.local"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a missing concrete source assertion or replay expectation fails freshness", () => {
  const root = createReplayFixture();
  const manifestPath = "e2e/auth-replay-coverage.json";
  const lockPath = "e2e/auth-replay-source-lock.json";
  try {
    refreshReplayLock({ root, manifestPath, lockPath });
    const sourcePath = "apps/example/components/probe.tsx";
    const source = fs.readFileSync(path.join(root, sourcePath), "utf8");
    writeFile(root, sourcePath, source.replace("value === undefined", "value"));

    const missingAssertion = checkReplayFreshness({
      root,
      manifestPath,
      lockPath,
    });
    assert.equal(missingAssertion.fresh, false);
    assert.match(missingAssertion.reason ?? "", /public assertion is missing/i);
    assert.throws(
      () => refreshReplayLock({ root, manifestPath, lockPath }),
      /public assertion is missing/i,
    );

    writeFile(root, sourcePath, source);
    refreshReplayLock({ root, manifestPath, lockPath });
    const original = fs.readFileSync(path.join(root, "e2e/probe.ad"), "utf8");
    writeFile(
      root,
      "e2e/probe.ad",
      original.replace('wait text "pass:probe"\n', ""),
    );

    const result = checkReplayFreshness({ root, manifestPath, lockPath });
    assert.equal(result.fresh, false);
    assert.match(result.reason ?? "", /expected text|assertion/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("all manifest flows are distinct, safe, present, and closed", () => {
  const suites = readSuites();
  assert.deepEqual(
    suites.map((suite) => suite.id),
    [
      "full-features",
      "deeplink",
      "credentials",
      "signed-out-extended",
      "button-behavior",
    ],
  );
  for (const suite of suites) {
    const source = fs.readFileSync(path.join(projectRoot, suite.path), "utf8");
    assert.match(
      source,
      /^close\s*$/m,
      `${suite.path} must close its app flow`,
    );
    assert.match(source.trimEnd(), /\bclose\s*$/);
  }
});

test("coverage distinguishes visual-only assertions from provider acceptance", () => {
  const { manifest } = readCoverageManifest(projectRoot);
  const visualFeatures = manifest.features.filter(
    (feature: { kind: string }) => feature.kind === "visual-only",
  );
  assert.deepEqual(
    visualFeatures.map((feature: { id: string }) => feature.id),
    [
      "social-button.google-visual",
      "social-button.apple-visual",
      "social-button.icon-only-size",
      "social-button.disabled-press",
      "social-button.busy-press-guard",
      "social-button.on-error",
      "social-button.microsoft-outline",
      "social-button.busy-state-propagation",
    ],
  );
  assert.ok(
    visualFeatures.every(
      (feature: { claimLimit?: string }) => feature.claimLimit,
    ),
  );
  assert.ok(
    manifest.pending.every(
      (row: { state: string; prerequisites: unknown[]; acceptance: string }) =>
        row.state === "pending-prerequisites" &&
        row.prerequisites.length > 0 &&
        row.acceptance.length > 0,
    ),
  );
  assert.ok(
    manifest.pending.some(
      (row: { id: string }) => row.id === "auth.refresh-and-deduplication",
    ),
  );
  assert.ok(
    manifest.pending.some(
      (row: { id: string }) => row.id === "auth.credential-server-verification",
    ),
  );
  assert.ok(
    manifest.pending.some(
      (row: { id: string }) => row.id === "credentials.nonce-web-native-bridge",
    ),
  );
  assert.ok(
    manifest.pending.some(
      (row: { id: string }) => row.id === "auth.scope-consent",
    ),
  );
  assert.ok(
    manifest.features.some(
      (feature: { id: string; kind: string }) =>
        feature.id === "smoke.provider-probes-remain-pending" &&
        feature.kind === "coverage-state",
    ),
  );
  assert.ok(
    manifest.pending.some(
      (row: { id: string }) =>
        row.id === "auth.provider-cancellation-and-dispose",
    ),
  );
  assert.ok(
    !manifest.features.some((feature: { id: string }) =>
      feature.id.startsWith("provider-cancel."),
    ),
  );
  for (const suite of manifest.suites) {
    const source = fs.readFileSync(path.join(projectRoot, suite.path), "utf8");
    assert.doesNotMatch(source, /press id="e2e-silent-restore"/);
    assert.doesNotMatch(source, /press id="smoke-run-provider-probes"/);
    assert.doesNotMatch(source, /wait id="smoke-[^"]+-status"/);
  }
});

test("missing platform or exact target fails before spawn", () => {
  const calls: unknown[][] = [];
  let tempDirectoryCalls = 0;
  const spawn = (...args: unknown[]) => {
    calls.push(args);
    return { status: 0 };
  };
  assert.throws(
    () =>
      runExampleReplay({
        argv: ["--udid", "sim-1"],
        env: {},
        makeTempDirectory: () => {
          tempDirectoryCalls += 1;
          return "unused";
        },
        spawn,
      }),
    /--platform must be ios or android/,
  );
  assert.throws(
    () =>
      runExampleReplay({
        argv: ["--platform", "ios"],
        env: {},
        makeTempDirectory: () => {
          tempDirectoryCalls += 1;
          return "unused";
        },
        spawn,
      }),
    /Provide one exact ios target with --udid/,
  );
  assert.equal(calls.length, 0);
  assert.equal(tempDirectoryCalls, 0);
});

test("invalid flow selection and ambiguous targets fail before spawn", () => {
  const calls: unknown[][] = [];
  const spawn = (...args: unknown[]) => {
    calls.push(args);
    return { status: 0 };
  };
  assert.throws(
    () =>
      parseArgs([
        "--platform",
        "ios",
        "--udid",
        "sim-1,sim-2",
        "--flow",
        "credentials",
      ]),
    /comma-separated targets are ambiguous/,
  );
  assert.throws(
    () =>
      runExampleReplay({
        argv: [
          "--platform",
          "android",
          "--serial",
          "emulator-5554",
          "--flow",
          "does-not-exist",
        ],
        env: {},
        spawn,
      }),
    /unknown replay flow/i,
  );
  assert.equal(calls.length, 0);
});

test("runner sends the selected manifest flow to official agent-device test", () => {
  const calls: Array<{
    command: string;
    args: string[];
    options: { cwd: string; env: NodeJS.ProcessEnv };
  }> = [];
  const artifacts: string[] = [];
  const root = projectRoot;
  try {
    const status = runExampleReplay({
      argv: ["--platform", "ios", "--udid", "sim-123", "--flow", "credentials"],
      env: { PATH: "/bin", USER: "fixture" },
      uuid: () => "run-123",
      makeTempDirectory: (prefix: string) => {
        const directory = fs.mkdtempSync(prefix);
        artifacts.push(directory);
        return directory;
      },
      spawn: (
        command: string,
        args: string[],
        options: { cwd: string; env: NodeJS.ProcessEnv },
      ) => {
        calls.push({ command, args, options });
        return { status: 0 };
      },
      cwd: root,
    });
    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "agent-device");
    assert.deepEqual(calls[0]?.args, [
      "test",
      "e2e/qa-credentials.ad",
      "--udid",
      "sim-123",
      "--session",
      "nitro-auth-replay-run-123",
      "--artifacts-dir",
      artifacts[0],
      "--fail-fast",
      "--retries",
      "0",
      "--timeout",
      "180000",
    ]);
    assert.equal(calls[0]?.options.cwd, root);
    assert.equal(calls[0]?.options.env.PATH, "/bin");
    assert.equal(artifacts.length, 1);
    const relative = path.relative(os.tmpdir(), artifacts[0] ?? "");
    assert.ok(!relative.startsWith(".."));
    assert.ok(path.relative(root, artifacts[0] ?? "").startsWith(".."));
  } finally {
    removeTempDirectories(artifacts);
  }
});

test("default selection runs every manifest flow with one unique temp directory and session", () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const artifacts: string[] = [];
  try {
    const status = runExampleReplay({
      argv: ["--platform", "android", "--serial", "emulator-5554"],
      env: {},
      uuid: () => "all-run",
      makeTempDirectory: (prefix: string) => {
        const directory = fs.mkdtempSync(prefix);
        artifacts.push(directory);
        return directory;
      },
      spawn: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    });
    assert.equal(status, 0);
    assert.deepEqual(calls[0]?.args.slice(1, 6), [
      "e2e/qa-full-features.ad",
      "e2e/qa-deeplink.ad",
      "e2e/qa-credentials.ad",
      "e2e/qa-signed-out-extended.ad",
      "e2e/qa-button-behavior.ad",
    ]);
    assert.equal(calls[0]?.args[6], "--serial");
    assert.equal(artifacts.length, 1);
    assert.match(
      calls[0]?.args.join(" ") ?? "",
      /--session nitro-auth-replay-all-run/,
    );
    assert.match(calls[0]?.args.join(" ") ?? "", /--artifacts-dir/);
    assert.ok(
      !calls.some((call) =>
        /prebuild|expo run|start --/.test(call.args.join(" ")),
      ),
    );
  } finally {
    removeTempDirectories(artifacts);
  }
});

test("separate replay invocations get distinct OS temp directories and sessions", () => {
  const calls: Array<{ args: string[] }> = [];
  const artifacts: string[] = [];
  let nextRun = 0;
  try {
    for (const flow of ["deeplink", "credentials"]) {
      const status = runExampleReplay({
        argv: ["--platform", "ios", "--udid", "sim-unique", "--flow", flow],
        env: {},
        uuid: () => `unique-run-${++nextRun}`,
        makeTempDirectory: (prefix: string) => {
          const directory = fs.mkdtempSync(prefix);
          artifacts.push(directory);
          return directory;
        },
        spawn: (_command: string, args: string[]) => {
          calls.push({ args });
          return { status: 0 };
        },
      });
      assert.equal(status, 0);
    }
    assert.equal(new Set(artifacts).size, 2);
    assert.notEqual(
      calls[0]?.args[calls[0]?.args.indexOf("--session") + 1],
      calls[1]?.args[calls[1]?.args.indexOf("--session") + 1],
    );
    assert.notEqual(
      calls[0]?.args[calls[0]?.args.indexOf("--artifacts-dir") + 1],
      calls[1]?.args[calls[1]?.args.indexOf("--artifacts-dir") + 1],
    );
  } finally {
    removeTempDirectories(artifacts);
  }
});

test("failed replay returns the agent-device status without another spawn", () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const artifacts: string[] = [];
  try {
    const status = runExampleReplay({
      argv: [
        "--platform",
        "android",
        "--serial",
        "device-xyz",
        "--flow",
        "deeplink",
      ],
      env: {},
      uuid: () => "failed-run",
      makeTempDirectory: (prefix: string) => {
        const directory = fs.mkdtempSync(prefix);
        artifacts.push(directory);
        return directory;
      },
      spawn: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 17 };
      },
    });
    assert.equal(status, 17);
    assert.equal(calls.length, 1);
  } finally {
    removeTempDirectories(artifacts);
  }
});

test("spawn errors return a failing status without another spawn", () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const artifacts: string[] = [];
  try {
    const status = runExampleReplay({
      argv: ["--platform", "ios", "--udid", "sim-err"],
      env: {},
      uuid: () => "spawn-error",
      makeTempDirectory: (prefix: string) => {
        const directory = fs.mkdtempSync(prefix);
        artifacts.push(directory);
        return directory;
      },
      spawn: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: null, error: new Error("agent-device unavailable") };
      },
    });
    assert.equal(status, 1);
    assert.equal(calls.length, 1);
  } finally {
    removeTempDirectories(artifacts);
  }
});

test("git-ignored files inside hashed directories stay out of the runtime digest", () => {
  const root = createReplayFixture();
  try {
    writeFile(root, ".gitignore", "apps/example/expo-env.d.ts\n");
    writeFile(root, "apps/example/expo-env.d.ts", "generated\n");
    writeFile(root, "apps/example/env-types.d.ts", "tracked\n");
    const init = spawnSync("git", ["init", "-q"], { cwd: root });
    assert.equal(init.status, 0);
    const files = collectRuntimeFiles(root);
    assert.ok(!files.includes("apps/example/expo-env.d.ts"));
    assert.ok(files.includes("apps/example/env-types.d.ts"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("all example source, assets and generated bindings are watched without generated app projects", () => {
  const root = createReplayFixture();
  try {
    for (const file of [
      "apps/example/components/smoke-test.tsx",
      "apps/example/hooks/use-theme.ts",
      "apps/example/theme.ts",
      "apps/example/assets/qa-font.ttf",
      "packages/react-native-nitro-auth/nitrogen/generated/shared/Probe.hpp",
    ]) {
      writeFile(root, file, "runtime fixture\n");
    }
    writeFile(root, "apps/example/android/app/src/main/Main.kt", "generated\n");
    writeFile(root, "apps/example/ios/AppDelegate.swift", "generated\n");
    writeFile(root, "apps/example/.env.local", "DO_NOT_HASH\n");
    writeFile(
      root,
      "packages/react-native-nitro-auth/cpp/ProbeTest.cpp",
      "unit test\n",
    );
    const files = collectRuntimeFiles(root);
    for (const file of [
      "apps/example/components/smoke-test.tsx",
      "apps/example/hooks/use-theme.ts",
      "apps/example/theme.ts",
      "apps/example/assets/qa-font.ttf",
      "packages/react-native-nitro-auth/nitrogen/generated/shared/Probe.hpp",
    ])
      assert.ok(files.includes(file), file);
    assert.ok(
      !files.some(
        (file: string) =>
          file.startsWith("apps/example/android/") ||
          file.startsWith("apps/example/ios/"),
      ),
    );
    assert.ok(!files.includes("apps/example/.env.local"));
    assert.ok(
      !files.includes("packages/react-native-nitro-auth/cpp/ProbeTest.cpp"),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("external symlink flows fail before a runner spawn or lock refresh", () => {
  const root = createReplayFixture();
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), "nitro-auth-external-flow-"),
  );
  const manifestPath = "e2e/auth-replay-coverage.json";
  try {
    const manifestFile = path.join(root, manifestPath);
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    const suiteFile = path.join(root, manifest.suites[0].path);
    const outsideFile = path.join(outside, "external.ad");
    fs.copyFileSync(suiteFile, outsideFile);
    fs.unlinkSync(suiteFile);
    fs.symlinkSync(outsideFile, suiteFile);
    assert.throws(() => readSuites(manifestFile), /symlink|missing/);
    assert.throws(
      () =>
        refreshReplayLock({
          root,
          manifestPath,
          lockPath: "e2e/test-lock.json",
        }),
      /symlink|missing/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
