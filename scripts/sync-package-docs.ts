const projectRoot = import.meta.dir + "/..";
const packageRoot = `${projectRoot}/packages/react-native-nitro-auth`;

const docs = [
  { source: `${projectRoot}/README.md`, target: `${packageRoot}/README.md` },
  {
    source: `${projectRoot}/CHANGELOG.md`,
    target: `${packageRoot}/CHANGELOG.md`,
  },
  { source: `${projectRoot}/LICENSE`, target: `${packageRoot}/LICENSE` },
] as const;

for (const doc of docs) {
  const sourceFile = Bun.file(doc.source);

  if (!(await sourceFile.exists())) {
    throw new Error(`Missing required package document: ${doc.source}`);
  }

  await Bun.write(doc.target, sourceFile);
  console.log(`Synced ${doc.target}`);
}
