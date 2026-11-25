// Checks in code for the SDD documents (rule 3: what code can check, code checks), and the plan as
// the Builder's job. The brief and plan are the Spec agent's JSON (agents/spec/schemas.js, decoded).
//
//   taktOf(brief)                    seconds per unit the line must reach
//   productOf(brief)                 factory.json's product
//   checkBrief(registry, brief)      → problems (strings with paths), [] when fine
//   checkPlan(registry, plan, brief) → problems
//   jobFromSdd(brief, plan)          → { line, product, plan: [...] } for the Builder session
import { Product } from '../factory.schema.js';

const ID = /^[a-z][a-zA-Z0-9]*$/;

/** Takt time (s per unit) from the target rate. */
export const taktOf = (brief) => 3600 / brief.targetPerHour;

/** The brief's product as factory.json has it. */
export function productOf(brief) {
  const m = brief.product.model;
  return m.kind === 'parametric' ? { kind: 'parametric', params: m.params ?? {} } : { kind: 'catalog', type: m.type, params: m.params ?? {} };
}

const dupes = (list) => [...new Set(list.filter((x, i) => list.indexOf(x) !== i))];

export function checkBrief(registry, brief) {
  const problems = [];
  if (!ID.test(brief.id ?? '')) problems.push(`id: "${brief.id}" must be camelCase (a-z first, then letters and digits)`);
  if (!brief.title?.trim()) problems.push('title: give the line a name');
  else if (brief.title.length > 60) problems.push(`title: ${brief.title.length} characters, at most 60`);
  const product = productOf(brief);
  const parsed = Product.safeParse(product);
  if (!parsed.success) problems.push(`product.model: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
  else {
    const def = registry.getProduct(product.kind === 'catalog' ? product.type : 'parametric');
    if (!def) problems.push(`product.model: no catalog product "${product.type}"`);
    else {
      const p = def.params.safeParse(product.params);
      if (!p.success) problems.push(...p.error.issues.map((i) => `product.model.params.${i.path.join('.')}: ${i.message}`));
    }
  }
  if (!(brief.targetPerHour > 0)) problems.push('targetPerHour: must be above 0');
  const names = (brief.steps ?? []).map((s) => s.name.trim());
  if (!names.length) problems.push('steps: list what happens to the product, at least one step');
  for (const d of dupes(names.map((n) => n.toLowerCase()))) problems.push(`steps: "${d}" is named twice; step names must be unique`);
  return problems;
}

/** Words that say bad units leave the line (the brief's quality text or its steps). */
const REJECTS = /\breject|\bbad (units?|bottles?|parts?|ones?)|\bfail|off the line|\bscrap|\bdiscard|\bpushed off/i;

/**
 * Things code can see but not decide: shown to the owner (in the brief and on the page), not refused.
 * - rejects described but the product never fails (its every-Nth-fails setting is 0 or unset)
 */
export function briefWarnings(registry, brief) {
  const warnings = [];
  const product = productOf(brief);
  const def = registry.getProduct(product.kind === 'catalog' ? product.type : 'parametric');
  const text = [brief.quality ?? '', ...brief.steps.map((s) => `${s.name} ${s.does}`)].join(' ');
  if (def && REJECTS.test(text)) {
    const shape = def.params?.shape ?? {};
    const failKey = Object.keys(shape).find((k) => /^reject(Every|Rate)$/.test(k));
    if (failKey && !(Number(product.params?.[failKey]) > 0)) {
      warnings.push(`The brief says bad units are rejected, but product.model.params.${failKey} is ${product.params?.[failKey] ?? 'unset'}: no unit will ever fail, so the reject path never runs in the twin. Reject the brief with how often one should fail (e.g. "every 10th fails").`);
    }
  }
  return warnings;
}

/**
 * The plan against the brief: ids, a station for every brief step, nothing covering a step the brief
 * hasn't got, every budget within the takt (a straight line runs at its slowest station).
 */
export function checkPlan(registry, plan, brief) {
  const problems = [];
  const takt = taktOf(brief);
  const ids = plan.stations.map((s) => s.id);
  for (const [i, s] of plan.stations.entries()) {
    if (!ID.test(s.id)) problems.push(`stations[${i}].id: "${s.id}" must be camelCase`);
    if (s.title.length > 40) problems.push(`stations[${i}].title: ${s.title.length} characters, at most 40`);
    if (s.seconds > takt + 1e-9) problems.push(`stations[${i}].seconds: ${s.seconds} s is over the takt of ${takt.toFixed(1)} s (${brief.targetPerHour}/h); split the work over more stations or shorten it`);
    for (const t of s.machines ?? []) if (!registry.components().some((d) => d.type === t)) problems.push(`stations[${i}].machines: "${t}" is not a catalog type`);
  }
  for (const d of dupes(ids)) problems.push(`stations: id "${d}" is used twice`);
  const briefSteps = new Map(brief.steps.map((s) => [s.name.trim().toLowerCase(), s.name]));
  const covered = new Set();
  for (const [i, s] of plan.stations.entries()) {
    for (const c of s.covers) {
      const k = c.trim().toLowerCase();
      if (!briefSteps.has(k)) problems.push(`stations[${i}].covers: "${c}" is not a brief step (${[...briefSteps.values()].join(', ')})`);
      covered.add(k);
    }
  }
  for (const [k, name] of briefSteps) if (!covered.has(k)) problems.push(`stations: no station covers the brief step "${name}"`);
  if (!plan.transport) problems.push('transport: choose the conveyor between stations');
  return problems;
}

/** The approved brief and plan as the Builder session's job (server/builderApi.js POST /start). */
export function jobFromSdd(brief, plan) {
  return {
    line: { id: brief.id, title: brief.title, runSize: brief.runSize ?? 8, transport: { type: plan.transport, params: {} } },
    product: productOf(brief),
    plan: plan.stations.map((s) => ({ id: s.id, ...(s.code ? { code: s.code } : {}), title: s.title, does: s.does, steps: s.steps, seconds: s.seconds, ...(s.machines?.length ? { machines: s.machines } : {}) })),
  };
}
