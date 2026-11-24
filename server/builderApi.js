// /api/builder (step 8.5): the Builder run one approval gate at a time from the twin page.
//
//   GET  /api/builder              { session: view | null, rehearsals: [names] }
//   POST /api/builder/start        { rehearsal: 'bottling' }  a scripted run of an example line ($0), or
//                                  { line, product, plan }    a real run through the LLM layer
//                                  → builds the first gate's draft
//   POST /api/builder/approve      accept the draft, then build the next one (until the plan is done)
//   POST /api/builder/reject       { comment } → back to that phase with the comment, rebuilt
//   POST /api/builder/next         build the next draft (after an error, or a restart)
//   POST /api/builder/reset        forget the session
//
// Answers { session } (200). 409 when the step can't be done now (no draft, a draft waiting, the plan
// done) or the LLM layer refused (budget, mock mode without a recording: { error, code }); 400 for a bad
// request. One request at a time (each may build and play the line). The session is kept in
// .agent-cache/builder/session.json, so it survives a dev-server restart.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { serverLlm } from './llmApi.js';

const MAX_BODY = 1024 * 1024;
const KEEP_REVS = 6;

/**
 * @param {object} env
 * @param {string} env.root
 * @param {() => Promise<{ registry, createBuilder, createBuildSession, loadRehearsal, REHEARSALS, SessionError, LlmError, RehearsalError }>} env.load
 * @param {() => object} env.llm   the dev server's LLM layer
 */
export function createBuilderService({ root, load, llm }) {
  const file = join(root, '.agent-cache', 'builder', 'session.json');
  let session = null;
  let meta = null; // { kind: 'rehearsal' | 'llm', name? , tag }
  let restored = false;
  let queue = Promise.resolve();

  const saveFile = (state) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ meta, state })}\n`);
    // The approved line so far, next to its drafts: generated/_draft/<line>/approved.factory.json.
    const folder = state.approvedUrl?.match(/^\/generated\/_draft\/([\w-]+)\//)?.[1];
    if (folder) writeFileSync(join(root, 'generated', '_draft', folder, 'approved.factory.json'), `${JSON.stringify(state.base, null, 2)}\n`);
  };

  /** Draft writer: every revision in its own folder (r<tag>-<n>), older ones pruned. */
  const draftWriter = (builder, tag) => (factory, rev) => {
    const out = builder.writeDraft(factory, { rev: `${tag}-${rev}` });
    const parent = dirname(out.dir);
    const keep = new Set([`r${tag}-${rev}`]);
    for (let k = rev - 1; k > rev - KEEP_REVS && k > 0; k -= 1) keep.add(`r${tag}-${k}`);
    const approved = session?.state().approvedUrl?.match(/\/(r[^/]+)\/line\.js$/)?.[1];
    if (approved) keep.add(approved);
    for (const name of readdirSync(parent)) if (/^r[a-z0-9]+-\d+$/.test(name) && !keep.has(name)) rmSync(join(parent, name), { recursive: true, force: true });
    return out;
  };

  async function make({ kind, name = null, job = null, plan = null, tag, state = null }) {
    const m = await load();
    let llmLayer;
    let source;
    if (kind === 'rehearsal') {
      const r = m.loadRehearsal(m.registry, name, { root });
      llmLayer = r.llm;
      job = r.job;
      plan = r.plan;
      source = { kind, name, title: r.title, about: r.about };
    } else {
      llmLayer = llm();
      source = { kind: 'llm', mode: llmLayer.config?.mode ?? null };
    }
    const builder = m.createBuilder({ registry: m.registry, llm: llmLayer, root });
    meta = { kind, name, tag, ...(kind === 'llm' ? { job, plan } : {}) };
    session = m.createBuildSession({ builder, job, plan, source, writeDraft: draftWriter(builder, tag), save: saveFile, state });
    return session;
  }

  async function restore() {
    if (restored) return;
    restored = true;
    if (!existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      await make({ ...saved.meta, state: saved.state });
    } catch (error) {
      console.warn(`[builder] the saved session could not be restored: ${error.message}`);
      session = null;
    }
  }

  /** Handles one request: { method, path ('/', '/start', …), body (parsed JSON or undefined) }. */
  async function handle({ method, path, body }) {
    const run = async () => {
      await restore();
      const m = await load();
      const ok = () => ({ status: 200, body: { session: session?.view() ?? null } });
      try {
        if (path === '/' || path === '') {
          if (method !== 'GET') return { status: 405, body: { error: 'GET /api/builder' } };
          return { status: 200, body: { session: session?.view() ?? null, rehearsals: m.REHEARSALS } };
        }
        if (method !== 'POST') return { status: 405, body: { error: `POST /api/builder${path}` } };
        if (path === '/start') {
          const tag = Date.now().toString(36);
          if (body?.rehearsal) {
            if (!m.REHEARSALS.includes(body.rehearsal)) return { status: 400, body: { error: `no rehearsal "${body.rehearsal}" (there are: ${m.REHEARSALS.join(', ')})` } };
            await make({ kind: 'rehearsal', name: body.rehearsal, tag });
          } else if (body?.line && body?.product && Array.isArray(body?.plan) && body.plan.length) {
            if (!body.line.transport?.type) return { status: 400, body: { error: 'line.transport.type is needed (the catalog conveyor between stations)' } };
            await make({ kind: 'llm', job: { line: body.line, product: body.product }, plan: body.plan, tag });
          } else {
            return { status: 400, body: { error: 'POST { rehearsal } or { line, product, plan: [...] }' } };
          }
          await session.next();
          return ok();
        }
        if (!session) return { status: 409, body: { error: 'no build session: POST /api/builder/start first' } };
        if (path === '/next') { await session.next(); return ok(); }
        if (path === '/approve') {
          session.approve();
          if (!session.view().finished) await session.next();
          return ok();
        }
        if (path === '/reject') {
          session.reject(body?.comment);
          await session.next();
          return ok();
        }
        if (path === '/reset') {
          session = null;
          meta = null;
          rmSync(file, { force: true });
          return ok();
        }
        return { status: 404, body: { error: `no route /api/builder${path}` } };
      } catch (error) {
        if (error instanceof m.SessionError || error instanceof m.RehearsalError) return { status: 409, body: { error: error.message, session: session?.view() ?? null } };
        // By name: the LLM layer is loaded natively (server/llmApi.js), not through the SSR graph.
        if (error instanceof m.LlmError || error?.constructor?.name === 'LlmError') return { status: 409, body: { error: error.message, code: error.code, session: session?.view() ?? null } };
        return { status: 500, body: { error: `the builder failed: ${error.message}`, session: session?.view() ?? null } };
      }
    };
    const result = queue.then(run, run);
    queue = result.catch(() => {});
    return result;
  }

  return { handle, current: () => session };
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

/** The Vite dev-server plugin: mounts /api/builder. Modules load through the SSR graph (as /api/review). */
export function builderApi() {
  return {
    name: 'builder-api',
    apply: 'serve',
    configureServer(server) {
      const root = server.config.root;
      // Modules are asked for on every request: Vite's SSR graph returns them from its cache, or fresh
      // after an edit (a memoised copy kept serving stale agent code until a restart). The GLB models
      // load once per registry.
      let assetsFor = null;
      const load = () => (async () => {
          const { registry } = await server.ssrLoadModule('/lib/components/index.js');
          await server.ssrLoadModule('/lib/products/index.js');
          await server.ssrLoadModule('/lib/ops/index.js');
          if (assetsFor !== registry) {
            const { preloadComponentAssets } = await server.ssrLoadModule('/lib/core/assets.js');
            await preloadComponentAssets(registry);
            assetsFor = registry;
          }
          const { createBuilder } = await server.ssrLoadModule('/agents/builder/builder.js');
          const { createBuildSession, SessionError } = await server.ssrLoadModule('/agents/builder/session.js');
          const { loadRehearsal, REHEARSALS, RehearsalError } = await server.ssrLoadModule('/agents/builder/rehearsal.js');
          const { LlmError } = await server.ssrLoadModule('/agents/llm.js');
          return { registry, createBuilder, createBuildSession, SessionError, loadRehearsal, REHEARSALS, RehearsalError, LlmError };
        })();
      const service = createBuilderService({ root, load, llm: () => serverLlm(root, server.config.mode) });
      server.middlewares.use('/api/builder', async (req, res) => {
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
            send(400, { error: `the body is not JSON: ${error.message}` });
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
