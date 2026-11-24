// Rehearsals (step 8.5): the Builder driven by a scripted model, so the approval flow can run and be
// shown at $0 before any live answer is recorded (8.6). A rehearsal is a hand-written example line plus
// the placement hints its stations would be described with; the "model" answers each phase with that
// station encoded by the Builder's own schemas (exactly a strict-mode answer). No network, no ledger.
// It is not mock mode (agents/llm.js): mock replays recorded live answers; a rehearsal makes them up
// from hand-written data, and is labelled so everywhere it shows.
//
//   const r = loadRehearsal(registry, 'bottling', { root });
//   r → { name, title, about, job: { line, product }, plan: [{ id, title, does, steps }], llm }
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { layoutSchema, machinesSchema, processSchema } from './schemas.js';

const DIR = new URL('./rehearsals/', import.meta.url);

export class RehearsalError extends Error {}

/** Every op name used in a list of op entries, nested ones (decision cases) included. */
export function opsUsed(...lists) {
  const found = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if (typeof v.op === 'string') found.add(v.op);
      Object.values(v).forEach(walk);
    }
  };
  lists.forEach(walk);
  return [...found];
}

/** The three answers (IR shape) that describe a hand-written station with the given hints. */
export function stationAnswers(station, hints) {
  const own = new Set(station.equipment.map((e) => e.id));
  const ports = Object.entries(station.ports ?? {})
    .filter(([name]) => !['input', 'output', 'work'].includes(name))
    .map(([name, p]) => ({ name, machine: p.machine, port: p.port, direction: p.direction ?? 'out' }));
  const layout = {
    id: station.id,
    ...(station.code ? { code: station.code } : {}),
    title: station.title,
    ...(station.shell ? { shell: { type: station.shell.type, params: station.shell.params ?? {} } } : {}),
    equipment: station.equipment.map((e) => {
      const h = hints[e.id];
      if (!h) throw new RehearsalError(`no hint for machine "${e.id}" of station "${station.id}"`);
      const { why = e.type, ...place } = h;
      return { id: e.id, type: e.type, why, ...place };
    }),
    conveyor: station.conveyor,
    ...(ports.length ? { ports } : {}),
    ops: opsUsed(station.intake ?? [], station.process ?? [], station.output ?? []),
  };
  const machines = { params: Object.fromEntries(station.equipment.filter((e) => own.has(e.id)).map((e) => [e.id, e.params ?? {}])) };
  const process = {
    ...(station.intake ? { intake: station.intake } : {}),
    process: station.process ?? [],
    ...(station.output ? { output: station.output } : {}),
    ...(station.inputStage ? { inputStage: station.inputStage } : {}),
  };
  return { layout, machines, process };
}

/** The PLAN section of a Builder prompt (its JSON), or null. */
const planOf = (content) => {
  const section = content.split('\n\n').find((s) => s.startsWith('PLAN\n'));
  return section ? JSON.parse(section.slice(5)) : null;
};

/**
 * A scripted model for the Builder: answers by schema name for the station the prompt's PLAN names.
 * @param {object} registry
 * @param {Record<string, { station, hints }>} byId  hand-written station and hints, by plan id
 */
export function scriptedBuilderLlm(registry, byId) {
  const calls = [];
  return {
    calls,
    async call({ agent, schemaName, messages }) {
      const plan = planOf(messages.at(-1).content);
      const entry = plan && byId[plan.id];
      if (!entry) throw new RehearsalError(`rehearsal: no scripted station for plan ${JSON.stringify(plan?.id ?? null)}`);
      const a = stationAnswers(entry.station, entry.hints);
      const machineIds = [...new Set([...(a.layout.shell ? registry.expandShell(a.layout.shell.type, a.layout.shell.params).equipment.map((e) => e.id) : []), ...a.layout.equipment.map((e) => e.id)])];
      let output;
      if (schemaName === 'stationLayout') output = layoutSchema(registry).encode(a.layout);
      else if (schemaName === 'stationMachines') output = machinesSchema(registry, a.layout.equipment).encode(a.machines);
      else if (schemaName === 'stationProcess') output = processSchema(registry, { ops: a.layout.ops, machines: machineIds }).encode(a.process);
      else throw new RehearsalError(`rehearsal: no scripted answer for ${schemaName}`);
      calls.push({ agent, schemaName, station: plan.id, task: messages.at(-1).content });
      return { output, cost: 0, source: 'rehearsal', key: `rehearsal:${plan.id}:${schemaName}` };
    },
  };
}

/** The rehearsals there are (agents/builder/rehearsals/*.json). */
export const REHEARSALS = ['bottling'];

/** Loads a rehearsal: the job (line, product), the plan and its scripted model. */
export function loadRehearsal(registry, name, { root }) {
  if (!REHEARSALS.includes(name)) throw new RehearsalError(`no rehearsal "${name}" (there are: ${REHEARSALS.join(', ')})`);
  const spec = JSON.parse(readFileSync(new URL(`${name}.json`, DIR), 'utf8'));
  const sourcePath = join(root, spec.source);
  if (!existsSync(sourcePath)) throw new RehearsalError(`rehearsal "${name}": no ${spec.source}`);
  const source = JSON.parse(readFileSync(sourcePath, 'utf8'));
  const byId = {};
  const plan = spec.stations.map((s) => {
    const station = source.stations.find((x) => x.id === s.id);
    if (!station) throw new RehearsalError(`rehearsal "${name}": ${spec.source} has no station "${s.id}"`);
    byId[s.id] = { station, hints: s.hints };
    return { id: s.id, ...s.plan };
  });
  return {
    name,
    title: spec.title,
    about: spec.about,
    job: { line: { ...spec.line, ...(source.line.conventions ? { conventions: source.line.conventions } : {}) }, product: source.product },
    plan,
    llm: scriptedBuilderLlm(registry, byId),
  };
}
