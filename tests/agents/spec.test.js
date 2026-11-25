// The Spec agent (agents/spec/spec.js, Phase 9 step 2) against a scripted model whose answers are made by
// the schemas' own encode(), so they are exactly strict-mode answers. No network.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createSpec, MAX_OWNER_TEXT } from '../../agents/spec/spec.js';
import { briefSchema, planSchema } from '../../agents/spec/schemas.js';
import { createLlm, LlmError } from '../../agents/llm.js';
import { juiceBrief, juicePlan } from '../spec/fixtures.js';

const enc = {
  brief: (b = juiceBrief) => briefSchema(registry).encode(b),
  plan: (p = juicePlan) => planSchema(registry).encode(p),
};

function scripted(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  return {
    calls,
    call: async (req) => {
      calls.push(req);
      const next = queues[req.schemaName]?.shift();
      if (!next) throw new Error(`no scripted answer for ${req.schemaName}`);
      return { output: next, cost: 0.001, source: 'mock', key: req.schemaName };
    },
  };
}

const owner = (text, source = 'chat') => ({ from: 'owner', text, source });

describe('the Spec agent: brief', () => {
  it('a brief from the conversation; the prompt: the stable start, then the transcript', async () => {
    const llm = scripted({ factoryBrief: [enc.brief()] });
    const spec = createSpec({ registry, llm });
    const r = await spec.draftBrief({ conversation: [owner('Apple juice in 1 L glass bottles, 240 an hour: fill, cap, inspect.')] });
    expect(r).toMatchObject({ ok: true, attempts: [], problems: [] });
    expect(r.brief).toEqual(juiceBrief);
    const [req] = llm.calls;
    expect(req).toMatchObject({ agent: 'spec', schemaName: 'factoryBrief', model: 'default' });
    expect(req.messages[0].content).toBe(spec.system);
    expect(spec.system).toMatch(/^You are the Spec agent/);
    expect(spec.system).toContain('\n\nCATALOG\n{"version":');
    expect(req.messages[1].content).toBe('DOCUMENT factory brief\n\nCONVERSATION\nOWNER: Apple juice in 1 L glass bottles, 240 an hour: fill, cap, inspect.');
  });

  it('follow-up questions come back in the brief; the answers go in the next call with the questions', async () => {
    const asking = { ...juiceBrief, questions: [{ topic: 'throughput', question: 'How many bottles per hour?', why: 'sets the takt' }] };
    const llm = scripted({ factoryBrief: [enc.brief(asking), enc.brief()] });
    const spec = createSpec({ registry, llm });
    const first = await spec.draftBrief({ conversation: [owner('Juice bottles: fill, cap, inspect.')] });
    expect(first.brief.questions).toHaveLength(1);
    const conversation = [owner('Juice bottles: fill, cap, inspect.'), { from: 'spec', text: 'How many bottles per hour?' }, owner('240')];
    const second = await spec.draftBrief({ conversation, previous: first.brief });
    expect(second.brief.questions).toEqual([]);
    expect(llm.calls[1].messages[1].content).toContain('OWNER: Juice bottles: fill, cap, inspect.\n\nSPEC AGENT: How many bottles per hour?\n\nOWNER: 240');
  });

  it('a product param out of range: refused in code with its path, fixed on the retry', async () => {
    const bad = structuredClone(juiceBrief);
    bad.product.model.params.height = 5;
    const llm = scripted({ factoryBrief: [enc.brief(bad), enc.brief()] });
    const r = await createSpec({ registry, llm }).draftBrief({ conversation: [owner('juice')] });
    expect(r.ok).toBe(true);
    expect(r.attempts[0].problems[0]).toMatch(/^product\.model\.params\.height: /);
    const retry = llm.calls[1].messages[1].content;
    expect(retry).toContain('PREVIOUS ANSWER\n{"id":"juiceLine"');
    expect(retry).toMatch(/FEEDBACK\nYour answer was refused\. Fix these and keep the rest:\n- product\.model\.params\.height/);
    expect(r.cost).toBeCloseTo(0.002, 9);
  });

  it('the owner\'s rejection comment and the previous draft go in the first call', async () => {
    const llm = scripted({ factoryBrief: [enc.brief()] });
    await createSpec({ registry, llm }).draftBrief({ conversation: [owner('juice')], previous: juiceBrief, feedback: ' 300 an hour, not 240 ' });
    const task = llm.calls[0].messages[1].content;
    expect(task).toContain('FEEDBACK\nThe owner rejected your previous draft with this comment: "300 an hour, not 240". Change what the comment asks and keep the rest.');
    expect(task).toContain('PREVIOUS ANSWER');
  });

  it('still wrong after two retries: ok false with the problems; nothing to start from: an error', async () => {
    const bad = { ...juiceBrief, id: 'Bad Id' };
    const llm = scripted({ factoryBrief: [enc.brief(bad), enc.brief(bad), enc.brief(bad)] });
    const spec = createSpec({ registry, llm });
    const r = await spec.draftBrief({ conversation: [owner('x')] });
    expect(r).toMatchObject({ ok: false, problems: [expect.stringMatching(/^id: "Bad Id"/)] });
    expect(llm.calls).toHaveLength(3);
    await expect(spec.draftBrief({ conversation: [{ from: 'spec', text: 'hi' }] })).rejects.toThrow(/needs something the owner wrote/);
  });

  it('an uploaded document longer than the limit is cut, with a note', async () => {
    const llm = scripted({ factoryBrief: [enc.brief()] });
    await createSpec({ registry, llm }).draftBrief({ conversation: [owner('a'.repeat(MAX_OWNER_TEXT + 50), 'upload')] });
    expect(llm.calls[0].messages[1].content).toMatch(/OWNER \(upload\): a+\n\[… cut: 50 more characters\]$/);
  });
});

describe('the Spec agent: plan', () => {
  it('a plan from the approved brief (without its questions), with the takt and step names; asked of the strong model', async () => {
    const llm = scripted({ linePlan: [enc.plan()] });
    const r = await createSpec({ registry, llm }).draftPlan({ brief: { ...juiceBrief, questions: [{ topic: 'other', question: 'old', why: 'x' }] } });
    expect(r).toMatchObject({ ok: true, plan: juicePlan });
    const req = llm.calls[0];
    expect(req.model).toBe('strong');
    expect(req.messages[1].content).toMatch(/^DOCUMENT plan\n\nBRIEF\n\{"id":"juiceLine"/);
    expect(req.messages[1].content).not.toContain('"questions"');
    expect(req.messages[1].content).toContain('TAKT\n15 s per unit (240/h)');
    expect(req.messages[1].content).toContain('STEP NAMES\n["Fill","Cap","Inspect"]');
  });

  it('a station over the takt: refused with the reason, fixed', async () => {
    const slow = structuredClone(juicePlan);
    slow.stations[0].seconds = 30;
    const llm = scripted({ linePlan: [enc.plan(slow), enc.plan()] });
    const r = await createSpec({ registry, llm }).draftPlan({ brief: juiceBrief });
    expect(r.ok).toBe(true);
    expect(r.attempts[0].problems).toEqual(['stations[0].seconds: 30 s is over the takt of 15.0 s (240/h); split the work over more stations or shorten it']);
  });

  it('the real LLM layer in mock mode with nothing recorded: the mock error reaches the caller', async () => {
    const llm = createLlm({ env: { LLM_MODE: 'mock' }, root: mkdtempSync(join(tmpdir(), 'spec-')) });
    const e = await createSpec({ registry, llm }).draftBrief({ conversation: [owner('juice')] }).catch((x) => x);
    expect(e).toBeInstanceOf(LlmError);
    expect(e.message).toMatch(/^mock mode: no recorded answer for this spec call \(factoryBrief/);
  });
});
