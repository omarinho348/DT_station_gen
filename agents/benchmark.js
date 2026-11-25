// The benchmark run of one brief (Claude.md §10, Phase 12): the whole pipeline without a person, every
// approval given automatically, and the metrics §10 asks for.
//
//   brief text → Spec session (brief, approved with its assumptions; plan, approved)
//             → Builder, station by station (each with its own retries)
//             → deterministic reviewer on the whole line (with a played run) → SimPy KPIs (optional)
//             → one standard edit request (edit success) → the Reviewer's critique (optional)
//
// Metrics: stations planned / built, first-pass stations (built with no refusal), the parts mix per
// station (named / composite / placeholder), the review's errors and warnings and whether the run plays
// to the end, the SimPy rate against the brief's target, edit success, the critique's verdict, cost per
// agent and wall time. A stage that fails stops the run there, with the reason (nothing throws for a
// model's mistakes; LLM-layer refusals such as the budget guard end the run and are reported).
import { createSpec } from './spec/spec.js';
import { createSpecSession } from './spec/session.js';
import { createBuilder } from './builder/builder.js';
import { createEditor } from './editor/editor.js';
import { createCritic } from './reviewer/critique.js';
import { review } from './reviewer/deterministic.js';
import { jobFromSdd } from '../spec/sdd/checks.js';

/** The standard edit every benchmark line gets (edit success: a checked patch comes back). */
export const STANDARD_EDIT = 'Make the slowest station about 10 percent faster.';

/** A station's parts mix: placeholder if any genericMachine, else composite if any composite, else named. */
export function stationKind(station) {
  const types = station.equipment.map((e) => e.type);
  if (types.includes('genericMachine')) return 'placeholder';
  if (types.includes('composite')) return 'composite';
  return 'named';
}

/**
 * @param {object} o
 * @param {object} o.registry
 * @param {object} o.llm        the LLM layer (or a scripted one); costs are read from its answers
 * @param {string} o.name       the brief's name
 * @param {string} o.text       the brief (markdown)
 * @param {Function} [o.simpy]  async (factory) → kpis, or null to skip
 * @param {boolean} [o.edit]    run the standard edit (default true)
 * @param {boolean} [o.critique] run the critique (default true)
 * @param {Function} [o.now]    () → ms (tests)
 * @param {Function} [o.log]    (line) progress
 */
export async function runBrief({ registry, llm, name, text, simpy = null, edit = true, critique = true, retries = 2, now = () => Date.now(), log = () => {} }) {
  const started = now();
  const cost = { spec: 0, builder: 0, editor: 0, reviewer: 0 };
  // Every call's cost, by agent (the layer reports it per answer).
  const metered = { call: async (req) => { const r = await llm.call(req); cost[req.agent] = (cost[req.agent] ?? 0) + (r.cost ?? 0); return r; } };
  const result = { name, stage: 'spec', ok: false, cost, seconds: 0 };
  const finish = (stage, extra = {}) => Object.assign(result, { stage, ...extra, seconds: (now() - started) / 1000, totalCost: Object.values(cost).reduce((a, b) => a + b, 0) });

  try {
    // ---- Spec ---------------------------------------------------------------------------------------
    const spec = createSpecSession({ spec: createSpec({ registry, llm: metered }) });
    let v = await spec.message(text, 'upload');
    result.brief = { status: v.docs.brief.status, retries: v.docs.brief.retries, questions: v.questions.length, warnings: v.docs.brief.warnings, problems: v.docs.brief.problems };
    if (v.docs.brief.status !== 'draft') return finish('brief', { reason: `the brief failed its checks: ${v.docs.brief.problems.join(' | ')}` });
    const briefData = spec.state().docs.brief.data;
    result.target = { perHour: briefData.targetPerHour, title: briefData.title, steps: briefData.steps.length };
    await spec.approve('constitution');
    v = await spec.approve('brief');
    result.plan = { status: v.docs.plan.status, retries: v.docs.plan.retries, problems: v.docs.plan.problems };
    if (v.docs.plan.status !== 'draft') return finish('plan', { reason: `the plan failed its checks: ${v.docs.plan.problems.join(' | ')}` });
    v = await spec.approve('plan');
    const job = jobFromSdd(briefData, spec.state().docs.plan.data);
    result.planned = job.plan.length;
    log(`${name}: brief and plan approved, ${job.plan.length} stations`);

    // ---- Builder ------------------------------------------------------------------------------------
    result.stage = 'builder';
    const builder = createBuilder({ registry, llm: metered, play: true, maxRetries: retries });
    const stations = [];
    result.stations = [];
    let factory = null;
    for (const item of job.plan) {
      const r = await builder.buildStation({ line: job.line, product: job.product, stations, plan: item });
      result.stations.push({ id: item.id, title: item.title, ok: r.ok, refusals: r.attempts.length, phases: r.attempts.map((a) => a.phase), kind: r.station ? stationKind(r.station) : null, types: r.station?.equipment.map((e) => e.type) ?? [], problems: r.ok ? [] : r.attempts.at(-1)?.problems ?? [] });
      log(`${name}: ${item.id} ${r.ok ? 'built' : 'FAILED'}${r.attempts.length ? ` (${r.attempts.length} refusals)` : ''}`);
      if (!r.ok) return finish('builder', { factory: r.factory, reason: `station "${item.id}" still failing after the retries: ${(r.attempts.at(-1)?.problems ?? []).slice(0, 3).join(' | ')}` });
      stations.push(r.station);
      factory = r.factory;
    }

    // ---- Whole-line review, SimPy -----------------------------------------------------------------------
    result.stage = 'review';
    const checked = review(registry, factory, { play: true });
    const play = checked.findings.find((f) => f.check === 'play');
    result.review = { ok: checked.ok, errors: checked.counts.error, warnings: checked.counts.warning, plays: Boolean(play && play.severity !== 'error'), play: play?.message ?? null, takt: checked.timing?.takt ?? null };
    result.factory = factory;
    let kpis = null;
    if (simpy) {
      try {
        const k = await simpy(factory);
        kpis = k;
        result.simpy = { finished: k.finished, steadyPerHour: k.steadyPerHour, throughputPerHour: k.throughputPerHour, taktAchieved: k.taktAchieved, rejects: k.rejects.count, meetsTarget: k.steadyPerHour >= briefData.targetPerHour - 1e-9 };
      } catch (error) {
        result.simpy = { error: error.message };
      }
    }

    // ---- One standard edit, the critique -------------------------------------------------------------------
    if (edit) {
      result.stage = 'edit';
      const e = await createEditor({ registry, llm: metered }).propose({ factory, request: STANDARD_EDIT });
      result.edit = { ok: e.ok, ops: e.ops.length, questions: e.questions.length, refusals: e.attempts.length, summary: e.summary, success: e.ok && e.ops.length > 0 };
    }
    if (critique && checked.ok) {
      result.stage = 'critique';
      const c = await createCritic({ registry, llm: metered }).critique({ factory, brief: briefData, kpis: kpis?.finished ? kpis : null });
      result.critique = c.ok ? { verdict: c.verdict, summary: c.summary, issues: c.issues.map((i) => ({ severity: i.severity, issue: i.issue })) } : { skipped: c.skipped };
    }
    return finish('done', { ok: true });
  } catch (error) {
    // The LLM layer refused (budget cap, mock mode without a recording) or something broke: reported.
    return finish(result.stage, { reason: `${error.constructor?.name ?? 'Error'}: ${error.message}`, factory: result.factory ?? null });
  }
}

/** The metrics over several runs (Claude.md §10). */
export function summarize(runs) {
  const stations = runs.flatMap((r) => r.stations ?? []);
  const built = stations.filter((s) => s.ok);
  const share = (kind) => (built.length ? built.filter((s) => s.kind === kind).length / built.length : 0);
  const pct = (x) => Math.round(x * 1000) / 10;
  const edits = runs.filter((r) => r.edit);
  return {
    briefs: runs.length,
    linesComplete: runs.filter((r) => r.stage === 'done').length,
    stationsPlanned: runs.reduce((s, r) => s + (r.planned ?? 0), 0),
    stationsBuilt: built.length,
    firstPassStations: pct(built.length ? built.filter((s) => s.refusals === 0).length / built.length : 0),
    parts: { named: pct(share('named')), composite: pct(share('composite')), placeholder: pct(share('placeholder')) },
    reviewOk: runs.filter((r) => r.review?.ok).length,
    plays: runs.filter((r) => r.review?.plays).length,
    meetsTarget: runs.filter((r) => r.simpy?.meetsTarget).length,
    editSuccess: edits.length ? pct(edits.filter((r) => r.edit.success).length / edits.length) : null,
    verdicts: Object.fromEntries(['fits', 'concerns', 'misfit'].map((k) => [k, runs.filter((r) => r.critique?.verdict === k).length])),
    cost: { total: runs.reduce((s, r) => s + (r.totalCost ?? 0), 0), perLine: runs.length ? runs.reduce((s, r) => s + (r.totalCost ?? 0), 0) / runs.length : 0 },
    secondsPerLine: runs.length ? runs.reduce((s, r) => s + r.seconds, 0) / runs.length : 0,
  };
}
