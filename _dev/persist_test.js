/* Persistence round trip: two page loads in ONE browser profile.
 *
 * Load 1 (?persist=save) ingests real files through addFiles, edits every part
 * of state, and waits for the debounced autosave to land in IndexedDB.
 * Load 2 (?persist=load) seeds nothing, waits for the tool's own restore
 * prompt, clicks Restore, and reports what came back.
 *
 * A fresh temp profile per run means the DB starts empty, so a pass cannot be
 * an artefact of leftover state from a previous run.
 *
 *   node persist_test.js
 */
const {spawn} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
];
const BASE = 'http://localhost:8731/_autotest.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = CHROMES.find(p => fs.existsSync(p));
  if (!chrome) { console.error('no Chrome found'); process.exit(1); }
  const port = 9700 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdppersist-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run',
    '--window-size=1400,900', `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, 'about:blank'], {stdio: 'ignore'});
  const cleanup = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  let list = null;
  for (let i = 0; i < 100 && !list; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
    catch (e) { await sleep(100); }
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map(); let logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const txt = (m.params.args || [])
        .map(a => a.value !== undefined ? a.value : a.description).join(' ');
      logs.push(txt);
    } else if (m.method === 'Runtime.exceptionThrown') {
      const ex = (m.params.exceptionDetails || {}).exception || {};
      console.error('PAGE EXCEPTION:', ex.description || ex.value);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, {res, rej});
    ws.send(JSON.stringify({id: i, method, params: params || {}}));
  });
  await send('Page.enable');
  await send('Runtime.enable');

  async function visit(qs) {
    logs = [];
    await send('Page.navigate', {url: BASE + '?' + qs});
    for (let i = 0; i < 400; i++) {
      const r = await send('Runtime.evaluate', {expression: 'window.__ready === true'});
      if (r.result && r.result.value === true) break;
      await sleep(100);
    }
    const line = logs.find(l => l.indexOf('PERSIST ') === 0 || l.indexOf('[harness] PERSIST') === 0);
    if (!line) throw new Error('no PERSIST result; logs: ' + logs.slice(-4).join(' | '));
    return JSON.parse(line.slice(line.indexOf('PERSIST ') + 8));
  }

  let fail = 0;
  const ok = (name, cond, extra) => {
    console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '   >> ' + extra));
    if (!cond) fail++;
  };

  console.log('\n--- persistence: autosave and restore across a reload ---');
  const saved = await visit('persist=save&n=6&preset=ig-square');
  ok('autosave wrote a snapshot to IndexedDB', saved.snapshotWritten,
     JSON.stringify(saved).slice(0, 200));
  ok('the snapshot is small (layout only, no pixels)',
     saved.snapshotBytes > 200 && saved.snapshotBytes < 60000,
     saved.snapshotBytes + ' bytes');
  ok('every photo blob was stored once', saved.blobsStored === saved.expected.photos.length,
     saved.blobsStored + ' of ' + saved.expected.photos.length);
  ok('all photos carry a content hash',
     saved.expected.photos.every(p => p.hash && p.hash.length >= 16),
     JSON.stringify(saved.expected.photos.map(p => p.hash)));
  ok('hashes are unique per distinct photo',
     new Set(saved.expected.photos.map(p => p.hash)).size === saved.expected.photos.length);

  const back = await visit('persist=load');
  ok('the restore prompt is offered on reload', back.promptShown, back.promptMeta);
  ok('the prompt names the photo count and size',
     /\d+ photos? · \d+×\d+/.test(back.promptMeta), back.promptMeta);

  const e = saved.expected, r = back.restored;
  ok('photo count restored', r.photos.length === e.photos.length,
     r.photos.length + ' vs ' + e.photos.length);
  ok('artboard restored', r.artboard === e.artboard && r.preset === e.preset,
     r.artboard + '/' + r.preset + ' vs ' + e.artboard + '/' + e.preset);
  ok('band copy restored', r.headline === e.headline && r.subhead === e.subhead,
     JSON.stringify([r.headline, r.subhead]));
  ok('brand palette override restored', r.accent === e.accent, r.accent + ' vs ' + e.accent);
  ok('mark placement and hand position restored',
     r.mode === e.mode && r.placed === e.placed &&
     r.markX === e.markX && r.markY === e.markY,
     JSON.stringify({got: [r.mode, r.placed, r.markX, r.markY],
                     want: [e.mode, e.placed, e.markX, e.markY]}));
  ok('per-photo focal point restored',
     r.photos[0] && r.photos[0].focal === e.photos[0].focal,
     (r.photos[0] || {}).focal + ' vs ' + e.photos[0].focal);
  ok('per-photo zoom restored',
     r.photos[0] && r.photos[0].zoom === e.photos[0].zoom,
     (r.photos[0] || {}).zoom + ' vs ' + e.photos[0].zoom);
  ok('per-photo span restored',
     r.photos[1] && r.photos[1].span === e.photos[1].span,
     (r.photos[1] || {}).span + ' vs ' + e.photos[1].span);
  ok('photo order preserved',
     r.photos.map(p => p.name).join() === e.photos.map(p => p.name).join(),
     r.photos.map(p => p.name).join());
  ok('restored photos have real pixels back', r.photos.every(p => p.hasPixels),
     JSON.stringify(r.photos.map(p => p.hasPixels)));
  ok('restored photos keep an original blob for hi-res export',
     r.photos.every(p => p.hasFile), JSON.stringify(r.photos.map(p => p.hasFile)));
  ok('original dimensions survived the round trip',
     r.photos.every((p, i) => p.w === e.photos[i].w && p.h === e.photos[i].h),
     JSON.stringify(r.photos.map(p => p.w + 'x' + p.h)));

  // optional: capture the restore card itself (shown, not clicked)
  if (process.argv.includes('--shot')) {
    const outPng = process.argv[process.argv.indexOf('--shot') + 1];
    await send('Emulation.setDeviceMetricsOverride',
      {width: 1400, height: 900, deviceScaleFactor: 1, mobile: false});
    await send('Page.navigate', {url: BASE + '?persist=peek'});
    for (let i = 0; i < 200; i++) {
      const r = await send('Runtime.evaluate', {expression: 'window.__ready === true'});
      if (r.result && r.result.value === true) break;
      await sleep(100);
    }
    const shot = await send('Page.captureScreenshot', {format: 'png'});
    fs.writeFileSync(outPng, Buffer.from(shot.data, 'base64'));
    console.log('  restore card captured -> ' + outPng);
  }

  console.log(fail ? '\n' + fail + ' PERSISTENCE FAILURE(S)\n' : '\nPERSISTENCE PASSED\n');
  cleanup();
  await sleep(200);
  try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {}
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
