const projectRoot = import.meta.dir + "/..";

const expectedVersions = {
  react: "19.2.0",
  "react-dom": "19.2.0",
  "react-native": "0.83.2",
} as const;

type DependencyName = keyof typeof expectedVersions;
type JsonRecord = Record<string, unknown>;

const checks: Array<{
  file: string;
  fields: Array<[string, DependencyName]>;
}> = [
  {
    file: "package.json",
    fields: [
      ["overrides", "react"],
      ["overrides", "react-dom"],
      ["overrides", "react-native"],
    ],
  },
  {
    file: "apps/example/package.json",
    fields: [
      ["dependencies", "react"],
      ["dependencies", "react-dom"],
      ["dependencies", "react-native"],
    ],
  },
  {
    file: "packages/react-native-nitro-auth/package.json",
    fields: [
      ["devDependencies", "react"],
      ["devDependencies", "react-native"],
    ],
  },
];

const readJson = async (relativePath: string): Promise<JsonRecord> => {
  const source = await Bun.file(`${projectRoot}/${relativePath}`).text();
  return JSON.parse(source) as JsonRecord;
};

const getPathValue = (obj: JsonRecord, segments: string[]): unknown =>
  segments.reduce<unknown>(
    (value, segment) =>
      value != null && typeof value === "object"
        ? (value as JsonRecord)[segment]
        : undefined,
    obj
  );

const failures: string[] = [];

for (const check of checks) {
  const json = await readJson(check.file);

  for (const [section, depName] of check.fields) {
    const actualValue = getPathValue(json, [section, depName]);
    const expectedValue = expectedVersions[depName];

    if (actualValue !== expectedValue) {
      failures.push(
        `${projectRoot}/${check.file} -> ${section}.${depName}: expected "${expectedValue}", got "${String(actualValue)}"`
      );
    }
  }
}

if (failures.length > 0) {
  console.error("Core dependency version guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Core dependency versions are pinned as expected.");
