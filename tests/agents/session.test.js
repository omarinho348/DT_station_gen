// The build session (agents/builder/session.js, step 8.5): the Builder one approval gate at a time,
// driven by the bottling rehearsal (agents/builder/rehearsal.js: scripted answers from the hand-written
// line, encoded by the Builder's own schemas). The Builder, placer, reviewer and compiler are the real ones.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder } from '../../agents/builder/builder.js';
import { createBuildSession, SessionError } from '../../agents/builder/session.js';
import { loadRehearsal, stationAnswers, opsUsed, RehearsalError } from '../../agents/builder/rehearsal.js';
import { applyPatch } from '../../agents/diff.js';

const root = process.cwd();
const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));

function session({ draftRoot = null, play = false } = {}) {
  const r = loadRehearsal(registry, 'bottling', { root });
  const builder = createBuilder({ registry, llm: r.llm, root: draftRoot, play });
  const saved = [];
  const s = createBuildSession({
    builder, job: r.job, plan: r.plan, source: { kind: 'rehearsal', name: 'bottling' },
    writeDraft: draftRoot ? (factory, rev) => builder.writeDraft(factory, { rev: `t-${rev}` }) : null,
    save: (state) => saved.push(JSON.parse(JSON.stringify(state))),
  });
  return { s, llm: r.llm, saved, rehearsal: r };
}

describe('the rehearsal', () => {
  it('describes a hand-written station as the three answers: hints, params, process; nested ops found', () => {
    const inspect = bottling.stations.find((x) => x.id === 'inspect');
    const a = stationAnswers(inspect, { belt: { place: 'line', at: 'whole' }, vision: { place: 'overLine', at: 'work' }, rejectLane: { place: 'besideLine', at: 'work', turned: true, why: 'rejects' } });
    expect(a.layout.equipment.map((e) => [e.id, e.place, e.why])).toEqual([['belt', 'line', 'beltConveyor'], ['vision', 'overLine', 'composite'], ['rejectLane', 'besideLine', 'rejects']]);
    expect(a.layout.ports).toEqual([{ name: 'reject', machine: 'rejectLane', port: 'output', direction: 'out' }]);
    expect(a.layout.ops.sort()).toEqual(['decide', 'toolOn', 'transfer']); // transfer only inside the decision's reject case, and in intake
    expect(opsUsed([{ op: 'decide', cases: { a: [{ op: 'wait' }] } }])).toEqual(['decide', 'wait']);
    expect(() => stationAnswers(inspect, {})).toThrow(RehearsalError);
    expect(() => loadRehearsal(registry, 'nowhere', { root })).toThrow(/no rehearsal "nowhere"/);
  });
});

describe('the build session', () => {
  it('one gate per phase: layout (default params, no process) → machines → process; each diff applies to the last approved state', async () => {
    const { s, llm } = session();
    let v = await s.next();
    expect(v.gate).toMatchObject({ station: 'fill', phase: 'layout', ok: true, done: false });
    const layout = s.state().gate.stationData;
    expect(layout.equipment.map((e) => e.params)).toEqual([{}, {}]); // the preview: defaults
    expect(layout.process).toEqual([]);
    expect(v.gate.diff).toEqual([expect.objectContaining({ op: 'add', path: '/stations/0', label: 'stations › fill' })]);
    expect(llm.calls.map((c) => c.schemaName)).toEqual(['stationLayout']); // one call per gate

    let base = s.factory();
    expect(applyPatch(base, v.gate.diff)).toEqual(s.state().gate.factory);
    s.approve();
    v = await s.next();
    expect(v.gate).toMatchObject({ station: 'fill', phase: 'machines', ok: true });
    expect(v.gate.diff.every((d) => d.path.startsWith('/stations/0/equipment/'))).toBe(true);
    base = s.factory();
    expect(applyPatch(base, v.gate.diff)).toEqual(s.state().gate.factory);
    s.approve();
    v = await s.next();
    expect(v.gate).toMatchObject({ station: 'fill', phase: 'process', ok: true, done: true });
    expect(v.gate.diff.some((d) => d.path === '/stations/0/process/0')).toBe(true);
    s.approve();
    expect(s.view().plan.map((p) => p.state)).toEqual(['approved', 'building', 'planned', 'planned']);
    expect(llm.calls.map((c) => c.schemaName)).toEqual(['stationLayout', 'stationMachines', 'stationProcess']);

    // The next station's layout adds it and the edge to it.
    v = await s.next();
    expect(v.gate.diff.map((d) => [d.op, d.label])).toEqual([['add', 'stations › cap'], ['add', 'graph › edges › [0]']]);
  }, 60000);

  it('the whole plan approved: four stations, the line as factory.json, each gate a draft whose files exist; the run plays', async () => {
    const draftRoot = mkdtempSync(join(tmpdir(), 'session-'));
    const { s, saved } = session({ draftRoot, play: true });
    let gates = 0;
    while (!s.view().finished) {
      const v = await s.next();
      expect(v.gate.ok, `${v.gate.station} ${v.gate.phase}`).toBe(true);
      expect(v.url).toBe(v.gate.url);
      expect(existsSync(join(draftRoot, v.gate.url.replace(/^\//, '')))).toBe(true);
      gates += 1;
      s.approve();
    }
    expect(gates).toBe(12);
    const f = s.factory();
    expect(f.stations.map((x) => x.id)).toEqual(['fill', 'cap', 'inspect', 'pack']);
    expect(f.graph.edges.map((e) => `${e.from}→${e.to}`)).toEqual(['fill.output→cap.input', 'cap.output→inspect.input', 'inspect.output→pack.input']);
    expect(s.view().url).toMatch(/\/generated\/_draft\/bottling-rehearsal\/rt-12\/line\.js$/);
    expect(s.state().gate).toBe(null);
    expect(saved.length).toBe(24); // every draft and every approval saved
    expect(s.view().log.filter((l) => l.action === 'approve')).toHaveLength(12);
    await expect(s.next()).rejects.toThrow(/every planned station is built/);
  }, 180000);

  it('reject: the comment and the previous answer go back to that phase, with a fresh retry allowance', async () => {
    const { s, llm } = session();
    await s.next();
    s.approve();
    await s.next(); // machines draft
    s.reject('  Make the belt longer  ');
    expect(s.state().build).toMatchObject({ from: 'machines', attempts: [] });
    const v = await s.next();
    expect(v.gate).toMatchObject({ station: 'fill', phase: 'machines', rev: 3 });
    const retry = llm.calls.at(-1);
    expect(retry.schemaName).toBe('stationMachines');
    expect(retry.task).toContain('FEEDBACK\nThe owner rejected your machines answer with this comment: "Make the belt longer". Change what the comment asks and keep the rest.');
    expect(retry.task).toContain('PREVIOUS ANSWER\n{"belt":');
    expect(s.view().log.map((l) => l.action)).toEqual(['draft', 'approve', 'draft', 'reject', 'draft']);
    expect(s.view().log[3]).toMatchObject({ station: 'fill', phase: 'machines', comment: 'Make the belt longer' });
    // The diff is still against the approved layout (rejected drafts are never a base).
    expect(v.gate.diff.every((d) => d.path.startsWith('/stations/0/equipment/'))).toBe(true);
  }, 60000);

  it('refuses what cannot be done now, with reasons', async () => {
    const { s } = session();
    expect(() => s.approve()).toThrow(/no draft to approve/);
    expect(() => s.reject('x')).toThrow(/no draft to reject/);
    await s.next();
    await expect(s.next()).rejects.toThrow(/approve or reject the layout draft of "fill" first/);
    expect(() => s.reject('   ')).toThrow(SessionError);
    expect(() => s.reject('')).toThrow(/needs a comment/);
  }, 60000);

  it('a draft still failing after the retries can be rejected with a comment, not approved', async () => {
    const r = loadRehearsal(registry, 'bottling', { root });
    // A model that keeps answering a belt length out of range.
    const bad = {
      call: async (req) => {
        const out = await r.llm.call(req);
        if (req.schemaName === 'stationMachines') out.output.params.belt.length = 99;
        return out;
      },
    };
    const builder = createBuilder({ registry, llm: bad, play: false });
    const s = createBuildSession({ builder, job: r.job, plan: r.plan });
    await s.next();
    s.approve();
    const v = await s.next();
    expect(v.gate).toMatchObject({ ok: false, phase: 'machines' });
    expect(v.gate.attempts).toHaveLength(3);
    expect(() => s.approve()).toThrow(/failed its checks/);
    s.reject('keep the belt inside its range');
    expect(s.state().gate).toBe(null);
  }, 60000);

  it('a saved state goes on where it stopped', async () => {
    const { s, saved, rehearsal } = session();
    await s.next();
    s.approve();
    const state = saved.at(-1);
    const again = createBuildSession({ builder: createBuilder({ registry, llm: rehearsal.llm, play: false }), job: rehearsal.job, plan: rehearsal.plan, state });
    const v = await again.next();
    expect(v.gate).toMatchObject({ station: 'fill', phase: 'machines', rev: 2 });
  }, 60000);
});
