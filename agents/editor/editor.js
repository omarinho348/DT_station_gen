// The Editor agent (Claude.md §7.4): an owner's request in plain words → an RFC 6902 JSON Patch on
// factory.json. The patch is applied to a copy, validated by the IR schema and reviewed by the
// deterministic reviewer (rule 3); findings the patch brings in are refused back to the model with its
// previous answer, at most `maxRetries` times. Nothing is saved here: the caller shows the diff and the
// owner applies or discards it (agents/editor/session.js).
//
//   const editor = createEditor({ registry, llm });
//   const r = await editor.propose({ factory, request, feedback? })
//   r → { ok, summary, ops, factory, diff, findings, questions, attempts, cost, problems }
import { readFileSync } from 'node:fs';
import { patchSchema } from './schemas.js';
import { applyPatch, describeDiff, parsePointer, PatchError } from '../diff.js';
import { catalogIndex, catalogDetail } from '../../lib/catalog.js';
import { review } from '../reviewer/deterministic.js';
import { parseFactory } from '../../spec/factory.schema.js';

const INSTRUCTIONS = new URL('../prompts/editor.md', import.meta.url);

/** Paths no edit may touch. */
const FIXED = [/^$/, /^\/version(\/|$)/, /^\/line\/id$/, /^\/line$/];

/** A finding's identity, to tell the patch's findings from those the line already had. */
const findingKey = (f) => `${f.check}|${f.severity}|${f.path}|${f.message}`;
const blocking = (f) => f.severity === 'error' || (f.check === 'geometry' && f.severity === 'warning');

/** Every op name and component type a station uses (nested op lists included). */
function stationUses(station) {
  const ops = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.op === 'string') ops.add(v.op);
      Object.values(v).forEach(walk);
    }
  };
  walk([station.intake ?? [], station.process ?? [], station.output ?? []]);
  return { ops: [...ops], types: [...new Set((station.equipment ?? []).map((e) => e.type))] };
}

/**
 * The stations a request is about: those whose id, code or title it names (whole words, any case);
 * none named → every station. Deterministic: decides which detail goes in the prompt.
 */
export function targetStations(factory, request) {
  const text = ` ${String(request).toLowerCase()} `;
  const named = factory.stations.filter((s) => [s.id, s.code, s.title].filter(Boolean).some((k) => {
    const word = String(k).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`[^a-z0-9]${word}[^a-z0-9]`).test(text);
  }));
  return named.length ? named : factory.stations;
}

export function createEditor({ registry, llm, maxRetries = 2, play = true }) {
  const system = `${readFileSync(INSTRUCTIONS, 'utf8').trim()}\n\nCATALOG\n${JSON.stringify(catalogIndex(registry))}`;
  const def = patchSchema();

  const timingOf = (factory) => {
    const t = review(registry, factory, { play: false, geometry: false }).timing;
    if (!t) return null;
    const list = Array.isArray(t.stations) ? t.stations : Object.entries(t.stations).map(([id, p]) => ({ id, ...p }));
    const secs = (p) => Number(Number(p.cycleTime ?? p.time ?? 0).toFixed(2));
    return {
      lineCycle: Number(t.takt.toFixed(2)),
      bottleneck: t.bottleneck ? `${t.bottleneck.kind} ${t.bottleneck.id ?? t.bottleneck.station}` : null,
      stations: Object.fromEntries(list.map((p, i) => [p.id ?? p.station ?? String(i), secs(p)])),
    };
  };

  /** Checks a patch answer: values parse, paths allowed, it applies, the IR is valid, no new findings. */
  function check(factory, answer, before) {
    const problems = [];
    const ops = [];
    for (const [i, o] of answer.ops.entries()) {
      if (FIXED.some((re) => re.test(o.path))) { problems.push(`ops[${i}].path: "${o.path}" may not be changed`); continue; }
      try { parsePointer(o.path); } catch { problems.push(`ops[${i}].path: "${o.path}" is not a JSON Pointer`); continue; }
      if (!o.path.startsWith('/')) { problems.push(`ops[${i}].path: "${o.path}" must start with /`); continue; }
      if (o.op === 'remove') { ops.push({ op: 'remove', path: o.path }); continue; }
      if (o.valueJson === undefined || o.valueJson === null || o.valueJson === '') { problems.push(`ops[${i}].valueJson: ${o.op} needs a value`); continue; }
      try {
        ops.push({ op: o.op, path: o.path, value: JSON.parse(o.valueJson) });
      } catch (error) {
        problems.push(`ops[${i}].valueJson: not JSON (${error.message})`);
      }
    }
    if (problems.length) return { problems };
    let after;
    try {
      after = applyPatch(factory, ops);
    } catch (error) {
      if (!(error instanceof PatchError)) throw error;
      return { problems: [`patch: ${error.message}`] };
    }
    try {
      parseFactory(after);
    } catch (error) {
      return { problems: (error.issues ?? [{ path: [], message: error.message }]).map((x) => `${Array.isArray(x.path) ? x.path.join('.') : x.path}: ${x.message}`) };
    }
    // The reviewer: only what the patch brings in counts against it.
    const had = new Set(before.findings.map(findingKey));
    let result = review(registry, after, { play: false });
    let fresh = result.findings.filter((f) => blocking(f) && !had.has(findingKey(f)));
    if (!fresh.length && play) {
      result = review(registry, after, { play: true, geometry: false });
      fresh = result.findings.filter((f) => f.check === 'play' && f.severity === 'error' && !had.has(findingKey(f)));
    }
    if (fresh.length) return { problems: fresh.map((f) => `${f.path}: ${f.message}${f.hint ? ` (${f.hint})` : ''}`) };
    return { problems: [], ops, after, findings: result.findings };
  }

  async function propose({ factory, request, feedback = null }) {
    const text = String(request ?? '').trim();
    if (!text) throw new Error('propose needs a request');
    const targets = targetStations(factory, text);
    const uses = targets.map(stationUses);
    const detail = catalogDetail(registry, { types: [...new Set(uses.flatMap((u) => u.types))], ops: [...new Set(uses.flatMap((u) => u.ops))] });
    const before = review(registry, factory, { play: false });
    const sections = { request: text, line: factory, timing: timingOf(factory), detail };
    const attempts = [];
    let cost = 0;
    let previous = null;
    let note = feedback ? `The owner discarded your previous patch with this comment: "${String(feedback).trim()}".` : null;
    let last = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const task = ['EDIT', ...Object.entries({ ...sections, previousAnswer: previous, feedback: note })
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `${k.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()}\n${typeof v === 'string' ? v : JSON.stringify(v)}`)].join('\n\n');
      const r = await llm.call({ agent: 'editor', schemaName: def.name, schema: def.schema, messages: [{ role: 'system', content: system }, { role: 'user', content: task }] });
      cost += r.cost;
      const answer = def.decode(r.output);
      last = answer;
      if (!answer.ops.length) {
        if (answer.questions.length) return { ok: true, summary: answer.summary, ops: [], factory, diff: [], findings: [], questions: answer.questions, attempts, cost, problems: [] };
        attempts.push({ problems: ['ops: empty, and no question asked: give the patch, or ask'] });
      } else {
        const c = check(factory, answer, before);
        if (!c.problems.length) {
          return { ok: true, summary: answer.summary, ops: c.ops, factory: c.after, diff: describeDiff(factory, c.after), findings: c.findings, questions: answer.questions, attempts, cost, problems: [] };
        }
        attempts.push({ problems: c.problems });
      }
      previous = last;
      note = `Your patch was refused. Fix these and keep the rest:\n${attempts.at(-1).problems.map((p) => `- ${p}`).join('\n')}`;
    }
    return { ok: false, summary: last?.summary ?? '', ops: [], factory, diff: [], findings: [], questions: [], attempts, cost, problems: attempts.at(-1).problems };
  }

  return { propose, system, targetStations };
}
