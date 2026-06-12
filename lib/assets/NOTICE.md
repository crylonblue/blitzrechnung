# Bundled assets

These files are embedded into generated invoice PDFs to make them conformant
PDF/A-3b (ZUGFeRD) documents.

## Fonts — `fonts/LiberationSans-{Regular,Bold}.ttf`

Liberation Sans 2.1.5, licensed under the **SIL Open Font License 1.1**
(see `fonts/LICENSE`). Metric-compatible with Helvetica/Arial, so the invoice
layout is unchanged. PDF/A requires all fonts to be embedded, which pdf-lib's
standard fonts are not — hence a real embedded TTF.

## Colour profile — `icc/sRGB.icc`

`sRGB-v2-micro` from the Compact-ICC-Profiles project (public domain / CC0).
Used as the mandatory PDF/A output intent (RGB, 3 components).
