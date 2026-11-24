// A build session (step 8.5): the Builder run one gate at a time, with the owner approving or
// rejecting each draft (Claude.md §7.2: per station, layout → machines → process, each shown as a
// draft with a change diff). Plain JSON state, so the dev server can keep it across restarts.
//
//   const s = createBuildSession({ builder, job, plan, source, writeDraft, save });
//   await s.next()          the next gate's draft (one phase of the current station)
//   await s.approve()       accept it (the diff base moves on; a finished station joins the line)
//   await s.reject(text)    send the comment back to that phase (it runs again on the next next())
//   s.view()                what the approval panel shows
//
// The diff of a gate is the change from the last approved state (the line as approved so far plus this
// station as approved up to its previous gate) to the draft.
import { describeDiff } from '../diff.js';

export class SessionError extends Error {}

const PHASES = ['layout', 'machines', 'process'];

/**
 * @param {object} o
 * @param {object} o.builder     createBuilder(…) (advance, newBuild, rejectGate, factoryOf)
 * @param {object} o.job         { line, product } (line with transport)
 * @param {object[]} o.plan      the planned stations, in flow order: { id, title, does, steps }
 * @param {object} [o.source]    { kind: 'rehearsal' | 'llm', name?, title?, about? } (shown in the panel)
 * @param {Function} [o.writeDraft]  (factory, rev) → { url, files } (the app loads url)
 * @param {Function} [o.save]    (state) after every change
 * @param {object} [o.state]     a saved state to go on from
 * @param {Function} [o.now]
 */
export function createBuildSession({ builder, job, plan, source = { kind: 'llm' }, writeDraft = null, save = null, state = null, now = () => new Date().toISOString() }) {
  const s = state ?? {
    source,
    line: job.line,
    product: job.product,
    plan,
    approved: [],     // finished stations, approved
    index: 0,         // the plan item being built
    build: null,      // the Builder's state for that station (agents/builder/builder.js newBuild())
    base: builder.factoryOf(job, []), // the last approved factory.json (what the next diff starts from)
    gate: null,       // the draft waiting for the owner
    approvedUrl: null, // the draft files of the last approved gate (what the twin shows between gates)
    rev: 0,
    cost: 0,
    log: [],
  };
  const jobNow = () => ({ line: s.line, product: s.product, stations: s.approved, plan: s.plan[s.index] });
  const persist = () => save?.(s);
  const record = (entry) => s.log.push({ time: now(), station: s.plan[s.index]?.id ?? null, ...entry });

  /** Runs the current station on to its next gate and keeps the draft. LLM-layer errors are thrown. */
  async function next() {
    if (s.gate) throw new SessionError(`approve or reject the ${s.gate.phase} draft of "${s.gate.station}" first`);
    if (s.index >= s.plan.length) throw new SessionError('every planned station is built and approved');
    s.build ??= builder.newBuild();
    const phase = PHASES.includes(s.build.from) ? s.build.from : 'process';
    const costBefore = s.build.cost;
    const r = await builder.advance(jobNow(), s.build, { stopAfter: phase });
    const spent = s.build.cost - costBefore;
    s.cost += spent;
    s.rev += 1;
    const draft = r.factory && writeDraft ? writeDraft(r.factory, s.rev) : null;
    s.gate = {
      rev: s.rev,
      station: s.plan[s.index].id,
      title: r.station?.title ?? s.plan[s.index].title,
      phase: r.ok ? r.phase : s.build.from,
      ok: r.ok,
      done: r.done,
      stationData: r.station,
      factory: r.factory,
      diff: r.factory ? describeDiff(s.base, r.factory) : [],
      notes: r.notes ?? [],
      findings: (r.findings ?? []).filter((f) => f.severity !== 'info' || f.check === 'play'),
      attempts: r.attempts.map((a) => ({ phase: a.phase, problems: a.problems })),
      cost: spent,
      url: draft?.url ?? null,
      files: draft?.files ?? [],
    };
    record({ phase: s.gate.phase, action: r.ok ? 'draft' : 'failed', cost: spent, retries: r.attempts.length });
    persist();
    return view();
  }

  /** Accepts the waiting draft. A finished station joins the line; the next station starts fresh. */
  function approve() {
    const g = s.gate;
    if (!g) throw new SessionError('there is no draft to approve');
    if (!g.ok) throw new SessionError(`the ${g.phase} draft of "${g.station}" failed its checks: reject it with a comment, or start again`);
    record({ phase: g.phase, action: 'approve' });
    s.base = g.factory;
    s.approvedUrl = g.url;
    if (g.done) {
      s.approved = [...s.approved, g.stationData];
      s.index += 1;
      s.build = null;
    }
    s.gate = null;
    persist();
    return view();
  }

  /** Sends the owner's comment back to the phase the draft shows; that phase runs again on next(). */
  function reject(comment) {
    const g = s.gate;
    if (!g) throw new SessionError('there is no draft to reject');
    const text = String(comment ?? '').trim();
    if (!text) throw new SessionError('a rejection needs a comment saying what to change');
    record({ phase: g.phase, action: 'reject', comment: text });
    builder.rejectGate(s.build, g.phase, text);
    s.gate = null;
    persist();
    return view();
  }

  /** The panel's view: everything but the Builder's internals and full factories. */
  function view() {
    const g = s.gate;
    return {
      source: s.source,
      line: { id: s.line.id, title: s.line.title },
      plan: s.plan.map((p, i) => ({ id: p.id, title: p.title, state: i < s.index ? 'approved' : i === s.index ? 'building' : 'planned' })),
      index: s.index,
      finished: s.index >= s.plan.length,
      phase: g ? g.phase : (s.build && PHASES.includes(s.build.from) ? s.build.from : s.index < s.plan.length ? 'layout' : null),
      gate: g ? {
        rev: g.rev, station: g.station, title: g.title, phase: g.phase, ok: g.ok, done: g.done,
        diff: g.diff, notes: g.notes, findings: g.findings, attempts: g.attempts, cost: g.cost, url: g.url, files: g.files,
      } : null,
      url: g?.url ?? s.approvedUrl,
      cost: s.cost,
      rev: s.rev,
      log: s.log.slice(-30),
    };
  }

  return { next, approve, reject, view, state: () => s, factory: () => s.base };
}
