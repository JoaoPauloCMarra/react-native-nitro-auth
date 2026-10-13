"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { securitySupportsVersion } = require("./assert-security-support");

const table = (line) =>
  [
    "| Version   | Supported          |",
    "| --------- | ------------------ |",
    line,
    "| older 0.x | :x:                |",
  ].join("\n");

test("accepts the release line marked supported", () => {
  assert.equal(
    securitySupportsVersion(
      table("| 0.14.x    | :white_check_mark: |"),
      "0.14.0",
    ),
    true,
  );
  assert.equal(
    securitySupportsVersion(
      table("| 0.14.x    | :white_check_mark: |"),
      "0.14.7",
    ),
    true,
  );
});

test("rejects a stale or unsupported release line", () => {
  assert.equal(
    securitySupportsVersion(
      table("| 0.13.x    | :white_check_mark: |"),
      "0.14.0",
    ),
    false,
  );
  assert.equal(
    securitySupportsVersion(
      table("| 0.14.x    | :x:                |"),
      "0.14.0",
    ),
    false,
  );
});

test("rejects malformed versions", () => {
  assert.throws(
    () => securitySupportsVersion(table("| 0.14.x |"), "v0.14"),
    /semantic version/,
  );
});

test("the shipped SECURITY.md supports the package version", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const { version } = JSON.parse(
    fs.readFileSync(
      path.join(root, "packages", "react-native-nitro-auth", "package.json"),
      "utf8",
    ),
  );
  const security = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
  assert.equal(securitySupportsVersion(security, version), true);
});
