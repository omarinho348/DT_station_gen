// The Editor agent (agents/editor/editor.js, Phase 10 step 2) against a scripted model on the bottling
// line: answers are the schema's encode() of patches, so exactly strict-mode answers. No network.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createEditor, targetStations } from '../../agents/editor/editor.js';
import { patchSchema } from '../../agents/editor/schemas.js';
import { checkStrict } from '../../agents/strict.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
const def = patchSchema();
const answer = (ops, { summary = 'a change', questions = [] } = {}) => def.encode({ summary, ops: ops.map(([op, path, value]) => ({ op, path, ...(value === undefined ? {} : { valueJson: JSON.stringify(value) }) })), questions });

function scripted(answers) {
  const calls = [];
  const queue = [...answers];
  return {
    calls,
    call: async (req) => {
      calls.push(req);
      if (!queue.length) throw new Error('no scripted answer');
      return { output: queue.shift(), cost: 0.001, source: 'mock', key: 'k' };
    },
  };
}

const fillIndex = bottling.stations[0].process.findIndex((o) => o.op === 'runRoutine');
const fillPath = `/stations/0/process/${fillIndex}/seconds`;

describe('the Editor agent', () => {
  it('the schema is strict-valid; ops carry their value as JSON text', () => {
    expect(checkStrict(def.schema)).toEqual([]);
    expect(def.decode(answer([['replace', '/line/runSize', 12]]))).toEqual({ summary: 'a change', ops: [{ op: 'replace', path: '/line/runSize', valueJson: '12' }], questions: [] });
  });

  it('a request → a patch, applied, valid, reviewed and played; the diff; the prompt with the line, timing and the named station\'s detail', async () => {
    const llm = scripted([answer([['replace', fillPath, 5]], { summary: 'Filling takes 5 s instead of 6' })]);
    const editor = createEditor({ registry, llm });
    const r = await editor.propose({ factory: bottling, request: 'Make Filling faster: fill for 5 seconds' });
    expect(r).toMatchObject({ ok: true, summary: 'Filling takes 5 s instead of 6', attempts: [], questions: [] });
    expect(r.ops).toEqual([{ op: 'replace', path: fillPath, value: 5 }]);
    expect(r.factory.stations[0].process[fillIndex].seconds).toBe(5);
    expect(bottling.stations[0].process[fillIndex].seconds).toBe(6); // the input is untouched
    expect(r.diff).toEqual([expect.objectContaining({ op: 'replace', label: `stations › fill › process › [${fillIndex}] › seconds`, from: 6, value: 5 })]);
    expect(r.findings.find((f) => f.check === 'play').message).toMatch(/^played a run of 10/);
    const [req] = llm.calls;
    expect(req).toMatchObject({ agent: 'editor', schemaName: 'factoryPatch' });
    expect(req.messages[0].content).toMatch(/^You are the Editor/);
    const task = req.messages[1].content;
    expect(task).toMatch(/^EDIT\n\nREQUEST\nMake Filling faster: fill for 5 seconds\n\nLINE\n\{"\$schema":"\.\.\/factory\.schema\.json","version":1/);
    const timing = JSON.parse(task.split('\n\nTIMING\n')[1].split('\n\n')[0]);
    expect(timing.bottleneck).toBe('station pack');
    expect(timing.stations.pack).toBeCloseTo(10.48, 2);
    expect(Object.values(timing.stations).every((v) => v > 0)).toBe(true);
    const detail = JSON.parse(task.split('\n\nDETAIL\n')[1]);
    expect(Object.keys(detail.components).sort()).toEqual(['beltConveyor', 'composite']); // the Filling station's types only
  }, 120000);

  it('questions instead of a patch: nothing applied', async () => {
    const llm = scripted([answer([], { summary: 'Unclear', questions: ['Which station should get the second camera?'] })]);
    const r = await createEditor({ registry, llm }).propose({ factory: bottling, request: 'add another camera' });
    expect(r).toMatchObject({ ok: true, ops: [], diff: [], questions: ['Which station should get the second camera?'] });
    expect(r.factory).toBe(bottling);
  });

  it('refusals with paths, sent back with the previous answer: a motion out of range (reviewer), then fixed', async () => {
    const lower = bottling.stations[0].process.findIndex((o) => o.op === 'move' && o.to?.lower !== undefined);
    const llm = scripted([answer([['replace', `/stations/0/process/${lower}/to/lower`, 99]]), answer([['replace', `/stations/0/process/${lower}/to/lower`, 0.25]])]);
    const r = await createEditor({ registry, llm, play: false }).propose({ factory: bottling, request: 'lower the Filling nozzle further' });
    expect(r.ok).toBe(true);
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0].problems[0]).toMatch(/^stations\[0\]\.process\[\d+\]: .*must stay in/);
    const retry = llm.calls[1].messages[1].content;
    expect(retry).toContain('PREVIOUS ANSWER\n{"summary":"a change","ops":[{"op":"replace"');
    expect(retry).toMatch(/FEEDBACK\nYour patch was refused\. Fix these and keep the rest:\n- stations\[0\]/);
  }, 60000);

  it('what code refuses before the reviewer: fixed paths, values that are not JSON, a missing value, a path that is not there, an invalid IR', async () => {
    const cases = [
      [answer([['replace', '/line/id', 'other']]), /ops\[0\]\.path: "\/line\/id" may not be changed/],
      [def.encode({ summary: 's', ops: [{ op: 'replace', path: '/line/runSize', valueJson: 'twelve' }], questions: [] }), /ops\[0\]\.valueJson: not JSON/],
      [def.encode({ summary: 's', ops: [{ op: 'add', path: '/line/note' }], questions: [] }), /ops\[0\]\.valueJson: add needs a value/],
      [answer([['remove', '/stations/9']]), /^patch: op 0: index 9 is outside/],
      [answer([['replace', '/stations/0/id', 'Bad Id']]), /^stations\[0\]\.id: use camelCase/],
      [answer([], { questions: [] }), /ops: empty, and no question asked/],
    ];
    for (const [bad, message] of cases) {
      const llm = scripted([bad, bad, bad]);
      const r = await createEditor({ registry, llm, play: false }).propose({ factory: bottling, request: 'x' });
      expect(r.ok).toBe(false);
      expect(r.attempts).toHaveLength(3);
      expect(r.problems[0]).toMatch(message);
      expect(r.factory).toBe(bottling);
    }
  }, 120000);

  it('the owner\'s comment on a discarded patch goes in the first call', async () => {
    const llm = scripted([answer([['replace', '/line/runSize', 12]])]);
    await createEditor({ registry, llm, play: false }).propose({ factory: bottling, request: 'longer run', feedback: 'not 20, 12' });
    expect(llm.calls[0].messages[1].content).toContain('FEEDBACK\nThe owner discarded your previous patch with this comment: "not 20, 12".');
  });

  it('targetStations: by id, code or title as whole words; none named → all', () => {
    expect(targetStations(bottling, 'make capping faster').map((s) => s.id)).toEqual(['cap']);
    expect(targetStations(bottling, 'Inspection and Rework').map((s) => s.id)).toEqual(['inspect', 'rework']);
    expect(targetStations(bottling, 'speed the line up').map((s) => s.id)).toEqual(bottling.stations.map((s) => s.id));
    expect(targetStations(bottling, 'capping2').length).toBe(bottling.stations.length); // not a whole word
  });
});
