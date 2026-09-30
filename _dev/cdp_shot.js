/* Zero-dependency Chrome DevTools Protocol screenshotter (Node 22+ global WebSocket).
 *
 * Chrome's `--screenshot` flag fires at the load event, which silently captures
 * half-decoded images and never waits for async work like the canvas painter.
 * This waits for an explicit `window.__ready === true` instead.
 *
 *   node cdp_shot.js <url> <out.png> [width] [height]
 */
const {spawn} = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROMES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

const [url, out, W, H] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node cdp_shot.js <url> <out.png> [w] [h]'); process.exit(2); }
const width = +(W || 1680), height = +(H || 1020);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(port, route) {
  const res = await fetch(`http://127.0.0.1:${port}${route}`);
  return res.json();
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; }
  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    const c = new CDP(ws);
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && c.pending.has(m.id)) {
        const {res, rej} = c.pending.get(m.id);
        c.pending.delete(m.id);
        m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
      } else if (m.method) c.events.push(m);
    };
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws failed')); });
    return c;
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, {res, rej});
      this.ws.send(JSON.stringify({id, method, params: params || {}}));
    });
  }
}

(async () => {
  const chrome = CHROMES.find(p => fs.existsSync(p));
  if (!chrome) { console.error('no Chrome/Edge found'); process.exit(1); }

  const port = 9500 + Math.floor(Math.random() * 400);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpshot-'));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${width},${height}`, 'about:blank'
  ], {stdio: 'ignore'});

  const cleanup = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  // wait for the debugging endpoint
  let list = null;
  for (let i = 0; i < 100 && !list; i++) {
    try { list = await getJSON(port, '/json/list'); } catch (e) { await sleep(100); }
  }
  if (!list) { console.error('chrome debug port never opened'); cleanup(); process.exit(1); }

  const page = list.find(t => t.type === 'page') || list[0];
  const cdp = await CDP.open(page.webSocketDebuggerUrl);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',
    {width, height, deviceScaleFactor: 1, mobile: false});

  await cdp.send('Page.navigate', {url});

  // wait for window.__ready (set by the page when it has finished ALL async work)
  let ready = false;
  for (let i = 0; i < 300; i++) {
    try {
      const r = await cdp.send('Runtime.evaluate', {expression: 'window.__ready === true'});
      if (r.result && r.result.value === true) { ready = true; break; }
    } catch (e) {}
    await sleep(100);
  }
  if (!ready) console.error('WARNING: window.__ready never became true — capturing anyway');

  // let a frame settle so the compositor has painted everything
  await cdp.send('Runtime.evaluate', {
    expression: 'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',
    awaitPromise: true
  });

  const shot = await cdp.send('Page.captureScreenshot',
    {format: 'png', captureBeyondViewport: true});
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));

  // surface anything the page logged, so failures are visible
  for (const e of cdp.events) {
    if (e.method === 'Runtime.consoleAPICalled') {
      const txt = (e.params.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' ');
      if (/RESULT|PARITY|EXPORT|GESTURES|HTMLPARITY|PROJFILE|error|failed|WARN/i.test(String(txt))) console.log(txt);
    }
    if (e.method === 'Runtime.exceptionThrown') {
      const d = e.params.exceptionDetails || {};
      const ex = d.exception || {};
      // `text` is usually just "Uncaught"; the useful part is the exception's
      // own description (message + stack)
      console.error('PAGE EXCEPTION:', ex.description || ex.value || d.text ||
                    JSON.stringify(d).slice(0, 400));
      process.exitCode = 1;
    }
  }

  cleanup();
  await sleep(150);
  try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {}
})().catch(e => { console.error(e); process.exit(1); });
