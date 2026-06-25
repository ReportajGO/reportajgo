# Brand assets for the news card template

Drop your two brand files in this folder. The card renderer
(`src/generate/media/card.ts`) picks them up automatically.

## 1. Logo  →  `brand/logo.png`
- The **GO** mark, as a **transparent PNG** (the renderer places it top-right).
- Any resolution; it's scaled to ~96px tall. Higher-res = crisper.
- Accepted names: `logo.png`, `logo.jpg`, `logo.webp` (PNG with transparency preferred).

## 2. Headline font  →  `brand/headline.ttf`
- The bold-italic condensed typeface used for the headline.
- `.ttf`, `.otf`, or `.woff2`. The renderer prefers a file with `headline` in
  the name, otherwise it uses the first font file here.

## Accent color
- The red bar / accent color is set by `BRAND_ACCENT_COLOR` in `.env`
  (default `#E11414`). Change it to your exact brand red if needed.

Once both files are in place, regenerate samples and the layout matches your
post format exactly (background photo + logo + red bar + uppercase headline).
