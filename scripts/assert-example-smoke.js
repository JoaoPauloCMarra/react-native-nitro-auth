const fs = require("node:fs");

const smokeSource = fs.readFileSync(
  "apps/example/components/SmokeTestCard.tsx",
  "utf8",
);
const maestroFlow = fs.readFileSync("maestro/smoke-tests.yaml", "utf8");
const requiredSourceMarkers = [
  'typeof hookReturn.silentRestore === "function"',
  'typeof AuthService.hasPlayServices === "boolean"',
  'test("silentRestore resolves"',
  'result.status === "fail" ? 1 : 0',
  "toAuthErrorCode(",
];
const requiredFlowMarkers = [
  "appId: com.auth.example",
  'element: "Smoke Tests"',
  'tapOn: "Run smoke tests"',
  "Run smoke tests again",
  "passed,.*skipped",
];

for (const marker of requiredSourceMarkers) {
  if (!smokeSource.includes(marker)) {
    throw new Error(`Example smoke source is missing: ${marker}`);
  }
}

for (const marker of requiredFlowMarkers) {
  if (!maestroFlow.includes(marker)) {
    throw new Error(`Maestro flow is missing: ${marker}`);
  }
}

const testCount = (smokeSource.match(/\btest\(/g) ?? []).length;
if (testCount < 8) {
  throw new Error(`Example smoke suite is unexpectedly small: ${testCount}`);
}

console.log(
  `Example smoke contract is valid: ${testCount} labeled tests and terminal-state Maestro assertions.`,
);
