# Gumroad listing images

The cover and thumbnail shown on the Gumroad product page
(debtfreedashboard.gumroad.com/l/prfzv). Remade November 18, 2026 for the v1.74
"Highlighter" look ($24 price). `app-home.png` is the app screenshot in the cover.

| File | What |
|---|---|
| `cover.png` | 2560x1280 cover, as uploaded (a re-render comes out 2560x1281, which Gumroad accepts) |
| `thumbnail.png` | 1200x1200 thumbnail (Gumroad stores it at 600x600) |
| `cover.html`, `thumbnail.html` | The sources the PNGs are rendered from |
| `render.mjs` | Re-renders both PNGs from the sources |

## Changing the price

1. In `cover.html` and `thumbnail.html`, edit the one line
   `Premium just $24, one-time.`
2. Run `node render.mjs` (or ask Claude to re-render).
3. In Gumroad: Products -> DebtFree Dashboard -> Cover: add the new cover, then remove
   the old one. Thumbnail: Remove, then Upload. Save changes.

`tools/set-price.py` does NOT touch these files. They are a manual step of any price
change, along with the Gumroad price itself.

Fonts: Atkinson Hyperlegible from `fonts/` (no install needed). The icon is
`assets/icons/icon-512.png`.
