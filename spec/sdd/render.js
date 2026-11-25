// The three SDD documents as markdown (Claude.md §6: constitution.md, factory-brief.md, plan.md),
// rendered by templates from data, never written by the model (rule 1). constitution.md comes from the
// project's conventions alone; the brief and the plan from the Spec agent's JSON.
import { CONVENTIONS } from '../../lib/core/conventions.js';
import { taktOf, productOf } from './checks.js';

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const list = (items, empty = '_None._') => (items?.length ? items.map((x) => `- ${x}`).join('\n') : empty);
/** A number with at most d decimals, trailing zeros dropped: 0.9, 1.6, 15. */
const num = (v, d = 1) => String(Number(Number(v).toFixed(d)));

/** constitution.md: the fixed rules every line follows (from lib/core/conventions.js). */
export function renderConstitution(conventions = CONVENTIONS) {
  const c = conventions;
  return `# Constitution

Fixed rules for every line this tool builds. They come from the project's conventions, not from the model; the brief and the plan work inside them.

## Units and axes
- Lengths in **metres**, times in **seconds**.
- Every station has its **own frame**; placing it in the line is a transform. Nothing in a station depends on world coordinates.
- Units flow along **${c.flow}**. The station conveyor runs along X through the station origin, belt top at **${num(c.beltHeight, 2)} m**.
- Operator walkway on **${c.walkwaySide}**; equipment and fencing on **${c.equipmentSide}**.

## Ports and flow
- A station takes a unit in at its **input** port (x = ${num(c.ports.input, 2)}), works on it at the **work** place (x = ${num(c.ports.work, 2)}) and hands it out at its **output** port (x = ${num(c.ports.output, 2)}).
- Ports carry one kind of goods: **unit, batch, case or pallet**. Two stations connect only where the goods match.
- Neighbouring stations are joined by a **${num(c.transferLength, 2)} m** transfer conveyor; a station slab is ${num(c.slabHalfLength * 2, 2)} m long.
- The line is laid out by a program from the line graph; nobody writes station positions.

## Naming
- Ids are camelCase (\`capping\`, \`rejectLane\`); every station has a short code (ST1, ST2, …) shown on its HMI.
- Every machine and every part is named; nothing floats (each part rests on something).

## Determinism
- No randomness in behaviour or geometry. The same factory.json always gives the same line and the same run.
- Quality decisions (pass / reject) are a fixed function of the unit's serial number.
- Simulation speeds: ${c.speeds.map((s) => `${s}×`).join(', ')}.

## How the line is made
- The agents write only JSON and markdown. All code comes from fixed templates and a hand-built component library.
- factory.json is the single source of truth: every change is a change to it, validated and recompiled.
- Deterministic checks run before any model review.
`;
}

/** factory-brief.md from the brief JSON. */
export function renderBrief(brief, { warnings = [] } = {}) {
  const product = productOf(brief);
  const shown = product.kind === 'parametric'
    ? `parametric ${product.params.shape ?? 'shape'}${product.params.length ? `, ${num(product.params.length * 1000, 0)} × ${num((product.params.width ?? product.params.length) * 1000, 0)} × ${num((product.params.height ?? 0) * 1000, 0)} mm` : ''}`
    : `catalog product \`${product.type}\``;
  const takt = taktOf(brief);
  return `# Factory brief: ${brief.title}

Line id \`${brief.id}\`.

## Product
**${brief.product.name}**: ${brief.product.description}

Shown in the twin as a ${shown}.

## Throughput
- Target: **${num(brief.targetPerHour, 1)} units per hour**, so a takt of **${num(takt, 1)} s** per unit.
- A simulated run: ${brief.runSize ?? 8} units.

## Process
| # | Step | What happens |
|---|---|---|
${brief.steps.map((s, i) => `| ${i + 1} | ${cell(s.name)} | ${cell(s.does)} |`).join('\n')}

## Quality
${brief.quality?.trim() ? brief.quality : '_Not specified._'}

## Constraints
${list(brief.constraints)}

## Assumptions
${list(brief.assumptions)}
${warnings.length ? `
## Checks
${warnings.map((w) => `- ⚠ ${w}`).join('\n')}
` : ''}${brief.questions?.length ? `
## Open questions
${brief.questions.map((q) => `- **${q.topic}**: ${q.question} _(${q.why})_`).join('\n')}
` : ''}`;
}

/** plan.md from the plan JSON (and its brief, for the takt). */
export function renderPlan(plan, brief) {
  const takt = taktOf(brief);
  const slowest = plan.stations.reduce((a, s) => (s.seconds > a.seconds ? s : a), plan.stations[0]);
  return `# Plan: ${brief.title}

${plan.stations.length} station${plan.stations.length === 1 ? '' : 's'} in a straight line, joined by \`${plan.transport}\` transfers. Takt ${num(takt, 1)} s (${num(brief.targetPerHour, 1)}/h); the slowest station is **${slowest.title}** at ${num(slowest.seconds, 1)} s.

## Line graph
${plan.stations.map((s) => `**${s.code ?? s.id}** ${s.title}`).join(' → ')}

## Stations
| # | Code | Station | Does | Budget (s) | Covers |
|---|---|---|---|---|---|
${plan.stations.map((s, i) => `| ${i + 1} | ${cell(s.code ?? '')} | ${cell(s.title)} (\`${s.id}\`) | ${cell(s.does)} | ${num(s.seconds, 1)} | ${cell(s.covers.join(', '))} |`).join('\n')}

${plan.stations.map((s) => `### ${s.code ? `${s.code} ` : ''}${s.title}
${s.steps.map((x, i) => `${i + 1}. ${x}`).join('\n')}
${s.machines?.length ? `\nExpected machines: ${s.machines.map((m) => `\`${m}\``).join(', ')}.` : ''}`).join('\n\n')}

## Takt budget
| Station | Budget (s) | Share of takt |
|---|---|---|
${plan.stations.map((s) => `| ${cell(s.title)} | ${num(s.seconds, 1)} | ${Math.round((s.seconds / takt) * 100)} % |`).join('\n')}

## Notes
${list(plan.notes)}
`;
}
