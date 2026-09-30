/* Drive the harness to produce a real exported .html file on disk, so it can be
 * opened standalone rather than only inspected inside an iframe.
 *
 *   node export_html.js "<harness query string>" <out.html>
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
const [qs, out] = process.argv.slice(2);
if (!qs || !out) { console.error('usage: node export_html.js "<query>" <out.html>'); process.exit(2); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = CHROMES.find(p => fs.existsSync(p));
  const port = 9900 + Math.floor(Math.random() * 90);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpexp-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'],
    {stdio: 'ignore'});
  const cleanup = () => { try { proc.kill(); } catch (e) {} };
  process.on('exit', cleanup);

  let list = null;
  for (let i = 0; i < 100 && !list; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); }
    catch (e) { await sleep(100); }
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
  };
  await new Promise(r => { ws.onopen = r; });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, {res, rej});
    ws.send(JSON.stringify({id: i, method, params: params || {}}));
  });

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', {url: `http://localhost:8731/_autotest.html?${qs}`});
  for (let i = 0; i < 300; i++) {
    const r = await send('Runtime.evaluate', {expression: 'window.__ready === true'});
    if (r.result && r.result.value === true) break;
    await sleep(100);
  }
  const r = await send('Runtime.evaluate', {
    expression: 'buildExportHTML(state)', awaitPromise: true, returnByValue: true
  });
  if (!r.result || typeof r.result.value !== 'string') {
    console.error('no HTML returned:', JSON.stringify(r).slice(0, 300));
    cleanup(); process.exit(1);
  }
  fs.writeFileSync(out, r.result.value, 'utf8');
  console.log(`wrote ${out} (${(r.result.value.length / 1024).toFixed(0)} KB)`);
  cleanup();
  await sleep(150);
  try { fs.rmSync(profile, {recursive: true, force: true}); } catch (e) {}
})().catch(e => { console.error(e); process.exit(1); });
