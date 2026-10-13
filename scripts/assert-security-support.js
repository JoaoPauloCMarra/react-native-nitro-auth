"use strict";

function securitySupportsVersion(markdown, version) {
  const match = /^(\d+)\.(\d+)\.\d+(?:[-+].*)?$/u.exec(version);
  if (!match) {
    throw new Error(`${version} is not a semantic version.`);
  }
  const line = `${match[1]}.${match[2]}.x`;
  return markdown
    .split("\n")
    .some(
      (row) =>
        row.trim().startsWith(`| ${line} `) &&
        row.includes(":white_check_mark:"),
    );
}

module.exports = { securitySupportsVersion };

if (require.main === module) {
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
  if (!securitySupportsVersion(security, version)) {
    console.error(`SECURITY.md does not list ${version} as supported.`);
    process.exit(1);
  }
}
