// The Spec agent (Claude.md §7.1): turns the owner's description (chat, guided answers, a template or an
// uploaded .md) into the factory brief, asking follow-up questions where something is missing, and the
// approved brief into the plan. Both are JSON typed by agents/spec/schemas.js, checked in code
// (spec/sdd/checks.js) and refused back to the model with the problems, at most `maxRetries` times.
// The markdown documents are rendered from the JSON (spec/sdd/render.js); the model writes no code.
//
//   const spec = createSpec({ registry, llm });
//   await spec.draftBrief({ conversation, previous?, feedback? })  → { ok, brief, attempts, cost, problems, warnings }
//   await spec.draftPlan({ brief, previous?, feedback? })          → { ok, plan, attempts, cost, problems }
//
//   conversation  [{ from: 'owner' | 'spec', text, source? }]: what the owner wrote (source: chat, guided,
//                 template, upload) and the agent's questions, oldest first
//   feedback      the owner's comment when they rejected the previous draft
import { readFileSync } from 'node:fs';
import { briefSchema, planSchema } from './schemas.js';
import { checkBrief, checkPlan, taktOf, briefWarnings } from '../../spec/sdd/checks.js';
import { catalogIndex } from '../../lib/catalog.js';

const INSTRUCTIONS = new URL('../prompts/spec.md', import.meta.url);

/** Longest owner text sent to the model (characters); an uploaded document beyond it is cut, with a note. */
export const MAX_OWNER_TEXT = 12000;

export function createSpec({ registry, llm, maxRetries = 2 }) {
  // The stable start of every Spec prompt: instructions, then the catalog (the same bytes all session).
  const system = `${readFileSync(INSTRUCTIONS, 'utf8').trim()}\n\nCATALOG\n${JSON.stringify(catalogIndex(registry))}`;
  const sectionsText = (title, sections) => [title, ...Object.entries(sections)
    .filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))
    .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}\n${typeof v === 'string' ? v : JSON.stringify(v)}`)].join('\n\n');

  const ask = (def, task, model = 'default') => llm.call({
    agent: 'spec', schemaName: def.name, schema: def.schema, model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: task }],
  });

  /** The conversation as the model reads it: who said what, long owner texts cut. */
  const transcript = (conversation) => conversation.map((m) => {
    const text = String(m.text ?? '');
    const cut = text.length > MAX_OWNER_TEXT ? `${text.slice(0, MAX_OWNER_TEXT)}\n[… cut: ${text.length - MAX_OWNER_TEXT} more characters]` : text;
    return `${m.from === 'spec' ? 'SPEC AGENT' : `OWNER${m.source && m.source !== 'chat' ? ` (${m.source})` : ''}`}: ${cut}`;
  }).join('\n\n');

  /** Runs one document's call with retries on the problems `check` finds. */
  async function draft({ def, task, check, model, ownerFeedback, previous }) {
    const attempts = [];
    let cost = 0;
    let feedback = ownerFeedback ? `The owner rejected your previous draft with this comment: "${String(ownerFeedback).trim()}". Change what the comment asks and keep the rest.` : null;
    let last = previous ?? null;
    let value = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const r = await ask(def, task({ previousAnswer: feedback ? last : null, feedback }), model);
      cost += r.cost;
      value = def.decode(r.output);
      const problems = check(value);
      if (!problems.length) return { ok: true, value, attempts, cost, problems: [] };
      attempts.push({ problems });
      last = value;
      feedback = `Your answer was refused. Fix these and keep the rest:\n${problems.map((p) => `- ${p}`).join('\n')}`;
    }
    return { ok: false, value, attempts, cost, problems: attempts.at(-1).problems };
  }

  async function draftBrief({ conversation, previous = null, feedback = null }) {
    if (!conversation?.some((m) => m.from !== 'spec' && String(m.text ?? '').trim())) throw new Error('draftBrief needs something the owner wrote');
    const def = briefSchema(registry);
    const r = await draft({
      def, previous, ownerFeedback: feedback,
      task: (extra) => sectionsText('DOCUMENT factory brief', { conversation: transcript(conversation), ...extra }),
      check: (brief) => checkBrief(registry, brief),
    });
    // Warnings: what code sees but the owner decides (shown, not refused).
    return { ok: r.ok, brief: r.value, attempts: r.attempts, cost: r.cost, problems: r.problems, warnings: r.value ? briefWarnings(registry, r.value) : [] };
  }

  async function draftPlan({ brief, previous = null, feedback = null }) {
    const def = planSchema(registry);
    const facts = { takt: `${(Math.round(taktOf(brief) * 10) / 10)} s per unit (${brief.targetPerHour}/h)`, stepNames: brief.steps.map((s) => s.name) };
    const { questions, ...approved } = brief; // an approved brief has no open questions worth sending
    const r = await draft({
      def, previous, ownerFeedback: feedback, model: 'strong', // the strong model only if enabled (Claude.md §5)
      task: (extra) => sectionsText('DOCUMENT plan', { brief: approved, ...facts, ...extra }),
      check: (plan) => checkPlan(registry, plan, brief),
    });
    return { ok: r.ok, plan: r.value, attempts: r.attempts, cost: r.cost, problems: r.problems };
  }

  return { draftBrief, draftPlan, system };
}
