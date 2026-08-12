const projectRoot = import.meta.dir + "/..";
const packageRoot = `${projectRoot}/packages/react-native-nitro-auth`;

const docs = [
  { source: `${projectRoot}/README.md`, target: `${packageRoot}/README.md` },
  {
    source: `${projectRoot}/CHANGELOG.md`,
    target: `${packageRoot}/CHANGELOG.md`,
  },
  { source: `${projectRoot}/LICENSE`, target: `${packageRoot}/LICENSE` },
  { source: `${projectRoot}/SECURITY.md`, target: `${packageRoot}/SECURITY.md` },
] as const;

const checkOnly = process.argv.includes("--check");

let drifted = false;

for (const doc of docs) {
  const sourceFile = Bun.file(doc.source);

  if (!(await sourceFile.exists())) {
    throw new Error(`Missing required package document: ${doc.source}`);
  }

  const sourceContent = await sourceFile.text();

  if (checkOnly) {
    const targetFile = Bun.file(doc.target);
    if (!(await targetFile.exists())) {
      console.error(`DRIFT: missing package document: ${doc.target}`);
      drifted = true;
      continue;
    }
    const targetContent = await targetFile.text();
    if (sourceContent !== targetContent) {
      console.error(
        `DRIFT: ${doc.target} differs from ${doc.source}. Run "bun run sync-package-docs" and commit the synced copy.`,
      );
      drifted = true;
      continue;
    }
    console.log(`In sync: ${doc.target}`);
    continue;
  }

  await Bun.write(doc.target, sourceContent);
  console.log(`Synced ${doc.target}`);
}

if (checkOnly && drifted) {
  process.exit(1);
}
