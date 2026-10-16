# Play Next application icon

The icon combines a lime die and a play triangle on a charcoal rounded tile.
Created using the built-in image generation tool, with transparent background.
Source: `app-icon-source.png`. Windows and UI files are produced by
`scripts/build-icon.ps1`: `public/icon.ico` and `public/icon.png`.
The ICO contains 16, 24, 32, 48, 64, 128 and 256 pixel frames. Small frames use
32-bit DIBs plus transparency masks; the 256 pixel frame uses an RGBA PNG.
Copies in `docs` use the same artwork. Native builds embed the ICO directly.
