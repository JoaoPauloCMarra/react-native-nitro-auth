import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const packageRoot = resolve(
  import.meta.dir,
  "../packages/react-native-nitro-auth",
);
const assetRoot = resolve(packageRoot, "src/ui/assets");
const manifest: unknown = JSON.parse(
  readFileSync(resolve(assetRoot, "provenance.json"), "utf8"),
);
if (
  !manifest ||
  typeof manifest !== "object" ||
  !("entries" in manifest) ||
  !Array.isArray(manifest.entries)
) {
  throw new Error("Provider artwork provenance is missing");
}
if (manifest.entries.length !== 64)
  throw new Error("Expected 64 platform/theme/shape artwork files");
for (const entry of manifest.entries) {
  if (
    !entry ||
    typeof entry !== "object" ||
    typeof entry.file !== "string" ||
    typeof entry.sha256 !== "string"
  )
    throw new Error("Invalid artwork provenance entry");
  const bytes = readFileSync(resolve(assetRoot, entry.file));
  if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
    throw new Error(`Artwork changed without provenance: ${entry.file}`);
  const ios = entry.file.includes("-ios-");
  const height = ios ? 44 : 40;
  const width = entry.file.includes("-icon.") ? height : ios ? 188 : 180;
  if (entry.file.endsWith(".png")) {
    if (
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
      bytes.readUInt32BE(16) !== width * 4 ||
      bytes.readUInt32BE(20) !== height * 4
    )
      throw new Error(`Invalid image dimensions: ${entry.file}`);
  } else if (entry.file.endsWith(".svg")) {
    const xml = bytes.toString("utf8");
    if (/<svg\b[^>]*\b(?:width|height|x|y)=["'][^"']*%/i.test(xml))
      throw new Error(
        `SVG viewports must use explicit coordinate units: ${entry.file}`,
      );
    if (
      /<text\b|@font-face|font-family|<image\b|<script\b|url\(https?:|(?:href|src)=["']https?:/i.test(
        xml,
      )
    )
      throw new Error(
        `Vector artwork must use local paths without fonts: ${entry.file}`,
      );
  }
}
for (const path of [
  "android/src/main/assets/fonts/GoogleSans-Medium.ttf",
  "ios/resources/GoogleSans-Medium.ttf",
  "android/src/main/assets/fonts/NitroAuthGoogleSans-Medium.ttf",
  "ios/resources/NitroAuthGoogleSans-Medium.ttf",
]) {
  if (existsSync(resolve(packageRoot, path)))
    throw new Error(
      `Google font must not be an unconditional native resource: ${path}`,
    );
}
console.log(
  "Social button artwork verified: 64 checksums, dimensions, font-free vectors, optional native font",
);
