import { spawnSync } from "node:child_process";

const mode = process.argv[2] ?? "sync";
const result = spawnSync(
  "node",
  [`${import.meta.dir}/package-doc-lifecycle.js`, mode],
  {
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
