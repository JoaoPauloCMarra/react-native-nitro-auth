/**
 * Regenerates `src/ui/social-button-assets.ts` from the artwork in
 * `src/ui/assets`. Metro cannot import an SVG file as text, so the vector
 * artwork is inlined; generating it keeps the module and the files identical.
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

function entry(base: string, indent: string): string {
  const { svg, width, height } = readSvg(`${base}.svg`);
  const pad = `${indent}  `;
  return [
    `${indent}{`,
    `${pad}image: require("./assets/${base}.png") as ImageSourcePropType,`,
    `${pad}svg: ${JSON.stringify(svg)},`,
    `${pad}width: ${width},`,
    `${pad}height: ${height},`,
    `${indent}}`,
  ].join("\n");
}

function artwork(name: string, suffix: string): string {
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

${artwork("socialButtonArtwork", "")}

${artwork("iconOnlyArtwork", "-icon")}

/** Official provider marks, used by the custom renderer and busy states. */
export const googleMark =
  require("./assets/google-logo.png") as ImageSourcePropType;

export const appleMarks = {
  light: require("./assets/apple-mark-light.png") as ImageSourcePropType,
  dark: require("./assets/apple-mark-dark.png") as ImageSourcePropType,
} as const;
`;

writeFileSync(modulePath, source);
console.log(`Generated ${modulePath}`);
