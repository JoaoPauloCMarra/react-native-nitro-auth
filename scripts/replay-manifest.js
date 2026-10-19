const fs = require("node:fs");
const path = require("node:path");

const flowIdPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isOutside(relative) {
  return (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  );
}

function inside(root, relativePath) {
  const absolute = path.resolve(root, relativePath);
  if (isOutside(path.relative(path.resolve(root), absolute))) {
    throw new Error(`Replay path escapes the repository: ${relativePath}`);
  }
  if (fs.existsSync(absolute)) {
    const resolved = path.relative(
      fs.realpathSync(root),
      fs.realpathSync(absolute),
    );
    if (isOutside(resolved)) {
      throw new Error(
        `Replay path escapes the repository through a symlink: ${relativePath}`,
      );
    }
  }
  return absolute;
}

function readValidatedSuites(root, manifestSuites) {
  const ids = new Set();
  const paths = new Set();
  return manifestSuites.map((suite) => {
    if (
      !suite ||
      typeof suite.id !== "string" ||
      !flowIdPattern.test(suite.id) ||
      ids.has(suite.id) ||
      typeof suite.path !== "string" ||
      !suite.path.startsWith("e2e/") ||
      suite.path.includes("..") ||
      suite.path.includes("\\") ||
      !suite.path.endsWith(".ad") ||
      paths.has(suite.path) ||
      typeof suite.purpose !== "string" ||
      suite.purpose.trim() === ""
    ) {
      throw new Error(
        "Auth replay manifest contains an invalid or duplicate flow",
      );
    }
    ids.add(suite.id);
    paths.add(suite.path);
    const suiteFile = inside(root, suite.path);
    if (!fs.existsSync(suiteFile) || !fs.lstatSync(suiteFile).isFile()) {
      throw new Error(`Replay flow is missing: ${suite.path}`);
    }
    const source = fs.readFileSync(suiteFile, "utf8");
    const commands = source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"));
    if (commands.at(-1) !== "close") {
      throw new Error(
        `${suite.path} must close its app flow as its final command`,
      );
    }
    return { suite, source };
  });
}

module.exports = { flowIdPattern, inside, readValidatedSuites };
