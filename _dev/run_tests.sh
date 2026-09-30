#!/usr/bin/env bash
# Dev harness for collage-tool.html. Run from this directory:
#     bash run_tests.sh              # unit tests only
#     bash run_tests.sh --shots      # + preset screenshots
#     bash run_tests.sh --parity     # + DOM-vs-canvas parity test (the step-2 gate)
#     bash run_tests.sh --all        # everything
#
# Regenerates its inputs from ../collage-tool.html every run, so it can never
# test a stale copy. Screenshots go through cdp_shot.js, which waits for
# window.__ready instead of racing Chrome's load event.
set -uo pipefail
cd "$(dirname "$0")"
PORT=8731
fail=0
MODE="${1:-}"
do_shots=0; do_parity=0
[ "$MODE" = "--shots"  ] && do_shots=1
[ "$MODE" = "--parity" ] && do_parity=1
[ "$MODE" = "--all"    ] && { do_shots=1; do_parity=1; }

command -v node >/dev/null || { echo "node not found"; exit 1; }

# ---- 1. extract the pure layout module + the harness copy of the tool ------
python build_harness.py
[ $? -eq 0 ] || exit 1

# ---- 2. syntax + unit tests ------------------------------------------------
node --check _pure.js || { echo "SYNTAX ERROR in extracted module"; exit 1; }
node _test.js || fail=1

[ $do_shots -eq 0 ] && [ $do_parity -eq 0 ] && exit $fail

# ---- serve the harness ----------------------------------------------------
mkdir -p _shots
python -m http.server $PORT >_server.log 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1

shot(){ node cdp_shot.js "http://localhost:$PORT/_autotest.html?$2" "_shots/$1.png" "${3:-1680}" "${4:-1020}"; }

# ---- 3. preset screenshots ------------------------------------------------
if [ $do_shots -eq 1 ]; then
  echo ""
  echo "--- preset screenshots ---"
  for spec in \
    "square:preset=ig-square&n=9" \
    "banner:preset=banner&n=12" \
    "flyer:preset=flyer&n=7&radius=8" \
    "hero:preset=ig-square&n=7&hero=1&radius=6&gutter=2" \
    "focal:preset=banner&n=6&focal=1" \
    "story:preset=story&n=6" \
    "orange:preset=ig-square&n=8&fill=accent&side=t&matcolor=accent" \
    "white:preset=flyer&n=6&fill=light&matcolor=light" \
    "bleed:preset=ig-square&n=9&mode=none&gutter=0&outer=0"; do
    name="${spec%%:*}"; qs="${spec#*:}"
    shot "$name" "$qs" >/dev/null 2>&1 && echo "  _shots/$name.png   ($qs)" \
      || { echo "  FAILED $name"; fail=1; }
  done

  echo ""
  echo "--- synthetic gestures (pan / zoom / swap / span) ---"
  for pre in ig-square banner flyer p2436 story sign4k; do
    printf "  %-10s " "$pre"
    node cdp_shot.js "http://localhost:$PORT/_autotest.html?gestures=1&preset=$pre&n=9" \
      "_shots/_gest_$pre.png" 1500 950 2>/dev/null | python -c "
import sys, json
got = False
for line in sys.stdin:
    if 'GESTURES' in line:
        d = json.loads(line.split('GESTURES ', 1)[1]); got = True
        bad = d['failures']
        print(('PASS %d/%d' % (d['passed'], d['total'])) if not bad
              else ('FAIL %d/%d' % (d['passed'], d['total'])))
        for f in bad:
            print('      %s   >> %s' % (f['t'], f['d']))
        sys.exit(1 if bad else 0)
if not got:
    print('FAIL no gesture result'); sys.exit(1)
" || fail=1
  done

  echo ""
  echo "--- hi-res export path (real File ingestion + original decode) ---"
  for pre in banner p2436 sign4k; do
    # the banner case also drives the real Download PNG button handler
    extra=""; [ "$pre" = "banner" ] && extra="&clickexport=1"
    node cdp_shot.js "http://localhost:$PORT/_autotest.html?export=1${extra}&preset=$pre&n=12" \
      "_shots/export_$pre.png" 1040 940 2>/dev/null | python -c "
import sys, json
found = False
for line in sys.stdin:
    if 'EXPORT' in line:
        d = json.loads(line.split('EXPORT ', 1)[1]); found = True
        okflags = (d['originalsRetained'] and d['previewsDownscaled']
                   and d['distinctColours'] > 8
                   and d.get('exportOk', True) and d.get('buttonReenabled', True))
        note = 'originals used'
        if 'exportOk' in d:
            note += ' + button handler: ' + str(d['statusAfter'])
        print('  %s  %-11s paint %4dms encode %4dms  %5.2f MB  %s' % (
            'PASS ' if okflags else 'FAIL ', d['canvas'], d['paintMs'], d['encodeMs'],
            d['pngBytes'] / 1048576.0, note if okflags else d))
        sys.exit(0 if okflags else 1)
sys.exit(0 if found else 1)
" || fail=1
  done
fi

# ---- 4. parity: the step-2 gate ------------------------------------------
if [ $do_parity -eq 1 ]; then
  echo ""
  echo "--- DOM vs canvas parity ---"
  for spec in \
    "parity_grid:parity=1&preset=ig-square&n=9&mode=none&radius=0&gutter=2&outer=2" \
    "parity_brand:parity=1&preset=ig-square&n=9&mode=band&fill=accent&matcolor=dark&radius=6&gutter=2&outer=2" \
    "parity_hero:parity=1&preset=ig-square&n=7&hero=1&mode=band&fill=accent&radius=4&gutter=2&outer=2" \
    "parity_white:parity=1&preset=ig-square&n=6&mode=band&fill=light&matcolor=dark&radius=0&gutter=2&outer=2" \
    "parity_cell:parity=1&preset=ig-square&n=8&mode=cell&fill=dark&matcolor=dark&radius=4&gutter=2&outer=2" \
    "parity_plate:parity=1&preset=ig-square&n=6&mode=band&fill=accent&matcolor=dark&onaccent=plate&radius=4&gutter=2&outer=2" \
    "parity_overlay:parity=1&preset=ig-square&n=6&mode=overlay&corner=bl&marksize=34&scrim=80&gutter=2&outer=2" \
    "parity_overlay_free:parity=1&preset=ig-square&n=6&mode=overlay&markx=62&marky=38&marksize=40&scrim=70&gutter=2&outer=2" \
    "parity_text:parity=1&preset=ig-square&n=6&mode=band&fill=dark&matcolor=dark&headline=DEMO%20DAY%202026&subhead=Bird%20Library%2C%201st%20Floor&bandpct=20&gutter=2&outer=2" \
    "parity_text_light:parity=1&preset=ig-square&n=6&mode=band&fill=light&matcolor=dark&headline=Cohort%202026&bandpct=18&gutter=2&outer=2" \
    "parity_text_serif:parity=1&preset=ig-square&n=6&mode=band&fill=accent&matcolor=dark&font=georgia&headline=Innovation%20Showcase&subhead=Thursday%20at%205pm&bandpct=22&gutter=2&outer=2"; do
    name="${spec%%:*}"; qs="${spec#*:}"
    echo ""
    echo "[$name]"
    shot "$name" "$qs" 1080 2160 >/dev/null 2>&1 || { echo "  capture FAILED"; fail=1; continue; }
    python compare_parity.py "_shots/$name.png" || fail=1
  done

  # The 1080x1080 cases above all divide evenly into 3 columns. The step-1 seam
  # bug only appeared at 3744 with FRACTIONAL cell widths (607.5 px), so the
  # banner must be covered too. mode=none matters: a full-width band makes every
  # column "not mat", which makes the column-edge check vacuous - and columns are
  # exactly the axis the seams were on.
  for spec in \
    "parity_banner_cols:parity=1&preset=banner&n=12&mode=none&radius=0&gutter=2&outer=1.5" \
    "parity_banner:parity=1&preset=banner&n=12&mode=band&fill=accent&matcolor=dark&radius=4&gutter=2&outer=1.5"; do
    name="${spec%%:*}"; qs="${spec#*:}"
    echo ""
    echo "[$name]  (3744x768 per half - the pure-python scan takes a while)"
    shot "$name" "$qs" 3744 1536 >/dev/null 2>&1 || { echo "  capture FAILED"; fail=1; continue; }
    python compare_parity.py "_shots/$name.png" || fail=1
  done

  # ---- 5. HTML export round trip: consumer 3 vs consumer 2 ----------------
  # Renders the EXPORTED html in an iframe directly below a canvas render of the
  # same state. This is the only check that proves the exporter: everything else
  # inspects the string rather than what a browser does with it.
  echo ""
  echo "--- exported HTML vs canvas (round trip) ---"
  for spec in \
    "htmlparity_band:htmlparity=1&preset=ig-square&n=6&mode=band&fill=dark&matcolor=dark&headline=DEMO%20DAY%202026&subhead=Bird%20Library%2C%201st%20Floor&bandpct=20&gutter=2&outer=2&radius=4:1080:2160" \
    "htmlparity_overlay:htmlparity=1&preset=ig-square&n=6&mode=overlay&corner=bl&marksize=34&scrim=80&gutter=2&outer=2:1080:2160" \
    "htmlparity_cell:htmlparity=1&preset=ig-square&n=8&mode=cell&fill=accent&matcolor=dark&radius=5&gutter=2&outer=2:1080:2160" \
    "htmlparity_banner:htmlparity=1&preset=banner&n=10&mode=band&fill=dark&matcolor=dark&headline=LAUNCHPAD%20DEMO%20DAY&subhead=Bird%20Library&bandpct=22&gutter=1.5&radius=2:3744:1536"; do
    name="${spec%%:*}"; rest="${spec#*:}"
    qs="${rest%%:*}"; dims="${rest#*:}"
    cw="${dims%%:*}"; ch="${dims##*:}"
    echo ""
    echo "[$name]"
    node cdp_shot.js "http://localhost:$PORT/_autotest.html?$qs" "_shots/$name.png" "$cw" "$ch" \
      2>/dev/null | python -c "
import sys, json
got = False
for line in sys.stdin:
    if 'HTMLPARITY' in line:
        d = json.loads(line.split('HTMLPARITY ', 1)[1]); got = True
        good = (d['selfContained'] and d['hasPageRule'] and d['hasColorAdjust']
                and d['sheetW'] == d['w'] and d['sheetH'] == d['h']
                and d['imgs'] >= d['tiles'])
        print('  %s  %d KB, %d imgs, sheet %dx%d, self-contained=%s, @page=%s' % (
            'PASS ' if good else 'FAIL ', d['bytes'] // 1024, d['imgs'],
            d['sheetW'], d['sheetH'], d['selfContained'], d['hasPageRule']))
        if not good:
            print('       ' + json.dumps(d))
        sys.exit(0 if good else 1)
if not got:
    print('  FAIL  no HTMLPARITY result'); sys.exit(1)
" || fail=1
    python compare_parity.py "_shots/$name.png" || fail=1
  done

  # ---- 6. persistence -----------------------------------------------------
  # The autosave round trip needs TWO page loads in one profile, so it runs in
  # its own driver. The project-file cases fit in a single load.
  echo ""
  node persist_test.js || fail=1

  echo ""
  echo "--- .collage.json save / load ---"
  for spec in \
    "full file, IndexedDB wiped:projfile=full&wipedb=1&n=5:5" \
    "layout only, blobs present:projfile=layout&n=5:5" \
    "layout only, blobs absent:projfile=layout&wipedb=1&n=5:0"; do
    label="${spec%%:*}"; rest="${spec#*:}"
    qs="${rest%%:*}"; want="${rest##*:}"
    printf "  %-30s " "$label"
    node cdp_shot.js "http://localhost:$PORT/_autotest.html?$qs" "_shots/_proj.png" 1200 800 \
      2>/dev/null | WANT="$want" python -c "
import sys, json, os
want = int(os.environ['WANT'])
for line in sys.stdin:
    if 'PROJFILE' in line:
        d = json.loads(line.split('PROJFILE ', 1)[1])
        e, l = d['expected'], d['loaded']
        settings = (l['artboard'] == e['artboard'] and l['headline'] == e['headline']
                    and l['dark'] == e['dark'])
        pixels = all(p['hasPixels'] for p in l['photos'])
        crops = (not l['photos']) or (l['photos'][0]['focal'] == e['photos'][0]['focal']
                                      and l['photos'][0]['zoom'] == e['photos'][0]['zoom'])
        good = len(l['photos']) == want and settings and pixels and crops
        print(('PASS %d photos, %d KB' % (len(l['photos']), d['jsonBytes'] // 1024))
              if good else ('FAIL got %d want %d | settings=%s pixels=%s crops=%s'
                            % (len(l['photos']), want, settings, pixels, crops)))
        sys.exit(0 if good else 1)
print('FAIL no PROJFILE result'); sys.exit(1)
" || fail=1
  done
  rm -f _shots/_proj.png
fi

echo ""
[ $fail -eq 0 ] && echo "SUITE PASSED" || echo "SUITE FAILED"
exit $fail
