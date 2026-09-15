# Provider button artwork

Google PNG and SVG buttons are unchanged files from the official Sign in with
Google asset archive. Apple PNG buttons are rendered from the official Sign in
with Apple JavaScript SDK. Apple SVG buttons preserve that SDK artwork and
character positions, converting its embedded font to paths for native SVG use.
The vector buttons do not load or require a font.

`provenance.json` records source URLs, configuration, and SHA-256 checksums.
Run `bun scripts/check-social-button-assets.ts` from the repository root to check
integrity, platform dimensions, and absence of font dependencies in SVG artwork.

The separate Google logo and padded Apple logos are official provider artwork.
Do not crop, recolor, stretch, or replace the marks with text characters.
Provider trademarks remain owned by their respective owners; the package MIT
license does not grant trademark rights. Follow the provider branding terms.

- [Google branding and artwork](https://developers.google.com/identity/branding-guidelines)
- [Apple artwork and design guidelines](https://developer.apple.com/design/resources/)
- [Apple button SDK](https://developer.apple.com/documentation/signinwithapple/displaying-sign-in-with-apple-buttons-on-the-web)
