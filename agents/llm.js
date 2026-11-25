// The LLM layer (Claude.md §7.5): every model call of every agent goes through here.
//
//   const llm = createLlm({ env: process.env, root });
//   const { output, cost, source } = await llm.call({ agent: 'builder', schemaName: 'stationLayout',
//     schema, messages: [{ role: 'system', content: stable }, { role: 'user', content: variable }] });
//
// - Structured Outputs only: the model answers JSON that fits `schema` (strict), parsed here. Agents
//   never get free text back, and never send or receive code (rules 1 and 7).
// - Response cache: key = sha256(model, effort, max tokens, schema name, schema, messages). A cached
//   answer costs $0, so replaying a demo or a test never pays twice. Live answers go to
//   .agent-cache/responses/ (git-ignored); recorded fixtures for mock mode live in
//   agents/fixtures/responses/ (committed).
// - Mock mode (LLM_MODE=mock, the default): no network at all. Answers come from the fixtures or the
//   cache; a call nobody recorded is an error that names its key. All tests run like this.
// - Budget guard: before a live call, its worst case (the prompt's tokens at the input price plus
//   max_output_tokens at the output price) must fit under both the session cap and the total cap,
//   or the call is refused. After it, the real cost from `usage` (cached input at the cached price)
//   is written to the ledger .agent-cache/usage.json, which survives restarts.
// - Prompt caching: callers put the stable part first (constitution, catalog) and the variable part
//   last; OpenAI caches long shared prefixes by itself, and the ledger counts those tokens at the
//   cached price.
// - The key: read from env only, handed to the client, never written to the ledger, the cache, an
//   error message or the status (status says only whether it is there).
// Model names and prices come from env (.env), never from code (Claude.md §5).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class LlmError extends Error {
  constructor(message, { code = 'llm', key = null } = {}) {
    super(message);
    this.code = code; // 'budget' | 'mock' | 'config' | 'model' | 'llm'
    this.key = key;
  }
}

const num = (v, fallback = null) => {
  if (v === undefined || v === null || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * The LLM settings from env (.env names). Throws LlmError (code 'config') when live mode lacks
 * something it needs; mock mode needs nothing but still reports what is set.
 */
export function llmConfig(env = {}) {
  const mode = (env.LLM_MODE || 'mock').toLowerCase();
  if (!['mock', 'live'].includes(mode)) throw new LlmError(`LLM_MODE must be mock or live, not "${env.LLM_MODE}"`, { code: 'config' });
  const model = (kind) => ({
    name: env[`LLM_MODEL_${kind}`] || null,
    price: {
      input: num(env[`LLM_PRICE_${kind}_INPUT`]),
      cachedInput: num(env[`LLM_PRICE_${kind}_CACHED_INPUT`]),
      output: num(env[`LLM_PRICE_${kind}_OUTPUT`]),
    },
  });
  const config = {
    mode,
    keyFound: Boolean(env.OPENAI_API_KEY),
    models: { default: model('DEFAULT'), strong: model('STRONG') },
    strongEnabled: String(env.LLM_STRONG_ENABLED).toLowerCase() === 'true',
    // Agents that always use the strong model (the owner's choice, e.g. "builder"; step 12.2).
    strongAgents: String(env.LLM_STRONG_AGENTS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    caps: { session: num(env.LLM_BUDGET_SESSION, 0.5), total: num(env.LLM_BUDGET_TOTAL, 4.5) },
    effort: env.LLM_REASONING_EFFORT || 'low',
    maxOutputTokens: num(env.LLM_MAX_OUTPUT_TOKENS, 4000),
  };
  if (mode === 'live') {
    const missing = [];
    if (!config.keyFound) missing.push('OPENAI_API_KEY');
    const d = config.models.default;
    if (!d.name) missing.push('LLM_MODEL_DEFAULT');
    for (const [k, v] of Object.entries(d.price)) if (v === null) missing.push(`LLM_PRICE_DEFAULT_${k === 'cachedInput' ? 'CACHED_INPUT' : k.toUpperCase()}`);
    if (config.strongAgents.length || config.strongEnabled) {
      const s = config.models.strong;
      if (!s.name) missing.push('LLM_MODEL_STRONG');
      for (const [k, v] of Object.entries(s.price)) if (v === null) missing.push(`LLM_PRICE_STRONG_${k === 'cachedInput' ? 'CACHED_INPUT' : k.toUpperCase()}`);
    }
    if (missing.length) throw new LlmError(`live mode needs ${missing.join(', ')} in .env`, { code: 'config' });
  }
  return config;
}

/** A conservative token count for text (about 3 characters per token; real counts are lower). */
export const estimateTokens = (text) => Math.ceil(String(text).length / 3);

/** Cost in USD of a call's usage at a model's prices (per 1M tokens). */
export function costOf(usage, price) {
  const cached = usage.cachedInputTokens ?? 0;
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - cached);
  return (fresh * price.input + cached * price.cachedInput + (usage.outputTokens ?? 0) * price.output) / 1e6;
}

/** The cache key of a call: everything that decides its answer. */
export function cacheKey({ model, effort, maxOutputTokens, schemaName, schema, messages }) {
  return createHash('sha256').update(JSON.stringify({ model, effort, maxOutputTokens, schemaName, schema, messages })).digest('hex');
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/**
 * @param {object} o
 * @param {object} o.env        .env values (process.env or Vite's loadEnv)
 * @param {string} o.root       the project root (.agent-cache/ and agents/fixtures/ live under it)
 * @param {string} [o.session]  this session's id (default: the time it started)
 * @param {object} [o.client]   an OpenAI-like client ({ responses: { create } }); default: the SDK's, live mode only
 * @param {Function} [o.now]    () → ISO time (tests)
 */
export function createLlm({ env, root, session = null, client = null, now = () => new Date().toISOString() }) {
  const config = llmConfig(env);
  const apiKey = env.OPENAI_API_KEY || '';
  const sessionId = session ?? now();
  const cacheDir = join(root, '.agent-cache', 'responses');
  const fixtureDir = join(root, 'agents', 'fixtures', 'responses');
  const ledgerPath = join(root, '.agent-cache', 'usage.json');
  const counts = { live: 0, cached: 0, mock: 0, refused: 0 };
  let sdk = client;

  const hide = (text) => (apiKey ? String(text).split(apiKey).join('***') : String(text));

  const readLedger = () => {
    if (!existsSync(ledgerPath)) return { total: 0, sessions: {}, calls: [] };
    return JSON.parse(readFileSync(ledgerPath, 'utf8'));
  };
  const writeJson = (path, data) => {
    mkdirSync(join(path, '..'), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, path);
  };
  const spent = () => {
    const l = readLedger();
    return { session: l.sessions[sessionId] ?? 0, total: l.total };
  };
  const readCached = (key) => {
    for (const dir of [fixtureDir, cacheDir]) {
      const path = join(dir, `${key}.json`);
      if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
    }
    return null;
  };

  async function liveClient() {
    if (!sdk) {
      const { default: OpenAI } = await import('openai');
      sdk = new OpenAI({ apiKey });
    }
    return sdk;
  }

  /**
   * One structured call. Returns { output, cost, source: 'live' | 'cache' | 'mock', key, usage? }.
   * @param {object} o
   * @param {string} o.agent        who calls (spec, builder, reviewer, editor): for the ledger
   * @param {string} o.schemaName   the answer's name (a-z, A-Z, 0-9, _ -; up to 64)
   * @param {object} o.schema       its JSON Schema (strict Structured Outputs)
   * @param {object[]} o.messages   [{ role: 'system' | 'user' | 'assistant', content }], stable part first
   * @param {'default'|'strong'} [o.model]  strong only if enabled (else default)
   */
  async function call(req) {
    // An answer cut off at the output limit (reasoning took it) is asked once more with twice the limit
    // (benchmark tuning set, step 12.2); the budget guard checks the larger worst case.
    try {
      return await callWith(req, config.maxOutputTokens);
    } catch (error) {
      if (error.code !== 'truncated') throw error;
      return callWith(req, config.maxOutputTokens * 2);
    }
  }

  async function callWith({ agent, schemaName, schema, messages, model: kind = 'default' }, maxOutputTokens) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(schemaName ?? '')) throw new LlmError(`schemaName "${schemaName}" must be 1–64 of a-z, A-Z, 0-9, _ or -`, { code: 'config' });
    const strong = (kind === 'strong' && config.strongEnabled) || config.strongAgents.includes(agent);
    const use = strong && config.models.strong.name ? config.models.strong : config.models.default;
    const request = { model: use.name, effort: config.effort, maxOutputTokens, schemaName, schema, messages };
    const key = cacheKey(request);

    // A cut-off answer is never cached, so a recorded one for twice the limit stands in for it.
    const longer = maxOutputTokens === config.maxOutputTokens ? cacheKey({ ...request, maxOutputTokens: maxOutputTokens * 2 }) : null;
    const found = readCached(key) ? { hit: readCached(key), key } : longer && readCached(longer) ? { hit: readCached(longer), key: longer } : null;
    if (found) {
      counts[config.mode === 'mock' ? 'mock' : 'cached'] += 1;
      return { output: found.hit.output, cost: 0, source: config.mode === 'mock' ? 'mock' : 'cache', key: found.key };
    }
    if (config.mode === 'mock') {
      counts.refused += 1;
      throw new LlmError(`mock mode: no recorded answer for this ${agent} call (${schemaName}, key ${key.slice(0, 12)})`, { code: 'mock', key });
    }

    // Budget guard: the worst case must fit under both caps.
    const prompt = messages.map((m) => m.content).join('\n') + JSON.stringify(schema);
    const worst = (estimateTokens(prompt) * use.price.input + maxOutputTokens * use.price.output) / 1e6;
    const before = spent();
    for (const cap of ['session', 'total']) {
      if (before[cap] + worst > config.caps[cap] + 1e-12) {
        counts.refused += 1;
        throw new LlmError(`budget: this call could cost up to $${worst.toFixed(4)}, and $${before[cap].toFixed(4)} of the $${config.caps[cap].toFixed(2)} ${cap} cap is spent`, { code: 'budget', key });
      }
    }

    let response;
    try {
      const openai = await liveClient();
      response = await openai.responses.create({
        model: use.name,
        input: messages,
        text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
        reasoning: { effort: config.effort },
        max_output_tokens: maxOutputTokens,
        store: false,
      });
    } catch (error) {
      throw new LlmError(`the model call failed: ${hide(error.message)}`, { code: 'model', key });
    }
    const u = response.usage ?? {};
    const usage = { inputTokens: u.input_tokens ?? 0, cachedInputTokens: u.input_tokens_details?.cached_tokens ?? 0, outputTokens: u.output_tokens ?? 0 };
    const cost = costOf(usage, use.price);
    // Paid for, whatever comes next: into the ledger first.
    const ledger = readLedger();
    ledger.total = round6(ledger.total + cost);
    ledger.sessions[sessionId] = round6((ledger.sessions[sessionId] ?? 0) + cost);
    ledger.calls.push({ time: now(), session: sessionId, agent, model: use.name, schemaName, ...usage, cost: round6(cost), key });
    writeJson(ledgerPath, ledger);
    counts.live += 1;

    if (response.status && response.status !== 'completed') {
      const reason = response.incomplete_details?.reason;
      throw new LlmError(`the model stopped early (${response.status}${reason ? `: ${reason}` : ''}); raise LLM_MAX_OUTPUT_TOKENS or shorten the request`, { code: reason === 'max_output_tokens' && maxOutputTokens === config.maxOutputTokens ? 'truncated' : 'model', key });
    }
    let output;
    try {
      output = JSON.parse(response.output_text);
    } catch (error) {
      throw new LlmError(`the model's answer is not JSON: ${error.message}`, { code: 'model', key });
    }
    writeJson(join(cacheDir, `${key}.json`), { key, model: use.name, agent, schemaName, recordedAt: now(), usage, output });
    return { output, cost, source: 'live', key, usage };
  }

  /** What the UI shows: mode, whether the key is there (never the key), models, caps, spent, remaining, calls. */
  function status() {
    const s = spent();
    const byAgent = {};
    for (const c of readLedger().calls) byAgent[c.agent] = round6((byAgent[c.agent] ?? 0) + c.cost);
    return {
      byAgent,
      mode: config.mode,
      keyFound: config.keyFound,
      models: { default: config.models.default.name, strong: config.models.strong.name, strongEnabled: config.strongEnabled, strongAgents: config.strongAgents },
      caps: config.caps,
      spent: { session: round6(s.session), total: round6(s.total) },
      remaining: { session: round6(Math.max(0, config.caps.session - s.session)), total: round6(Math.max(0, config.caps.total - s.total)) },
      calls: { ...counts },
      session: sessionId,
    };
  }

  /** Copies a cached live answer into the committed fixtures, so mock mode can replay it (step 8.6). */
  function record(key) {
    const path = join(cacheDir, `${key}.json`);
    if (!existsSync(path)) throw new LlmError(`no cached answer with key ${key.slice(0, 12)} to record`, { code: 'mock', key });
    writeJson(join(fixtureDir, `${key}.json`), JSON.parse(readFileSync(path, 'utf8')));
  }

  return { call, status, record, config: Object.freeze({ ...config }) };
}
