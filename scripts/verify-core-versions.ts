const projectRoot = import.meta.dir + "/..";

const expectedVersions = {
  expo: "~57.0.15",
  "expo-asset": "~57.0.13",
  "expo-build-properties": "~57.0.13",
  "expo-constants": "~57.0.13",
  "expo-linking": "~57.0.7",
  "expo-router": "~57.0.15",
  nitrogen: "0.37.0",
  react: "19.2.3",
  "react-dom": "19.2.3",
  "react-native": "0.86.2",
  "react-native-example": "0.86.2",
  "react-native-nitro-modules": "0.37.0",
} as const;
const expectedNitroPeerRange = ">=0.37.0 <0.38.0";

type DependencyName = keyof typeof expectedVersions;
type JsonRecord = Record<string, unknown>;

const checks: Array<{
  file: string;
  fields: Array<[string, string, DependencyName?]>;
}> = [
  {
    file: "package.json",
    fields: [
      ["overrides", "react"],
      ["overrides", "react-dom"],
      ["overrides", "react-native"],
      ["overrides", "expo"],
      ["overrides", "expo-asset"],
      ["overrides", "expo-build-properties"],
      ["overrides", "expo-constants"],
      ["overrides", "expo-linking"],
      ["overrides", "react-native-nitro-modules"],
      ["devDependencies", "nitrogen"],
    ],
  },
  {
    file: "apps/example/package.json",
    fields: [
      ["dependencies", "react"],
      ["dependencies", "react-dom"],
      ["dependencies", "react-native", "react-native-example"],
      ["dependencies", "expo"],
      ["dependencies", "expo-asset"],
      ["dependencies", "expo-build-properties"],
      ["dependencies", "expo-constants"],
      ["dependencies", "expo-linking"],
      ["dependencies", "expo-router"],
      ["dependencies", "react-native-nitro-modules"],
    ],
  },
  {
    file: "packages/react-native-nitro-auth/package.json",
    fields: [
      ["dependencies", "expo-build-properties"],
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
    obj,
  );

const failures: string[] = [];

for (const check of checks) {
  const json = await readJson(check.file);

  for (const [section, depName, expectedName = depName] of check.fields) {
    const actualValue = getPathValue(json, [section, depName]);
    const expectedValue = expectedVersions[expectedName];

    if (actualValue !== expectedValue) {
      failures.push(
        `${projectRoot}/${check.file} -> ${section}.${depName}: expected "${expectedValue}", got "${String(actualValue)}"`,
      );
    }
  }
}

const packageJson = await readJson(
  "packages/react-native-nitro-auth/package.json",
);
const actualNitroPeerRange = getPathValue(packageJson, [
  "peerDependencies",
  "react-native-nitro-modules",
]);
if (actualNitroPeerRange !== expectedNitroPeerRange) {
  failures.push(
    `${projectRoot}/packages/react-native-nitro-auth/package.json -> peerDependencies.react-native-nitro-modules: expected "${expectedNitroPeerRange}", got "${String(actualNitroPeerRange)}"`,
  );
}

if (
  getPathValue(await readJson("package.json"), [
    "scripts",
    "typecheck:rn087",
  ]) !== "bun scripts/verify-rn087-types.ts"
) {
  failures.push(
    "package.json -> scripts.typecheck:rn087 must run the RN 0.87 Strict TypeScript check",
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
