// /api/lines (Phase 10 step 3): the stored lines and the Editor agent (Claude.md §7.4: an edit in plain
// words → JSON Patch → review → shown as a diff → applied (a new version, recompiled: Vite reloads what
// changed) or discarded; undo).
//
//   GET  /api/lines                       { lines: [{ id, title, version, stations }], examples: [names] }
//   POST /api/lines/import                { example, id }  a spec/examples line copied under a new id (version 1)
//   GET  /api/lines/<id>                  { line: { id, title, version, folder }, history, pending }
//   POST /api/lines/<id>/propose          { request }      the Editor's patch, checked, kept as pending (not saved)
//   POST /api/lines/<id>/apply            the pending patch saved as a new version and recompiled
//   POST /api/lines/<id>/discard          { comment? }     dropped; with a comment the Editor tries again with it
//   POST /api/lines/<id>/undo             the previous version saved again as a new one
//   GET  /api/lines/<id>/zip              the line's files as a zip (server/lineZip.js)
//   POST /api/lines/<id>/critique         the Reviewer's critique (after the deterministic checks pass),
//                                         against sdd/<id>/brief.json and simpy/<folder>/kpis.json when there
//
// 409 when the step can't be done now (no pending patch, the line changed since the proposal) or the LLM
// layer refused ({ error, code }); 400 / 404 for bad requests. One request at a time. Pending patches are
// kept in .agent-cache/editor/<id>.json.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { serverLlm } from './llmApi.js';
import { serverLineStore } from './builderApi.js';
import { lineZip } from './lineZip.js';

const MAX_BODY = 64 * 1024;
const ID = /^[a-z][a-zA-Z0-9]*$/;

/**
 * @param {object} env
 * @param {string} env.root
 * @param {() => Promise<{ registry, createEditor, createCritic?, lineStore, lineFolder }>} env.load
 * @param {() => object} env.llm
 */
export function createLinesService({ root, load, llm }) {
  const examplesDir = join(root, 'spec', 'examples');
  const pendingFile = (id) => join(root, '.agent-cache', 'editor', `${id}.json`);
  const critiqueFile = (id) => join(root, '.agent-cache', 'critique', `${id}.json`);
  const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
  const pending = new Map();
  let queue = Promise.resolve();

  const getPending = (id) => {
    if (!pending.has(id) && existsSync(pendingFile(id))) pending.set(id, JSON.parse(readFileSync(pendingFile(id), 'utf8')));
    return pending.get(id) ?? null;
  };
  const setPending = (id, p) => {
    if (p) {
      pending.set(id, p);
      mkdirSync(dirname(pendingFile(id)), { recursive: true });
      writeFileSync(pendingFile(id), `${JSON.stringify(p)}\n`);
    } else {
      pending.delete(id);
      rmSync(pendingFile(id), { force: true });
    }
  };
  const examples = () => (existsSync(examplesDir) ? readdirSync(examplesDir).filter((n) => n.endsWith('.factory.json')).map((n) => n.replace(/\.factory\.json$/, '')).sort() : []);
  /** What the page shows of a pending patch (not the whole factory). */
  const pendingView = (p) => (p ? { request: p.request, summary: p.summary, ok: p.ok, diff: p.diff, findings: p.findings, questions: p.questions, problems: p.problems, retries: p.attempts.length, cost: p.cost, baseVersion: p.baseVersion } : null);

  async function propose(m, id, request, feedback = null) {
    const { factory, version } = m.lineStore.load(id);
    const editor = m.createEditor({ registry: m.registry, llm: llm() });
    const r = await editor.propose({ factory, request, feedback });
    const findings = (r.findings ?? []).filter((f) => f.severity !== 'info' || f.check === 'play');
    setPending(id, { request, baseVersion: version, ok: r.ok, summary: r.summary, ops: r.ops, factory: r.ok && r.ops.length ? r.factory : null, diff: r.diff, findings, questions: r.questions, problems: r.problems, attempts: r.attempts, cost: r.cost });
  }

  async function handle({ method, path, body }) {
    const run = async () => {
      const m = await load();
      const lineView = (id) => {
        const { factory, version } = m.lineStore.load(id);
        const critique = readJson(critiqueFile(id));
        return { line: { id, title: factory.line.title, version, folder: m.lineFolder(id), stations: factory.stations.length }, history: m.lineStore.history(id).slice(0, 50), pending: pendingView(getPending(id)), critique: critique ? { ...critique, stale: critique.version !== version } : null };
      };
      try {
        if (path === '/' || path === '') {
          if (method !== 'GET') return { status: 405, body: { error: 'GET /api/lines' } };
          return { status: 200, body: { lines: m.lineStore.list(), examples: examples() } };
        }
        if (path === '/import') {
          if (method !== 'POST') return { status: 405, body: { error: 'POST /api/lines/import' } };
          const name = body?.example;
          if (!examples().includes(name)) return { status: 400, body: { error: `no example "${name}" (there are: ${examples().join(', ')})` } };
          if (!ID.test(body?.id ?? '')) return { status: 400, body: { error: 'give the copy an id (camelCase), e.g. bottlingEdit' } };
          const factory = JSON.parse(readFileSync(join(examplesDir, `${name}.factory.json`), 'utf8'));
          delete factory.$schema;
          m.lineStore.create(body.id, factory, { by: 'owner', message: `copied from spec/examples/${name}.factory.json` });
          return { status: 200, body: lineView(body.id) };
        }
        const [, id, action = ''] = path.match(/^\/([^/]+)(?:\/([a-z]+))?$/) ?? [];
        if (!id || !ID.test(id)) return { status: 404, body: { error: `no route /api/lines${path}` } };
        if (!m.lineStore.exists(id)) return { status: 404, body: { error: `no line "${id}" in lines/` } };
        if (!action) {
          if (method !== 'GET') return { status: 405, body: { error: `GET /api/lines/${id}` } };
          return { status: 200, body: lineView(id) };
        }
        if (action === 'zip') {
          if (method !== 'GET') return { status: 405, body: { error: `GET /api/lines/${id}/zip` } };
          const { bytes } = lineZip({ root, id, folder: m.lineFolder(id), history: m.lineStore.history(id) });
          return { status: 200, binary: bytes, type: 'application/zip', filename: `${id}.zip` };
        }
        if (method !== 'POST') return { status: 405, body: { error: `POST /api/lines/${id}/${action}` } };
        if (action === 'propose') {
          const request = String(body?.request ?? '').trim();
          if (!request) return { status: 400, body: { error: 'POST { request }: say what to change' } };
          await propose(m, id, request);
          return { status: 200, body: lineView(id) };
        }
        if (action === 'apply') {
          const p = getPending(id);
          if (!p?.factory) return { status: 409, body: { error: 'there is no checked patch to apply', ...lineView(id) } };
          const current = m.lineStore.load(id).version;
          if (p.baseVersion !== current) return { status: 409, body: { error: `the line changed since this patch was proposed (version ${p.baseVersion} → ${current}): propose it again`, ...lineView(id) } };
          const saved = m.lineStore.save(id, p.factory, { by: 'editor', message: p.summary || p.request, request: p.request });
          setPending(id, null);
          return { status: 200, body: { ...lineView(id), saved: { version: saved.version, compiled: saved.compiled } } };
        }
        if (action === 'discard') {
          const p = getPending(id);
          if (!p) return { status: 409, body: { error: 'there is no pending patch', ...lineView(id) } };
          const comment = String(body?.comment ?? '').trim();
          setPending(id, null);
          if (comment) await propose(m, id, p.request, comment);
          return { status: 200, body: lineView(id) };
        }
        if (action === 'critique') {
          const { factory, version } = m.lineStore.load(id);
          const brief = readJson(join(root, 'sdd', id, 'brief.json'));
          const kpis = readJson(join(root, 'simpy', m.lineFolder(id), 'kpis.json'));
          const r = await m.createCritic({ registry: m.registry, llm: llm() }).critique({ factory, brief, kpis });
          const { lineSummary, ...kept } = r;
          mkdirSync(dirname(critiqueFile(id)), { recursive: true });
          writeFileSync(critiqueFile(id), `${JSON.stringify({ ...kept, version, withBrief: Boolean(brief), withKpis: Boolean(kpis) })}
`);
          return { status: 200, body: lineView(id) };
        }
        if (action === 'undo') {
          const saved = m.lineStore.undo(id);
          setPending(id, null);
          return { status: 200, body: { ...lineView(id), saved: { version: saved.version, compiled: saved.compiled } } };
        }
        return { status: 404, body: { error: `no action "${action}"` } };
      } catch (error) {
        if (error?.constructor?.name === 'LineStoreError') return { status: 409, body: { error: error.message } };
        if (error?.constructor?.name === 'LlmError') return { status: 409, body: { error: error.message, code: error.code } };
        return { status: 500, body: { error: `the Editor failed: ${error.message}` } };
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return { handle };
}

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

/** The Vite dev-server plugin: mounts /api/lines (modules per request, as /api/builder). */
export function linesApi() {
  return {
    name: 'lines-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const load = async () => {
        const { registry } = await server.ssrLoadModule('/lib/components/index.js');
        await server.ssrLoadModule('/lib/products/index.js');
        await server.ssrLoadModule('/lib/ops/index.js');
        const { createEditor } = await server.ssrLoadModule('/agents/editor/editor.js');
        const { createCritic } = await server.ssrLoadModule('/agents/reviewer/critique.js');
        const { lineFolder } = await server.ssrLoadModule('/compiler/emit.js');
        const lineStore = await serverLineStore(server, registry);
        return { registry, createEditor, createCritic, lineStore, lineFolder };
      };
      const service = createLinesService({ root, load, llm: () => serverLlm(root, server.config.mode) });
      server.middlewares.use('/api/lines', async (req, res) => {
        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(body));
        };
        let body;
        if (req.method === 'POST') {
          try {
            const text = await readBody(req);
            body = text ? JSON.parse(text) : {};
          } catch (error) {
            send(400, { error: `the body is not JSON or too big: ${error.message}` });
            return;
          }
        }
        const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/';
        const out = await service.handle({ method: req.method, path, body });
        if (out.binary) {
          res.statusCode = out.status;
          res.setHeader('Content-Type', out.type);
          res.setHeader('Content-Disposition', `attachment; filename="${out.filename}"`);
          res.setHeader('Cache-Control', 'no-store');
          res.end(Buffer.from(out.binary));
          return;
        }
        send(out.status, out.body);
      });
    },
  };
}
