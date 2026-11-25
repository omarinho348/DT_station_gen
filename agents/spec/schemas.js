// The Spec agent's answer schemas (Claude.md §7.1, Phase 9): the factory brief and the plan as JSON,
// typed from the registry (rule 1: the agent writes JSON; the .md documents are rendered from it by
// spec/sdd/render.js). Nothing here names a component, op or product (rule 6).
//
//   briefSchema(registry)   the line, the product (a catalog product or a parametric shape, with its
//                           params), the target rate, the process steps, constraints, assumptions and
//                           the questions the owner still has to answer
//   planSchema(registry)    the stations in flow order (id, title, what it does, its steps, its time
//                           budget, which brief steps it covers) and the conveyor between stations
//
// Each returns { name, schema (strict), decode, encode } like the Builder's schemas.
import { z } from 'zod';
import { toStrict } from '../strict.js';

const ID = '^[a-z][a-zA-Z0-9]*$';
const jsonOf = (schema) => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });

/** Params the line sets itself (never asked of the agent). */
const LINE_SET = ['serial'];

/** Products the brief can name: those built from params alone (not an imported model, which needs a file). */
export function briefProducts(registry) {
  return registry.products().filter((d) => !d.needsFile && d.type !== 'model').map((d) => d.type).sort();
}

/** Conveyors that can carry units between stations: a conveyor or transport with a length and in / out ports. */
export function transportTypes(registry) {
  return registry.components()
    .filter((d) => (d.category === 'conveyor' || d.category === 'transport') && 'length' in (jsonOf(d.params).properties ?? {}))
    .filter((d) => {
      try {
        const ports = Object.values(registry.componentSpec(d.type, {}).ports ?? {});
        return ports.some((p) => p.direction === 'in') && ports.some((p) => p.direction === 'out');
      } catch {
        return false;
      }
    })
    .map((d) => d.type)
    .sort();
}

/** Topics a follow-up question can be about (the UI groups them). */
export const QUESTION_TOPICS = Object.freeze(['product', 'throughput', 'steps', 'quality', 'layout', 'other']);

/** Phase 1 of the Spec agent: the factory brief. */
export function briefSchema(registry) {
  const types = briefProducts(registry);
  const $defs = {};
  const choices = types.map((type) => {
    const def = registry.getProduct(type);
    const params = jsonOf(def.params);
    for (const k of LINE_SET) {
      delete params.properties?.[k];
      if (params.required) params.required = params.required.filter((r) => r !== k);
    }
    $defs[`${type}Params`] = { ...params, description: `${type}: ${def.summary}` };
    return type === 'parametric'
      ? { type: 'object', properties: { kind: { const: 'parametric' }, params: { $ref: '#/$defs/parametricParams' } }, required: ['kind', 'params'] }
      : { type: 'object', properties: { kind: { const: 'catalog' }, type: { const: type }, params: { $ref: `#/$defs/${type}Params` } }, required: ['kind', 'type', 'params'] };
  });
  const source = {
    type: 'object',
    properties: {
      id: { type: 'string', pattern: ID, description: 'Line id, camelCase (e.g. juiceBottling)' },
      title: { type: 'string', description: 'Line name, at most 60 characters' },
      product: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'What the owner calls the product' },
          description: { type: 'string', description: 'One or two sentences: what it is, its size, what it is made of' },
          model: { description: 'How the twin shows it: a catalog product, or a parametric shape (box, cylinder, bottle, tray) with its size', anyOf: choices },
        },
        required: ['name', 'description', 'model'],
      },
      targetPerHour: { type: 'number', minimum: 1, maximum: 3600, description: 'Finished units per hour the line must reach (the takt follows from it)' },
      runSize: { type: 'integer', minimum: 2, maximum: 50, description: 'Units in one simulated run (default 8)' },
      steps: {
        type: 'array',
        minItems: 1,
        description: 'What happens to the product, in order, as the owner described it (one step per distinct operation)',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short name, unique, e.g. "Fill"' },
            does: { type: 'string', description: 'One sentence' },
          },
          required: ['name', 'does'],
        },
      },
      quality: { type: 'string', description: 'How bad units are found and what happens to them (none if the owner said nothing)' },
      constraints: { type: 'array', items: { type: 'string' }, description: 'Limits the owner gave: space, budget, operators, hygiene, existing machines' },
      assumptions: { type: 'array', items: { type: 'string' }, description: 'What you assumed where the owner said nothing (each one the owner can correct)' },
      questions: {
        type: 'array',
        description: 'What you still need to know before a plan can be made; empty when the brief is complete',
        items: {
          type: 'object',
          properties: {
            topic: { type: 'string', enum: QUESTION_TOPICS },
            question: { type: 'string' },
            why: { type: 'string', description: 'What the answer decides' },
          },
          required: ['topic', 'question', 'why'],
        },
      },
    },
    required: ['id', 'title', 'product', 'targetPerHour', 'steps', 'constraints', 'assumptions', 'questions'],
    $defs,
  };
  return { name: 'factoryBrief', ...toStrict(source) };
}

/** Phase 2 of the Spec agent: the plan (stations in flow order). */
export function planSchema(registry) {
  const source = {
    type: 'object',
    properties: {
      transport: { type: 'string', enum: transportTypes(registry), description: 'Catalog conveyor that carries units between stations' },
      stations: {
        type: 'array',
        minItems: 1,
        description: 'The stations in flow order (a straight line: each feeds the next)',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', pattern: ID, description: 'camelCase, unique, e.g. capping' },
            code: { type: 'string', description: 'Short code on the HMI, e.g. ST3' },
            title: { type: 'string', description: 'Station function, at most 40 characters' },
            does: { type: 'string', description: 'One sentence: what the station does to each unit' },
            steps: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'Its work in order, from the unit arriving to it leaving' },
            seconds: { type: 'number', minimum: 1, maximum: 3600, description: 'Its time budget per unit (s): within the takt' },
            covers: { type: 'array', minItems: 1, items: { type: 'string' }, description: 'The brief steps (by name) this station does' },
            machines: { type: 'array', items: { type: 'string' }, description: 'Catalog types you expect it to use (a hint for the Builder; may be empty)' },
          },
          required: ['id', 'title', 'does', 'steps', 'seconds', 'covers', 'machines'],
        },
      },
      notes: { type: 'array', items: { type: 'string' }, description: 'Choices worth the owner\'s attention (a step split across stations, a tight budget)' },
    },
    required: ['transport', 'stations', 'notes'],
  };
  return { name: 'linePlan', ...toStrict(source) };
}
