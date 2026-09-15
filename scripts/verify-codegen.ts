import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dir, "..");
const generatedRoot = join(
  projectRoot,
  "packages/react-native-nitro-auth/nitrogen/generated",
);

function digest(directory: string): string {
  const hash = createHash("sha256");
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = join(directory, entry.name);
    hash.update(entry.name);
    hash.update("\0");
    hash.update(entry.isDirectory() ? digest(path) : readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

// Compare the complete tree, including newly added bindings not yet tracked by Git.
const before = digest(generatedRoot);
const generated = Bun.spawnSync(["bun", "run", "codegen"], {
  cwd: projectRoot,
  stdout: "inherit",
  stderr: "inherit",
});
if (generated.exitCode !== 0) process.exit(generated.exitCode);
if (before !== digest(generatedRoot)) {
  console.error(
    "Generated bindings were stale. Review and include the regenerated files, then rerun verification.",
  );
  process.exit(1);
}
console.log("Generated Nitro bindings are reproducible.");
