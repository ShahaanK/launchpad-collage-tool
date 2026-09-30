# LaunchPad Collage Tool

A local, single-file collage builder for Syracuse University Blackstone LaunchPad
assets. Drop photos in, arrange them on a fixed-pixel artboard, apply LaunchPad
branding, export at exact resolution. Photos never leave the machine — no server,
no CDN, no build step.

**Open it:** double-click `collage-tool.html` (Chrome).

Full decision record and architecture: [`SPEC.md`](SPEC.md).

---

## Status

**All 7 steps complete.** The tool is finished and fully tested.

| Step | What | State |
|------|------|-------|
| 1 | `computeLayout()` + DOM preview + drop zone + size presets | **done** |
| 2 | Canvas painter + PNG export (parity gate **passed**) | **done** |
| 3 | Drag-to-swap, drag-to-span, focal-point dragging | **done** |
| 4 | Brand override panel + lockup-as-cell and scrim placements | **done** |
| 5 | Band headline/subhead + font picker (`measureText` auto-fit) | **done** |
| 6 | Self-contained HTML export + injected `@page` PDF path | **done** |
| 7 | IndexedDB autosave + Save/Load `.collage.json` | **done** |

### Working now

- Drop or pick up to **16** photos (drag onto the sidebar, or anywhere in the window).
- **10 size presets** — Instagram square/portrait/story, LinkedIn, 39×8″ banner,
  8.5×11″ flyer, 16:9 slide, 4K signage, 18×24″ and 24×36″ posters — plus custom W×H.
- Grid **reflows on every size change**: the same 12 photos are 3×3 on a square and
  6×2 on the banner.
- Column count is chosen from **cell demand** (a 2×2 hero counts as four) × artboard
  aspect × **median photo aspect**, or set by hand.
- Gutter, outer mat, corner radius, mat colour; brand band with side, fill and height.
- Leftover grid cells render in the mat colour rather than as gaps.
- **Three mark placements** — a full-width **band**, a real **grid cell**, or an
  **overlay** on the photos over a gradient scrim.
- The LAUNCHPAD + Libraries lockup is inline vector, locked to 7.66:1, and picks its
  colourway from the ground: **reverse** on dark, **light** on light, and on an accent
  ground either **mono** or the untouched artwork on a **dark plate** — your choice
  (the artwork's own orange Block S would otherwise vanish into orange).
- **Brand palette panel** — dark / accent / light colour pickers, an uploaded logo
  that replaces the lockup (its own aspect ratio is respected, not stretched), and
  Reset brand.
- **Download PNG** — the full artboard at true pixel size, drawn from your original
  files, not the downscaled previews. A 24×36" poster at 3600×5400 with 12 photos
  takes well under a second with test-sized sources.

### Arranging photos

| gesture | action |
|---------|--------|
| **drag** inside a photo | move its focal point — set a face once and it survives every resize |
| **scroll** over a photo | zoom 1×–5× (never below cover) |
| **double-click** a photo | recentre and clear zoom |
| **drag the ⠳ grip** (top-left) | drop it on another photo to swap them |
| **drag the orange corner** | span more columns or rows; double-click it to reset |

Spans stay with the *slot*, so swapping trades two pictures without reshaping the
collage.

### Moving and resizing the logo

The mark is draggable and resizable directly on the artboard:

| gesture | action |
|---------|--------|
| **drag the logo** | place it freely (overlay) or nudge it along the band |
| **drag its orange dot** | resize it; the aspect ratio is preserved |
| **double-click the logo** | reset its position and size |

Position is stored as a **percentage** of the artboard, so a hand placement survives
a change of size just like a photo's focal point does.

### Band copy

Type a **headline** and optional **subhead** and they sit beside the logo in the band,
auto-fitting to the space available:

- The band splits into two columns — copy on one side, logo on the other. Without
  copy the logo still centres at full size.
- **Drag the logo across the band** and the copy moves to the other side rather than
  colliding with it.
- Copy is drawn in the light role on a dark or accent band and the dark role on a
  light band, so it stays legible when you override the palette.
- **Font**: Sherman Sans (brand), Helvetica/Arial, Georgia, or Monospace.

Sizing happens in the layout function via canvas `measureText`, never in CSS — so
what you see is what the PNG contains. A long headline shrinks rather than overflowing.

### Exporting

| button | what you get |
|--------|--------------|
| **Download PNG** | the full artboard at true pixel size, drawn from your originals |
| **Export HTML** | one self-contained file — inline CSS, embedded photos, inline vector lockup. 266 KB for a 1080 square with 6 photos, 533 KB for the 39×8″ banner with 10 |
| **Print / PDF** | prints the exported sheet (not the app) with `@page` set to the artboard size — choose Save as PDF, margins None, background graphics on |

Each photo is cropped to exactly its tile before embedding, using spare source
resolution up to 2× but never upscaling.

**Embed font file…** is optional and off by default. A browser cannot read an
installed system font, so an exported file opened on a machine without Sherman Sans
falls back to Helvetica unless you supply the font file to inline.

### Saving your work

**Autosave is automatic.** Every change is written to IndexedDB (debounced), and the
next time you open the tool it offers to restore: *"Restore your last session? 6 photos
· 3744×768 · 23 Sep 2026."* Choose **Restore** or **Start fresh**.

Photos are stored once, keyed by content hash, separately from the layout — so a
focal-point drag rewrites about 2 KB, not tens of megabytes.

**Save project** writes a `.collage.json` you can archive or move:

| Include | size (5 photos) | opens elsewhere? |
|---------|-----------------|------------------|
| **Photos + layout** | ~700 KB | yes — fully self-contained |
| **Layout only** | ~1 KB | only on a machine that already has those photos |

A layout-only file opened where the photos aren't stored loads every setting, restores
no photos, and tells you which ones it couldn't find — by name.

If IndexedDB is unavailable (private window, blocked storage), the sidebar says so and
everything else keeps working.

---

## Architecture in one line

> **One layout function, three consumers.**

`computeLayout(state)` is pure and returns geometry in **artboard pixels**. The DOM
preview renders it CSS-scaled; the canvas painter renders the same object at scale 1;
the HTML exporter serialises it. No consumer computes its own geometry — otherwise
they drift, and the drift only shows up in the exported file.

All three are held to that by test: the parity suite stacks the DOM and canvas renders
and diffs them, and the round-trip suite does the same for the exported HTML against
the canvas.

Two consequences worth knowing before editing:

- **Cropping is shared, not duplicated.** `coverSrcRect()` reproduces
  `object-fit:cover` + `object-position:x% y%` exactly, and the preview's `<img>` is
  positioned *from that same rect* rather than using CSS `object-position`. Parity
  with `drawImage()` is therefore structural, not something to hope for.
- **The packer is hand-written on purpose.** `grid-auto-flow:dense` would have been
  free, but it makes the DOM the source of geometry truth, which the canvas and HTML
  exporters cannot read back reliably at a scale factor. `packTiles()` does dense
  first-fit in JS instead.

---

## Dev harness

```bash
cd _dev
bash run_tests.sh            # 164 assertions on the pure layout functions
bash run_tests.sh --all      # + everything below, ~70s
bash run_tests.sh --shots    # + screenshots, gesture tests, hi-res export checks
bash run_tests.sh --parity   # + DOM-vs-canvas parity (the step-2 gate)
bash run_tests.sh --all      # everything
```

Screenshots go through `cdp_shot.js`, a zero-dependency DevTools Protocol driver
that waits for `window.__ready`. Chrome's `--screenshot` flag fires at the load
event, which silently captured half-decoded images and never waited for the canvas
paint at all.

`run_tests.sh` re-extracts its inputs from `collage-tool.html` on every run, so it
can never test a stale copy. `_dev/_fixtures/` holds generated images with corner
labels (TL/TR/BL/BR) and a centre crosshair — a wrong crop is then obvious at a
glance instead of plausible-looking.

The unit tests cover the `coverSrcRect` formula (including that it is *not* the
naive centre-plus-nudge version), resolution independence of focal points, dense
packing with spans, geometry invariants across all 10 presets, and freedom from
the sub-pixel seams that would only ever show up in a full-size export.

`--all` also runs `persist_test.js`, which drives **two page loads in one browser
profile** — the only way to test autosave honestly — plus three `.collage.json`
save/load cases including a layout-only file opened with no stored photos.

The **parity test** stacks the DOM render above the canvas render at scale 1 and
diffs them: tile edges must match exactly, and no tile may align better under a
±3 px shift. Current result is well inside tolerance across **thirteen** cases —
including all three mark placements, the gradient scrim, and the 3744×768 banner,
whose fractional 607.5 px cell widths are the exact geometry that produced the
step-1 seam bug.
`compare_parity.py` also checks ink volume per band, because band and lockup are
both "not mat" — without it, a canvas render that dropped the lockup entirely
would pass every other check.

---

## Notes

- **Sherman Sans is installed on this machine**, so the preview, `measureText`
  auto-fit, and local exports all use the real face. The tool logs
  `[collage] Sherman Sans active: true` to the console to confirm it. A file sent to
  a machine without the font falls back to Helvetica; step 6 will add an optional
  base64 `@font-face` embed (default off — embedding a licensed SU font in a shared
  file is a decision for the user, not the tool).
- **Brand rule:** the LAUNCHPAD wordmark is never shown without the Syracuse
  University Libraries logo. It is one locked vector lockup, not a toggle.
- `out/` is for exports. `_dev/` is scaffolding and can be deleted without affecting
  the tool.
