const projectRoot = import.meta.dir + "/..";

const expectedVersions = {
  expo: "~57.0.9",
  nitrogen: "0.36.4",
  react: "19.2.3",
  "react-dom": "19.2.3",
  "react-native": "0.86.2",
  "react-native-nitro-modules": "0.36.4",
} as const;
const expectedNitroPeerRange = ">=0.36.4 <0.37.0";

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
      ["overrides", "expo"],
      ["overrides", "react-native-nitro-modules"],
      ["devDependencies", "nitrogen"],
    ],
  },
  {
    file: "apps/example/package.json",
    fields: [
      ["dependencies", "react"],
      ["dependencies", "react-dom"],
      ["dependencies", "react-native"],
      ["dependencies", "expo"],
      ["dependencies", "react-native-nitro-modules"],
    ],
  },
  {
    file: "packages/react-native-nitro-auth/package.json",
    fields: [
      ["devDependencies", "react"],
      ["devDependencies", "react-native"],
      ["devDependencies", "react-native-nitro-modules"],
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

const packageJson = await readJson(
  "packages/react-native-nitro-auth/package.json"
);
const actualNitroPeerRange = getPathValue(packageJson, [
  "peerDependencies",
  "react-native-nitro-modules",
]);
if (actualNitroPeerRange !== expectedNitroPeerRange) {
  failures.push(
    `${projectRoot}/packages/react-native-nitro-auth/package.json -> peerDependencies.react-native-nitro-modules: expected "${expectedNitroPeerRange}", got "${String(actualNitroPeerRange)}"`
  );
}

if (failures.length > 0) {
  console.error("Core dependency version guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Core dependency versions are pinned as expected.");
