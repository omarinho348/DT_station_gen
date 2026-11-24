// /api/llm/status (Claude.md §7.5 "show the remaining budget in the UI", step 8.1): the LLM layer's
// state for the app. One LLM layer per dev-server start (that start is the budget session); later
// agent routes (Builder, Spec, Editor) take it from serverLlm().
//
//   GET /api/llm/status  →  { mode, keyFound, models, caps, spent, remaining, byAgent, calls, session }
//
// Never returns the key, only whether it is set. Settings come from .env through Vite's loadEnv.
import { loadEnv } from 'vite';
import { createLlm } from '../agents/llm.js';

let shared = null;

/** The dev server's LLM layer (created on first use from .env). */
export function serverLlm(root, mode = 'development') {
  shared ??= createLlm({ env: loadEnv(mode, root, ''), root });
  return shared;
}

/** Handles GET /api/llm/status. Returns { status, body }. */
export function handleLlmStatus(req, llm) {
  if (req.method !== 'GET') return { status: 405, body: { error: 'GET only' } };
  try {
    return { status: 200, body: llm().status() };
  } catch (error) {
    return { status: 500, body: { error: error.message } };
  }
}

/** The Vite dev-server plugin: mounts /api/llm/status. */
export function llmApi() {
  return {
    name: 'llm-api',
    apply: 'serve',
    configureServer(server) {
      const llm = () => serverLlm(server.config.root, server.config.mode);
      server.middlewares.use('/api/llm/status', (req, res) => {
        const out = handleLlmStatus(req, llm);
        res.statusCode = out.status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(out.body));
      });
    },
  };
}
