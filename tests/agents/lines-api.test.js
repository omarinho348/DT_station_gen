// /api/lines (server/linesApi.js, Phase 10 step 3): stored lines, the Editor's proposals, apply / discard,
// undo, on a temporary project root with a scripted model (and once the real LLM layer in mock mode).
import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, copyFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createEditor } from '../../agents/editor/editor.js';
import { patchSchema } from '../../agents/editor/schemas.js';
import { createLlm } from '../../agents/llm.js';
import { projectLineStore } from '../../server/lineStore.js';
import { createLinesService } from '../../server/linesApi.js';
import { parseFactory } from '../../spec/factory.schema.js';
import { compileFactory, lineFolder } from '../../compiler/emit.js';
import { writeCompiled } from '../../compiler/write.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const fillIndex = bottling.stations[0].process.findIndex((o) => o.op === 'runRoutine');
const def = patchSchema();
const patch = (value, summary = 'Filling shorter') => def.encode({ summary, ops: [{ op: 'replace', path: `/stations/0/process/${fillIndex}/seconds`, valueJson: JSON.stringify(value) }], questions: [] });

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'lines-api-'));
  mkdirSync(join(root, 'spec', 'examples'), { recursive: true });
  copyFileSync('spec/examples/bottling-line.factory.json', join(root, 'spec', 'examples', 'bottling-line.factory.json'));
  return root;
}

function setup({ answers = [], llm = null } = {}) {
  const root = tempRoot();
  const calls = [];
  const queue = [...answers];
  const model = llm ?? { call: async (req) => { calls.push(req); if (!queue.length) throw new Error('no scripted answer'); return { output: queue.shift(), cost: 0.001, source: 'mock', key: 'k' }; } };
  const lineStore = projectLineStore({ root, registry, parseFactory, compileFactory, writeCompiled });
  const svc = createLinesService({ root, llm: () => model, load: async () => ({ registry, createEditor, lineStore, lineFolder }) });
  return { root, svc, calls, queue, lineStore };
}
const post = (svc, path, body = {}) => svc.handle({ method: 'POST', path, body });

describe('/api/lines', () => {
  it('import an example → propose → apply (a new version, recompiled) → undo', async () => {
    const { root, svc, calls } = setup({ answers: [patch(5)] });
    let r = await svc.handle({ method: 'GET', path: '/' });
    expect(r.body).toEqual({ lines: [], examples: ['bottling-line'] });
    expect((await post(svc, '/import', { example: 'bottling-line', id: 'bottlingLine' })).body.error).toMatch(/example line's id/);
    expect((await post(svc, '/import', { example: 'bottling-line' })).status).toBe(400);
    r = await post(svc, '/import', { example: 'bottling-line', id: 'juice' });
    expect(r.body.line).toEqual({ id: 'juice', title: bottling.line.title, version: 1, folder: 'juice', stations: 5 });
    expect(existsSync(join(root, 'generated', 'juice', 'line.js'))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, 'lines', 'juice', 'factory.json'), 'utf8')).$schema).toBeUndefined();

    r = await post(svc, '/juice/propose', { request: 'Filling 5 s instead of 6' });
    expect(r.body.pending).toMatchObject({ request: 'Filling 5 s instead of 6', summary: 'Filling shorter', ok: true, baseVersion: 1, retries: 0 });
    expect(r.body.pending.diff).toEqual([expect.objectContaining({ op: 'replace', from: 6, value: 5 })]);
    expect(r.body.line.version).toBe(1); // nothing saved yet
    expect(calls[0].messages[1].content).toContain('"id":"juice"');

    r = await post(svc, '/juice/apply');
    expect(r.body.line.version).toBe(2);
    expect(r.body.pending).toBe(null);
    expect(r.body.saved.compiled.written.length).toBeGreaterThan(0);
    expect(r.body.history[0]).toMatchObject({ version: 2, by: 'editor', message: 'Filling shorter', request: 'Filling 5 s instead of 6', ops: 1 });
    expect((await post(svc, '/juice/apply')).status).toBe(409);

    r = await post(svc, '/juice/undo');
    expect(r.body.line.version).toBe(3);
    expect(JSON.parse(readFileSync(join(root, 'lines', 'juice', 'factory.json'), 'utf8')).stations[0].process[fillIndex].seconds).toBe(6);
  }, 120000);

  it('a stale patch is refused; discard with a comment asks again with it; questions cannot be applied', async () => {
    const asking = def.encode({ summary: 'Unclear', ops: [], questions: ['Which station?'] });
    const { svc, calls, lineStore } = setup({ answers: [patch(5), patch(5.5), patch(4), asking] });
    await post(svc, '/import', { example: 'bottling-line', id: 'juice' });
    await post(svc, '/juice/propose', { request: 'shorter filling' });
    let r = await post(svc, '/juice/discard', { comment: 'only half a second shorter' });
    expect(r.body.pending.diff[0].value).toBe(5.5);
    expect(calls[1].messages[1].content).toContain('The owner discarded your previous patch with this comment: "only half a second shorter"');
    // Another change lands first (here by hand, through the store): the pending patch is stale.
    await post(svc, '/juice/apply');
    await post(svc, '/juice/propose', { request: 'even shorter' });
    lineStore.save('juice', { ...lineStore.load('juice').factory, line: { ...lineStore.load('juice').factory.line, runSize: 12 } }, { by: 'owner', message: 'by hand' });
    r = await post(svc, '/juice/apply');
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/the line changed since this patch was proposed/);
    r = await post(svc, '/juice/propose', { request: 'add a camera' });
    expect(r.body.pending).toMatchObject({ questions: ['Which station?'], diff: [] });
    expect((await post(svc, '/juice/apply')).body.error).toMatch(/no checked patch/);
    r = await post(svc, '/juice/discard');
    expect(r.body.pending).toBe(null);
    expect((await post(svc, '/juice/discard')).status).toBe(409);
  }, 180000);

  it('bad requests and the real LLM layer in mock mode', async () => {
    const root0 = tempRoot();
    const { svc } = setup({ llm: createLlm({ env: { LLM_MODE: 'mock' }, root: root0 }) });
    expect((await svc.handle({ method: 'GET', path: '/nowhere' })).status).toBe(404);
    await post(svc, '/import', { example: 'bottling-line', id: 'juice' });
    expect((await post(svc, '/juice/propose', {})).status).toBe(400);
    expect((await post(svc, '/juice/fly')).status).toBe(404);
    const r = await post(svc, '/juice/propose', { request: 'faster' });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('mock');
    expect((await svc.handle({ method: 'GET', path: '/juice' })).body.pending).toBe(null);
    expect((await post(svc, '/juice/undo')).body.error).toMatch(/nothing to undo/);
  }, 60000);
});
