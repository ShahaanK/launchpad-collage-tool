const M = require('./_pure.js');
const {coverSrcRect, autoCols, packTiles, computeLayout, PRESETS} = M;
let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   >> ' + extra));
  if (!cond) fail++;
};
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);

console.log('\n--- coverSrcRect: object-position semantics ---');
// 1000x1000 image into a 500x100 tile (5:1). cover scale = max(0.5, 0.1) = 0.5
// so sw = 500/0.5 = 1000 (full width) and sh = 100/0.5 = 200
let r = coverSrcRect(1000, 1000, 500, 100, {x: 50, y: 50, zoom: 1});
ok('5:1 tile uses full image width', near(r.sw, 1000), JSON.stringify(r));
ok('5:1 tile crops height to 200', near(r.sh, 200), JSON.stringify(r));
ok('centre focal -> sy = (1000-200)*0.5 = 400', near(r.sy, 400), 'got ' + r.sy);
ok('centre focal -> sx = 0 (no horizontal slack)', near(r.sx, 0), 'got ' + r.sx);

// the rule that matters: the image fy% point lands on the tile fy% point
r = coverSrcRect(1000, 1000, 500, 100, {x: 25, y: 75, zoom: 1});
ok('focal y=75 -> sy = (1000-200)*0.75 = 600', near(r.sy, 600), 'got ' + r.sy);
ok('focal x=25 with zero slack -> sx stays 0', near(r.sx, 0), 'got ' + r.sx);
const naive = (1000 / 2 - 200 / 2) + (75 - 50) / 100 * 1000; // 650 - the classic bug
ok('formula is NOT naive centre+nudge (650)', !near(r.sy, naive), 'both are ' + r.sy);

console.log('\n--- coverSrcRect: resolution independence (DOM vs canvas parity) ---');
// identical crop at preview res and original res must agree as a FRACTION of
// the image. This is exactly what makes the downscaled DOM preview and the
// full-res canvas export land on the same pixels.
const crop = {x: 31, y: 68, zoom: 1.4};
const a = coverSrcRect(1200, 800, 900, 300, crop);
const b = coverSrcRect(4000, 2666.6667, 900, 300, crop);
ok('sx/imgW matches across resolutions', near(a.sx / 1200, b.sx / 4000, 1e-4), (a.sx / 1200) + ' vs ' + (b.sx / 4000));
ok('sy/imgH matches across resolutions', near(a.sy / 800, b.sy / 2666.6667, 1e-4), (a.sy / 800) + ' vs ' + (b.sy / 2666.6667));
ok('sw/imgW matches across resolutions', near(a.sw / 1200, b.sw / 4000, 1e-4), (a.sw / 1200) + ' vs ' + (b.sw / 4000));

console.log('\n--- coverSrcRect: zoom and clamping ---');
r = coverSrcRect(1000, 1000, 500, 500, {x: 50, y: 50, zoom: 2});
ok('zoom 2 halves the source rect', near(r.sw, 500) && near(r.sh, 500), JSON.stringify(r));
r = coverSrcRect(1000, 1000, 500, 500, {x: 50, y: 50, zoom: 0.5});
ok('zoom<1 clamps sw to image width', r.sw <= 1000, 'sw=' + r.sw);
r = coverSrcRect(1000, 1000, 500, 100, {x: 0, y: 0, zoom: 1});
ok('focal 0,0 -> sx=sy=0', near(r.sx, 0) && near(r.sy, 0), JSON.stringify(r));
r = coverSrcRect(1000, 1000, 500, 100, {x: 100, y: 100, zoom: 1});
ok('focal 100,100 -> sy = full slack 800', near(r.sy, 800), 'got ' + r.sy);
ok('focal 100 never runs past the image edge', r.sy + r.sh <= 1000 + 1e-9, r.sy + '+' + r.sh);

console.log('\n--- autoCols: aspect-aware column choice ---');
const LAND = 3 / 2, PORT = 2 / 3;
// a square artboard with a square target is a genuine 3-vs-4 tie; the photos'
// own aspect is what should break it, and it must break it the sane way
ok('12 landscape photos on a square -> 3 landscape columns',
   autoCols(12, 1080, 1080, LAND) === 3, 'got ' + autoCols(12, 1080, 1080, LAND));
ok('12 portrait photos on a square -> 4 portrait columns',
   autoCols(12, 1080, 1080, PORT) === 4, 'got ' + autoCols(12, 1080, 1080, PORT));
ok('landscape and portrait give different answers (aspect actually matters)',
   autoCols(12, 1080, 1080, LAND) !== autoCols(12, 1080, 1080, PORT));
ok('square target on a square is deterministic (no float-noise tie)',
   autoCols(12, 1080, 1080, 1) === autoCols(12, 1080, 1080, 1) &&
   [3, 4].indexOf(autoCols(12, 1080, 1080, 1)) >= 0, 'got ' + autoCols(12, 1080, 1080, 1));
ok('missing/garbage target falls back to 1, no crash',
   autoCols(12, 1080, 1080) === autoCols(12, 1080, 1080, 1) &&
   autoCols(12, 1080, 1080, 0) === autoCols(12, 1080, 1080, 1) &&
   autoCols(12, 1080, 1080, NaN) === autoCols(12, 1080, 1080, 1));
ok('12 photos, banner 3744x768 -> 6 cols', autoCols(12, 3744, 768) === 6, 'got ' + autoCols(12, 3744, 768));
ok('medianAspect of mixed photos', near(M.medianAspect([{w:3,h:2},{w:1,h:1},{w:2,h:3}]), 1), 'got ' + M.medianAspect([{w:3,h:2},{w:1,h:1},{w:2,h:3}]));
ok('medianAspect ignores zero dimensions', near(M.medianAspect([{w:0,h:0}]), 1), 'got ' + M.medianAspect([{w:0,h:0}]));
ok('medianAspect of empty list is 1', near(M.medianAspect([]), 1));
ok('4 photos, square -> 2 cols', autoCols(4, 1080, 1080) === 2, 'got ' + autoCols(4, 1080, 1080));
ok('3 photos, banner -> 3 cols', autoCols(3, 3744, 768) === 3, 'got ' + autoCols(3, 3744, 768));
ok('6 photos, story 1080x1920 -> 2 cols', autoCols(6, 1080, 1920) === 2, 'got ' + autoCols(6, 1080, 1920));
ok('1 photo -> 1 col', autoCols(1, 1080, 1080) === 1, 'got ' + autoCols(1, 1080, 1080));
ok('0 photos -> 1 col, no crash', autoCols(0, 1080, 1080) === 1);

console.log('\n--- packTiles: dense fill and leftover holes ---');
const mk = (n, spans) => Array.from({length: n}, (_, i) => ({
  id: 'p' + i, span: (spans && spans[i]) || {c: 1, r: 1}
}));
let p = packTiles(mk(7), 3);
ok('7 photos in 3 cols -> 3 rows', p.rows === 3, 'rows=' + p.rows);
ok('7 photos in 3 cols -> 2 holes', p.holes.length === 2, 'holes=' + p.holes.length);
ok('all 7 placed', p.placed.length === 7, 'placed=' + p.placed.length);
p = packTiles(mk(6), 3);
ok('6 photos in 3 cols -> exact fit, 0 holes', p.rows === 2 && p.holes.length === 0,
   JSON.stringify({rows: p.rows, holes: p.holes.length}));

// 2x2 hero plus singles: dense packing must backfill the column beside the hero
p = packTiles(mk(5, {0: {c: 2, r: 2}}), 3);
ok('2x2 hero + 4 singles in 3 cols: all placed', p.placed.length === 5, 'placed=' + p.placed.length);
ok('hero lands at col 0 row 0', p.placed[0].c === 0 && p.placed[0].r === 0, JSON.stringify(p.placed[0]));
ok('next tile backfills col 2 row 0', p.placed[1].c === 2 && p.placed[1].r === 0, JSON.stringify(p.placed[1]));
ok('third tile backfills col 2 row 1', p.placed[2].c === 2 && p.placed[2].r === 1, JSON.stringify(p.placed[2]));
const noOverlap = (pl) => {
  const seen = new Set();
  for (const t of pl) for (let i = 0; i < t.rs; i++) for (let j = 0; j < t.cs; j++) {
    const k = (t.r + i) + ':' + (t.c + j);
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
};
ok('no tile overlaps another', noOverlap(p.placed));
p = packTiles(mk(4, {0: {c: 9, r: 1}}), 3);
ok('span wider than cols is clamped, not dropped', p.placed.length === 4 && p.placed[0].cs === 3,
   JSON.stringify(p.placed[0]));

console.log('\n--- computeLayout: geometry invariants across every preset ---');
const base = JSON.parse(JSON.stringify(M.state));
const st = JSON.parse(JSON.stringify(base));
st.photos = Array.from({length: 9}, (_, i) => ({id: 'p' + i, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
for (const pr of PRESETS) {
  st.artboard = {w: pr.w, h: pr.h, presetId: pr.id};
  const L = computeLayout(st);
  const inBounds = L.tiles.every(t => t.x >= 0 && t.y >= 0 && t.x + t.w <= pr.w + 1 && t.y + t.h <= pr.h + 1);
  const positive = L.tiles.every(t => t.w > 0 && t.h > 0);
  ok(pr.id + ' (' + pr.w + 'x' + pr.h + '): 9 tiles, in bounds, positive size',
     L.tiles.length === 9 && inBounds && positive,
     JSON.stringify({n: L.tiles.length, inBounds: inBounds, positive: positive}));
}

console.log('\n--- computeLayout: band reserves space, lockup holds 7.66:1 ---');
st.artboard = {w: 3744, h: 768, presetId: 'banner'};
const CHROME = () => ({mode:'band', side:'bottom', fill:'dark', bandPct:14,
  cellAt:'end', corner:'bl', scrimPct:80, bandMarkPct:52, sizePct:30,
  markX:50, markY:50, placed:false});
st.chrome = CHROME();
let L = computeLayout(st);
ok('band exists and spans full width', !!L.band && L.band.rect.w === 3744, JSON.stringify(L.band));
ok('band sits flush to the bottom', L.band.rect.y + L.band.rect.h === 768, JSON.stringify(L.band.rect));
ok('no tile intrudes into the band', L.tiles.every(t => t.y + t.h <= L.band.rect.y + 1),
   'max tile bottom=' + Math.max.apply(null, L.tiles.map(t => t.y + t.h)) + ' band y=' + L.band.rect.y);
ok('lockup ratio is 7.66:1 (+/-0.02)', near(L.lockup.rect.w / L.lockup.rect.h, M.LOCKUP_RATIO, 0.02),
   'got ' + (L.lockup.rect.w / L.lockup.rect.h));
ok('lockup sits inside the band',
   L.lockup.rect.y >= L.band.rect.y && L.lockup.rect.y + L.lockup.rect.h <= L.band.rect.y + L.band.rect.h,
   JSON.stringify(L.lockup.rect));
ok('dark band -> reverse lockup variant', L.lockup.variant === 'reverse', L.lockup.variant);
st.chrome.fill = 'light';
L = computeLayout(st);
ok('light band -> light lockup variant (both colour swaps)', L.lockup.variant === 'light', L.lockup.variant);
st.chrome.fill = 'accent';
L = computeLayout(st);
// the bundled artwork has an orange Block S and orange "Syracuse University";
// on an orange band those vanish, so this must NOT be the reverse variant
ok('accent band -> mono lockup variant (orange-on-orange would vanish)',
   L.lockup.variant === 'mono', L.lockup.variant);
ok('every band fill maps to a distinct lockup variant',
   new Set(['dark', 'light', 'accent'].map(function (f) {
     return M.lockupVariant(f, base.brand); })).size === 3);
st.chrome.fill = 'dark';
st.chrome.side = 'top';
L = computeLayout(st);
ok('top band -> tiles pushed below it', L.tiles.every(t => t.y >= L.band.rect.h),
   'min y=' + Math.min.apply(null, L.tiles.map(t => t.y)));
st.chrome = Object.assign(CHROME(), {mode: 'none'});
L = computeLayout(st);
ok('mode none -> no band and no lockup', L.band === null && L.lockup === null);

console.log('\n--- autoCols counts CELL DEMAND, not photo count ---');
(function () {
  const mkp = (n, spans) => Array.from({length: n}, (_, i) => ({
    id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1,
    span: (spans && spans[i]) || {c: 1, r: 1}
  }));
  ok('cellDemand: no spans = photo count', M.cellDemand(mkp(8)) === 8, '' + M.cellDemand(mkp(8)));
  ok('cellDemand: a 2x2 hero counts as four cells',
     M.cellDemand(mkp(8, {0: {c: 2, r: 2}})) === 11, '' + M.cellDemand(mkp(8, {0: {c: 2, r: 2}})));

  const s = JSON.parse(JSON.stringify(base));
  s.artboard = {w: 3744, h: 768, presetId: 'banner'};

  s.photos = mkp(8);
  const plain = computeLayout(s);
  s.photos = mkp(8, {0: {c: 2, r: 2}});
  const hero = computeLayout(s);
  // On the banner this previously chose 8 columns x 2 rows and stranded 5
  // leftover mat cells. What matters is the outcome, not the column count:
  // higher cell demand should raise the column count (so cells stay in
  // proportion) while still packing tightly.
  ok('8 photos + 2x2 hero leaves at most 1 leftover cell',
     hero.holes.length <= 1, hero.holes.length + ' holes, grid ' + JSON.stringify(hero.grid));
  /* Characterisation test for the exact case that exposed this, using the real
     fixture dimensions (mixed aspects -> median 1.25). Counting photos gave
     8 columns x 2 rows and stranded 5 mat cells; counting cell demand gives
     6 x 2 and strands 1. Uniform-aspect photos do NOT reproduce it. */
  const FIXW = [[1600,1067],[1200,1600],[1800,1200],[1000,1000],
                [2000,1125],[1400,1400],[1080,1620],[2400,1600]];
  const s2 = JSON.parse(JSON.stringify(base));
  s2.artboard = {w: 3744, h: 768, presetId: 'banner'};
  s2.space.gutterPct = 2;
  s2.photos = FIXW.map(function (d, i) {
    return {id: 'f' + i, w: d[0], h: d[1], focal: {x: 50, y: 50}, zoom: 1,
            span: i === 0 ? {c: 2, r: 2} : {c: 1, r: 1}};
  });
  const real = computeLayout(s2);
  ok('real fixtures + 2x2 hero on banner -> 6 columns (was 8)',
     real.grid.cols === 6, 'cols ' + real.grid.cols);
  ok('real fixtures + 2x2 hero -> 1 stranded mat cell (was 5)',
     real.holes.length === 1, real.holes.length + ' holes');
  ok('the hero keeps its 2x2 span in that layout',
     real.tiles[0].cell.cs === 2 && real.tiles[0].cell.rs === 2,
     JSON.stringify(real.tiles[0].cell));
  ok('column count stays within the cell demand',
     hero.grid.cols <= M.cellDemand(mkp(8, {0: {c: 2, r: 2}})), 'cols ' + hero.grid.cols);
  ok('no leftover-cell regression for plain photos', plain.holes.length <= 1,
     plain.holes.length + ' holes');

  // a span wider than the auto column count must not be silently clamped away
  s.photos = mkp(3, {0: {c: 5, r: 1}});
  const wide = computeLayout(s);
  ok('columns never fall below the widest span', wide.grid.cols >= 5, 'cols ' + wide.grid.cols);
  ok('the wide tile keeps its full span', wide.tiles[0].cell.cs === 5,
     JSON.stringify(wide.tiles[0].cell));
})();

console.log('\n--- computeLayout: mat cells, spans survive a resize ---');
st.chrome = CHROME();
st.photos = Array.from({length: 7}, (_, i) => ({id: 'p' + i, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
st.photos[0].span = {c: 2, r: 2};
st.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
const sq = computeLayout(st);
st.artboard = {w: 3744, h: 768, presetId: 'banner'};
const bn = computeLayout(st);
ok('hero span preserved on square', sq.tiles[0].cell.cs === 2 && sq.tiles[0].cell.rs === 2, JSON.stringify(sq.tiles[0].cell));
ok('hero span preserved after resize to banner', bn.tiles[0].cell.cs === 2 && bn.tiles[0].cell.rs === 2, JSON.stringify(bn.tiles[0].cell));
ok('hero is larger than a single tile on both', sq.tiles[0].w > sq.tiles[1].w && bn.tiles[0].w > bn.tiles[1].w);
ok('holes carry the mat fill colour', sq.holes.every(h => h.fill === sq.bg), JSON.stringify(sq.holes[0]));
const covered = sq.tiles.reduce((acc, t) => acc + t.cell.cs * t.cell.rs, 0) + sq.holes.length;
ok('tiles + holes cover the grid exactly', covered === sq.grid.cols * sq.grid.rows,
   JSON.stringify({covered: covered, grid: sq.grid}));

console.log('\n--- computeLayout: no sub-pixel seams (export-only defect) ---');
// Rounding tile x and w independently leaves 1px hairlines of mat colour that
// are invisible in the scaled preview and obvious in a 3744px PNG.
(function () {
  const cases = [
    {w: 3744, h: 768,  cols: 5,  n: 10, label: 'banner 5 cols'},
    {w: 3744, h: 768,  cols: 7,  n: 14, label: 'banner 7 cols'},
    {w: 1080, h: 1080, cols: 7,  n: 14, label: 'square 7 cols'},
    {w: 816,  h: 1056, cols: 3,  n: 9,  label: 'flyer 3 cols'},
    {w: 3600, h: 5400, cols: 11, n: 11, label: 'poster 11 cols'},
    {w: 1237, h: 913,  cols: 6,  n: 13, label: 'odd custom size'}
  ];
  for (const cs of cases) {
    const s = JSON.parse(JSON.stringify(base));
    s.photos = Array.from({length: cs.n}, (_, i) => ({
      id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}
    }));
    s.grid = {template: 'manual', cols: cs.cols};
    s.artboard = {w: cs.w, h: cs.h, presetId: 'custom'};
    const L = computeLayout(s);
    const gut = Math.round(s.space.gutterPct / 100 * Math.min(cs.w, cs.h));

    let seams = 0;
    // horizontal: every adjacent pair in a row must be exactly one gutter apart
    for (let r = 0; r < L.grid.rows; r++) {
      const row = L.tiles.filter(t => t.cell.r === r && t.cell.rs === 1).sort((x, y) => x.cell.c - y.cell.c);
      for (let i = 0; i < row.length - 1; i++) {
        if (row[i].cell.c + row[i].cell.cs !== row[i + 1].cell.c) continue; // not adjacent
        if (row[i + 1].x !== row[i].x + row[i].w + gut) seams++;
      }
    }
    // vertical: same down each column
    for (let c = 0; c < L.grid.cols; c++) {
      const col = L.tiles.filter(t => t.cell.c === c && t.cell.cs === 1).sort((x, y) => x.cell.r - y.cell.r);
      for (let i = 0; i < col.length - 1; i++) {
        if (col[i].cell.r + col[i].cell.rs !== col[i + 1].cell.r) continue;
        if (col[i + 1].y !== col[i].y + col[i].h + gut) seams++;
      }
    }
    ok(cs.label + ' (' + cs.w + 'x' + cs.h + '): no seams', seams === 0, seams + ' seam(s)');

    // the grid must also land exactly on the content edge, not 1px short
    const outer = Math.round(s.space.outerPct / 100 * Math.min(cs.w, cs.h));
    const rightMost = Math.max.apply(null, L.tiles.map(t => t.x + t.w));
    ok(cs.label + ': right edge lands on the mat exactly', rightMost === cs.w - outer,
       'got ' + rightMost + ' want ' + (cs.w - outer));
  }
})();

console.log('\n--- placement: lockup as a grid cell ---');
(function () {
  const s = JSON.parse(JSON.stringify(base));
  s.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
  s.photos = Array.from({length: 8}, (_, i) => ({
    id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
  s.chrome = Object.assign(CHROME(), {mode: 'cell', fill: 'dark'});
  const L = computeLayout(s);

  ok('cell mode: no band', L.band === null);
  ok('cell mode: a plate occupies a grid cell', !!L.plate, JSON.stringify(L.plate && L.plate.rect));
  ok('cell mode: all 8 photos still get tiles', L.tiles.length === 8, '' + L.tiles.length);
  ok('cell mode: the mark is not a photo tile',
     L.tiles.every(t => t.photoId !== '__mark__'));
  const covered = L.tiles.reduce((a, t) => a + t.cell.cs * t.cell.rs, 0);
  const plateCells = Math.round(L.plate.rect.w / (L.cell.cw + L.cell.gutter) + 0.001) || 1;
  ok('cell mode: tiles + mark cell + holes cover the grid',
     covered + plateCells + L.holes.length === L.grid.cols * L.grid.rows,
     JSON.stringify({covered, plateCells, holes: L.holes.length, grid: L.grid}));
  ok('cell mode: the mark sits inside its plate',
     L.lockup.rect.x >= L.plate.rect.x && L.lockup.rect.y >= L.plate.rect.y &&
     L.lockup.rect.x + L.lockup.rect.w <= L.plate.rect.x + L.plate.rect.w + 1 &&
     L.lockup.rect.y + L.lockup.rect.h <= L.plate.rect.y + L.plate.rect.h + 1,
     JSON.stringify({mark: L.lockup.rect, plate: L.plate.rect}));
  ok('cell mode: the mark keeps 7.66:1',
     near(L.lockup.rect.w / L.lockup.rect.h, M.LOCKUP_RATIO, 0.05),
     '' + (L.lockup.rect.w / L.lockup.rect.h));
  ok('cell mode: the mark cell is wide enough to not squash the lockup',
     L.plate.rect.w / L.plate.rect.h >= 1.6,
     'plate aspect ' + (L.plate.rect.w / L.plate.rect.h).toFixed(2));

  // cellAt moves it to the front of the pack order
  s.chrome.cellAt = 'start';
  const L2 = computeLayout(s);
  ok('cell mode: cellAt=start puts the mark in the first row',
     L2.plate.rect.y < L2.tiles[L2.tiles.length - 1].y,
     JSON.stringify({plateY: L2.plate.rect.y}));
  ok('cell mode: still deterministic',
     JSON.stringify(computeLayout(s)) === JSON.stringify(computeLayout(s)));
})();

console.log('\n--- placement: overlay with a scrim ---');
(function () {
  const s = JSON.parse(JSON.stringify(base));
  s.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
  s.photos = Array.from({length: 6}, (_, i) => ({
    id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
  s.chrome = Object.assign(CHROME(), {mode: 'overlay', corner: 'bl', sizePct: 30, scrimPct: 80});
  let L = computeLayout(s);

  ok('overlay: no band, no plate', L.band === null && L.plate === null);
  ok('overlay: photos bleed (tiles reach past where a band would be)',
     Math.max.apply(null, L.tiles.map(t => t.y + t.h)) > 1080 * 0.9,
     'lowest tile ' + Math.max.apply(null, L.tiles.map(t => t.y + t.h)));
  ok('overlay: mark width follows sizePct',
     near(L.lockup.rect.w, Math.round(0.30 * 1080), 1), '' + L.lockup.rect.w);
  ok('overlay: bottom-left corner places the mark low and left',
     L.lockup.rect.x < 1080 * 0.15 && L.lockup.rect.y > 1080 * 0.8,
     JSON.stringify(L.lockup.rect));
  ok('overlay: mark is draggable on both axes', L.lockup.drag === 'xy', '' + L.lockup.drag);
  ok('overlay: scrim exists and spans the full width',
     !!L.scrim && L.scrim.rect.w === 1080, JSON.stringify(L.scrim && L.scrim.rect));
  ok('overlay: scrim is darkest at the bottom edge for a bottom mark',
     L.scrim.y0 > L.scrim.y1, JSON.stringify({y0: L.scrim.y0, y1: L.scrim.y1}));
  ok('overlay: scrim first stop is opaque-ish, last is transparent',
     /rgba\(0,0,0,0\.[1-9]/.test(L.scrim.stops[0][1]) &&
     L.scrim.stops[L.scrim.stops.length - 1][1] === 'rgba(0,0,0,0)',
     JSON.stringify(L.scrim.stops));
  ok('overlay: the scrim holds full strength across the mark before fading',
     L.scrim.stops.length === 3 && L.scrim.stops[1][0] > 0.2 && L.scrim.stops[1][0] < 0.9,
     JSON.stringify(L.scrim.stops.map(function (x) { return x[0]; })));
  // the mark must sit inside the plateau, not out in the faded part
  (function () {
     var sc = L.scrim, mk = L.lockup.rect;
     var far = sc.y0 > sc.y1 ? (sc.y0 - mk.y) : (mk.y + mk.h - sc.y0);
     ok('overlay: the whole mark lies within the scrim plateau',
        far / sc.rect.h <= sc.stops[1][0] + 0.02,
        'mark reaches ' + (far / sc.rect.h).toFixed(3) + ' of the scrim, plateau ends ' + sc.stops[1][0].toFixed(3));
  })();

  s.chrome.corner = 'tr';
  L = computeLayout(s);
  ok('overlay: top-right corner places the mark high and right',
     L.lockup.rect.y < 1080 * 0.12 && L.lockup.rect.x > 1080 * 0.5,
     JSON.stringify(L.lockup.rect));
  ok('overlay: scrim flips to be darkest at the top', L.scrim.y0 < L.scrim.y1,
     JSON.stringify({y0: L.scrim.y0, y1: L.scrim.y1}));

  s.chrome.scrimPct = 0;
  L = computeLayout(s);
  ok('overlay: scrim 0% removes the scrim entirely', L.scrim === null);
})();

console.log('\n--- the mark can be moved and resized ---');
(function () {
  const s = JSON.parse(JSON.stringify(base));
  s.photos = Array.from({length: 6}, (_, i) => ({
    id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));

  // --- free placement in overlay mode ---
  s.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
  s.chrome = Object.assign(CHROME(), {mode: 'overlay', placed: true, markX: 25, markY: 70,
                                      sizePct: 30, scrimPct: 60});
  let L = computeLayout(s);
  ok('overlay: markX/markY position the mark CENTRE',
     near(L.lockup.rect.x + L.lockup.rect.w / 2, 0.25 * 1080, 1) &&
     near(L.lockup.rect.y + L.lockup.rect.h / 2, 0.70 * 1080, 1),
     JSON.stringify(L.lockup.rect));

  // percentages mean the placement survives a change of artboard
  s.artboard = {w: 3744, h: 768, presetId: 'banner'};
  const B = computeLayout(s);
  ok('overlay: hand placement survives an artboard change (it is a %)',
     near((B.lockup.rect.x + B.lockup.rect.w / 2) / 3744, 0.25, 0.02) &&
     near((B.lockup.rect.y + B.lockup.rect.h / 2) / 768, 0.70, 0.03),
     JSON.stringify(B.lockup.rect));

  // clamped inside the artboard even at the extremes
  s.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
  for (const [mx, my] of [[0, 0], [100, 100], [-50, 150]]) {
    s.chrome.markX = mx; s.chrome.markY = my;
    const C = computeLayout(s);
    ok('overlay: mark stays inside the artboard at markX=' + mx + ' markY=' + my,
       C.lockup.rect.x >= 0 && C.lockup.rect.y >= 0 &&
       C.lockup.rect.x + C.lockup.rect.w <= 1080 &&
       C.lockup.rect.y + C.lockup.rect.h <= 1080,
       JSON.stringify(C.lockup.rect));
  }

  // --- resizing ---
  s.chrome.markX = 50; s.chrome.markY = 50;
  s.chrome.sizePct = 12;
  const small = computeLayout(s).lockup.rect.w;
  s.chrome.sizePct = 70;
  const big = computeLayout(s).lockup.rect.w;
  ok('overlay: sizePct actually resizes the mark', big > small * 4, small + ' -> ' + big);
  ok('overlay: resizing preserves the aspect ratio',
     near(computeLayout(s).lockup.rect.w / computeLayout(s).lockup.rect.h, M.LOCKUP_RATIO, 0.05));

  // --- band mode: horizontal nudge + height-driven size ---
  s.chrome = Object.assign(CHROME(), {mode: 'band', bandMarkPct: 52});
  s.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
  const centred = computeLayout(s);
  ok('band: the mark is centred until it is placed by hand',
     near(centred.lockup.rect.x + centred.lockup.rect.w / 2, 540, 1),
     JSON.stringify(centred.lockup.rect));
  ok('band: the mark is draggable on the x axis only', centred.lockup.drag === 'x');
  s.chrome.placed = true; s.chrome.markX = 20;
  const nudged = computeLayout(s);
  ok('band: markX nudges the mark along the band',
     nudged.lockup.rect.x < centred.lockup.rect.x,
     nudged.lockup.rect.x + ' vs ' + centred.lockup.rect.x);
  ok('band: a nudged mark stays inside the artboard',
     nudged.lockup.rect.x >= 0 && nudged.lockup.rect.x + nudged.lockup.rect.w <= 1080,
     JSON.stringify(nudged.lockup.rect));
  ok('band: the mark stays vertically centred in the band',
     near(nudged.lockup.rect.y + nudged.lockup.rect.h / 2,
          nudged.band.rect.y + nudged.band.rect.h / 2, 1.5),
     JSON.stringify({mark: nudged.lockup.rect, band: nudged.band.rect}));
  s.chrome.bandMarkPct = 90;
  const tall = computeLayout(s);
  ok('band: bandMarkPct scales the mark off the band height',
     tall.lockup.rect.h > nudged.lockup.rect.h, nudged.lockup.rect.h + ' -> ' + tall.lockup.rect.h);
  ok('band: the mark never overflows the band',
     tall.lockup.rect.h <= tall.band.rect.h &&
     tall.lockup.rect.y >= tall.band.rect.y - 1,
     JSON.stringify({mark: tall.lockup.rect, band: tall.band.rect}));
})();

console.log('\n--- a custom logo replaces the lockup ---');
(function () {
  const s = JSON.parse(JSON.stringify(base));
  s.photos = Array.from({length: 4}, (_, i) => ({
    id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
  s.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
  s.chrome = CHROME();
  s.brand.logo = {url: 'data:image/png;base64,AAA', ratio: 2.5, name: 'acme.png'};
  const L = computeLayout(s);
  ok('custom logo: source is custom', L.lockup.source === 'custom', L.lockup.source);
  ok('custom logo: its own aspect ratio is used, not 7.66:1',
     near(L.lockup.rect.w / L.lockup.rect.h, 2.5, 0.05),
     '' + (L.lockup.rect.w / L.lockup.rect.h));
  ok('custom logo: the url is carried through', L.lockup.url === s.brand.logo.url);
  ok('custom logo: still fits inside the band',
     L.lockup.rect.h <= L.band.rect.h, JSON.stringify(L.lockup.rect));
})();

console.log('\n--- brand palette overrides ---');
(function () {
  const s = JSON.parse(JSON.stringify(base));
  s.photos = [{id: 'p0', w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}];
  s.chrome = CHROME();
  s.brand.dark = '#123456';
  s.brand.accent = '#ABCDEF';
  s.space.matColor = 'dark';
  let L = computeLayout(s);
  ok('overridden dark role drives the mat', L.bg === '#123456', L.bg);
  s.space.matColor = 'accent';
  L = computeLayout(s);
  ok('overridden accent role drives the mat', L.bg === '#ABCDEF', L.bg);
  ok('fillOf falls back to the LaunchPad palette with no brand',
     M.fillOf('dark') === '#000E54' && M.fillOf('accent') === '#F76900',
     M.fillOf('dark') + '/' + M.fillOf('accent'));

  // a pale "dark" role must flip the lockup to its light treatment
  s.brand.dark = '#FAFAFA';
  s.chrome.fill = 'dark';
  L = computeLayout(s);
  ok('a pale dark role flips the lockup to the light variant',
     L.lockup.variant === 'light', L.lockup.variant);

  // onAccent: plate keeps the artwork intact instead of recolouring it
  s.brand.dark = '#000E54';
  s.brand.onAccent = 'plate';
  s.chrome.fill = 'accent';
  L = computeLayout(s);
  ok('onAccent=plate keeps the full-colour artwork', L.lockup.variant === 'reverse',
     L.lockup.variant);
  ok('onAccent=plate adds a dark plate behind the mark',
     !!L.plate && L.plate.fill === '#000E54', JSON.stringify(L.plate));
  ok('the plate fully contains the mark',
     L.plate.rect.x <= L.lockup.rect.x && L.plate.rect.y <= L.lockup.rect.y &&
     L.plate.rect.x + L.plate.rect.w >= L.lockup.rect.x + L.lockup.rect.w &&
     L.plate.rect.y + L.plate.rect.h >= L.lockup.rect.y + L.lockup.rect.h,
     JSON.stringify({plate: L.plate.rect, mark: L.lockup.rect}));
  s.brand.onAccent = 'mono';
  L = computeLayout(s);
  ok('onAccent=mono recolours instead, with no plate',
     L.lockup.variant === 'mono' && L.plate === null, L.lockup.variant);
})();

console.log('\n--- band copy: auto-fit and baseline geometry ---');
(function () {
  /* Inject a deterministic measurer: width proportional to length, fixed
     ascent/descent. The real browser measurer is a canvas 2d context - the very
     same object paintToCanvas draws with - so what matters here is the FITTING
     logic and the baseline maths, not the font metrics themselves. */
  M.setTextMeasurer(function (str, px) {
    return {w: String(str).length * px * 0.55, a: px * 0.72, d: px * 0.22};
  });

  ok('fitText shrinks until the string fits',
     M.fitText('a'.repeat(40), 200, 100, 700, 'X').w <= 200,
     JSON.stringify(M.fitText('a'.repeat(40), 200, 100, 700, 'X')));
  ok('fitText never goes below 6px',
     M.fitText('a'.repeat(4000), 10, 100, 700, 'X').px >= 6,
     '' + M.fitText('a'.repeat(4000), 10, 100, 700, 'X').px);
  ok('fitText keeps the requested size when it already fits',
     M.fitText('ab', 9999, 42, 700, 'X').px === 42,
     '' + M.fitText('ab', 9999, 42, 700, 'X').px);
  ok('fitText returns integer sizes (no DOM/canvas rounding drift)',
     Number.isInteger(M.fitText('a'.repeat(30), 137, 90, 700, 'X').px));
  ok('fitText is deterministic',
     JSON.stringify(M.fitText('LaunchPad Demo Day', 300, 80, 700, 'X')) ===
     JSON.stringify(M.fitText('LaunchPad Demo Day', 300, 80, 700, 'X')));

  const s = JSON.parse(JSON.stringify(base));
  s.artboard = {w: 3744, h: 768, presetId: 'banner'};
  s.photos = Array.from({length: 6}, (_, i) => ({
    id: 'p' + i, w: 1600, h: 1067, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
  s.chrome = CHROME();
  s.text = {headline: '', subhead: ''};
  let L = computeLayout(s);
  ok('no copy -> no text lines', L.text.length === 0 && L.textBox === null);

  s.text = {headline: 'DEMO DAY 2026', subhead: ''};
  L = computeLayout(s);
  ok('headline only -> one text line', L.text.length === 1, '' + L.text.length);
  ok('headline is bold', L.text[0].weight === 700, '' + L.text[0].weight);
  ok('headline fits the text column', L.text[0].px > 6, '' + L.text[0].px);
  ok('headline baseline sits inside the band',
     L.text[0].y > L.band.rect.y && L.text[0].y < L.band.rect.y + L.band.rect.h,
     JSON.stringify({y: L.text[0].y, band: L.band.rect}));
  ok('headline does not overlap the mark horizontally',
     L.text[0].x + L.textBox.w <= L.lockup.rect.x + 1 ||
     L.text[0].x >= L.lockup.rect.x + L.lockup.rect.w - 1,
     JSON.stringify({text: L.textBox, mark: L.lockup.rect}));

  s.text = {headline: 'DEMO DAY 2026', subhead: 'Bird Library, 1st Floor'};
  L = computeLayout(s);
  ok('headline + subhead -> two lines', L.text.length === 2, '' + L.text.length);
  ok('subhead is lighter than the headline',
     L.text[1].weight === 400 && L.text[1].px < L.text[0].px,
     JSON.stringify(L.text.map(function (t) { return t.weight + '/' + t.px; })));
  ok('subhead baseline is below the headline baseline',
     L.text[1].y > L.text[0].y, L.text[0].y + ' -> ' + L.text[1].y);
  ok('both lines share the same left anchor',
     L.text[0].x === L.text[1].x, L.text[0].x + '/' + L.text[1].x);
  ok('the copy block is vertically centred in the band',
     Math.abs((L.textBox.y + L.textBox.h / 2) - (L.band.rect.y + L.band.rect.h / 2)) <= 2,
     JSON.stringify({box: L.textBox, band: L.band.rect}));
  ok('every line carries an explicit font, weight, colour and baseline',
     L.text.every(function (t) {
       return t.font && t.weight && t.color && typeof t.y === 'number' && t.align;
     }), JSON.stringify(L.text[0]));

  // a very long headline must shrink, not overflow
  const normalPx = L.text[0].px;
  s.text = {headline: 'A'.repeat(160), subhead: ''};
  const wide = computeLayout(s);
  ok('a very long headline auto-shrinks instead of overflowing',
     wide.text[0].px < normalPx, normalPx + ' -> ' + wide.text[0].px);

  // ink colour follows the band fill
  s.text = {headline: 'HELLO', subhead: ''};
  s.chrome.fill = 'dark';
  ok('copy on a dark band uses the light role',
     computeLayout(s).text[0].color === base.brand.light,
     computeLayout(s).text[0].color);
  s.chrome.fill = 'light';
  ok('copy on a light band uses the dark role',
     computeLayout(s).text[0].color === base.brand.dark,
     computeLayout(s).text[0].color);

  // the copy swaps sides when the mark is nudged
  s.chrome.fill = 'dark';
  s.chrome.placed = true; s.chrome.markX = 12;
  const markLeft = computeLayout(s);
  s.chrome.markX = 88;
  const markRight = computeLayout(s);
  ok('copy moves to the other side when the logo is nudged across',
     markLeft.text[0].x > markRight.text[0].x,
     'markX=12 -> textX ' + markLeft.text[0].x + ' ; markX=88 -> textX ' + markRight.text[0].x);
  ok('copy never overlaps the mark on either side',
     [markLeft, markRight].every(function (Q) {
       return Q.text[0].x + Q.textBox.w <= Q.lockup.rect.x + 1 ||
              Q.text[0].x >= Q.lockup.rect.x + Q.lockup.rect.w - 1;
     }));

  // copy only applies to the band placement
  s.chrome = Object.assign(CHROME(), {mode: 'overlay'});
  ok('overlay placement carries no band copy', computeLayout(s).text.length === 0);
  s.chrome = Object.assign(CHROME(), {mode: 'none'});
  ok('no-mark placement carries no band copy', computeLayout(s).text.length === 0);

  // font choice is carried through
  s.chrome = CHROME();
  s.brand.font = "Georgia,'Times New Roman',serif";
  ok('the chosen font stack reaches the text spec',
     computeLayout(s).text[0].font === "Georgia,'Times New Roman',serif",
     computeLayout(s).text[0].font);
})();

console.log('\n--- computeLayout: empty state and purity ---');
st.photos = [];
L = computeLayout(st);
ok('0 photos -> no tiles, no crash', L.tiles.length === 0 && L.grid.cols === 0);
st.photos = Array.from({length: 5}, (_, i) => ({id: 'p' + i, focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}}));
const snap = JSON.stringify(st);
computeLayout(st);
computeLayout(st);
ok('computeLayout does not mutate state', JSON.stringify(st) === snap);
ok('computeLayout is deterministic', JSON.stringify(computeLayout(st)) === JSON.stringify(computeLayout(st)));

console.log(fail ? '\n' + fail + ' FAILURE(S)\n' : '\nALL TESTS PASSED\n');
process.exit(fail ? 1 : 0);
