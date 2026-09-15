# Provider button artwork

Google PNG buttons are unchanged files from the official Sign in with Google
asset archive. Apple PNG buttons are rendered from the official Sign in with
Apple JavaScript SDK.

The SVG buttons carry that same artwork, rewritten so native SVG renderers place
it correctly. Apple's export nests `<svg>` viewports that those renderers put in
the wrong place; the nesting is flattened into equivalent transforms. Google's
export draws its mark with a Figma conic gradient inside a `foreignObject`,
which no native renderer supports; that block is removed and the button draws
the Google mark image into the same box. The vector buttons do not load or
require a font. Run `bun scripts/generate-social-button-assets.ts` from the
repository root after changing any file here, so the inlined artwork in
`src/ui/social-button-assets.ts` stays identical.

`provenance.json` records source URLs, configuration, and SHA-256 checksums.
Run `bun scripts/check-social-button-assets.ts` from the repository root to check
integrity, platform dimensions, and absence of font dependencies in SVG artwork.

`google-logo.png` and `apple-mark-light.png` / `apple-mark-dark.png` are the
official provider marks, traced from the same sources with a transparent
background. They are the marks drawn in custom mode, in busy states, and by
`SocialProviderIcon`.
Do not crop, recolor, stretch, or replace the marks with text characters.
Provider trademarks remain owned by their respective owners; the package MIT
license does not grant trademark rights. Follow the provider branding terms.

- [Google branding and artwork](https://developers.google.com/identity/branding-guidelines)
- [Apple artwork and design guidelines](https://developer.apple.com/design/resources/)
- [Apple button SDK](https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web)
