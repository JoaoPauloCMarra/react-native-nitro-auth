import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Glob } from "bun";

type JsonRecord = Record<string, unknown>;
type DependencyMap = Record<string, string>;

const projectRoot = import.meta.dir + "/..";

function asRecord(value: unknown): JsonRecord {
  return value != null && typeof value === "object"
    ? (value as JsonRecord)
    : {};
}

function asDependencies(value: unknown): DependencyMap {
  const entries = Object.entries(asRecord(value)).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return Object.fromEntries(entries);
}

function run(
  command: string[],
  cwd: string,
): { exitCode: number; output: string } {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const decoder = new TextDecoder();
  return {
    exitCode: result.exitCode,
    output: `${decoder.decode(result.stdout)}${decoder.decode(result.stderr)}`,
  };
}

async function main(): Promise<void> {
  const packageFiles = Array.from(
    new Glob("packages/*/package.json").scanSync({ cwd: projectRoot }),
  );
  if (packageFiles.length !== 1) {
    throw new Error(
      `Expected one package manifest, found ${packageFiles.length}.`,
    );
  }

  const packageRelativePath = packageFiles[0];
  const packageManifestPath = join(projectRoot, packageRelativePath);
  const packageRoot = dirname(packageManifestPath);
  const packageManifest = JSON.parse(
    await Bun.file(packageManifestPath).text(),
  ) as JsonRecord;
  const packageName = String(packageManifest.name);
  const sourceDirectory = packageManifestPath.replace(
    /\/package\.json$/,
    "/src",
  );
  const sourceEntry = join(sourceDirectory, "index.ts");
  const officialButtonsEntry = join(sourceDirectory, "official-buttons.ts");
  const temporaryRoot = await mkdtemp(join(tmpdir(), "nitro-rn087-types-"));

  try {
    const dependencies: DependencyMap = {
      ...asDependencies(packageManifest.dependencies),
      ...asDependencies(packageManifest.peerDependencies),
      ...asDependencies(packageManifest.devDependencies),
      "@types/node": "^24.0.0",
      "@types/react": "~19.2.18",
      react: "19.2.3",
      "react-native": "0.87.0",
      "react-native-nitro-modules": "0.37.1",
      typescript: "6.0.3",
    };

    await Bun.write(
      join(temporaryRoot, "package.json"),
      JSON.stringify(
        {
          name: `${packageName}-rn087-typecheck`,
          private: true,
          dependencies,
        },
        null,
        2,
      ),
    );
    await Bun.write(
      join(temporaryRoot, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            allowSyntheticDefaultImports: true,
            baseUrl: temporaryRoot,
            esModuleInterop: true,
            ignoreDeprecations: "6.0",
            jsx: "react-native",
            module: "ESNext",
            moduleResolution: "bundler",
            noEmit: true,
            noFallthroughCasesInSwitch: true,
            noImplicitReturns: true,
            noImplicitOverride: true,
            noUncheckedIndexedAccess: true,
            paths: {
              [packageName]: [sourceEntry],
              [`${packageName}/*`]: [`${sourceDirectory}/*`],
              react: [
                join(temporaryRoot, "node_modules/@types/react/index.d.ts"),
              ],
              "react/*": [join(temporaryRoot, "node_modules/@types/react/*")],
              "react-native": [
                join(
                  temporaryRoot,
                  "node_modules/react-native/types_generated/index.d.ts",
                ),
              ],
              "react-native/*": [
                join(temporaryRoot, "node_modules/react-native/*"),
              ],
            },
            skipLibCheck: true,
            strict: true,
            target: "ES2020",
            types: ["node", "react", "react-native"],
          },
          include: [
            sourceEntry,
            officialButtonsEntry,
            `${sourceDirectory}/**/*.d.ts`,
          ],
        },
        null,
        2,
      ),
    );

    const install = run(
      ["bun", "install", "--ignore-scripts", "--no-progress"],
      temporaryRoot,
    );
    if (install.exitCode !== 0) {
      throw new Error(
        `RN 0.87 compatibility dependencies failed to install:\n${install.output}`,
      );
    }

    const typecheck = run(
      ["bun", "x", "tsc", "--noEmit", "-p", "tsconfig.json"],
      temporaryRoot,
    );
    if (typecheck.exitCode !== 0) {
      throw new Error(
        `RN 0.87 Strict TypeScript compatibility failed:\n${typecheck.output}`,
      );
    }

    console.log(
      `${packageName} passes the RN 0.87 Strict TypeScript compatibility check.`,
    );

    const packageExports = asRecord(packageManifest.exports);
    const exportKeys = [".", "./official-buttons", "./official-buttons/svg"];
    for (const exportKey of exportKeys) {
      for (const mode of ["import", "require"]) {
        const declarationPath = asRecord(
          asRecord(packageExports[exportKey])[mode],
        ).types;
        if (
          typeof declarationPath !== "string" ||
          !(await Bun.file(join(packageRoot, declarationPath)).exists())
        ) {
          throw new Error(
            `Build the ${exportKey} ${mode} declarations with bun run build before typecheck:rn087.`,
          );
        }
      }
    }

    const tarballName = `${packageName}-${String(packageManifest.version)}.tgz`;
    const tarballPath = join(temporaryRoot, tarballName);
    const pack = run(
      [
        "bun",
        "pm",
        "pack",
        "--ignore-scripts",
        "--filename",
        tarballPath,
        "--quiet",
      ],
      packageRoot,
    );
    if (pack.exitCode !== 0 || !(await Bun.file(tarballPath).exists())) {
      throw new Error(
        `Packed consumer archive failed to create:\n${pack.output}`,
      );
    }
    dependencies[packageName] = `file:./${tarballName}`;
    await Bun.write(
      join(temporaryRoot, "package.json"),
      JSON.stringify(
        {
          name: `${packageName}-rn087-typecheck`,
          private: true,
          dependencies,
        },
        null,
        2,
      ),
    );
    const installTarball = run(
      ["bun", "install", "--ignore-scripts", "--no-progress"],
      temporaryRoot,
    );
    if (installTarball.exitCode !== 0) {
      throw new Error(
        `Packed consumer install failed:\n${installTarball.output}`,
      );
    }

    const consumer = [
      `import { AuthService, useAuth, type AuthCredential } from ${JSON.stringify(packageName)};`,
      `import { OfficialSocialButton as ImageButton, type OfficialSocialButtonProps as ImageProps } from ${JSON.stringify(`${packageName}/official-buttons`)};`,
      `import { OfficialSocialButton as SvgButton, type OfficialSocialButtonProps as SvgProps } from ${JSON.stringify(`${packageName}/official-buttons/svg`)};`,
      'const credential: Promise<AuthCredential> = AuthService.getCredential("apple", { scopes: [] });',
      'const imageProps: ImageProps = { provider: "apple", renderMode: "image" };',
      'const svgProps: SvgProps = { provider: "google", renderMode: "svg" };',
      "// @ts-expect-error Only supported providers are accepted by the installed root API.",
      'AuthService.login("github");',
      "// @ts-expect-error Nonce values must remain strings in the installed contract.",
      'AuthService.login("apple", { nonce: 42 });',
      "// @ts-expect-error Image-only buttons must not silently accept SVG rendering.",
      'const invalidImage: ImageProps = { provider: "apple", renderMode: "svg" };',
      "void [credential, imageProps, svgProps, invalidImage, ImageButton, SvgButton, useAuth];",
      "",
    ].join("\n");

    for (const mode of ["import", "require"] as const) {
      const file = mode === "import" ? "consumer.mts" : "consumer.cts";
      await Bun.write(join(temporaryRoot, file), consumer);
      const config = `tsconfig.consumer-${mode}.json`;
      await Bun.write(
        join(temporaryRoot, config),
        JSON.stringify(
          {
            compilerOptions: {
              allowSyntheticDefaultImports: true,
              esModuleInterop: true,
              jsx: "react-native",
              module: mode === "import" ? "ESNext" : "NodeNext",
              moduleResolution: mode === "import" ? "bundler" : "NodeNext",
              noEmit: true,
              strict: true,
              skipLibCheck: true,
              target: "ES2020",
              types: ["node", "react", "react-native"],
            },
            files: [file],
          },
          null,
          2,
        ),
      );
      const consumerTypecheck = run(
        ["bun", "x", "tsc", "--noEmit", "-p", config],
        temporaryRoot,
      );
      if (consumerTypecheck.exitCode !== 0) {
        throw new Error(
          `Installed tarball ${mode} consumer typecheck failed:\n${consumerTypecheck.output}`,
        );
      }
    }
    console.log(
      `${packageName} installed tarball passes import and require consumer checks for root and both official-button subpaths.`,
    );
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

await main();
