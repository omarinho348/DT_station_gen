// /api/review (Claude.md §7.3 "run from a CLI and the API", step 7.4): the deterministic reviewer over
// HTTP, for the app and later the Builder (Phase 8). No LLM, no cost.
//
//   GET  /api/review?file=spec/examples/x.factory.json   a factory.json in the project
//   POST /api/review   { "factory": { … } }               a factory.json sent in the body
//   options, as query parameters (GET) or body fields (POST): play, geometry, compiled (default on;
//   0 / false turns one off: playing the run takes up to ~20 s per line)
//
// Answers { ok, counts, findings, takt, file? } (200, also when the line has errors: the review
// itself worked). 400 for a bad request (no factory, not JSON, a path outside the project or not a
// .factory.json), 404 for a missing file, 405 for other methods, 500 if the reviewer itself failed.
// Reviews run one at a time (each builds and plays whole lines).
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

/** Largest request body accepted (bytes). */
export const MAX_BODY = 2 * 1024 * 1024;

const OPTIONS = ['play', 'geometry', 'compiled'];
const flag = (v) => !(v === false || v === 0 || v === '0' || v === 'false' || v === 'no');

let queue = Promise.resolve();

/**
 * Handles one request. Pure apart from reading the file and what the reviewer does.
 * @param {{ method: string, url: string, body?: string }} req   url relative to /api/review (e.g. "/?file=…")
 * @param {{ root: string, load: () => Promise<{ registry, reviewAll, importModule? }> }} env
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleReview(req, { root, load }) {
  const url = new URL(req.url || '/', 'http://local');
  let data;
  let source = null;
  let options = {};
  if (req.method === 'GET') {
    const file = url.searchParams.get('file');
    if (!file) return { status: 400, body: { error: 'give ?file=<path to a .factory.json in the project>, or POST { factory }' } };
    const path = resolve(root, file);
    const rel = relative(root, path);
    if (rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(root, rel) !== path || !rel.endsWith('.factory.json')) {
      return { status: 400, body: { error: `"${file}" is not a .factory.json inside the project` } };
    }
    if (!existsSync(path)) return { status: 404, body: { error: `no file "${file}"` } };
    try {
      data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
      return { status: 400, body: { error: `"${file}" is not JSON: ${error.message}` } };
    }
    source = rel.split(sep).join('/');
    for (const k of OPTIONS) if (url.searchParams.has(k)) options[k] = flag(url.searchParams.get(k));
  } else if (req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(req.body || '');
    } catch (error) {
      return { status: 400, body: { error: `the body is not JSON: ${error.message}` } };
    }
    if (!body || typeof body.factory !== 'object' || body.factory === null) return { status: 400, body: { error: 'the body needs { "factory": { … } }' } };
    data = body.factory;
    for (const k of OPTIONS) if (k in body) options[k] = flag(body[k]);
  } else {
    return { status: 405, body: { error: 'GET ?file=… or POST { factory }' } };
  }

  const run = async () => {
    const { registry, reviewAll, importModule } = await load();
    const r = await reviewAll(registry, data, { ...options, root, source, ...(importModule ? { importModule } : {}) });
    return {
      status: 200,
      body: { ok: r.ok, counts: r.counts, findings: r.findings, takt: r.timing?.takt ?? null, ...(source ? { file: source } : {}) },
    };
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  try {
    return await result;
  } catch (error) {
    return { status: 500, body: { error: `the reviewer failed: ${error.message}` } };
  }
}

/** Reads a request body as text, refusing more than MAX_BODY bytes. */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error(`body over ${MAX_BODY} bytes`)); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * The Vite dev-server plugin: mounts /api/review. The reviewer and the catalog load through the
 * server's SSR module graph (the catalog uses import.meta.glob), the GLB models once.
 */
export function reviewApi() {
  return {
    name: 'review-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      let loaded = null;
      const load = () => {
        loaded ??= (async () => {
          const { registry } = await server.ssrLoadModule('/lib/components/index.js');
          await server.ssrLoadModule('/lib/products/index.js');
          await server.ssrLoadModule('/lib/ops/index.js');
          const { preloadComponentAssets } = await server.ssrLoadModule('/lib/core/assets.js');
          await preloadComponentAssets(registry);
          const { reviewAll } = await server.ssrLoadModule('/agents/reviewer/deterministic.js');
          return { registry, reviewAll, importModule: (p) => server.ssrLoadModule(p) };
        })();
        loaded.catch(() => { loaded = null; });
        return loaded;
      };
      server.middlewares.use('/api/review', async (req, res) => {
        let body;
        try {
          body = req.method === 'POST' ? await readBody(req) : undefined;
        } catch (error) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message }));
          return;
        }
        const out = await handleReview({ method: req.method, url: req.url, body }, { root, load });
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(out.body));
      });
    },
  };
}
