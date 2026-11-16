#!/usr/bin/env node
// Headless screenshot of any app page. No extra dependencies: drives Chrome through the
// DevTools Protocol using Node's built-in fetch and WebSocket (Node >= 22).
//
//   npm run screenshot                          -> screenshots/home.png of "/" (setup page)
//   npm run screenshot -- "#/twin"              -> screenshots/twin.png
//   npm run screenshot -- /gallery.html --out screenshots/gallery.png
//   npm run screenshot -- --url http://localhost:5173/ --size 1280x720
//
// Options:
//   [path]            page path served by Vite (default "/")
//   --url <url>       use an already running server instead of starting Vite
//   --out <file>      output PNG (default screenshots/<name>.png)
//   --size <WxH>      viewport (default 1600x900)
//   --ready <expr>    JS expression that is true when the page is ready (default window.__appReady === true)
//   --settle <n>      extra animation frames to wait after ready (default 3)
//   --timeout <ms>    give up after this long (default 60000; SwiftShader's first frame takes ~15 s)
//
// Pages can define window.__screenshotPrepare() to stop their render loop before capture.
//   --verbose         print timings for each stage
//   CHROME_PATH env   overrides the Chrome executable

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const opts = {
    path: '/',
    url: null,
    out: null,
    width: 1600,
    height: 900,
    ready: 'window.__appReady === true',
    settle: 3,
    timeout: 60000,
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--verbose') opts.verbose = true;
    else if (a === '--url') opts.url = next();
    else if (a === '--out') opts.out = next();
    else if (a === '--ready') opts.ready = next();
    else if (a === '--settle') opts.settle = toInt(next(), a, 0);
    else if (a === '--timeout') opts.timeout = toInt(next(), a, 1000);
    else if (a === '--size') {
      const m = /^(\d+)x(\d+)$/.exec(next());
      if (!m) throw new Error('--size must look like 1600x900');
      opts.width = toInt(m[1], a, 100);
      opts.height = toInt(m[2], a, 100);
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else opts.path = a.startsWith('/') ? a : `/${a}`;
  }
  if (!opts.out) {
    const u = opts.url ? new URL(opts.url) : null;
    opts.out = join('screenshots', `${nameFor(u ? u.pathname + u.hash : opts.path)}.png`);
  }
  return opts;
}

/** "/" -> "home", "/#/setup/brief" -> "setup-brief", "/gallery.html" -> "gallery" */
export function nameFor(path) {
  const clean = path
    .replace(/#/g, '/')
    .replace(/\.html?(?=\/|$)/g, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
  return clean ? clean.replace(/[^\w-]+/g, '-') : 'home';
}

function toInt(v, flag, min) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new Error(`${flag} must be an integer >= ${min}`);
  return n;
}

export function findChrome(env = process.env) {
  const candidates = [
    env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].filter(Boolean);
  const hit = candidates.find((p) => existsSync(p));
  if (!hit) throw new Error('Chrome not found. Set CHROME_PATH.');
  return hit;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, what) {
  const end = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      lastErr = e;
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${what}${lastErr ? ` (${lastErr.message})` : ''}`);
}

/** Minimal CDP client over one page WebSocket. */
function connectCdp(wsUrl) {
  return new Promise((resolveConn, rejectConn) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const logs = [];
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method === 'Runtime.exceptionThrown') {
        logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
      } else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(msg.params.entry.level)) {
        // Browser-level problems: failed network requests, blocked resources, lost WebGL context.
        logs.push(`[browser.${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`.trim());
      } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
        logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
      }
    };
    ws.onerror = () => rejectConn(new Error('CDP WebSocket error'));
    ws.onopen = () =>
      resolveConn({
        logs,
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const msgId = ++id;
            pending.set(msgId, { res, rej });
            ws.send(JSON.stringify({ id: msgId, method, params }));
          });
        },
        close: () => ws.close(),
      });
  });
}

async function startVite() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    // Own dependency cache: sharing node_modules/.vite with a running `npm run dev` makes
    // the two servers fight over it, and lazily loaded code then never arrives.
    cacheDir: 'node_modules/.vite-screenshot',
    server: { port: 0, strictPort: false, hmr: false, watch: null },
  });
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) throw new Error('Vite did not report a local URL');
  return { server, base: url.replace(/\/$/, '') };
}

export async function screenshot(opts) {
  let vite = null;
  let chrome = null;
  const profile = await mkdtemp(join(tmpdir(), 'dt-shot-'));
  const t0 = Date.now();
  const mark = (label) => opts.verbose && console.log(`  ${String(Date.now() - t0).padStart(6)} ms  ${label}`);
  try {
    let target = opts.url;
    if (!target) {
      vite = await startVite();
      target = vite.base + opts.path;
      mark('vite started');
    }

    chrome = spawn(
      findChrome(),
      [
        '--headless=new',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--hide-scrollbars',
        '--mute-audio',
        '--no-first-run',
        '--no-default-browser-check',
        `--user-data-dir=${profile}`,
        '--remote-debugging-port=0',
        `--window-size=${opts.width},${opts.height}`,
        'about:blank',
      ],
      { stdio: 'ignore' },
    );

    // Chrome writes the chosen debugging port to <profile>/DevToolsActivePort.
    const port = await waitFor(
      async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(),
      15000,
      'Chrome to start',
    );
    const page = await waitFor(
      async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'),
      10000,
      'a Chrome page target',
    );
    mark('chrome started');

    const cdp = await connectCdp(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: target });

    const evalBool = async (expr) =>
      (await cdp.send('Runtime.evaluate', { expression: `Boolean(${expr})`, returnByValue: true })).result.value;
    try {
      await waitFor(() => evalBool(opts.ready), opts.timeout, `ready condition "${opts.ready}"`);
    } catch (e) {
      if (cdp.logs.length) e.message += `\nPage errors:\n  ${cdp.logs.join('\n  ')}`;
      throw e;
    }
    mark('page ready');

    // Let shadows, the environment map and damping settle for a few frames.
    await cdp.send('Runtime.evaluate', {
      expression: `new Promise(r => { let n = ${opts.settle}; const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })`,
      awaitPromise: true,
    });

    mark(`${opts.settle} frames settled`);
    // Pages may expose a hook that stops their render loop so the capture isn't starved.
    await cdp.send('Runtime.evaluate', { expression: 'window.__screenshotPrepare?.()', awaitPromise: true });
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    mark('captured');
    const out = resolve(ROOT, opts.out);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, Buffer.from(data, 'base64'));
    cdp.close();
    return { out, url: target, logs: cdp.logs };
  } finally {
    if (chrome && chrome.exitCode === null) chrome.kill();
    if (vite) await vite.server.close();
    await sleep(300); // let Chrome release the profile folder before deleting it
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {});
    mark('cleaned up');
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const { out, url, logs } = await screenshot(opts);
    for (const l of logs) console.warn(l);
    console.log(`Saved ${basename(out)} (${opts.width}x${opts.height}) from ${url}\n  -> ${out}`);
    process.exit(0);
  } catch (e) {
    console.error(`screenshot failed: ${e.message}`);
    process.exit(1);
  }
}
