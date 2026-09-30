import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join, relative, resolve } from "path";
import ts from "typescript";

const srcRoot = resolve(__dirname, "..");

const sourceExtensions = [".ts", ".tsx", ".js", ".jsx"];
const platformSuffixes = ["", ".web", ".native", ".ios", ".android"];

type ImportGraph = {
  files: Set<string>;
  packages: Set<string>;
};

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function resolveRelative(fromFile: string, specifier: string): string[] {
  const base = resolve(dirname(fromFile), specifier);
  if (isFile(base)) return [base];
  const candidates: string[] = [];
  for (const stem of [base, join(base, "index")]) {
    for (const suffix of platformSuffixes) {
      for (const extension of sourceExtensions) {
        const candidate = `${stem}${suffix}${extension}`;
        if (isFile(candidate)) candidates.push(candidate);
      }
    }
    if (candidates.length > 0) return candidates;
  }
  throw new Error(
    `Unresolved import "${specifier}" in ${relative(srcRoot, fromFile)}`,
  );
}

function collectImportGraph(entry: string): ImportGraph {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [resolve(srcRoot, entry)];
  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || files.has(file)) continue;
    files.add(file);
    if (!sourceExtensions.some((extension) => file.endsWith(extension))) {
      continue;
    }
    const { importedFiles } = ts.preProcessFile(
      readFileSync(file, "utf8"),
      true,
      true,
    );
    for (const { fileName } of importedFiles) {
      if (fileName.startsWith(".")) {
        pending.push(...resolveRelative(file, fileName));
      } else {
        packages.add(fileName);
      }
    }
  }
  return { files, packages };
}

function relativeFiles(graph: ImportGraph): string[] {
  return [...graph.files].map((file) => relative(srcRoot, file)).sort();
}

const artworkModule = "ui/social-button-assets.ts";
const buttonArtworkImage =
  /^ui\/assets\/.+-(?:pill|rectangular)(?:-icon)?\.png$/u;

describe("social button import graph", () => {
  it.each(["index.ts", "index.web.ts"])(
    "keeps official artwork and react-native-svg out of %s",
    (entry) => {
      const graph = collectImportGraph(entry);
      const files = relativeFiles(graph);

      expect(files).toContain("ui/social-button-core.tsx");
      expect(files).toContain("ui/social-button-marks.ts");
      expect(files).not.toContain(artworkModule);
      expect(files).not.toContain("ui/official-social-button-renderer.tsx");
      expect(files.filter((file) => buttonArtworkImage.test(file))).toEqual([]);
      expect(files.filter((file) => file.endsWith(".png"))).toEqual([
        "ui/assets/apple-mark-dark.png",
        "ui/assets/apple-mark-light.png",
        "ui/assets/google-logo.png",
      ]);
      expect([...graph.packages]).not.toContain("react-native-svg");
    },
  );

  it.each(["official-buttons.ts", "official-buttons.web.ts"])(
    "reaches official artwork and react-native-svg from %s",
    (entry) => {
      const graph = collectImportGraph(entry);
      const files = relativeFiles(graph);

      expect(files).toContain(artworkModule);
      expect(
        files.filter((file) => buttonArtworkImage.test(file)),
      ).toHaveLength(32);
      expect([...graph.packages]).toContain("react-native-svg");
    },
  );
});
