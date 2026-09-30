"""Parity test: DOM preview (top half) vs canvas painter (bottom half).

The harness stacks both renders at scale 1 in one screenshot, so this can diff
them directly. Both consumers read the same source pixels (hiRes:false), which
isolates GEOMETRY differences from resampling differences.

Pass criteria (from SPEC.md):
  * tile edge positions must match EXACTLY (integer px)
  * image content offset must match within 1 px

Usage: python compare_parity.py _shots/parity_grid.png [--tol 1]
"""
import sys
from PIL import Image, ImageChops

TOL_CONTENT = 1          # px, allowed drift of content centroid
MAT_DIST = 40            # colour distance that counts as "not the mat"



def split_halves(path):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if h % 2:
        h -= 1
    half = h // 2
    return im.crop((0, 0, w, half)), im.crop((0, half, w, half * 2))


def mask_not_mat(img, mat):
    px = img.load()
    w, h = img.size
    mr, mg, mb = mat
    out = bytearray(w * h)
    for y in range(h):
        row = y * w
        for x in range(w):
            r, g, b = px[x, y]
            if abs(r - mr) + abs(g - mg) + abs(b - mb) > MAT_DIST:
                out[row + x] = 1
    return out, w, h


def transitions(mask, w, h, axis):
    """Indices where the projected profile flips between empty and non-empty."""
    if axis == "cols":
        prof = [any(mask[y * w + x] for y in range(h)) for x in range(w)]
    else:
        prof = [any(mask[y * w + x] for x in range(w)) for y in range(h)]
    return [i for i in range(1, len(prof)) if prof[i] != prof[i - 1]]


def runs_from_profile(mask, w, h, axis):
    if axis == "cols":
        prof = [any(mask[y * w + x] for y in range(h)) for x in range(w)]
    else:
        prof = [any(mask[y * w + x] for x in range(w)) for y in range(h)]
    runs, start = [], None
    for i, v in enumerate(prof):
        if v and start is None:
            start = i
        elif not v and start is not None:
            runs.append((start, i - 1))
            start = None
    if start is not None:
        runs.append((start, len(prof) - 1))
    return runs


def abs_diff_sum(a, b):
    """Total absolute difference between two equal-size grayscale crops."""
    h = ImageChops.difference(a, b).histogram()
    return sum(i * c for i, c in enumerate(h))


def best_shift(dom_g, cvs_g, box, radius=3, margin=6):
    """Sub-tile shift that best aligns the canvas crop to the DOM crop.

    Measuring a white-pixel centroid does NOT work here: the fixtures contain
    1px white gridlines, and CSS scaling vs canvas drawImage antialias them
    differently, so a brightness threshold keeps different pixel counts (3989
    vs 3616 in one tile) and the centroid swings by tens of pixels even when
    the content is perfectly aligned. A shift search is immune to that.

    Returns (dx, dy, score_at_zero, best_score).
    """
    x0, y0, x1, y1 = box
    x0 += margin; y0 += margin; x1 -= margin; y1 -= margin
    if x1 - x0 < 24 or y1 - y0 < 24:
        return None
    ref = dom_g.crop((x0, y0, x1, y1))

    # A featureless region (flat band colour, empty mat) scores 0 at EVERY
    # shift, so the search would return whichever offset it happened to try
    # first and report a misalignment that does not exist. Nothing to align.
    lo, hi = ref.getextrema()
    if hi - lo < 8:
        return None

    best = None
    zero = None
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            cand = cvs_g.crop((x0 + dx, y0 + dy, x1 + dx, y1 + dy))
            s = abs_diff_sum(ref, cand)
            if dx == 0 and dy == 0:
                zero = s
            if best is None or s < best[2]:
                best = (dx, dy, s)

    # Ties and near-ties must favour "no shift": a shift only indicates real
    # misalignment when it is meaningfully better than leaving it alone.
    if zero is not None and best[2] >= zero * 0.98:
        return (0, 0, zero, best[2])
    return (best[0], best[1], zero, best[2])


def main():
    path = sys.argv[1]
    dom, cvs = split_halves(path)
    if dom.size != cvs.size:
        print("FAIL: halves differ in size", dom.size, cvs.size)
        return 1

    w, h = dom.size
    mat = dom.load()[0, 0]
    print("image %dx%d per half   mat colour rgb%s" % (w, h, mat))

    dm, _, _ = mask_not_mat(dom, mat)
    cm, _, _ = mask_not_mat(cvs, mat)

    fails = 0

    # ---- 1. tile edges must line up exactly -------------------------------
    for axis in ("cols", "rows"):
        td = transitions(dm, w, h, axis)
        tc = transitions(cm, w, h, axis)
        if td == tc:
            print("  PASS  %s edge transitions identical (%d edges)" % (axis, len(td)))
        else:
            fails += 1
            print("  FAIL  %s edge transitions differ" % axis)
            print("        dom   : %s" % td[:24])
            print("        canvas: %s" % tc[:24])
            only_d = [v for v in td if v not in tc]
            only_c = [v for v in tc if v not in td]
            print("        dom-only %s  canvas-only %s" % (only_d[:12], only_c[:12]))

    # ---- 2. overall mask agreement ----------------------------------------
    diff = sum(1 for i in range(w * h) if dm[i] != cm[i])
    pct = 100.0 * diff / (w * h)
    # anti-aliasing along tile borders is expected; structural misplacement is not
    limit = 0.35
    if pct <= limit:
        print("  PASS  mask agreement: %d px differ (%.3f%% <= %.2f%%)" % (diff, pct, limit))
    else:
        fails += 1
        print("  FAIL  mask agreement: %d px differ (%.3f%% > %.2f%%)" % (diff, pct, limit))

    # ---- 3. content offset per tile ---------------------------------------
    col_runs = runs_from_profile(dm, w, h, "cols")
    row_runs = runs_from_profile(dm, w, h, "rows")
    print("  detected %d column band(s), %d row band(s)" % (len(col_runs), len(row_runs)))

    dom_g, cvs_g = dom.convert("L"), cvs.convert("L")
    checked = 0
    offenders = []
    for (ry0, ry1) in row_runs:
        for (cx0, cx1) in col_runs:
            r = best_shift(dom_g, cvs_g, (cx0, ry0, cx1, ry1))
            if r is None:
                continue
            dx, dy, zero, best = r
            checked += 1
            if abs(dx) > TOL_CONTENT or abs(dy) > TOL_CONTENT:
                offenders.append(((cx0, ry0), dx, dy, zero, best))
    if not checked:
        print("  WARN  no tiles large enough to compare content offset")
    elif not offenders:
        print("  PASS  content offset: best alignment is (0,0) within %dpx for all %d tiles"
              % (TOL_CONTENT, checked))
    else:
        fails += 1
        print("  FAIL  content offset: %d of %d tiles align better when shifted"
              % (len(offenders), checked))
        for at, dx, dy, zero, best in offenders[:6]:
            print("        tile at %s wants shift (%+d,%+d)  score %d -> %d"
                  % (at, dx, dy, zero, best))

    # ---- 4. ink volume per band ------------------------------------------
    # The mask test cannot see the lockup: it sits on the band, and band and
    # lockup are both "not mat", so a canvas render that dropped the lockup
    # entirely would still pass checks 1-3 (no shift helps a blank band).
    # Counting ink against each band's own modal colour catches that.
    def ink(img, box):
        c = img.crop((box[0], box[1], box[2] + 1, box[3] + 1)).convert("RGB")
        cols = c.getcolors(c.width * c.height) or []
        if not cols:
            return 0, 0
        base = max(cols)[1]
        n = sum(cnt for cnt, col in cols
                if abs(col[0] - base[0]) + abs(col[1] - base[1]) + abs(col[2] - base[2]) > 40)
        return n, c.width * c.height

    ink_fails = 0
    for (ry0, ry1) in row_runs:
        box = (0, ry0, w - 1, ry1)
        dn, area = ink(dom, box)
        cn, _ = ink(cvs, box)
        if dn < 200 and cn < 200:
            continue                      # a plain fill in both, nothing to compare
        rel = abs(dn - cn) / float(max(dn, cn, 1))
        tag = "rows %d-%d" % (ry0, ry1)
        if rel <= 0.15:
            print("  PASS  ink volume %s: dom %d vs canvas %d (%.1f%% apart)"
                  % (tag, dn, cn, 100 * rel))
        else:
            ink_fails += 1
            print("  FAIL  ink volume %s: dom %d vs canvas %d (%.1f%% apart) "
                  "- content missing or mis-scaled" % (tag, dn, cn, 100 * rel))
    fails += ink_fails

    # residual intensity difference, reported for information: nonzero here is
    # expected (two different resamplers), structural drift is what fails above
    gd = ImageChops.difference(dom_g, cvs_g).histogram()
    tot = sum(gd)
    mean = sum(i * c for i, c in enumerate(gd)) / float(tot)
    over32 = sum(c for i, c in enumerate(gd) if i > 32)
    print("  info  mean |diff| %.3f/255 · %d px (%.3f%%) differ by >32 (resampling)"
          % (mean, over32, 100.0 * over32 / tot))

    print("PARITY %s" % ("PASSED" if not fails else "FAILED (%d check(s))" % fails))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
