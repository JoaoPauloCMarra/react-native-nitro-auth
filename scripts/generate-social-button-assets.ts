/**
 * Regenerates `src/ui/social-button-assets.ts` (PNG artwork and dimensions) and
 * `src/ui/social-button-svg-assets.ts` (inlined SVG artwork) from the files in
 * `src/ui/assets`. Metro cannot import an SVG file as text, so the vector
 * artwork is inlined into its own module that only the SVG subpath imports.
 * Run after changing any button artwork, then refresh `provenance.json`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(
  import.meta.dir,
  "../packages/react-native-nitro-auth",
);
const assetRoot = resolve(packageRoot, "src/ui/assets");
const modulePath = resolve(packageRoot, "src/ui/social-button-assets.ts");
const svgModulePath = resolve(
  packageRoot,
  "src/ui/social-button-svg-assets.ts",
);

const providers = ["google", "apple"] as const;
const platforms = ["android", "ios"] as const;
const appearances = ["light", "dark"] as const;
const shapes = ["pill", "rectangular"] as const;

function readSvg(file: string): { svg: string; width: number; height: number } {
  const svg = readFileSync(resolve(assetRoot, file), "utf8").trim();
  const root = /<svg[^>]*>/u.exec(svg)?.[0] ?? "";
  const width = Number(/\bwidth="([\d.]+)"/u.exec(root)?.[1]);
  const height = Number(/\bheight="([\d.]+)"/u.exec(root)?.[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height))
    throw new Error(`Artwork is missing pixel dimensions: ${file}`);
  return { svg, width, height };
}

function imageEntry(base: string, indent: string): string {
  const { width, height } = readSvg(`${base}.svg`);
  const pad = `${indent}  `;
  return [
    `${indent}{`,
    `${pad}image: require("./assets/${base}.png") as ImageSourcePropType,`,
    `${pad}width: ${width},`,
    `${pad}height: ${height},`,
    `${indent}}`,
  ].join("\n");
}

function svgEntry(base: string): string {
  return JSON.stringify(readSvg(`${base}.svg`).svg);
}

function artwork(
  name: string,
  suffix: string,
  entry: (base: string, indent: string) => string,
): string {
  const lines = [`export const ${name} = {`];
  for (const provider of providers) {
    lines.push(`  ${provider}: {`);
    for (const platform of platforms) {
      lines.push(`    ${platform}: {`);
      for (const appearance of appearances) {
        lines.push(`      ${appearance}: {`);
        for (const shape of shapes) {
          const base = `${provider}-${platform}-${appearance}-${shape}${suffix}`;
          lines.push(`        ${shape}: ${entry(base, "        ").trimStart()},`);
        }
        lines.push("      },");
      }
      lines.push("    },");
    }
    lines.push("  },");
  }
  lines.push("} as const;");
  return lines.join("\n");
}

const source = `import type { ImageSourcePropType } from "react-native";

${artwork("socialButtonArtwork", "", imageEntry)}

${artwork("iconOnlyArtwork", "-icon", imageEntry)}
`;

const svgSource = `${artwork("socialButtonSvgArtwork", "", svgEntry)}

${artwork("iconOnlySvgArtwork", "-icon", svgEntry)}
`;

writeFileSync(modulePath, source);
writeFileSync(svgModulePath, svgSource);
console.log(`Generated ${modulePath} and ${svgModulePath}`);
