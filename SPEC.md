# LaunchPad Collage Tool — build spec

Resolved via `/grill-me`, 2026-09-10. Every decision below is locked by the user.

## What it is

A **local single-file HTML app** (`collage-tool.html`) opened in Chrome. Drag-drop
photos, arrange them on a fixed-pixel artboard, apply LaunchPad branding, export at
exact resolution. Photos never leave the machine. No CDN, no build step, works offline.

## Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Delivery | Local single-file HTML app in Chrome (not an Artifact, not a CLI) |
| 2 | Brand source | LaunchPad baked in as default preset **+** override panel (colors, logo, font) |
| 3 | Layout model | Auto-grid **+** drag-to-swap **+** drag-to-span tile resize |
| 4 | Brand chrome | All three placements, switchable: band · lockup-as-grid-cell · scrim overlay |
| 5 | Export | All three: instant canvas PNG · self-contained HTML · PDF via print |
| 6 | Text layer | Optional headline + subhead in the band, auto-fit; off by default |
| 7 | Persistence | IndexedDB autosave **+** explicit Save/Load `.collage.json` |
| 8 | Crop model | `cover` + draggable focal point + zoom, stored as **percentages** |
| 9 | Grid engine | Auto cols from photo count × artboard aspect × **median photo aspect**, template override, spans preserved |
| 10 | Size presets | Social · LaunchPad signage · Presentation/display · Large-format print |
| 11 | Photo cap | 16 max; warn (don't block) past 12 at large-format sizes |
| 12 | Location | `Code Space/launchpad-collage/` — tool + README + `out/` |

## Brand facts (from the SU LaunchPad brand reference)

- Otto navy `#000E54` · SU orange `#F76900` · white `#FFFFFF`
- Medium blue `#203299` (wordmark on **light**) · light blue `#2B72D7` (wordmark on **dark**)
- Font stack: `'Sherman Sans','Helvetica Neue',Helvetica,Arial,sans-serif`
- **Hard rule:** the LAUNCHPAD wordmark must *never* appear without the Syracuse
  University Libraries logo. Use the bundled lockup `assets/launchpad_lockup.svg`,
  viewBox ~`690.26 × 90.09`, ratio **7.66:1**. Never recolor or stretch it.
- Bundled lockup is the colour-reverse version (light blue) → for dark/blue grounds.
  On a light ground swap the wordmark to medium blue `#203299`.
- Approved large-text combos: navy-on-orange, orange-on-navy, white-on-navy,
  navy-on-white. White-on-orange is softer at distance.
- Lightbulb = "ideas" emphasis icon, **not** part of the logo. Optional toggle.
- Venue/contact for event collateral: Bird Library, 1st Floor · launchpad@syr.edu ·
  launchpad.syr.edu
- Sherman Sans **is installed** on this machine (`ShermanSans-Bold.ttf`,
  `ShermanSans-Book.otf` in the user fonts dir), so preview, canvas `measureText`,
  and local export all use the real face.

## Size presets

| Group | Preset | Pixels |
|-------|--------|--------|
| Social | Instagram square | 1080 × 1080 |
| Social | Instagram portrait | 1080 × 1350 |
| Social | Story / Reel | 1080 × 1920 |
| Social | LinkedIn / X landscape | 1200 × 627 |
| Signage | Whiteboard banner 39×8" @96dpi | 3744 × 768 |
| Signage | Flyer 8.5×11" @96dpi | 816 × 1056 |
| Display | Slide 16:9 | 1920 × 1080 |
| Display | Digital signage 4K | 3840 × 2160 |
| Print | Poster 18×24" @150dpi | 2700 × 3600 |
| Print | Poster 24×36" @150dpi | 3600 × 5400 |
| — | Custom W × H | free entry, always available |

## Architecture — the one rule that matters

Three brand placement modes × three export paths × auto-fit text = **nine ways for
the preview and the exported file to disagree.** Prevent it structurally:

> **One layout function, three consumers.**
>
> ```
> computeLayout(state) → {
>   artboard: {w, h},
>   tiles:  [{x, y, w, h, srcRect:{sx,sy,sw,sh}, radius, photoId}],
>   band:   {rect, fill} | null,
>   lockup: {rect, variant: 'reverse'|'light'} | null,
>   scrim:  {rect, gradient} | null,
>   text:   [{str, x, y, px, weight, align, color}]
> }
> ```
>
> All coordinates in **artboard pixels**. Auto-fit font sizing happens *inside* this
> function (via canvas `measureText`), **never** in CSS.
>
> - **DOM preview** renders this object, CSS `transform: scale()`-ed down to fit the pane.
> - **Canvas painter** renders the same object at scale 1.
> - **HTML exporter** serializes the same object to a fixed-px `.sheet`.
>
> If any consumer computes its own geometry, they will drift, and it will only show
> up in the exported file.

### Image store — dual resolution (required by the 3600×5400 preset)

Per photo, hold both:
- `previewBitmap` — downscaled to ~1200px long edge. Drives the DOM and stays fast
  during focal-point dragging.
- `originalBlob` — decoded **only during export**, so print output is sharp.

At 13+ photos on a large-format artboard, decode → draw → release one tile at a time.

### IndexedDB — two stores, not one

- `blobs` — keyed by content hash, written **once** on import. Dedupes re-drops.
- `state` — the tiny layout JSON, autosaved **debounced** on change.

Autosaving 60 MB of photos on every focal-point drag would make the tool unusable.

### `.collage.json` — two save modes

- **Full** — embeds base64 photos. Portable and archival, but 12 print-res photos is
  60–80 MB. The UI states the size before saving.
- **Layout only** — geometry, spans, focal points, brand, text; no blobs. Small, and
  reloads against photos already in IndexedDB.

### Freebies — do not hand-write these

- ~~**Hole-refilling packer:** `grid-auto-flow: row dense`.~~ **Reversed during
  step 1.** CSS Grid would be free, but it makes the *DOM* the source of geometry
  truth, and the canvas painter and HTML exporter cannot read those rects back
  reliably through a scale factor. `packTiles()` now does dense first-fit in JS
  (~25 lines) and every consumer is positioned absolutely from its output. This is
  the single-layout-function rule winning over a shortcut.
- **PDF:** inject `@page { size: <W>px <H>px; margin: 0 }` from JS on **every**
  artboard-size change — a static stylesheet won't track the dropdown. Add
  `print-color-adjust: exact` per house convention.

### Highest-risk divergence point

`object-fit: cover` + `object-position: x% y%` places the image's *x%* point at the
container's *x%* point — **not** a naive center offset. The canvas `drawImage` srcRect
must reproduce that exactly.

The correct formula for `cover` with `object-position: px% py%`:

```
s  = max(tileW / imgW, tileH / imgH)     // cover scale
sw = tileW / s,  sh = tileH / s          // source rect size
sx = (imgW - sw) * px / 100              // NOT (imgW/2 - sw/2) + nudge
sy = (imgH - sh) * py / 100
```

**Parity test (pass/fail, not eyeballed).** Fixture: one photo with a hard-edged
marker (checkerboard corner or drawn crosshair), focal point `25% / 75%`, tile at
5:1, artboard 3744 × 768. Render the DOM preview to a canvas at scale 1 using the
same `srcRect`, render the export painter's output, and compare:

- tile edge positions must match **exactly** (integer px)
- image content offset must match **within 1 px**

Anything larger means the srcRect formula is wrong — not that the test is noisy.
Run this before building anything else on top of the painter.

### Leftover cells — photo count vs. grid

Auto cols (#9) plus arbitrary spans (#3) means 7 photos in a 3-col grid leaves a
hole, and a 2×2 span can push a tile past the last row. `grid-auto-flow: dense`
reorders to fill holes but cannot invent a tile.

**Rule: an unfilled cell renders as the brand mat color** (navy or orange per the
brand panel). It's the only option that can't surprise at an arbitrary custom
W × H, and at this palette a solid navy or orange block reads as intentional
composition rather than a gap.

### Cold-load font trap

`computeLayout()` must **await `document.fonts.ready`** before its first call.
Otherwise `measureText` auto-fit sizes the headline against Helvetica on a cold
load — subtly wrong in the preview, right in the export. Exactly the drift the
single-layout-function rule exists to prevent.

### Font portability

Exported HTML optionally embeds a base64 `@font-face` from the installed
`ShermanSans-*.ttf`. **Default off** — embedding a licensed SU font in a shared file
is the user's call. Off → the file falls back to Helvetica on machines without it.

## Controls (built with brand-sensible defaults, not asked)

Gutter width · corner radius (brand.md calls out circular/"bubble" motifs) · outer
mat width and color · band side (top/bottom) · band height · band fill (navy/orange/
white) · per-photo zoom · lightbulb toggle · template picker · column count override.

## Build order

1. `computeLayout()` + DOM preview + drop zone + size presets.
2. ~~Canvas painter + parity gate.~~ **DONE — gate passed**, see the step 2 addenda.
3. ~~Spans, drag-to-swap, focal-point drag.~~ **DONE** — see step 3 addenda.
4. ~~Brand panel + the three placement modes.~~ **DONE** — see step 4 addenda.
5. ~~Band text with `measureText` auto-fit.~~ **DONE** - see step 5 addenda.
6. ~~HTML export + injected `@page` PDF path.~~ **DONE** - see step 6 addenda.
7. ~~IndexedDB autosave + Save/Load.~~ **DONE** - see step 7 addenda.

---

## Step 1 addenda (found while building)

Step 1 is complete: `computeLayout()`, the DOM preview, the drop zone, and all 10
size presets. 62 unit tests pass (`_dev/run_tests.sh`), plus 9 headless screenshots.

### `autoCols` targets the median photo aspect, not a square

Originally it aimed for square-ish cells. That had a real bug: on a square artboard
with 12 photos, 3 columns and 4 columns are an **exact** tie, decided by ~5e-17 of
floating-point noise in `Math.abs(Math.log(...))`. Whichever way the noise fell was
arbitrary.

It now targets the **median aspect of the photos on the board**, which both removes
the tie and reduces cropping: 12 landscape photos on a square get 3 landscape
columns, 12 portraits get 4 portrait ones. A residual exact tie prefers more
columns, deterministically (`cost <= best.cost + 1e-12`).

### Crop parity is structural, not hoped-for

The preview does **not** use CSS `object-position`. It calls the shared
`coverSrcRect()` and positions the `<img>` from that rect:

```
displayW = imgW * s     left = -sx * s
displayH = imgH * s     top  = -sy * s        (s = cover scale from the same call)
```

which is exactly `drawImage(img, sx,sy,sw,sh, x,y,w,h)`. The canvas painter in step 2
therefore cannot disagree with the preview about cropping — it is the same numbers,
not a parallel implementation. The parity test still applies to bands, radii and text.

Verified visually with labelled fixtures: focal `(0,0)` shows the image's left edge,
focal `(100,100)` shows its bottom, and both survive a square → banner resize.

### CSS gotcha that cost a bug

`.row{display:flex}` and `#empty{display:grid}` silently override the `hidden`
attribute, so `el.hidden = true` did nothing — the Columns slider showed while
Template was Auto, and the "Drop photos" overlay sat on top of a populated artboard.
Fixed with `[hidden]{display:none!important}`. Keep that rule.

### Dev harness flake to know about

Headless `--screenshot` fires at the `load` event; on a cold HTTP cache the later
fixtures can still be decoding, yielding blank tiles that look like a layout bug
(one batch rendered 2 of 6 photos while the DOM correctly held 6 `<img>`).
`run_tests.sh` now warms each case and captures the second load. When a screenshot
looks wrong, check the harness `RESULT` JSON before suspecting the tool.

### Sub-pixel seams: fixed, and now asserted

`cw`/`ch` are fractional (`(aw - gutter*(cols-1))/cols`). Rounding each tile's `x`
and `w` *independently* left 1px hairlines of mat colour between tiles — measured at
**2 seams across a 5-column 3744px banner**. They are invisible in the 36% preview
and would have printed.

Fixed by rounding the cell **boundaries** once (`colX`/`colR`, `rowY`/`rowB`) and
deriving `w`/`h` from the difference. As a bonus the last column now lands exactly on
the content edge instead of up to 1px short. `_test.js` asserts no seams and exact
edge landing across 6 size/column combinations, including a deliberately awkward
1237x913 custom size.

This is the class of defect the single-layout-function rule exists to catch, and it
was found by an assertion rather than by looking at a PNG — which is the right order.

### Test count

74 assertions in `_dev/_test.js`, all passing. Coverage: the `coverSrcRect` formula
and its resolution independence, aspect-aware `autoCols`, dense packing with spans
and clamping, geometry invariants across all 10 presets, band/lockup placement and
both colour variants, mat-cell accounting, seam-freedom, purity and determinism.

---

## Step 2 addenda (canvas painter + parity gate)

Step 2 is complete and **the parity gate passed**, so steps 3–7 may now build on
the painter. `bash _dev/run_tests.sh --all` runs 80 unit assertions, 3 hi-res export checks
(one of which drives the real Download PNG handler) and 6 DOM-vs-canvas parity
cases, in about 35 seconds.

### Parity results

Both consumers render at scale 1 into one stacked screenshot, from the *same* source
pixels, so geometry differences are isolated from resampling differences:

| case | artboard | tile edges | mask | content offset |
|------|----------|-----------|------|----------------|
| grid (no band, r=0) | 1080×1080 | identical, 6 col + 6 row | **0 px** | (0,0) all 9 tiles |
| brand (orange band, r=6) | 1080×1080 | identical | 1 px | (0,0) |
| hero (2×2 span, r=4) | 1080×1080 | identical | **0 px** | (0,0) |
| white band (light variant) | 1080×1080 | identical | **0 px** | (0,0) |
| **banner, no band (r=0)** | **3744×768** | **identical, 12 col + 4 row** | **0 px** | (0,0) all 12 tiles |
| banner, orange band (r=4) | 3744×768 | identical | **0 px** | (0,0) |

The banner cases matter specifically: every 1080×1080 case divides evenly into 3
columns, whereas the banner has **fractional 607.5 px cell widths** — the exact
geometry that produced the step-1 seam bug. `mode=none` is required for the column
axis to be tested at all: a full-width band makes every column "not mat", which
makes the column-edge check vacuous, and columns are the axis the seams were on.

Residual mean |diff| is 0.38–0.48 / 255, with 0.1–0.4% of pixels differing by >32 —
all of it antialiasing on the fixtures' 1px gridlines, where CSS scaling and canvas
`drawImage` use different resamplers. That is expected and is reported for
information, not asserted.

### Two traps inside the parity test itself

- **A white-pixel centroid is the wrong metric.** Thresholding near-white kept 3989
  pixels in one tile for the DOM and 3616 for the canvas, swinging the centroid 24 px
  while the content was in fact perfectly aligned. Replaced with a ±3 px shift search
  minimising absolute difference — immune to threshold effects.
- **The mask test cannot see the lockup.** Band and lockup are both "not mat", and no
  shift improves a blank band, so a canvas render that dropped the lockup entirely
  would have passed checks 1–3. Closed with an ink-volume check per band.

### Brand bug the parity test surfaced: orange-on-orange

The bundled lockup contains its own `#F76900` Block S and "Syracuse University" text.
On an **orange band those elements vanish** — both consumers agreed, so parity passed
while the logo was wrong.

`brand.md` defines only dark-ground (light-blue wordmark) and light-ground
(medium-blue wordmark) variants; an orange ground is undefined. Added a third
`mono` variant that renders the whole lockup in Otto navy, since **navy-on-orange is
an approved combo** and it is the only option that keeps every element visible
without inventing a colour. `lockupVariant()` now maps navy→reverse,
white→light, orange→mono, and a unit test asserts all three are distinct.

**This is a brand judgement worth a human check** — the alternative, if recolouring
the mark is unacceptable, is to keep the full-colour lockup on a navy plate inset
within the orange band.

### Export path

`paintToCanvas(st, {hiRes:true})` decodes the **original** File per tile and releases
it immediately (`decode → draw → release`), rather than holding 16 originals at once.
Verified rather than assumed: reported `hiResDims` (1600x1067, 1200x1600, 1800x1200)
differ from `previewDims` (1200x800, 900x1200, 1200x800).

Measured with the test fixtures (≤2400 px sources), 12 photos:

| artboard | paint | encode | PNG |
|----------|-------|--------|-----|
| 3744×768 banner | 105 ms | 11 ms | 0.33 MB |
| 3840×2160 4K sign | 172 ms | 37 ms | 0.92 MB |
| 3600×5400 24×36" poster | 210 ms | 72 ms | 1.87 MB |

Real 24 MP camera files will be substantially slower than these fixtures, so the
>12-photos-at-print-size warning stays.

### Dev harness rebuilt on CDP

Chrome's `--screenshot` flag fires at the load event and silently captured
half-decoded images (one batch rendered 2 of 6 photos while the DOM correctly held
6 `<img>`); it also never waits for async work like the canvas paint. Replaced with
`_dev/cdp_shot.js`, a ~120-line zero-dependency DevTools Protocol driver (Node 22's
global `WebSocket`) that waits for `window.__ready`, sets exact device metrics, and
reports page exceptions. The warm-the-cache workaround is gone.

One trap it exposed: the parity page must diff a **clone** of `#sheet`. The tool
re-runs `renderPreview()` on resize, CDP's device-metrics override fires one, and
with the UI hidden the stage measures 0 wide — giving the live sheet a *negative*
scale and making it disappear.

---

## Step 3 addenda (arrange: pan, zoom, swap, span)

All four gestures are live. `bash _dev/run_tests.sh --all` now also drives
**synthetic PointerEvents** through the real delegated handlers (via
`document.elementFromPoint`, not by calling internals) across six artboard
geometries: 15–16 gesture assertions each, all passing.

### Gestures

| gesture | action |
|---------|--------|
| drag inside a photo | move its focal point (crop) |
| scroll over a photo | zoom 1× – 5×, clamped so it never goes below cover |
| double-click a photo | recentre crop, clear zoom |
| drag the ⠳ grip (top-left) | drop on another photo to swap the two |
| drag the orange corner | span more columns/rows; double-click it to reset |

### Design decisions worth knowing

- **Spans belong to the slot, not the picture.** Swapping exchanges the two
  photos and then puts each span back, so a swap trades pictures without
  reshaping the collage.
- **Pan sign.** Dragging right moves the image content right, which means
  revealing more of its left edge — so `sx` and the focal percentage *decrease*.
  An assertion checks both the direction and that the magnitude matches
  `fx0 - dx / (s * slackX) * 100` within 0.6%.
- **Pan constants are measured once per gesture.** `sw`/`sh` depend only on tile
  size and zoom, so the slack and cover scale cannot change mid-drag; recomputing
  them per move would drift.
- **Span drag anchors to the tile origin and cell pitch captured at
  pointerdown.** Recomputing them each move oscillates: growing a span can reflow
  the grid, which moves the tile and changes the pitch, which changes the span
  again.
- **Pan takes a fast path.** `refreshTileCrop()` repositions one `<img>` instead
  of rebuilding `innerHTML`, so the drag stays smooth *and* the element (with its
  pointer capture) survives. It calls the same `coverSrcRect()` the exporter
  does, so dragging cannot introduce a preview/export divergence.
- **Interaction state lives in `ui`, not `state`.** It never enters
  `computeLayout()`, so highlights and handles can never leak into a PNG. A test
  asserts the layout object carries no UI keys.

### Two bugs found while building this

**`autoCols` counted photos, not cells.** With drag-to-span making heroes easy to
create, this became visible: 8 photos with one 2×2 hero on a banner chose
**8 columns × 2 rows and stranded 5 mat cells**. A hero occupies four cells, so
the column choice now uses `cellDemand()` — the same case is **6 × 2 with 1
stranded cell**. Column count is also floored at the widest span so a span can
never be silently clamped away. Pinned by a characterisation test using the real
fixture dimensions; uniform-aspect photos do *not* reproduce it.

**A negative preview scale.** `renderPreview()` derived its scale from
`stage.clientWidth`, which is 0 when the stage is hidden or collapsed — yielding
a negative scale that blanked the sheet entirely (first seen when CDP's
device-metrics override fired a resize on the parity page). Now floored at 0.02.

### Handle sizing

The grip and resize handles are sized in inverse-scale units (`--ui`, set to
`1/scale` by `renderPreview`), so they stay ~26 px on screen whether the artboard
is 816 px or 3744 px wide. A consequence to remember when writing tests: their
*artboard* offset grows with the artboard (x≈19.6 on a 3744 banner, x≈36 on a
3600×5400 poster), so a test must target the element's real rect rather than a
guessed offset — guessing is what made the swap test fail on two presets.

---

## Step 4 addenda (brand panel, three placements, movable mark)

`bash _dev/run_tests.sh --all`: **139 unit assertions**, 27–28 gesture assertions
across six geometries, 3 hi-res export checks, and **10 parity cases**. All green.

### Brand is now state, not constants

`BRAND` became `state.brand` with **roles** rather than colour names:
`dark` / `accent` / `light` (was navy / orange / white). `fillOf(role, brand)` and
`lockupVariant(role, brand)` both take the palette, so `computeLayout` stays pure and
an override cannot leak between renders. Panel exposes the three roles as colour
pickers, an uploaded logo, the on-accent treatment, and Reset brand.

A `luminance()` guard means a *custom* "dark" role that is actually pale still flips
the lockup to its light treatment — otherwise overriding the palette would silently
reproduce the invisible-text bug in a new place.

### The orange-on-orange question is now a setting

Rather than deciding for the user, `brand.onAccent` offers both answers:

- `mono` (default) — the whole lockup in dark on the accent ground.
- `plate` — the artwork stays **untouched** on a dark plate inset behind it,
  so `brand.md`'s "don't recolor" rule is honoured literally.

Both are parity-tested (`parity_brand`, `parity_plate`).

### Three placements

| mode | geometry |
|------|----------|
| `band` | full-width strip; mark sized off the BAND height so it reads the same on a 1080 square and a 3744 banner; nudgeable along the band |
| `cell` | the mark is a pseudo item **in the packer**, so it occupies a real grid cell rather than covering one |
| `overlay` | photos bleed; mark in a corner or placed freely, over a gradient scrim |

**`cell` needs two packing passes.** The mark wants a wide cell (7.66:1), but the
span it needs depends on the row height, which depends on the pack. So: pack once
with a 1-column mark to learn the row height, widen the mark to something it can sit
in, pack again for real. Two deterministic passes — no iterating to convergence.

### The mark can be moved and resized on the artboard

Requested mid-build. `chrome.markX` / `markY` are the mark **centre as a percentage**
of the artboard, so a hand placement survives a change of artboard size the same way
photo focal points do. `placed` flips true on first drag and the corner preset stops
applying; double-clicking the mark resets both placement and size.

- overlay: free drag on both axes (`drag:'xy'`), width from `sizePct`
- band: horizontal nudge only (`drag:'x'`), height from `bandMarkPct`
- resize handle is absolute from the width captured at pointerdown, so it cannot
  compound across a drag

### Two layers, so dragging the logo is cheap

`#sheet` now holds an **art layer** (holes + tiles) and a **chrome layer** (scrim,
band, plate, mark). Moving or resizing the mark reflows nothing, so `renderChrome()`
rebuilds only the chrome — dragging the logo does not re-create sixteen `<img>`
elements per pointermove.

**The trap this created, caught by the gesture tests:** the chrome layer covers the
whole sheet, so it swallowed every gesture aimed at the photos beneath it. Tile pan
and wheel-zoom broke instantly. `#chrlayer{pointer-events:none}` with the mark's own
handles opting back in via `pointer-events:auto`.

### The scrim holds strength across the mark

A plain two-stop gradient is darkest at the artboard **edge** and already half-faded
where the mark actually sits, leaving the light-blue wordmark fighting the photo. The
scrim is now three stops — full strength from the edge through past the mark, then
fade — with **explicit stop positions** emitted to both consumers so the CSS ramp and
the canvas ramp are driven by the same numbers. A test asserts the whole mark lies
inside the plateau.

### A harness bug that looked exactly like a painter bug

Overlay parity failed at mean |diff| 8.7/255 and 20.1/255. The cause was **not** the
canvas: the parity page hand-maintained a duplicated CSS list for its cloned sheet,
and `.scrim` / `.plate` / `.layer` were never added when those were introduced — so
the clone rendered them `position:static`, in the wrong place.

Fixed by **deriving** the rules: the harness now walks `document.styleSheets` and
copies every `#sheet` rule to `#paritysheet`. Mean diff dropped to 0.41 and 0.25.
The lesson is the same one the tool itself is built on — derive, never duplicate;
a hand-kept parallel list will fall behind and the failure will point at the
wrong component.

### Not done in step 4

The **font** picker. Nothing on the artboard sets type yet, so a font control would
be inert — it lands in step 5 with the band headline, where it takes effect.

---

## Step 5 addenda (band copy, auto-fit, font picker)

`bash _dev/run_tests.sh --all`: **164 unit assertions**, 27–28 gesture assertions
across six geometries, 3 hi-res export checks, and **13 parity cases**. All green.

### Text parity: SVG `<text>`, not a positioned div

This was the riskiest consumer yet. CSS block text anchors on its **box top**, and
the offset from box top to baseline depends on font metrics — so a `<div>` preview
and `fillText` export would drift by an amount that changes with the font.

The DOM therefore draws band copy as inline **SVG `<text>`**, which anchors on the
**baseline** and an explicit `x`, exactly like canvas `fillText`:

| | anchor | alignment |
|---|---|---|
| canvas | `textBaseline='alphabetic'`, `fillText(str, x, y)` | `textAlign` |
| DOM | `dominant-baseline="alphabetic"`, `<text x= y=>` | `text-anchor` |

`L.text` carries `{str, x, y, px, weight, align, color, font}` with **`y` as the
baseline**, so neither consumer computes typography of its own. Result: 1–1980 px of
mask difference and mean |diff| 0.33–0.77 / 255 across three text cases (dark band,
light band, and a serif font).

### Auto-fit lives in the layout function

`fitText()` shrinks to the largest **integer** px that fits, using an injectable
measurer. In the browser that measurer is a canvas 2d context — the very same kind of
object `paintToCanvas` draws with — so measurement and rendering cannot disagree.
Integer sizes matter: a fractional size would round differently in the two consumers.

The measurer is injectable for a second reason: the pure layout region must stay
DOM-free so `_test.js` can require it from node. The default measurer is a crude
DOM-free approximation, the browser installs the real one via `setTextMeasurer()`,
and the node tests inject a deterministic one to exercise the fitting logic.
`run_tests.sh` asserts the pure region contains no `document.` reference, which is
exactly what caught the first attempt at this.

### The band becomes two columns when copy is present

First attempt just moved the mark to the right edge. That was not enough: at the
default 52% of band height the lockup is **858 px wide on a 1080 artboard** — 79% of
the width — so the copy got a 104 px column, failed the minimum-width check, and was
**silently dropped entirely**.

With copy present the band now splits: the mark is capped to its own column (42% of
the usable width) and sized to fit it, and the copy takes the rest. Without copy the
mark still centres at its full size, so nothing about the previous behaviour changed.
A hand-dragged position still wins over both defaults, and the copy takes whichever
side of the mark is wider — so nudging the logo across the band moves the copy to the
other side instead of colliding with it.

### Ink colour follows the ground, not a constant

Copy is drawn in the `light` role on a dark or accent band and the `dark` role on a
light band. With the palette overridable, a fixed white would have reproduced the
invisible-text bug for the third time.

### Font picker

Four stacks: Sherman Sans (brand, installed locally), Helvetica/Arial, Georgia,
Monospace. Deferred from step 4 on purpose — until there was type on the artboard the
control would have been inert. The chosen stack flows into `L.text[].font` and is
used verbatim by both consumers.

### A slider that lied

The mark-size slider was labelled "Mark width", but in band mode it sets the mark's
**height** as a percentage of the band (overlay mode sets width as a percentage of the
artboard). The label and tooltip now switch with the mode.

### A shell escaping trap, for the record

Two heredoc-driven patches failed because `\n` inside a `python - <<'PY'` block
reached Python as a real newline rather than the two characters, so an anchor string
never matched. Long code blocks are now written with the editor and spliced on an
**escape-free anchor** instead of being pasted through a shell heredoc.

---

## Step 6 addenda (self-contained HTML export + PDF)

The third consumer exists, and it is verified against the second by rendering it.
`bash _dev/run_tests.sh --all`: 164 unit assertions, 27–28 gesture assertions across
six geometries, 3 hi-res export checks, **13 DOM-vs-canvas parity cases** and
**4 exported-HTML round trips**. All green, about a minute.

### Each tile is pre-cropped, so the exporter has no cropping logic

`tileDataURL()` crops and scales each photo to exactly its tile via the shared
`coverSrcRect()`, then embeds it as a JPEG data URI. The exported markup is therefore
a plain `<img>` at the tile rect with no `object-fit` anywhere — **a third place to
get cropping wrong simply does not exist.**

Resolution is chosen per tile: use spare source pixels up to 2×, never upscale. A flat
1× embed prints soft; a blanket 2× bloats the file for photos with no extra pixels to
give. JPEG rather than PNG — photos as PNG are enormous.

Measured output: **266 KB** for a 1080×1080 with 6 photos, **533 KB** for the
3744×768 banner with 10.

### Round trip is the only proof that counts

Checking the exported string tells you nothing about what a browser does with it. The
harness renders the exported HTML in an iframe at scale 1 directly below a canvas
render of the same state and diffs the two:

| case | tile edges | mask | content offset |
|------|-----------|------|----------------|
| band + copy | identical | 1983 px (0.17%) | (0,0) all 6 |
| overlay + scrim | identical | pass | (0,0) |
| lockup-as-cell | identical | pass | (0,0) |
| 3744×768 banner | identical, 16 edges | **6 px** | (0,0) all 11 |

Residual mean |diff| is higher than the canvas-vs-DOM cases (0.36–0.86 / 255) purely
because the export re-encodes to JPEG. Geometry is what is asserted.

### PDF prints the exported sheet, not the app

`exportPDF()` builds the same HTML, loads it into a hidden iframe, waits for images
and fonts, and prints **that**. Printing the app would print the sidebar and the
CSS-scaled preview. `@page{size:<W>px <H>px;margin:0}` is generated per export so it
always tracks the artboard, plus `print-color-adjust:exact` per the house convention.

### Optional font embed

The browser cannot read an installed system font, so a portable export needs the file
itself. "Embed font file…" takes a `.woff2/.ttf/.otf` and inlines it as an
`@font-face` data URI; the button then offers to remove it. Off by default —
embedding a licensed SU face in a shared file is the user's decision, not the tool's.
Verified: the rule is emitted and the file stays self-contained.

### Two harness bugs this step exposed

**The harness builder injected a script tag into the middle of a JS template
literal.** It replaced the *first* `</body>` in the file — and the new HTML exporter
legitimately contains `</body>` inside its template string. The page died with
"SyntaxError: Unexpected end of input" and, because `cdp_shot.js` only logged
`exceptionDetails.text` (always just "Uncaught"), the message said nothing. Two fixes:
split on the **last** `</body>`, and log `exception.description` so a page error names
itself. The regeneration snippet, which had been pasted inline into several commands,
is now `_dev/build_harness.py` — one copy, with the reason in a docstring.

**The shift search reported phantom misalignment on flat regions.** A featureless
crop (empty navy band) scores 0 at *every* offset, so the search returned whichever
it tried first — reporting 5 of 16 tiles "misaligned" at a perfect render. Now
uniform regions are skipped and a tie must favour no shift. Guarded against
over-loosening with a **negative control**: a deliberately 2 px-shifted pair still
fails, detecting (+2,+2) with the score dropping 387422 → 21.

---

## Step 7 addenda (persistence) — project complete

`bash _dev/run_tests.sh --all` now runs, in about 70 seconds:

- 164 unit assertions on the pure layout functions
- 27–28 synthetic-gesture assertions across six artboard geometries
- 3 hi-res export checks (one drives the real Download PNG handler)
- 13 DOM-vs-canvas parity cases
- 4 exported-HTML round trips
- **19 persistence assertions** across two page loads
- **3 `.collage.json` save/load cases**

All green.

### Two stores, for the reason the spec gave

`blobs` is keyed by **content hash** and written exactly once, in `addFiles`.
`state` holds the layout snapshot — measured at **under 2 KB for six photos**. One
combined store would rewrite tens of megabytes on every focal-point drag. Autosave is
debounced at 600 ms and has a single call site inside `renderPreview()`, so no state
change can forget to save.

Content hashing is SHA-256 via `crypto.subtle` (a `file://` page is a secure context
in Chrome), falling back to a sampled FNV digest rather than losing dedupe if it is
ever unavailable. Re-dropping the same photo reuses one stored blob.

### The ordering trap that would have eaten the snapshot

`renderPreview()` runs at startup with zero photos. With autosave wired to it, that
first render would have **saved an empty board over the snapshot** before the user was
ever offered it. Autosave therefore stays *disarmed* until the restore decision is
made — restored, discarded, or nothing to restore. This is the kind of bug that only
appears on the second launch, which is exactly why the persistence test navigates
twice.

### Testing persistence needed a different harness

A round trip is meaningless inside one page load. `_dev/persist_test.js` drives **two
navigations in one browser profile**: the first ingests real files through the real
`addFiles`, edits focal point, zoom, span, band copy, palette, artboard and mark
placement, then waits for the debounced write to actually appear in IndexedDB. The
second seeds **nothing**, waits for the tool's own restore prompt, clicks Restore, and
diffs a fingerprint of the result. A fresh temp profile per run means a pass cannot be
an artefact of leftover state.

It also asserts the restored photos keep an **original blob**, not just a preview —
otherwise a restored session would silently export at preview resolution.

### `.collage.json` has two honest modes

| mode | size (5 photos) | portable? |
|------|-----------------|-----------|
| Photos + layout | **707 KB** | yes — verified by wiping IndexedDB before loading |
| Layout only | **1 KB** | only where the blobs already exist |

The third test is the one worth having: a layout-only file opened with **no blobs
present** loads all the settings, restores zero photos, and says so by name rather
than failing silently or pretending to have worked.

### Degradation

Every IndexedDB call is wrapped; the first failure sets `persistOK = false` and the
sidebar says "Autosave unavailable in this browser session." The tool keeps working —
persistence is the only thing lost, and the user is told.
