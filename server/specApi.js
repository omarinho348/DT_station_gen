// /api/spec (Phase 9 step 3): the Spec agent and the three SDD documents from the setup page.
//
//   GET  /api/spec              { session: view, templates: [{ name, title, text }] }
//   POST /api/spec/message      { text, source: chat | guided | template | upload }  → the brief (re)drafted
//   POST /api/spec/approve      { doc: constitution | brief | plan }  (approving the brief drafts the plan)
//   POST /api/spec/reject       { doc: brief | plan, comment }        → redrafted with the comment
//   POST /api/spec/retry        draft again what an error left missing
//   POST /api/spec/reset        start over (approved documents already written stay in sdd/)
//
// Answers { session } (200); 409 when the step can't be done now or the LLM layer refused ({ error, code });
// 400 for a bad request. One request at a time. The session is kept in .agent-cache/spec/session.json;
// approved documents are written to sdd/<line id>/ (constitution.md, factory-brief.md, plan.md and the
// brief and plan as JSON, which the Builder's job is made from).
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { serverLlm } from './llmApi.js';

const MAX_BODY = 512 * 1024;
const LINE_ID = /^[a-z][a-zA-Z0-9]*$/;

/** The brief templates (spec/sdd/templates/*.md): name, title (its first heading), text. */
export function readTemplates(root) {
  const dir = join(root, 'spec', 'sdd', 'templates');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => {
    const text = readFileSync(join(dir, n), 'utf8');
    return { name: n.replace(/\.md$/, ''), title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? n, text };
  });
}

/**
 * @param {object} env
 * @param {string} env.root
 * @param {() => Promise<{ registry, createSpec, createSpecSession, SpecSessionError }>} env.load
 * @param {() => object} env.llm
 */
export function createSpecService({ root, load, llm }) {
  const file = join(root, '.agent-cache', 'spec', 'session.json');
  let session = null;
  let queue = Promise.resolve();

  const save = (state) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(state)}\n`);
  };
  const saveDocs = (lineId, files) => {
    if (!LINE_ID.test(lineId)) throw new Error(`not a line id: "${lineId}"`);
    const dir = join(root, 'sdd', lineId);
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  };

  async function ensure(m) {
    if (session) return session;
    let state = null;
    if (existsSync(file)) {
      try { state = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { console.warn(`[spec] the saved session could not be read: ${error.message}`); }
    }
    session = m.createSpecSession({ spec: m.createSpec({ registry: m.registry, llm: llm() }), saveDocs, save, state });
    return session;
  }

  async function handle({ method, path, body }) {
    const run = async () => {
      const m = await load();
      const s = await ensure(m);
      const ok = () => ({ status: 200, body: { session: s.view() } });
      try {
        if (path === '/' || path === '') {
          if (method !== 'GET') return { status: 405, body: { error: 'GET /api/spec' } };
          return { status: 200, body: { session: s.view(), templates: readTemplates(root) } };
        }
        if (method !== 'POST') return { status: 405, body: { error: `POST /api/spec${path}` } };
        if (path === '/message') {
          if (typeof body?.text !== 'string') return { status: 400, body: { error: 'POST { text, source }' } };
          await s.message(body.text, body.source ?? 'chat');
          return ok();
        }
        if (path === '/approve') { await s.approve(body?.doc); return ok(); }
        if (path === '/reject') { await s.reject(body?.doc, body?.comment); return ok(); }
        if (path === '/retry') { await s.retry(); return ok(); }
        if (path === '/reset') {
          rmSync(file, { force: true });
          session = null;
          return { status: 200, body: { session: (await ensure(m)).view() } };
        }
        return { status: 404, body: { error: `no route /api/spec${path}` } };
      } catch (error) {
        if (error instanceof m.SpecSessionError) return { status: 409, body: { error: error.message, session: s.view() } };
        // By name: the LLM layer is loaded natively (server/llmApi.js), not through the SSR graph.
        if (error?.constructor?.name === 'LlmError') return { status: 409, body: { error: error.message, code: error.code, session: s.view() } };
        return { status: 500, body: { error: `the Spec agent failed: ${error.message}`, session: s.view() } };
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

/** The Vite dev-server plugin: mounts /api/spec (modules per request, as /api/builder). */
export function specApi() {
  return {
    name: 'spec-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      const load = async () => {
        const { registry } = await server.ssrLoadModule('/lib/components/index.js');
        await server.ssrLoadModule('/lib/products/index.js');
        await server.ssrLoadModule('/lib/ops/index.js');
        const { createSpec } = await server.ssrLoadModule('/agents/spec/spec.js');
        const { createSpecSession, SpecSessionError } = await server.ssrLoadModule('/agents/spec/session.js');
        return { registry, createSpec, createSpecSession, SpecSessionError };
      };
      const service = createSpecService({ root, load, llm: () => serverLlm(root, server.config.mode) });
      server.middlewares.use('/api/spec', async (req, res) => {
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
        send(out.status, out.body);
      });
    },
  };
}
