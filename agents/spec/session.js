// A Spec session (Phase 9 step 3): the conversation with the Spec agent and the three SDD documents,
// each drafted, shown, and approved or rejected with a comment by the owner (Claude.md §7.1).
//
//   constitution.md  rendered from the conventions (no model); the owner approves it
//   factory-brief.md the agent's brief from the conversation; open questions go back to the owner, whose
//                    answers redraft it
//   plan.md          drafted by the agent once the brief is approved; a new brief resets it
//
// Approved documents are written by `saveDocs(lineId, files)` (the server: sdd/<line>/). Plain JSON state.
import { renderConstitution, renderBrief, renderPlan } from '../../spec/sdd/render.js';
import { jobFromSdd, taktOf } from '../../spec/sdd/checks.js';

export class SpecSessionError extends Error {}

const SOURCES = ['chat', 'guided', 'template', 'upload'];
const DOCS = ['constitution', 'brief', 'plan'];
const empty = () => ({ status: 'none', data: null, md: null, rev: 0, attempts: [], problems: [], warnings: [], cost: 0 });

/**
 * @param {object} o
 * @param {object} o.spec        createSpec(…)
 * @param {Function} [o.saveDocs]  (lineId, { 'constitution.md': text, … }) when documents are approved
 * @param {Function} [o.save]    (state) after every change
 * @param {object} [o.state]     a saved state to go on from
 * @param {Function} [o.now]
 */
export function createSpecSession({ spec, saveDocs = null, save = null, state = null, now = () => new Date().toISOString() }) {
  const s = state ?? {
    conversation: [],
    docs: { constitution: { ...empty(), status: 'draft', md: renderConstitution(), rev: 1 }, brief: empty(), plan: empty() },
    cost: 0,
    log: [],
  };
  const persist = () => save?.(s);
  const record = (entry) => s.log.push({ time: now(), ...entry });

  const setDoc = (name, r, value, md) => {
    const d = s.docs[name];
    s.docs[name] = { status: r.ok ? 'draft' : 'failed', data: value, md, rev: d.rev + 1, attempts: r.attempts, problems: r.problems, warnings: r.warnings ?? [], cost: r.cost };
    s.cost += r.cost;
    record({ doc: name, action: r.ok ? 'draft' : 'failed', cost: r.cost, retries: r.attempts.length });
  };

  /** Writes every approved document (and its JSON) for the line. */
  function writeApproved() {
    const brief = s.docs.brief;
    if (!saveDocs || brief.status !== 'approved') return;
    const files = {};
    if (s.docs.constitution.status === 'approved') files['constitution.md'] = s.docs.constitution.md;
    files['factory-brief.md'] = brief.md;
    files['brief.json'] = `${JSON.stringify(brief.data, null, 2)}\n`;
    if (s.docs.plan.status === 'approved') {
      files['plan.md'] = s.docs.plan.md;
      files['plan.json'] = `${JSON.stringify(s.docs.plan.data, null, 2)}\n`;
    }
    saveDocs(brief.data.id, files);
  }

  async function redraftBrief(feedback = null) {
    const prev = s.docs.brief.data;
    const r = await spec.draftBrief({ conversation: s.conversation, previous: prev, feedback });
    setDoc('brief', r, r.brief, r.brief ? renderBrief(r.brief, { warnings: r.warnings }) : null);
    // Questions go into the conversation, so the owner's answers follow them.
    if (r.ok && r.brief.questions.length) s.conversation.push({ from: 'spec', text: r.brief.questions.map((q) => q.question).join('\n'), time: now() });
    s.docs.plan = empty(); // a new brief needs a new plan
  }

  async function redraftPlan(feedback = null) {
    const r = await spec.draftPlan({ brief: s.docs.brief.data, previous: s.docs.plan.data, feedback });
    setDoc('plan', r, r.plan, r.plan ? renderPlan(r.plan, s.docs.brief.data) : null);
  }

  /** The owner writes (chat, guided answers, a template, an uploaded .md): the brief is (re)drafted. */
  async function message(text, source = 'chat') {
    const t = String(text ?? '').trim();
    if (!t) throw new SpecSessionError('write something first');
    if (!SOURCES.includes(source)) throw new SpecSessionError(`source must be one of ${SOURCES.join(', ')}`);
    s.conversation.push({ from: 'owner', text: t, source, time: now() });
    record({ doc: 'brief', action: 'message', source });
    try {
      await redraftBrief();
    } finally {
      persist();
    }
    return view();
  }

  /** Approves a document. Approving the brief drafts the plan. */
  async function approve(doc) {
    if (!DOCS.includes(doc)) throw new SpecSessionError(`doc must be one of ${DOCS.join(', ')}`);
    const d = s.docs[doc];
    if (d.status !== 'draft') throw new SpecSessionError(`there is no ${doc} draft to approve (${d.status})`);
    d.status = 'approved';
    record({ doc, action: 'approve' });
    try {
      if (doc === 'brief') await redraftPlan();
      writeApproved();
    } finally {
      persist();
    }
    return view();
  }

  /** Sends the owner's comment back: the brief or the plan is redrafted with it. */
  async function reject(doc, comment) {
    if (doc === 'constitution') throw new SpecSessionError('the constitution comes from the project conventions (lib/core/conventions.js), not from the agent: it cannot be redrafted');
    if (!DOCS.includes(doc)) throw new SpecSessionError(`doc must be one of ${DOCS.join(', ')}`);
    const text = String(comment ?? '').trim();
    if (!text) throw new SpecSessionError('a rejection needs a comment saying what to change');
    const d = s.docs[doc];
    if (!['draft', 'failed', 'approved'].includes(d.status)) throw new SpecSessionError(`there is no ${doc} to reject`);
    if (doc === 'plan' && s.docs.brief.status !== 'approved') throw new SpecSessionError('approve the brief first');
    record({ doc, action: 'reject', comment: text });
    try {
      if (doc === 'brief') { s.conversation.push({ from: 'owner', text: `(on the brief) ${text}`, source: 'chat', time: now() }); await redraftBrief(text); }
      else await redraftPlan(text);
    } finally {
      persist();
    }
    return view();
  }

  /** Drafts again what is missing after an error (a budget or mock refusal): the plan of an approved brief, else the brief. */
  async function retry() {
    try {
      if (s.docs.brief.status === 'approved' && ['none', 'failed'].includes(s.docs.plan.status)) await redraftPlan();
      else if (['none', 'failed'].includes(s.docs.brief.status) && s.conversation.some((m) => m.from === 'owner')) await redraftBrief();
      else throw new SpecSessionError('nothing to draft again');
      writeApproved();
    } finally {
      persist();
    }
    return view();
  }

  /** Everything approved: the Builder's job. */
  const ready = () => DOCS.every((d) => s.docs[d].status === 'approved');

  function view() {
    const doc = (name) => {
      const d = s.docs[name];
      return { status: d.status, md: d.md, rev: d.rev, problems: d.problems, warnings: d.warnings ?? [], retries: d.attempts.length, cost: d.cost };
    };
    const brief = s.docs.brief.data;
    return {
      conversation: s.conversation.map(({ from, text, source }) => ({ from, text, source })),
      questions: s.docs.brief.status === 'draft' || s.docs.brief.status === 'approved' ? brief?.questions ?? [] : [],
      line: brief ? { id: brief.id, title: brief.title, takt: taktOf(brief), targetPerHour: brief.targetPerHour } : null,
      docs: { constitution: doc('constitution'), brief: doc('brief'), plan: doc('plan') },
      ready: ready(),
      job: ready() ? jobFromSdd(brief, s.docs.plan.data) : null,
      cost: s.cost,
      log: s.log.slice(-30),
    };
  }

  return { message, approve, reject, retry, view, state: () => s };
}
