// /api/simpy (Phase 11): run a line's SimPy model and read its results over HTTP (simpy/FORMAT.md).
//
//   POST /api/simpy/run                     { line: <id in lines/> } or { example: <spec/examples name> }
//                                           → { folder, kpis, events }
//   GET  /api/simpy/<folder>/kpis.json      the last run's KPIs
//   GET  /api/simpy/<folder>/trace.jsonl    the last run's events (?since=<t>: from time t on)
//
// One run at a time. 404 when there is no such line or no run yet; 500 with the reason when Python or
// simpy is missing or the model failed.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z][a-zA-Z0-9]*$/;
const FOLDER = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {object} env
 * @param {string} env.root
 * @param {() => Promise<{ registry, writeModel, runModel, readResults }>} env.load
 */
export function createSimpyService({ root, load }) {
  let queue = Promise.resolve();
  const examples = () => (existsSync(join(root, 'spec', 'examples')) ? readdirSync(join(root, 'spec', 'examples')).filter((n) => n.endsWith('.factory.json')).map((n) => n.replace(/\.factory\.json$/, '')) : []);

  async function handle({ method, path, query = {} }) {
    const m = await load();
    if (path === '/run') {
      if (method !== 'POST') return { status: 405, body: { error: 'POST /api/simpy/run' } };
      const run = async () => {
        let file;
        if (query.line) {
          if (!ID.test(query.line) || !existsSync(join(root, 'lines', query.line, 'factory.json'))) return { status: 404, body: { error: `no line "${query.line}" in lines/` } };
          file = join('lines', query.line, 'factory.json');
        } else if (query.example) {
          if (!examples().includes(query.example)) return { status: 404, body: { error: `no example "${query.example}" (there are: ${examples().join(', ')})` } };
          file = join('spec', 'examples', `${query.example}.factory.json`);
        } else {
          return { status: 400, body: { error: 'POST { line } or { example }' } };
        }
        const factory = JSON.parse(readFileSync(join(root, file), 'utf8'));
        try {
          const { dir } = m.writeModel({ root, registry: m.registry, factory, source: file.replace(/\\/g, '/') });
          const r = await m.runModel(dir);
          return { status: 200, body: { folder: dir.split(/[\\/]/).pop(), kpis: r.kpis, events: r.trace.length, seconds: r.seconds } };
        } catch (error) {
          return { status: 500, body: { error: error.message } };
        }
      };
      const result = queue.then(run, run);
      queue = result.catch(() => {});
      return result;
    }
    const match = path.match(/^\/([^/]+)\/(kpis\.json|trace\.jsonl)$/);
    if (!match || !FOLDER.test(match[1])) return { status: 404, body: { error: `no route /api/simpy${path}` } };
    if (method !== 'GET') return { status: 405, body: { error: `GET /api/simpy${path}` } };
    const results = m.readResults(join(root, 'simpy', match[1]));
    if (!results) return { status: 404, body: { error: `no SimPy run of "${match[1]}" yet: POST /api/simpy/run` } };
    if (match[2] === 'kpis.json') return { status: 200, body: results.kpis };
    const since = Number(query.since);
    const events = Number.isFinite(since) ? results.trace.filter((e) => e.t >= since) : results.trace;
    return { status: 200, text: events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''), type: 'application/x-ndjson' };
  }

  return { handle };
}

/** The Vite dev-server plugin: mounts /api/simpy. */
export function simpyApi() {
  return {
    name: 'simpy-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      let assetsFor = null;
      const load = async () => {
        const { registry } = await server.ssrLoadModule('/lib/components/index.js');
        await server.ssrLoadModule('/lib/products/index.js');
        await server.ssrLoadModule('/lib/ops/index.js');
        if (assetsFor !== registry) {
          const { preloadComponentAssets } = await server.ssrLoadModule('/lib/core/assets.js');
          await preloadComponentAssets(registry);
          assetsFor = registry;
        }
        const { writeModel, runModel, readResults } = await server.ssrLoadModule('/server/simpyRun.js');
        return { registry, writeModel, runModel, readResults };
      };
      const service = createSimpyService({ root, load });
      server.middlewares.use('/api/simpy', async (req, res) => {
        const [rawPath, search = ''] = (req.url || '/').split('?');
        let query = Object.fromEntries(new URLSearchParams(search));
        if (req.method === 'POST') {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          try { query = { ...query, ...JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }; } catch { /* a bad body: no fields */ }
        }
        const out = await service.handle({ method: req.method, path: rawPath.replace(/\/+$/, '') || '/', query });
        res.statusCode = out.status;
        res.setHeader('Cache-Control', 'no-store');
        if (out.text !== undefined) {
          res.setHeader('Content-Type', out.type);
          res.end(out.text);
        } else {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(out.body));
        }
      });
    },
  };
}
