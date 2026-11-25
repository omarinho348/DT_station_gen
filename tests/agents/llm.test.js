// The LLM layer (agents/llm.js, Phase 8 step 1): budget guard, response cache, mock mode, ledger.
// No network anywhere: live mode runs against a fake client, in a temporary project root.
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLlm, llmConfig, costOf, cacheKey, estimateTokens, LlmError } from '../../agents/llm.js';
import { handleLlmStatus } from '../../server/llmApi.js';

const KEY = 'sk-test-0123456789abcdef';
const LIVE = {
  LLM_MODE: 'live', OPENAI_API_KEY: KEY,
  LLM_MODEL_DEFAULT: 'small-model', LLM_PRICE_DEFAULT_INPUT: '0.20', LLM_PRICE_DEFAULT_CACHED_INPUT: '0.02', LLM_PRICE_DEFAULT_OUTPUT: '1.25',
  LLM_MODEL_STRONG: 'big-model', LLM_PRICE_STRONG_INPUT: '0.75', LLM_PRICE_STRONG_CACHED_INPUT: '0.075', LLM_PRICE_STRONG_OUTPUT: '4.50',
  LLM_STRONG_ENABLED: 'false', LLM_BUDGET_SESSION: '0.50', LLM_BUDGET_TOTAL: '4.50',
};
const schema = { type: 'object', properties: { stations: { type: 'integer' } }, required: ['stations'], additionalProperties: false };
const messages = [{ role: 'system', content: 'constitution + catalog' }, { role: 'user', content: 'how many stations?' }];
const ask = (llm, extra = {}) => llm.call({ agent: 'builder', schemaName: 'count', schema, messages, ...extra });

/** A fake OpenAI client: records requests, answers with `answer` and `usage`. */
function fakeClient({ answer = { stations: 6 }, usage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 400 }, output_tokens: 200 }, status = 'completed', fail = null } = {}) {
  const requests = [];
  return {
    requests,
    responses: {
      create: async (req) => {
        requests.push(req);
        if (fail) throw new Error(fail);
        return { status, incomplete_details: status === 'incomplete' ? { reason: 'max_output_tokens' } : null, output_text: JSON.stringify(answer), usage };
      },
    },
  };
}

let root;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'llm-test-')); });

describe('config and prices', () => {
  it('mock by default; live needs the key, a default model and its prices, and says which are missing', () => {
    const c = llmConfig({});
    expect(c).toMatchObject({ mode: 'mock', keyFound: false, caps: { session: 0.5, total: 4.5 }, effort: 'low', maxOutputTokens: 4000 });
    expect(() => llmConfig({ LLM_MODE: 'live' })).toThrow(/live mode needs OPENAI_API_KEY, LLM_MODEL_DEFAULT, LLM_PRICE_DEFAULT_INPUT, LLM_PRICE_DEFAULT_CACHED_INPUT, LLM_PRICE_DEFAULT_OUTPUT in \.env/);
    expect(() => llmConfig({ LLM_MODE: 'turbo' })).toThrow(/LLM_MODE must be mock or live/);
    expect(llmConfig(LIVE).models.default).toEqual({ name: 'small-model', price: { input: 0.2, cachedInput: 0.02, output: 1.25 } });
  });

  it('cost: fresh input, cached input and output at their prices (per 1M tokens)', () => {
    const price = { input: 0.2, cachedInput: 0.02, output: 1.25 };
    expect(costOf({ inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200 }, price)).toBeCloseTo((600 * 0.2 + 400 * 0.02 + 200 * 1.25) / 1e6, 12);
    expect(estimateTokens('x'.repeat(300))).toBe(100);
    expect(cacheKey({ model: 'a', messages: [1] })).not.toBe(cacheKey({ model: 'b', messages: [1] }));
  });
});

describe('mock mode', () => {
  it('never calls out: an unrecorded call is an error naming its key; a recorded one is free', async () => {
    const client = fakeClient();
    const llm = createLlm({ env: { ...LIVE, LLM_MODE: 'mock' }, root, client });
    const missing = await ask(llm).catch((e) => e);
    expect(missing).toBeInstanceOf(LlmError);
    expect(missing.code).toBe('mock');
    expect(missing.message).toMatch(/^mock mode: no recorded answer for this builder call \(count, key [0-9a-f]{12}\)$/);
    mkdirSync(join(root, 'agents/fixtures/responses'), { recursive: true });
    writeFileSync(join(root, 'agents/fixtures/responses', `${missing.key}.json`), JSON.stringify({ output: { stations: 4 } }));
    expect(await ask(llm)).toEqual({ output: { stations: 4 }, cost: 0, source: 'mock', key: missing.key });
    expect(client.requests).toEqual([]);
    expect(llm.status().calls).toMatchObject({ mock: 1, refused: 1, live: 0 });
  });
});

describe('live mode (fake client)', () => {
  it('a call: Structured Outputs request, parsed answer, cost from usage in the ledger, answer cached; the same call again is free', async () => {
    const client = fakeClient();
    const llm = createLlm({ env: LIVE, root, client, session: 's1' });
    const r = await ask(llm);
    expect(r.output).toEqual({ stations: 6 });
    expect(r.source).toBe('live');
    const cost = (600 * 0.2 + 400 * 0.02 + 200 * 1.25) / 1e6;
    expect(r.cost).toBeCloseTo(cost, 12);
    expect(client.requests[0]).toMatchObject({
      model: 'small-model', input: messages, max_output_tokens: 4000, reasoning: { effort: 'low' }, store: false,
      text: { format: { type: 'json_schema', name: 'count', schema, strict: true } },
    });
    const ledger = JSON.parse(readFileSync(join(root, '.agent-cache/usage.json'), 'utf8'));
    expect(ledger.total).toBeCloseTo(cost, 6);
    expect(ledger.sessions.s1).toBeCloseTo(cost, 6);
    expect(ledger.calls[0]).toMatchObject({ session: 's1', agent: 'builder', model: 'small-model', schemaName: 'count', inputTokens: 1000, cachedInputTokens: 400, outputTokens: 200 });
    const again = await ask(llm);
    expect(again).toMatchObject({ output: { stations: 6 }, cost: 0, source: 'cache' });
    expect(client.requests).toHaveLength(1);
    expect(llm.status()).toMatchObject({ calls: { live: 1, cached: 1 }, byAgent: { builder: expect.any(Number) } });
  });

  it('the ledger outlives the process: a new session starts at $0 but the total carries on', async () => {
    await ask(createLlm({ env: LIVE, root, client: fakeClient(), session: 's1' }));
    const later = createLlm({ env: LIVE, root, client: fakeClient({ answer: { stations: 7 } }), session: 's2' });
    await later.call({ agent: 'spec', schemaName: 'count', schema, messages: [{ role: 'user', content: 'another question' }] });
    const s = later.status();
    expect(s.spent.session).toBeCloseTo(s.spent.total / 2, 6);
    expect(s.remaining.total).toBeCloseTo(4.5 - s.spent.total, 6);
    expect(Object.keys(s.byAgent).sort()).toEqual(['builder', 'spec']);
  });

  it('budget guard: a call whose worst case does not fit under a cap is refused before it is sent', async () => {
    const client = fakeClient();
    // Worst case: 4000 output tokens at $1.25 per 1M = $0.005, plus the prompt.
    const tight = createLlm({ env: { ...LIVE, LLM_BUDGET_SESSION: '0.004' }, root, client });
    const e = await ask(tight).catch((x) => x);
    expect(e.code).toBe('budget');
    expect(e.message).toMatch(/^budget: this call could cost up to \$0\.0050, and \$0\.0000 of the \$0\.00 session cap is spent$/);
    expect(client.requests).toEqual([]);
    // Total cap: spent so far counts.
    mkdirSync(join(root, '.agent-cache'), { recursive: true });
    writeFileSync(join(root, '.agent-cache/usage.json'), JSON.stringify({ total: 4.498, sessions: {}, calls: [] }));
    const nearly = createLlm({ env: LIVE, root, client });
    expect((await ask(nearly).catch((x) => x)).message).toMatch(/\$4\.4980 of the \$4\.50 total cap is spent/);
    expect(client.requests).toEqual([]);
    expect(nearly.status().remaining.total).toBeCloseTo(0.002, 6);
  });

  it('the strong model only when enabled; otherwise the default', async () => {
    const client = fakeClient();
    await ask(createLlm({ env: LIVE, root, client }), { model: 'strong' });
    await ask(createLlm({ env: { ...LIVE, LLM_STRONG_ENABLED: 'true' }, root, client }), { model: 'strong' });
    expect(client.requests.map((r) => r.model)).toEqual(['small-model', 'big-model']);
  });

  it('LLM_STRONG_AGENTS: those agents always on the strong model (priced as it), the others not; its prices are required', async () => {
    const client = fakeClient();
    const llm = createLlm({ env: { ...LIVE, LLM_STRONG_AGENTS: 'builder' }, root, client });
    await ask(llm); // agent builder
    await ask(llm, { agent: 'spec', model: 'strong' }); // strong asked, but not enabled and not listed
    expect(client.requests.map((r) => r.model)).toEqual(['big-model', 'small-model']);
    const ledger = JSON.parse(readFileSync(join(root, '.agent-cache/usage.json'), 'utf8'));
    expect(ledger.calls[0]).toMatchObject({ model: 'big-model', cost: (600 * 0.75 + 400 * 0.075 + 200 * 4.5) / 1e6 });
    expect(llm.status().models.strongAgents).toEqual(['builder']);
    expect(() => llmConfig({ ...LIVE, LLM_STRONG_AGENTS: 'builder', LLM_PRICE_STRONG_OUTPUT: '' })).toThrow(/LLM_PRICE_STRONG_OUTPUT/);
  });

  it('a cut-off answer is an error, but what it cost is still in the ledger; a bad schema name is refused', async () => {
    const llm = createLlm({ env: LIVE, root, client: fakeClient({ status: 'incomplete' }) });
    const e = await ask(llm).catch((x) => x);
    expect(e.message).toMatch(/the model stopped early \(incomplete: max_output_tokens\); raise LLM_MAX_OUTPUT_TOKENS/);
    expect(llm.status().spent.total).toBeGreaterThan(0);
    expect(existsSync(join(root, '.agent-cache/responses'))).toBe(false); // not cached
    await expect(ask(llm, { schemaName: 'has space' })).rejects.toThrow(/schemaName "has space" must be/);
  });

  it('cut off once: asked again with twice the output limit, both paid calls in the ledger; mock mode replays the longer answer', async () => {
    let n = 0;
    const requests = [];
    const client = { responses: { create: async (req) => {
      requests.push(req);
      n += 1;
      return { status: n === 1 ? 'incomplete' : 'completed', incomplete_details: n === 1 ? { reason: 'max_output_tokens' } : null, output_text: JSON.stringify({ stations: 4 }), usage: { input_tokens: 1000, output_tokens: n === 1 ? 4000 : 5000 } };
    } } };
    const llm = createLlm({ env: LIVE, root, client });
    const r = await ask(llm);
    expect(r.output).toEqual({ stations: 4 });
    expect(requests.map((q) => q.max_output_tokens)).toEqual([4000, 8000]);
    const ledger = JSON.parse(readFileSync(join(root, '.agent-cache/usage.json'), 'utf8'));
    expect(ledger.calls.map((c) => c.outputTokens)).toEqual([4000, 5000]);
    // Recorded, then replayed in mock mode from the normal request (the longer answer stands in).
    llm.record(r.key);
    const mock = createLlm({ env: { LLM_MODE: 'mock' , LLM_MODEL_DEFAULT: 'small-model' }, root });
    expect((await ask(mock)).output).toEqual({ stations: 4 });
  });

  it('the key never leaves: not in errors, the ledger, the cache or the status', async () => {
    const failing = createLlm({ env: LIVE, root, client: fakeClient({ fail: `401 Incorrect API key provided: ${KEY}` }) });
    const e = await ask(failing).catch((x) => x);
    expect(e.message).toBe('the model call failed: 401 Incorrect API key provided: ***');
    const llm = createLlm({ env: LIVE, root, client: fakeClient() });
    await ask(llm);
    const files = [join(root, '.agent-cache/usage.json'), ...readdirSync(join(root, '.agent-cache/responses')).map((n) => join(root, '.agent-cache/responses', n))];
    for (const f of files) expect(readFileSync(f, 'utf8')).not.toContain(KEY);
    expect(JSON.stringify(llm.status())).not.toContain(KEY);
    expect(llm.status().keyFound).toBe(true);
  });

  it('record: a cached live answer becomes a committed fixture that mock mode replays', async () => {
    const r = await ask(createLlm({ env: LIVE, root, client: fakeClient() }));
    const live = createLlm({ env: LIVE, root, client: fakeClient() });
    live.record(r.key);
    // Mock mode, cache gone: the fixture answers.
    const mock = createLlm({ env: { ...LIVE, LLM_MODE: 'mock' }, root: root, client: fakeClient() });
    expect(await ask(mock)).toMatchObject({ output: { stations: 6 }, source: 'mock' });
    expect(() => live.record('f'.repeat(64))).toThrow(/no cached answer with key ffffffffffff/);
  });
});

describe('/api/llm/status', () => {
  it('GET gives the status (never the key); other methods 405; a broken config 500 with the reason', () => {
    const llm = createLlm({ env: LIVE, root, client: fakeClient() });
    const ok = handleLlmStatus({ method: 'GET' }, () => llm);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ mode: 'live', keyFound: true, models: { default: 'small-model' }, caps: { session: 0.5, total: 4.5 }, remaining: { total: 4.5 } });
    expect(JSON.stringify(ok.body)).not.toContain(KEY);
    expect(handleLlmStatus({ method: 'POST' }, () => llm).status).toBe(405);
    expect(handleLlmStatus({ method: 'GET' }, () => createLlm({ env: { LLM_MODE: 'live' }, root }))).toMatchObject({ status: 500, body: { error: expect.stringMatching(/live mode needs/) } });
  });
});
