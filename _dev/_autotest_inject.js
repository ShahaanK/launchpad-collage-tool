/* Test harness, injected into a COPY of the tool.
 *
 * Sets `window.__ready = true` only after every image has actually decoded (and,
 * in parity mode, after the canvas has been painted), so cdp_shot.js captures a
 * settled page instead of racing the load event.
 *
 * Query params:
 *   ?preset=<id>&n=<count>&hero=1&focal=1&gutter=<pct>&outer=<pct>&radius=<pct>
 *   &fill=<navy|orange|white>&side=<t|b>&mode=<band|none>&matcolor=<name>&cols=<n>
 *   &parity=1     DOM at scale 1 stacked above the canvas render, UI stripped
 */
(function () {
  var q = new URLSearchParams(location.search);
  var n = Math.max(1, Math.min(16, +(q.get('n') || 9)));

  var FIXTURES = [
    'fx01_1600x1067.jpg','fx02_1200x1600.jpg','fx03_1800x1200.jpg','fx04_1000x1000.jpg',
    'fx05_2000x1125.jpg','fx06_1400x1400.jpg','fx07_1080x1620.jpg','fx08_2400x1600.jpg',
    'fx09_1500x1000.jpg','fx10_1600x1600.jpg','fx11_1300x1733.jpg','fx12_2048x1152.jpg'
  ].slice(0, n);

  var PERSIST = q.get('persist');   // 'save' | 'load' | null

  // photo records built directly; w/h parsed from the filename, no async decode.
  // In persist=load we must NOT seed photos: the point is what comes back from
  // IndexedDB, and seeding would mask a restore that returned nothing.
  if (PERSIST !== 'load' && PERSIST !== 'peek') state.photos = FIXTURES.map(function (name, i) {
    var m = /_(\d+)x(\d+)\./.exec(name);
    return {
      id: 'p' + (i + 1), name: name, file: null,
      url: '_fixtures/' + name,
      w: +m[1], h: +m[2], pw: +m[1], ph: +m[2],
      focal: {x: 50, y: 50}, zoom: 1, span: {c: 1, r: 1}
    };
  });

  if (q.get('hero') === '1' && state.photos.length) state.photos[0].span = {c: 2, r: 2};
  if (q.get('focal') === '1' && state.photos.length > 2) {
    state.photos[0].focal = {x: 0, y: 0};
    state.photos[1].focal = {x: 100, y: 100};
    state.photos[2].focal = {x: 25, y: 75};
    state.photos[2].zoom = 1.6;
  }
  if (q.get('gutter') !== null) state.space.gutterPct = +q.get('gutter');
  if (q.get('outer') !== null) state.space.outerPct = +q.get('outer');
  if (q.get('radius') !== null) state.space.radiusPct = +q.get('radius');
  // role names: navy/orange/white were renamed dark/accent/light
  var ROLE = {navy: 'dark', orange: 'accent', white: 'light',
              dark: 'dark', accent: 'accent', light: 'light'};
  if (q.get('matcolor')) state.space.matColor = ROLE[q.get('matcolor')] || 'dark';
  if (q.get('fill')) state.chrome.fill = ROLE[q.get('fill')] || 'dark';
  if (q.get('corner')) state.chrome.corner = q.get('corner');
  if (q.get('scrim') !== null) state.chrome.scrimPct = +q.get('scrim');
  if (q.get('marksize') !== null) {
    if (q.get('mode') === 'overlay') state.chrome.sizePct = +q.get('marksize');
    else state.chrome.bandMarkPct = +q.get('marksize');
  }
  if (q.get('bandpct') !== null) state.chrome.bandPct = +q.get('bandpct');
  if (q.get('cellat')) state.chrome.cellAt = q.get('cellat');
  if (q.get('onaccent')) state.brand.onAccent = q.get('onaccent');
  if (q.get('fontfile') === '1') state.brand.fontFile =
    {url: 'data:font/woff2;base64,AAAA', name: 'ShermanSans.woff2', bytes: 4};
  if (q.get('headline') !== null) state.text.headline = q.get('headline');
  if (q.get('subhead') !== null) state.text.subhead = q.get('subhead');
  if (q.get('font') && FONTS[q.get('font')]) state.brand.font = FONTS[q.get('font')].stack;
  if (q.get('markx') !== null) { state.chrome.markX = +q.get('markx'); state.chrome.placed = true; }
  if (q.get('marky') !== null) { state.chrome.markY = +q.get('marky'); state.chrome.placed = true; }
  if (q.get('side')) state.chrome.side = q.get('side') === 't' ? 'top' : 'bottom';
  if (q.get('mode')) state.chrome.mode = q.get('mode');
  if (q.get('cols')) { state.grid.template = 'manual'; state.grid.cols = +q.get('cols'); }

  var pid = q.get('preset') || 'ig-square';
  var pr = PRESETS.find(function (p) { return p.id === pid; });
  if (pr) state.artboard = {w: pr.w, h: pr.h, presetId: pr.id};

  if (q.get('showui') === '1') {
    var f = document.createElement('style');
    f.textContent = '#sheet .tile .grip,#sheet .tile .rsz{opacity:1!important}';
    document.head.appendChild(f);
  }

  renderThumbs();
  syncControls();
  document.getElementById('preset').value = state.artboard.presetId;
  document.getElementById('aw').value = state.artboard.w;
  document.getElementById('ah').value = state.artboard.h;
  renderPreview();

  function allImagesDecoded() {
    var imgs = [].slice.call(document.querySelectorAll('#sheet .tile img'));
    return Promise.all(imgs.map(function (im) {
      return (im.decode ? im.decode() : Promise.resolve()).catch(function () {});
    }));
  }

  var PARITY = q.get('parity') === '1';
  var EXPORT = q.get('export') === '1';
  var GESTURES = q.get('gestures') === '1';

  /* ---- synthetic gesture driving (step 3) --------------------------------
     Dispatches real PointerEvents at real client coordinates via
     elementFromPoint, so it exercises the same delegated handlers a mouse
     would rather than calling the internals directly. */
  function clientOf(ax, ay) {
    var sheet = document.getElementById('sheet');
    var r = sheet.getBoundingClientRect();
    var k = r.width / state.artboard.w;
    return {x: r.left + ax * k, y: r.top + ay * k};
  }

  function pev(type, cx, cy, buttons) {
    var el = document.elementFromPoint(cx, cy) || document.getElementById('sheet');
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, isPrimary: true,
      pointerType: 'mouse', clientX: cx, clientY: cy, button: 0,
      buttons: buttons === undefined ? 1 : buttons
    }));
    return el;
  }

  function dragFrom(ax, ay, toAx, toAy, steps) {
    var a = clientOf(ax, ay);
    pev('pointerdown', a.x, a.y, 1);
    var n = steps || 4;
    for (var i = 1; i <= n; i++) {
      var m = clientOf(ax + (toAx - ax) * i / n, ay + (toAy - ay) * i / n);
      pev('pointermove', m.x, m.y, 1);
    }
    var b = clientOf(toAx, toAy);
    pev('pointerup', b.x, b.y, 0);
  }

  function wheelAt(ax, ay, deltaY) {
    var c = clientOf(ax, ay);
    var el = document.elementFromPoint(c.x, c.y) || document.getElementById('sheet');
    el.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, deltaY: deltaY
    }));
  }

  function dblAt(ax, ay) {
    var c = clientOf(ax, ay);
    var el = document.elementFromPoint(c.x, c.y) || document.getElementById('sheet');
    el.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true, cancelable: true, clientX: c.x, clientY: c.y
    }));
  }

  function gestureTests() {
    var out = [];
    var add = function (name, pass, detail) { out.push({t: name, pass: !!pass, d: detail}); };
    var L = computeLayout(state);
    var t0 = L.tiles[0], t1 = L.tiles[1];
    var p0 = photoById(t0.photoId);

    // --- pan direction and magnitude ---
    var cr = coverSrcRect(p0.pw, p0.ph, t0.w, t0.h, t0.crop);
    var slackX = p0.pw - cr.sw;
    if (slackX > 0.5) {
      var fx0 = p0.focal.x, dx = 40;
      dragFrom(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5, t0.x + t0.w * 0.5 + dx, t0.y + t0.h * 0.5);
      var expected = Math.max(0, Math.min(100, fx0 - dx / (cr.s * slackX) * 100));
      add('pan right moves content right (focal.x decreases)', p0.focal.x < fx0,
          'fx ' + fx0 + ' -> ' + p0.focal.x.toFixed(2));
      add('pan magnitude matches the shared formula',
          Math.abs(p0.focal.x - expected) < 0.6,
          'got ' + p0.focal.x.toFixed(2) + ' want ' + expected.toFixed(2));
    } else {
      add('pan: tile had no horizontal slack (skipped)', true, 'slackX=' + slackX.toFixed(1));
    }

    /* --- the two code paths that position an <img> must agree ---
       refreshTileCrop() writes the style directly during a drag; renderPreview()
       writes it via the innerHTML template. If they ever diverge, a panned tile
       would look right mid-drag and jump on the next full re-render. */
    (function () {
      var mid = {x: t0.x + t0.w * 0.5, y: t0.y + t0.h * 0.5};
      dragFrom(mid.x, mid.y, mid.x + 25, mid.y + 25, 3);
      var sel = '#sheet .tile[data-id="' + p0.id + '"] img';
      var before = document.querySelector(sel);
      var fast = before ? [before.style.left, before.style.top,
                           before.style.width, before.style.height].join('|') : 'missing';
      renderPreview();
      var after = document.querySelector(sel);
      var full = after ? [after.style.left, after.style.top,
                          after.style.width, after.style.height].join('|') : 'missing';
      add('drag fast path and full re-render position the image identically',
          fast === full && fast !== 'missing', 'fast ' + fast + '  full ' + full);
    })();

    // --- pan clamps at the image edge ---
    dragFrom(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5, t0.x + t0.w * 0.5 - 6000, t0.y + t0.h * 0.5, 6);
    add('pan clamps focal to <=100', p0.focal.x <= 100 && p0.focal.y <= 100,
        p0.focal.x + '/' + p0.focal.y);
    dragFrom(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5, t0.x + t0.w * 0.5 + 6000, t0.y + t0.h * 0.5, 6);
    add('pan clamps focal to >=0', p0.focal.x >= 0 && p0.focal.y >= 0,
        p0.focal.x + '/' + p0.focal.y);

    // --- double-click recentres ---
    dblAt(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5);
    add('double-click recentres crop and clears zoom',
        p0.focal.x === 50 && p0.focal.y === 50 && p0.zoom === 1,
        JSON.stringify({f: p0.focal, z: p0.zoom}));

    // --- wheel zoom in / clamp ---
    wheelAt(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5, -100);
    add('wheel up zooms in', p0.zoom > 1, 'zoom=' + p0.zoom.toFixed(3));
    for (var i = 0; i < 40; i++) wheelAt(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5, -100);
    add('zoom clamps at 5x', p0.zoom <= 5 + 1e-9, 'zoom=' + p0.zoom.toFixed(3));
    for (var j = 0; j < 80; j++) wheelAt(t0.x + t0.w * 0.5, t0.y + t0.h * 0.5, 100);
    add('zoom clamps at 1x (never below cover)', p0.zoom >= 1 - 1e-9, 'zoom=' + p0.zoom.toFixed(3));

    // --- span via the resize handle ---
    var LL = computeLayout(state);
    var ts = LL.tiles[0];
    var pitch = LL.cell.pitchX;
    dragFrom(ts.x + ts.w - 4, ts.y + ts.h - 4, ts.x + ts.w - 4 + pitch, ts.y + ts.h - 4, 5);
    var ps = photoById(ts.photoId);
    add('drag resize handle one pitch right -> span 2 columns', ps.span.c === 2,
        JSON.stringify(ps.span));
    var L2 = computeLayout(state);
    var t2 = L2.tiles.find(function (t) { return t.photoId === ps.id; });
    add('spanned tile is wider than a single cell', t2 && t2.w > LL.cell.cw * 1.5,
        t2 ? t2.w + ' vs cw ' + LL.cell.cw.toFixed(1) : 'missing');

    // reset span by double-clicking the handle
    dblAt(t2.x + t2.w - 4, t2.y + t2.h - 4);
    add('double-click handle resets span', ps.span.c === 1 && ps.span.r === 1,
        JSON.stringify(ps.span));

    // --- swap via the grip, spans stay with the slot ---
    var L3 = computeLayout(state);
    var A = L3.tiles[0], B = L3.tiles[1];
    var idA = A.photoId, idB = B.photoId;
    photoById(idA).span = {c: 2, r: 1};        // give slot A a distinctive shape
    renderPreview();
    var L4 = computeLayout(state);
    A = L4.tiles.find(function (t) { return t.photoId === idA; });
    B = L4.tiles.find(function (t) { return t.photoId === idB; });
    /* Aim at the grip's REAL rect. Guessing an artboard offset is wrong: the
       handles are sized in inverse-scale (--ui) units so they stay a constant
       on-screen size, which means their artboard offset grows with the artboard
       (x=19.6 on a 3744 banner, x=36 on a 3600x5400 poster). */
    var gripEl = document.querySelector('#sheet .tile[data-id="' + idA + '"] .grip');
    add('grip element exists on the tile', !!gripEl, idA);
    var gr = gripEl.getBoundingClientRect();
    var bTo = clientOf(B.x + B.w * 0.5, B.y + B.h * 0.5);
    pev('pointerdown', gr.left + gr.width / 2, gr.top + gr.height / 2, 1);
    for (var s = 1; s <= 5; s++) {
      pev('pointermove',
          gr.left + gr.width / 2 + (bTo.x - gr.left - gr.width / 2) * s / 5,
          gr.top + gr.height / 2 + (bTo.y - gr.top - gr.height / 2) * s / 5, 1);
    }
    pev('pointerup', bTo.x, bTo.y, 0);
    add('grip drag swaps the two photos',
        state.photos[0].id === idB && state.photos[1].id === idA,
        state.photos.slice(0, 2).map(function (p) { return p.id; }).join(','));
    add('spans stay with the slot, not the picture',
        state.photos[0].span.c === 2 && state.photos[1].span.c === 1,
        JSON.stringify([state.photos[0].span, state.photos[1].span]));

    /* --- the mark can be dragged and resized on the artboard -------------- */
    (function () {
      // overlay mode: free placement on both axes
      state.chrome.mode = 'overlay';
      state.chrome.placed = false;
      state.chrome.corner = 'bl';
      state.chrome.sizePct = 30;
      syncControls();
      renderPreview();

      var Lo = computeLayout(state);
      var m0 = Lo.lockup.rect;
      add('overlay: a draggable mark is rendered with handles',
          !!document.querySelector('#sheet .lockup .mgrab') &&
          !!document.querySelector('#sheet .lockup .mrsz'), 'handles');

      // drag the mark to roughly the centre of the artboard
      var W = state.artboard.w, H = state.artboard.h;
      dragFrom(m0.x + m0.w / 2, m0.y + m0.h / 2, W * 0.5, H * 0.5, 5);
      add('overlay: dragging the mark sets placed=true', state.chrome.placed === true,
          '' + state.chrome.placed);
      add('overlay: the mark followed the pointer to mid-artboard',
          Math.abs(state.chrome.markX - 50) < 3 && Math.abs(state.chrome.markY - 50) < 3,
          state.chrome.markX.toFixed(1) + '/' + state.chrome.markY.toFixed(1));
      var Lm = computeLayout(state);
      add('overlay: the rendered mark moved with the state',
          Math.abs((Lm.lockup.rect.x + Lm.lockup.rect.w / 2) - W * 0.5) < 4,
          JSON.stringify(Lm.lockup.rect));
      add('overlay: the scrim followed the mark to the nearer edge',
          Lm.scrim === null || Lm.scrim.rect.h > 0, JSON.stringify(Lm.scrim && Lm.scrim.rect));

      // resize via the round handle: drag it right to widen the mark
      var rszEl = document.querySelector('#sheet .lockup .mrsz');
      var rr = rszEl.getBoundingClientRect();
      var before = state.chrome.sizePct;
      var target = clientOf(Lm.lockup.rect.x + Lm.lockup.rect.w + W * 0.12,
                            Lm.lockup.rect.y + Lm.lockup.rect.h);
      pev('pointerdown', rr.left + rr.width / 2, rr.top + rr.height / 2, 1);
      for (var q1 = 1; q1 <= 5; q1++) {
        pev('pointermove',
            rr.left + rr.width / 2 + (target.x - rr.left - rr.width / 2) * q1 / 5,
            rr.top + rr.height / 2 + (target.y - rr.top - rr.height / 2) * q1 / 5, 1);
      }
      pev('pointerup', target.x, target.y, 0);
      add('overlay: dragging the round handle widens the mark',
          state.chrome.sizePct > before, before + ' -> ' + state.chrome.sizePct.toFixed(1));
      var Lr = computeLayout(state);
      add('overlay: the resized mark keeps its aspect ratio',
          Math.abs(Lr.lockup.rect.w / Lr.lockup.rect.h - (Lr.lockup.ratio || 7.6618)) < 0.05,
          '' + (Lr.lockup.rect.w / Lr.lockup.rect.h));
      add('overlay: the resized mark stays inside the artboard',
          Lr.lockup.rect.x >= 0 && Lr.lockup.rect.y >= 0 &&
          Lr.lockup.rect.x + Lr.lockup.rect.w <= W &&
          Lr.lockup.rect.y + Lr.lockup.rect.h <= H, JSON.stringify(Lr.lockup.rect));

      // double-click resets placement and size
      var Ld = computeLayout(state);
      dblAt(Ld.lockup.rect.x + Ld.lockup.rect.w / 2, Ld.lockup.rect.y + Ld.lockup.rect.h / 2);
      add('overlay: double-clicking the mark resets its placement',
          state.chrome.placed === false && Math.abs(state.chrome.sizePct - 30) < 0.01,
          JSON.stringify({placed: state.chrome.placed, size: state.chrome.sizePct}));

      // band mode: horizontal only
      state.chrome.mode = 'band';
      state.chrome.placed = false;
      syncControls();
      renderPreview();
      var Lb = computeLayout(state);
      var b0 = Lb.lockup.rect;
      var y0 = b0.y;
      dragFrom(b0.x + b0.w / 2, b0.y + b0.h / 2, W * 0.22, b0.y + b0.h / 2 - 400, 5);
      var Lb2 = computeLayout(state);
      add('band: dragging moves the mark horizontally',
          Math.abs(state.chrome.markX - 22) < 4, '' + state.chrome.markX.toFixed(1));
      add('band: dragging does NOT move the mark vertically out of the band',
          Lb2.lockup.rect.y === y0, y0 + ' -> ' + Lb2.lockup.rect.y);

      // put things back for the checks that follow
      state.chrome.mode = 'band';
      state.chrome.placed = false;
      state.chrome.markX = 50; state.chrome.markY = 50;
      syncControls();
      renderPreview();
    })();

    // --- interaction state never leaks into the layout object -------------
    var L5 = computeLayout(state);
    add('computeLayout output has no UI/interaction keys',
        !('mode' in L5) && !('overId' in L5) && !('dragId' in L5) &&
        L5.tiles.every(function (t) { return !('over' in t) && !('src' in t); }),
        Object.keys(L5).join(','));

    // --- the canvas painter picks the gestures up -------------------------
    return paintToCanvas(state, {hiRes: false}).then(function (cv) {
      add('canvas paints after gestures', cv.width === state.artboard.w, cv.width + 'x' + cv.height);
      var pass = out.filter(function (o) { return o.pass; }).length;
      console.log('[harness] GESTURES ' + JSON.stringify({
        passed: pass, total: out.length,
        failures: out.filter(function (o) { return !o.pass; })
      }));
      return out;
    });
  }

  /* Exercise the REAL ingestion path (File -> makePhoto -> downscaled preview,
     original retained) and then the hi-res export paint. The parity harness
     bypasses both by building photo records by hand, so without this the
     originals-are-used-for-export claim is untested. */
  async function exportMode() {
    var files = [];
    for (var i = 0; i < FIXTURES.length; i++) {
      var res = await fetch('_fixtures/' + FIXTURES[i]);
      files.push(new File([await res.blob()], FIXTURES[i], {type: 'image/jpeg'}));
    }
    state.photos = [];
    await addFiles(files);

    var report = {
      ingested: state.photos.length,
      previewsDownscaled: state.photos.every(function (p) {
        return Math.max(p.pw, p.ph) <= 1200;
      }),
      originalsRetained: state.photos.every(function (p) { return !!p.file; }),
      // the export must decode the ORIGINAL, not the preview copy
      hiResDims: [], previewDims: []
    };
    for (var j = 0; j < Math.min(3, state.photos.length); j++) {
      var p = state.photos[j];
      var hi = await tileSource(p, true);
      report.hiResDims.push(hi.w + 'x' + hi.h);
      report.previewDims.push(p.pw + 'x' + p.ph);
      hi.release();
    }

    var t0 = performance.now();
    var cv = await paintToCanvas(state, {hiRes: true});
    report.paintMs = Math.round(performance.now() - t0);
    report.canvas = cv.width + 'x' + cv.height;

    var t1 = performance.now();
    var blob = await new Promise(function (r) { cv.toBlob(r, 'image/png'); });
    report.encodeMs = Math.round(performance.now() - t1);
    report.pngBytes = blob ? blob.size : 0;

    // is the render actually populated, or a blank canvas?
    var probe = document.createElement('canvas');
    probe.width = 60; probe.height = 60;
    var pctx = probe.getContext('2d');
    pctx.drawImage(cv, 0, 0, 60, 60);
    var d = pctx.getImageData(0, 0, 60, 60).data;
    var seen = {};
    for (var k = 0; k < d.length; k += 4) {
      seen[(d[k] >> 4) + ',' + (d[k + 1] >> 4) + ',' + (d[k + 2] >> 4)] = 1;
    }
    report.distinctColours = Object.keys(seen).length;

    // show it on screen, scaled to fit, so the screenshot proves it visually
    document.querySelector('header').hidden = true;
    document.querySelector('main').hidden = true;
    document.body.style.cssText =
      'margin:0;padding:0;background:#000;display:block;overflow:hidden';
    var k2 = Math.min(1000 / cv.width, 900 / cv.height);
    cv.style.cssText = 'position:absolute;left:0;top:0;width:' +
      Math.round(cv.width * k2) + 'px;height:' + Math.round(cv.height * k2) + 'px';
    document.body.appendChild(cv);

    // also drive the REAL button handler, so the user-facing path (empty guard,
    // button disable, anchor download, status text) is covered and not just
    // paintToCanvas + toBlob
    if (q.get('clickexport') === '1') {
      report.statusBefore = document.getElementById('exportnote').textContent;
      await exportPNG();
      report.statusAfter = document.getElementById('exportnote').textContent;
      report.buttonReenabled = document.getElementById('png').disabled === false;
      report.exportOk = /^Saved \d+×\d+/.test(report.statusAfter);
    }

    console.log('[harness] EXPORT ' + JSON.stringify(report));
  }

  /* ---- HTML export round trip -------------------------------------------
     Renders the EXPORTED HTML in an iframe at scale 1 directly below a canvas
     render of the same state, so compare_parity.py can diff them. This is the
     only thing that actually proves the third consumer: everything else tests
     the string, not what a browser does with it. */
  async function htmlParityMode() {
    var W = state.artboard.w, H = state.artboard.h;

    document.querySelector('header').hidden = true;
    document.querySelector('main').hidden = true;
    document.body.style.cssText =
      'margin:0;padding:0;overflow:hidden;background:#000;display:block';

    var cv = await paintToCanvas(state, {hiRes: true});
    cv.style.cssText = 'position:absolute;left:0;top:0;display:block';
    document.body.appendChild(cv);

    var html = await buildExportHTML(state);
    var frame = document.createElement('iframe');
    frame.style.cssText = 'position:absolute;left:0;top:' + H + 'px;width:' + W +
                          'px;height:' + H + 'px;border:0;display:block';
    frame.setAttribute('scrolling', 'no');
    document.body.appendChild(frame);
    await new Promise(function (res) { frame.onload = res; frame.srcdoc = html; });
    var doc = frame.contentDocument;
    await Promise.all([].slice.call(doc.images).map(function (im) {
      return (im.decode ? im.decode() : Promise.resolve()).catch(function () {});
    }));
    if (doc.fonts && doc.fonts.ready) { try { await doc.fonts.ready; } catch (e) {} }

    var external = (html.match(/(?:src|href)="(?!data:)[^"]*"/g) || [])
      .concat(html.match(/url\((?!data:|#)[^)]*\)/g) || []);
    console.log('[harness] HTMLPARITY ' + JSON.stringify({
      w: W, h: H,
      bytes: html.length,
      imgs: doc.images.length,
      tiles: computeLayout(state).tiles.length,
      selfContained: external.length === 0,
      external: external.slice(0, 4),
      hasPageRule: /@page\{size:\d+px \d+px;margin:0\}/.test(html),
      hasColorAdjust: html.indexOf('print-color-adjust:exact') >= 0,
      sheetW: doc.querySelector('.sheet') ? doc.querySelector('.sheet').offsetWidth : 0,
      sheetH: doc.querySelector('.sheet') ? doc.querySelector('.sheet').offsetHeight : 0
    }));
  }

  /* ---- persistence round trip (step 7) ----------------------------------
     Needs TWO page loads in one browser profile, so persist_test.js navigates
     this harness twice: once to write, once to read back. */
  function fingerprint() {
    return {
      artboard: state.artboard.w + 'x' + state.artboard.h,
      preset: state.artboard.presetId,
      mode: state.chrome.mode,
      fill: state.chrome.fill,
      markX: +state.chrome.markX.toFixed(2),
      markY: +state.chrome.markY.toFixed(2),
      placed: state.chrome.placed,
      headline: state.text.headline,
      subhead: state.text.subhead,
      dark: state.brand.dark,
      accent: state.brand.accent,
      photos: state.photos.map(function (p) {
        return {
          name: p.name, hash: p.hash,
          focal: +p.focal.x.toFixed(2) + '/' + (+p.focal.y.toFixed(2)),
          zoom: +p.zoom.toFixed(3),
          span: p.span.c + 'x' + p.span.r,
          w: p.w, h: p.h,
          hasPixels: !!(p.url && p.url.length > 100),
          hasFile: !!p.file
        };
      })
    };
  }

  async function persistSave() {
    var files = [];
    for (var i = 0; i < FIXTURES.length; i++) {
      var res = await fetch('_fixtures/' + FIXTURES[i]);
      files.push(new File([await res.blob()], FIXTURES[i], {type: 'image/jpeg'}));
    }
    state.photos = [];
    await addFiles(files);              // the REAL path: hashes + stores blobs

    // distinctive edits across every part of state
    state.photos[0].focal = {x: 17, y: 83};
    state.photos[0].zoom = 2.25;
    state.photos[1].span = {c: 2, r: 2};
    state.text.headline = 'PERSISTED HEADLINE';
    state.text.subhead = 'and a subhead';
    state.brand.accent = '#123456';
    state.chrome.mode = 'overlay';
    state.chrome.placed = true;
    state.chrome.markX = 31.5;
    state.chrome.markY = 72.25;
    var pr = PRESETS.find(function (p) { return p.id === 'banner'; });
    state.artboard = {w: pr.w, h: pr.h, presetId: pr.id};
    syncControls();
    renderPreview();                    // schedules the debounced save

    // wait for the debounce to land, then confirm it really is in IndexedDB
    var snap = null;
    for (var t = 0; t < 60 && !snap; t++) {
      await new Promise(function (r) { setTimeout(r, 100); });
      try { snap = await idbGet('state', SNAP_ID); } catch (e) { snap = null; }
      if (snap && snap.photos && snap.photos.length &&
          snap.text && snap.text.headline === 'PERSISTED HEADLINE') break;
      snap = null;
    }
    var blobCount = 0;
    for (var j = 0; j < state.photos.length; j++) {
      try {
        var rec = await idbGet('blobs', state.photos[j].hash);
        if (rec && rec.blob && rec.blob.size > 0) blobCount++;
      } catch (e) {}
    }
    console.log('[harness] PERSIST ' + JSON.stringify({
      phase: 'save',
      snapshotWritten: !!snap,
      snapshotBytes: snap ? JSON.stringify(snap).length : 0,
      blobsStored: blobCount,
      expected: fingerprint()
    }));
  }

  async function persistLoad() {
    // the tool's own startup offers the snapshot; wait for that prompt
    var card = document.getElementById('restore');
    var shown = false;
    for (var t = 0; t < 80; t++) {
      if (card && !card.hidden) { shown = true; break; }
      await new Promise(function (r) { setTimeout(r, 100); });
    }
    var meta = document.getElementById('restoremeta').textContent;
    if (shown) {
      document.getElementById('dorestore').click();
      for (var u = 0; u < 120; u++) {
        await new Promise(function (r) { setTimeout(r, 100); });
        if (state.photos.length && card.hidden) break;
      }
    }
    console.log('[harness] PERSIST ' + JSON.stringify({
      phase: 'load',
      promptShown: shown,
      promptMeta: meta,
      restored: fingerprint()
    }));
  }

  /* ---- .collage.json save/load, in one page load ------------------------
     Exercises the real saveProject serialisation and the real loadProject
     reader, including the case that matters most: a layout-only file opened
     where IndexedDB has none of the blobs (i.e. on another machine). */
  async function projFileMode() {
    var withPhotos = q.get('projfile') === 'full';
    var wipe = q.get('wipedb') === '1';

    var files = [];
    for (var i = 0; i < FIXTURES.length; i++) {
      var res = await fetch('_fixtures/' + FIXTURES[i]);
      files.push(new File([await res.blob()], FIXTURES[i], {type: 'image/jpeg'}));
    }
    state.photos = [];
    await addFiles(files);
    state.photos[0].focal = {x: 12, y: 88};
    state.photos[0].zoom = 1.75;
    state.photos[1].span = {c: 2, r: 1};
    state.text.headline = 'PROJECT FILE';
    state.brand.dark = '#0A1A3C';
    var pr = PRESETS.find(function (p) { return p.id === 'flyer'; });
    state.artboard = {w: pr.w, h: pr.h, presetId: pr.id};
    renderPreview();
    var expected = fingerprint();

    // build exactly what saveProject writes
    var snap = serializeState(state);
    if (withPhotos) {
      for (var j = 0; j < snap.photos.length; j++) {
        if (state.photos[j] && state.photos[j].file) {
          snap.photos[j].data = await blobToDataURL(state.photos[j].file);
        }
      }
    }
    var json = JSON.stringify(snap);

    if (wipe) {
      // simulate opening the file somewhere the blobs were never stored
      await new Promise(function (res) {
        openDB().then(function (db) {
          var tx = db.transaction('blobs', 'readwrite');
          tx.objectStore('blobs').clear();
          tx.oncomplete = res; tx.onerror = res;
        }).catch(res);
      });
    }

    // wipe the board, then read the file back through the real loader
    state.photos = [];
    state.text.headline = ''; state.brand.dark = '#000E54';
    state.artboard = {w: 1080, h: 1080, presetId: 'ig-square'};
    renderPreview();

    await loadProject(new File([json], 'test.collage.json', {type: 'application/json'}));

    console.log('[harness] PROJFILE ' + JSON.stringify({
      withPhotos: withPhotos, wiped: wipe,
      jsonBytes: json.length,
      note: document.getElementById('savenote').textContent,
      expected: expected,
      loaded: fingerprint()
    }));
  }

  (async function () {
    if (PERSIST === 'save') { await persistSave(); window.__ready = true; return; }
    if (PERSIST === 'load') { await persistLoad(); window.__ready = true; return; }
    if (PERSIST === 'peek') {
      var card = document.getElementById('restore');
      for (var t = 0; t < 80; t++) {
        if (card && !card.hidden) break;
        await new Promise(function (r) { setTimeout(r, 100); });
      }
      window.__ready = true; return;
    }
    if (q.get('projfile')) { await projFileMode(); window.__ready = true; return; }

    await allImagesDecoded();

    if (q.get('htmlparity') === '1') { await htmlParityMode(); window.__ready = true; return; }
    if (EXPORT) { await exportMode(); window.__ready = true; return; }
    if (GESTURES) { await gestureTests(); window.__ready = true; return; }

    if (PARITY) {
      var W = state.artboard.w, H = state.artboard.h;

      /* Diff a CLONE of #sheet, not the live one. The tool re-runs
         renderPreview() on every resize (CDP's device-metrics override fires
         one), and with `main` hidden the stage measures 0 wide, so the live
         sheet gets a NEGATIVE scale and disappears. A clone with its own id is
         immune, and cloning is exact because every child is already positioned
         in artboard pixels. */
      /* Re-point every #sheet rule at #paritysheet by COPYING the tool's own
         stylesheet, rather than hand-maintaining a duplicate list. The
         hand-written list silently omitted .scrim/.plate/.layer when those were
         added, which made the clone render them static (wrong position) and
         looked exactly like a canvas painter bug. Derive, never duplicate. */
      var copied = [];
      for (var si = 0; si < document.styleSheets.length; si++) {
        var rules = null;
        try { rules = document.styleSheets[si].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        for (var ri = 0; ri < rules.length; ri++) {
          var rule = rules[ri];
          if (!rule.selectorText || rule.selectorText.indexOf('#sheet') < 0) continue;
          copied.push(rule.selectorText.replace(/#sheet\b/g, '#paritysheet') +
                      '{' + rule.style.cssText + '}');
        }
      }
      var sty = document.createElement('style');
      sty.textContent = copied.join('\n') +
        '\n#paritysheet{position:absolute;left:0;top:0;overflow:hidden;' +
        'transform:none;box-shadow:none}';
      document.head.appendChild(sty);
      console.log('[harness] copied ' + copied.length + ' #sheet rules to #paritysheet');

      var clone = document.getElementById('sheet').cloneNode(true);
      clone.id = 'paritysheet';
      clone.style.cssText = 'width:' + W + 'px;height:' + H + 'px;box-shadow:none;' +
        'background:' + computeLayout(state).bg;

      document.querySelector('header').hidden = true;
      document.querySelector('main').hidden = true;
      document.body.style.cssText =
        'margin:0;padding:0;overflow:hidden;background:#000;display:block';
      document.body.appendChild(clone);
      await allImagesDecoded();
      await Promise.all([].slice.call(clone.querySelectorAll('img')).map(function (im) {
        return (im.decode ? im.decode() : Promise.resolve()).catch(function () {});
      }));

      // hiRes:false so BOTH consumers read the same source pixels; this isolates
      // geometry differences from resampling differences
      var cv = await paintToCanvas(state, {hiRes: false});
      cv.style.cssText = 'position:absolute;left:0;top:' + H + 'px;display:block';
      document.body.appendChild(cv);

      console.log('[harness] PARITY ' + JSON.stringify({
        preset: pid, w: W, h: H,
        canvasW: cv.width, canvasH: cv.height,
        tiles: computeLayout(state).tiles.length
      }));
    } else {
      var L = computeLayout(state);
      console.log('[harness] RESULT ' + JSON.stringify({
        preset: pid, artboard: L.artboard, grid: L.grid,
        tiles: L.tiles.length, holes: L.holes.length,
        lockupRatio: L.lockup ? +(L.lockup.rect.w / L.lockup.rect.h).toFixed(4) : null,
        imgsInDom: document.querySelectorAll('#sheet .tile img').length,
        holesInDom: document.querySelectorAll('#sheet .hole').length,
        lockupSvgInDom: !!document.querySelector('#sheet .lockup svg'),
        colsRowHidden: document.getElementById('colsrow').hidden,
        emptyHidden: document.getElementById('empty').hidden,
        tilesOutOfBounds: L.tiles.filter(function (t) {
          return t.x < 0 || t.y < 0 ||
                 t.x + t.w > L.artboard.w + 1 || t.y + t.h > L.artboard.h + 1;
        }).length
      }));
    }

    window.__ready = true;
  })().catch(function (e) {
    console.error('[harness] FAILED', e);
    window.__ready = true;   // let the capture proceed so the failure is visible
  });
})();
