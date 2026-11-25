// The Reviewer's LLM critique (Claude.md §7.3 step 2, Phase 11): only once the deterministic checks pass,
// the model reads a short TEXT summary of the line (never code, rule 7) next to the brief and says where
// the line does not fit it. Its findings are advice for the owner (and requests the Editor can take);
// nothing changes by itself.
//
//   lineSummary(registry, factory, { timing, kpis, findings }) → text
//   createCritic({ registry, llm }).critique({ factory, brief?, kpis? }) → { ok, skipped?, verdict, summary, issues, cost }
import { readFileSync } from 'node:fs';
import { review } from './deterministic.js';
import { toStrict } from '../strict.js';
import { catalogIndex } from '../../lib/catalog.js';

const INSTRUCTIONS = new URL('../prompts/critic.md', import.meta.url);
const n = (v, d = 1) => (Number.isFinite(v) ? String(Number(v.toFixed(d))) : '?');

/** What the critic reads about a line: plain text, a few lines per station. */
export function lineSummary(registry, factory, { timing = null, kpis = null, findings = [] } = {}) {
  const t = timing ?? review(registry, factory, { play: false, geometry: false }).timing;
  const cycleOf = (id) => {
    const list = Array.isArray(t?.stations) ? t.stations : [];
    const r = list.find((x) => x.id === id) ?? list.find((x) => x.id?.startsWith(id));
    return r ? n(r.cycleTime) : '?';
  };
  const product = factory.product.kind === 'catalog' ? `catalog product ${factory.product.type}` : `${factory.product.kind} ${factory.product.params?.shape ?? ''}`.trim();
  const out = [
    `LINE ${factory.line.title} (${factory.line.id}), run of ${factory.line.runSize ?? 8} units, product: ${product}${factory.product.params?.rejectEvery ? `, every ${factory.product.params.rejectEvery}th unit fails inspection` : ''}`,
    t ? `TIMING line cycle ${n(t.takt, 2)} s (${n(3600 / t.takt, 0)} units/h); bottleneck ${t.bottleneck?.kind} ${t.bottleneck?.id}; one unit through the empty line ${n(t.leadTime)} s` : 'TIMING unknown',
    'STATIONS (flow order)',
  ];
  for (const s of factory.stations) {
    const ops = [...(s.intake ?? []), ...(s.process ?? []), ...(s.output ?? [])];
    const labels = (s.process ?? []).map((o) => o.label ?? o.op).filter(Boolean);
    out.push(`- ${s.code ?? s.id} ${s.title} (${s.id})${s.parallel ? `, ${s.parallel} parallel copies` : ''}: cycle ${cycleOf(s.id)} s; machines ${s.equipment.map((e) => `${e.id}:${e.type}`).join(', ')}${s.shell ? ` in a ${s.shell.type} shell` : ''}; ${ops.length} ops; work: ${labels.slice(0, 8).join(' → ') || '(default transfer only)'}${labels.length > 8 ? ' …' : ''}${Object.keys(s.ports ?? {}).filter((p) => !['input', 'output'].includes(p)).map((p) => `; extra port ${p}`).join('')}`);
  }
  out.push(`FLOW ${(factory.graph?.edges ?? []).map((e) => `${e.from} → ${e.to}${e.transport?.capacity > 1 ? ` (buffer ${e.transport.capacity})` : ''}`).join('; ') || 'none'}`);
  if (kpis) out.push(`SIMULATION run of ${kpis.runSize}: ${kpis.steadyPerHour ? `${n(kpis.steadyPerHour, 0)} good units/h once the line is full (${n(kpis.throughputPerHour, 0)}/h over this short run, filling the empty line included)` : `${n(kpis.throughputPerHour, 0)} good units/h over the run`}, takt achieved ${n(kpis.taktAchieved, 2)} s, lead time ${n(kpis.leadTime?.mean, 0)} s, WIP mean ${n(kpis.wip?.mean, 1)}, rejects ${kpis.rejects?.count}; utilisation ${Object.entries(kpis.utilisation ?? {}).map(([k, u]) => `${k} ${Math.round(u * 100)}%`).join(', ')}`);
  const warn = findings.filter((f) => f.severity === 'warning');
  if (warn.length) out.push(`CHECK WARNINGS ${warn.map((f) => `${f.check}: ${f.message}`).join(' | ')}`);
  return out.join('\n');
}

export const SEVERITIES = Object.freeze(['high', 'medium', 'low']);

export function critiqueSchema() {
  return {
    name: 'lineCritique',
    ...toStrict({
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['fits', 'concerns', 'misfit'], description: 'fits: the line does what the brief asks; concerns: it does, with issues worth fixing; misfit: it misses something the brief requires' },
        summary: { type: 'string', description: 'Two sentences for the owner' },
        issues: {
          type: 'array',
          description: 'Concrete issues, most important first; empty when it fits',
          items: {
            type: 'object',
            properties: {
              severity: { type: 'string', enum: SEVERITIES },
              station: { type: 'string', description: 'Station id the issue is about, or null for the whole line' },
              issue: { type: 'string', description: 'What is wrong, against which part of the brief' },
              request: { type: 'string', description: 'The change as a request the Editor can carry out, in plain words (e.g. "make Capping 2 s faster"), or null when it needs a new station or a person' },
            },
            required: ['severity', 'issue'],
          },
        },
      },
      required: ['verdict', 'summary', 'issues'],
    }),
  };
}

export function createCritic({ registry, llm }) {
  const system = `${readFileSync(INSTRUCTIONS, 'utf8').trim()}\n\nCATALOG\n${JSON.stringify(catalogIndex(registry))}`;
  const def = critiqueSchema();

  /**
   * @param {object} o
   * @param {object} o.factory
   * @param {object} [o.brief]  the approved brief (sdd/<id>/brief.json), when the line came from the Spec flow
   * @param {object} [o.kpis]   the SimPy KPIs (simpy/<folder>/kpis.json)
   */
  async function critique({ factory, brief = null, kpis = null }) {
    // Rule 3: the deterministic reviewer first; the model only sees a line that passes it.
    const checked = review(registry, factory, { play: false });
    if (!checked.ok) {
      return { ok: false, skipped: 'the deterministic checks have errors: fix those first', errors: checked.findings.filter((f) => f.severity === 'error'), cost: 0 };
    }
    const summary = lineSummary(registry, factory, { timing: checked.timing, kpis, findings: checked.findings });
    const briefText = brief
      ? JSON.stringify({ title: brief.title, product: brief.product?.name, targetPerHour: brief.targetPerHour, steps: brief.steps, quality: brief.quality, constraints: brief.constraints })
      : 'No approved brief: judge the line as a plausible industrial line for its product.';
    const task = `CRITIQUE\n\nBRIEF\n${briefText}\n\nLINE SUMMARY\n${summary}`;
    const r = await llm.call({ agent: 'reviewer', schemaName: def.name, schema: def.schema, messages: [{ role: 'system', content: system }, { role: 'user', content: task }] });
    const answer = def.decode(r.output);
    // The station by its id, code or title (models use all three); one the line hasn't got → the whole line.
    const find = (name) => {
      const k = String(name ?? '').trim().toLowerCase();
      return k ? factory.stations.find((s) => [s.id, s.code, s.title].some((x) => String(x ?? '').toLowerCase() === k))?.id ?? null : null;
    };
    const issues = answer.issues.map((i) => ({ ...i, station: find(i.station) }));
    return { ok: true, verdict: answer.verdict, summary: answer.summary, issues, cost: r.cost, lineSummary: summary };
  }

  return { critique, system };
}
