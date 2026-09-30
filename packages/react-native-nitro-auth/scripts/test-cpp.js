/* eslint-disable no-console */
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const coverageEnabled = process.argv.includes("--coverage");
const coverageThreshold = 90;
const includeDir = path.join(__dirname, "../cpp");
const nitrogenDir = path.join(__dirname, "../nitrogen/generated/shared/c++");
const mockIncludeDir = path.join(__dirname, "../cpp/__tests__/mock_includes");
const coverageDir = path.join(__dirname, "../cpp/__tests__/.coverage");
const tests = [
  {
    name: "hybrid-auth",
    sources: [
      path.join(__dirname, "../cpp/HybridAuth.cpp"),
      path.join(__dirname, "../cpp/__tests__/HybridAuthTests.cpp"),
    ],
    output: path.join(__dirname, "../cpp/__tests__/hybrid_auth_tests"),
    coverageSources: [path.join(__dirname, "../cpp/HybridAuth.cpp")],
  },
  {
    name: "auth-crypto",
    sources: [
      path.join(__dirname, "../cpp/AuthCrypto.cpp"),
      path.join(__dirname, "../cpp/__tests__/AuthCryptoTests.cpp"),
    ],
    output: path.join(__dirname, "../cpp/__tests__/auth_crypto_tests"),
    coverageSources: [path.join(__dirname, "../cpp/AuthCrypto.cpp")],
  },
];

function resolveTool(name) {
  const xcrun = spawnSync("xcrun", ["--find", name], {
    encoding: "utf8",
  });
  if (xcrun.status === 0 && xcrun.stdout.trim()) {
    return xcrun.stdout.trim();
  }

  const pathResult = spawnSync(
    "bash",
    ["-lc", `command -v ${name} || compgen -c ${name}- | sort -V | tail -n 1`],
    {
      encoding: "utf8",
    },
  );
  const resolvedPath = pathResult.stdout.trim();
  if (pathResult.status === 0 && resolvedPath) {
    return resolvedPath;
  }

  const homebrewPath = `/opt/homebrew/opt/llvm/bin/${name}`;
  if (fs.existsSync(homebrewPath)) {
    return homebrewPath;
  }

  throw new Error(`${name} is required for C++ coverage`);
}

function cleanupCoverageDir() {
  if (fs.existsSync(coverageDir)) {
    fs.rmSync(coverageDir, { recursive: true, force: true });
  }
  fs.mkdirSync(coverageDir, { recursive: true });
}

function parseTotalLine(output) {
  const totalLine = output
    .split("\n")
    .find((line) => line.trim().startsWith("TOTAL"));
  if (!totalLine) {
    throw new Error("Unable to find TOTAL line in C++ coverage output");
  }

  const percentages = [...totalLine.matchAll(/(\d+(?:\.\d+)?)%/g)].map(
    (match) => Number(match[1]),
  );
  if (percentages.length < 3) {
    throw new Error(`Unable to parse coverage percentages: ${totalLine}`);
  }

  return {
    region: percentages[0],
    function: percentages[1],
    line: percentages[2],
    branch: percentages[3],
  };
}

function assertCoverage(reportOutput) {
  const total = parseTotalLine(reportOutput);
  const enforced = {
    function: total.function,
    line: total.line,
  };
  const failures = Object.entries(enforced).filter(
    ([, value]) => typeof value === "number" && value < coverageThreshold,
  );

  if (failures.length > 0) {
    console.error(reportOutput);
    for (const [kind, value] of failures) {
      console.error(
        `C++ ${kind} coverage ${value}% is below ${coverageThreshold}%`,
      );
    }
    process.exit(1);
  }

  console.log(
    `C++ coverage passed: regions ${total.region}%, functions ${total.function}%, lines ${total.line}%, branches ${total.branch}%`,
  );
}

for (const file of [
  "HybridObject.hpp",
  "JSIConverter.hpp",
  "JSIHelpers.hpp",
  "NitroDefines.hpp",
  "NitroHash.hpp",
  "Promise.hpp",
  "PropNameIDCache.hpp",
]) {
  if (!fs.existsSync(path.join(mockIncludeDir, "NitroModules", file))) {
    console.error(`Missing tracked C++ test mock: NitroModules/${file}`);
    process.exit(1);
  }
}

if (coverageEnabled) {
  cleanupCoverageDir();
}

const coverageProfiles = [];
const coverageObjects = [];
const coverageSources = new Set();

for (const test of tests) {
  console.log(`Compiling ${test.name} C++ tests...`);
  const coverageFlags = coverageEnabled
    ? ["-fprofile-instr-generate", "-fcoverage-mapping"]
    : [];
  const compile = spawnSync(
    "clang++",
    [
      "-std=c++20",
      ...coverageFlags,
      "-I" + includeDir,
      "-I" + nitrogenDir,
      "-I" + mockIncludeDir,
      ...test.sources,
      "-o",
      test.output,
    ],
    { stdio: "inherit" },
  );

  if (compile.status !== 0) {
    console.error(`${test.name} compilation failed`);
    process.exit(1);
  }

  console.log(`Running ${test.name} C++ tests...`);
  const profilePath = path.join(coverageDir, `${test.name}.profraw`);
  const run = spawnSync(test.output, [], {
    stdio: "inherit",
    env: coverageEnabled
      ? { ...process.env, LLVM_PROFILE_FILE: profilePath }
      : process.env,
  });

  if (run.status !== 0) {
    console.error(`${test.name} tests failed`);
    process.exit(1);
  }

  if (coverageEnabled) {
    coverageProfiles.push(profilePath);
    coverageObjects.push(test.output);
    for (const source of test.coverageSources) {
      coverageSources.add(source);
    }
  }

  if (fs.existsSync(test.output)) {
    if (!coverageEnabled) {
      fs.unlinkSync(test.output);
    }
  }
}

if (coverageEnabled) {
  const profdata = resolveTool("llvm-profdata");
  const cov = resolveTool("llvm-cov");
  const mergedProfile = path.join(coverageDir, "coverage.profdata");

  const merge = spawnSync(
    profdata,
    ["merge", "-sparse", ...coverageProfiles, "-o", mergedProfile],
    { stdio: "inherit" },
  );
  if (merge.status !== 0) {
    console.error("C++ coverage profile merge failed");
    process.exit(1);
  }

  const [firstObject, ...additionalObjects] = coverageObjects;
  const reportArgs = [
    "report",
    firstObject,
    ...additionalObjects.flatMap((object) => ["-object", object]),
    "-instr-profile",
    mergedProfile,
    ...coverageSources,
  ];
  const report = spawnSync(cov, reportArgs, {
    encoding: "utf8",
  });
  if (report.status !== 0) {
    process.stdout.write(report.stdout);
    process.stderr.write(report.stderr);
    console.error("C++ coverage report failed");
    process.exit(1);
  }

  process.stdout.write(report.stdout);
  assertCoverage(report.stdout);

  for (const object of coverageObjects) {
    if (fs.existsSync(object)) {
      fs.unlinkSync(object);
    }
  }
}

console.log("C++ tests completed successfully");
