// The Spec session (agents/spec/session.js) and /api/spec (server/specApi.js), Phase 9 step 3, with a
// scripted model (answers by the schemas' encode()) and, once, the real LLM layer in mock mode.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createSpec } from '../../agents/spec/spec.js';
import { createSpecSession, SpecSessionError } from '../../agents/spec/session.js';
import { briefSchema, planSchema } from '../../agents/spec/schemas.js';
import { createLlm } from '../../agents/llm.js';
import { createSpecService, readTemplates } from '../../server/specApi.js';
import { juiceBrief, juicePlan } from '../spec/fixtures.js';

const asking = { ...juiceBrief, questions: [{ topic: 'throughput', question: 'How many bottles per hour?', why: 'sets the takt' }] };
const answers = () => ({
  factoryBrief: [briefSchema(registry).encode(asking), briefSchema(registry).encode(juiceBrief), briefSchema(registry).encode(juiceBrief)],
  linePlan: [planSchema(registry).encode(juicePlan), planSchema(registry).encode(juicePlan)],
});

function scripted(script) {
  const calls = [];
  return {
    calls,
    call: async (req) => {
      calls.push(req);
      const next = script[req.schemaName]?.shift();
      if (!next) throw Object.assign(new Error(`no scripted answer for ${req.schemaName}`), { name: 'LlmError' });
      return { output: next, cost: 0.001, source: 'mock', key: req.schemaName };
    },
  };
}

describe('the Spec session', () => {
  it('constitution at once; the brief asks, the owner answers, approve brief → plan drafted; all approved → the Builder\'s job and the files', async () => {
    const llm = scripted(answers());
    const written = {};
    const s = createSpecSession({ spec: createSpec({ registry, llm }), saveDocs: (id, files) => Object.assign(written, { id, ...files }) });
    let v = s.view();
    expect(v.docs.constitution).toMatchObject({ status: 'draft', rev: 1 });
    expect(v.docs.constitution.md).toMatch(/^# Constitution/);
    expect(v.docs.brief.status).toBe('none');

    v = await s.message('Juice bottles: fill, cap, inspect.');
    expect(v.docs.brief).toMatchObject({ status: 'draft', rev: 1 });
    expect(v.questions).toEqual(asking.questions);
    expect(v.conversation.map((m) => m.from)).toEqual(['owner', 'spec']);
    expect(v.docs.brief.md).toContain('## Open questions');

    v = await s.message('240 an hour');
    expect(v.questions).toEqual([]);
    expect(v.docs.brief.rev).toBe(2);
    expect(v.line).toEqual({ id: 'juiceLine', title: 'Apple juice bottling', takt: 15, targetPerHour: 240 });

    v = await s.approve('brief');
    expect(v.docs.brief.status).toBe('approved');
    expect(v.docs.plan).toMatchObject({ status: 'draft', rev: 1 });
    expect(v.docs.plan.md).toMatch(/^# Plan: Apple juice bottling/);
    expect(llm.calls.map((c) => c.schemaName)).toEqual(['factoryBrief', 'factoryBrief', 'linePlan']);
    expect(written).toMatchObject({ id: 'juiceLine' });
    expect(written['factory-brief.md']).toContain('# Factory brief');
    expect(written['plan.md']).toBeUndefined(); // not approved yet

    await s.approve('constitution');
    v = await s.approve('plan');
    expect(v.ready).toBe(true);
    expect(v.job.line.transport).toEqual({ type: 'beltConveyor', params: {} });
    expect(v.job.plan.map((p) => p.id)).toEqual(['filling', 'capping', 'inspection']);
    expect(Object.keys(written).sort()).toEqual(['brief.json', 'constitution.md', 'factory-brief.md', 'id', 'plan.json', 'plan.md']);
    expect(JSON.parse(written['plan.json'])).toEqual(juicePlan);
    expect(v.cost).toBeCloseTo(0.003, 9);
    expect(v.log.map((l) => `${l.doc}:${l.action}`)).toEqual(['brief:message', 'brief:draft', 'brief:message', 'brief:draft', 'brief:approve', 'plan:draft', 'constitution:approve', 'plan:approve']);
  });

  it('reject: the plan redrafted with the comment; the brief redrafted resets the plan; the constitution cannot be redrafted', async () => {
    const llm = scripted(answers());
    const s = createSpecSession({ spec: createSpec({ registry, llm }) });
    await s.message('juice');
    await s.message('240');
    await s.approve('brief');
    let v = await s.reject('plan', 'one station fewer');
    expect(v.docs.plan.rev).toBe(2);
    expect(llm.calls.at(-1).messages[1].content).toContain('The owner rejected your previous draft with this comment: "one station fewer"');
    v = await s.reject('brief', 'call it Juice line 2');
    expect(v.docs.brief).toMatchObject({ status: 'draft', rev: 3 });
    expect(v.docs.plan.status).toBe('none');
    expect(v.conversation.at(-1)).toEqual({ from: 'owner', text: '(on the brief) call it Juice line 2', source: 'chat' });
    await expect(s.reject('constitution', 'x')).rejects.toThrow(/comes from the project conventions/);
    await expect(s.reject('plan', 'x')).rejects.toThrow(/there is no plan to reject/); // the new brief reset it
    await expect(s.reject('brief', ' ')).rejects.toThrow(/needs a comment/);
  });

  it('refusals: nothing written, an unknown source, approving what is not a draft', async () => {
    const s = createSpecSession({ spec: createSpec({ registry, llm: scripted(answers()) }) });
    await expect(s.message('  ')).rejects.toThrow(SpecSessionError);
    await expect(s.message('x', 'fax')).rejects.toThrow(/source must be one of/);
    await expect(s.approve('brief')).rejects.toThrow(/no brief draft to approve \(none\)/);
    await expect(s.approve('menu')).rejects.toThrow(/doc must be one of/);
    await expect(s.retry()).rejects.toThrow(/nothing to draft again/);
  });

  it('an LLM error leaves the message in the conversation; retry drafts the brief when the model answers again', async () => {
    const script = { factoryBrief: [] };
    const s = createSpecSession({ spec: createSpec({ registry, llm: scripted(script) }) });
    await expect(s.message('juice')).rejects.toThrow(/no scripted answer/);
    expect(s.view().conversation).toHaveLength(1);
    script.factoryBrief.push(briefSchema(registry).encode(juiceBrief));
    const v = await s.retry();
    expect(v.docs.brief.status).toBe('draft');
  });
});

/** A project root with the templates. */
function tempRoot() {
  const dir = mkdtempSync(join(tmpdir(), 'spec-api-'));
  mkdirSync(join(dir, 'spec', 'sdd', 'templates'), { recursive: true });
  for (const n of readdirSync('spec/sdd/templates')) copyFileSync(join('spec/sdd/templates', n), join(dir, 'spec', 'sdd', 'templates', n));
  return dir;
}
const service = (root, llm) => createSpecService({ root, llm: () => llm, load: async () => ({ registry, createSpec, createSpecSession, SpecSessionError }) });
const post = (svc, path, body = {}) => svc.handle({ method: 'POST', path, body });

describe('/api/spec', () => {
  it('templates; message → approve → documents in sdd/<line>/; bad requests; the session survives a restart; reset', async () => {
    const root = tempRoot();
    const llm = scripted(answers());
    const svc = service(root, llm);
    let r = await svc.handle({ method: 'GET', path: '/' });
    expect(r.body.templates.map((t) => t.name)).toEqual(['cosmetics-jars', 'juice-bottling', 'printer-assembly']);
    expect(r.body.templates[1].title).toBe('Apple juice bottling');
    expect(readTemplates(join(root, 'nowhere'))).toEqual([]);

    expect((await post(svc, '/message', {})).status).toBe(400);
    r = await post(svc, '/message', { text: r.body.templates[1].text, source: 'template' });
    expect(r.body.session.docs.brief.status).toBe('draft');
    await post(svc, '/message', { text: '240' });
    r = await post(svc, '/approve', { doc: 'brief' });
    expect(r.body.session.docs.plan.status).toBe('draft');
    expect(readFileSync(join(root, 'sdd', 'juiceLine', 'factory-brief.md'), 'utf8')).toContain('# Factory brief: Apple juice bottling');

    // A restart: the same root, a new service.
    const again = service(root, llm);
    r = await post(again, '/approve', { doc: 'plan' });
    expect(r.body.session.docs.plan.status).toBe('approved');
    r = await post(again, '/approve', { doc: 'constitution' });
    expect(r.body.session.ready).toBe(true);
    expect(readdirSync(join(root, 'sdd', 'juiceLine')).sort()).toEqual(['brief.json', 'constitution.md', 'factory-brief.md', 'plan.json', 'plan.md']);

    r = await post(again, '/reject', { doc: 'constitution', comment: 'x' });
    expect(r.status).toBe(409);
    expect((await again.handle({ method: 'PUT', path: '/' })).status).toBe(405);
    r = await post(again, '/reset');
    expect(r.body.session.docs.brief.status).toBe('none');
    expect(existsSync(join(root, 'sdd', 'juiceLine', 'plan.md'))).toBe(true); // approved files stay
  });

  it('the real LLM layer in mock mode with nothing recorded: 409 with code mock, the message kept', async () => {
    const root = tempRoot();
    const svc = service(root, createLlm({ env: { LLM_MODE: 'mock' }, root }));
    const r = await post(svc, '/message', { text: 'juice bottles' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('mock');
    expect(r.body.session.conversation).toHaveLength(1);
  });
});
