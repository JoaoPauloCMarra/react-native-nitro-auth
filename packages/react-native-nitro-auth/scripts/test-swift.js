/* eslint-disable no-console */
const { spawnSync } = require("child_process");
const path = require("path");

if (process.platform !== "darwin") {
  console.log(
    `Swift tests need macOS with Xcode (skipped on ${process.platform}).`,
  );
  process.exit(0);
}

const packagePath = path.join(__dirname, "../swift-tests");
const run = spawnSync("swift", ["test", "--package-path", packagePath], {
  stdio: "inherit",
});

if (run.error) {
  console.error(`Unable to run swift test: ${run.error.message}`);
  process.exit(1);
}
if (run.status !== 0) {
  console.error("Swift tests failed");
  process.exit(1);
}

console.log("Swift tests completed successfully");
