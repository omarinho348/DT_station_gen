// factory.json: the single source of truth for a line (Claude.md §3 rule 2, §6.5). Agents only
// ever write or patch this JSON; everything else (Three.js files, SimPy) is compiled from it.
//
//   version   schema version (1)
//   line      id, title, units, flow, run size, speed choices, optional convention overrides
//   product   what flows: a catalog product (parametric shapes and GLB imports come in Phase 6)
//   stations  each: a shell preset (slab, conveyor, sign, HMI…) + its own equipment by catalog
//             type + its process as ops. Never positions in the line: layout.js places stations.
//   graph     typed edges between station ports, each with its transport
//
// Checks here are structural (shape, ids, references inside the file). Whether a type, op or port
// exists in the catalog is checked when the file is expanded and planned (compiler/expand.js), and
// in depth by the deterministic reviewer (Phase 7). Generated JSON Schema: spec/factory.schema.json.
import { z } from 'zod';
import { id, opEntry } from '../lib/ops/args.js';

export const FACTORY_VERSION = 1;

const camelType = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'a catalog type in camelCase');
const upper = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'use UPPER_CASE, e.g. ASSEMBLING');
const statusKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'a status key, e.g. unit');
const statusValue = z.union([z.string(), z.number()]);
const params = z.record(z.string(), z.unknown()).default({});
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const endpoint = z.string().regex(/^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/, 'use "station.port", e.g. st1.output');

export const Conventions = z.object({
  beltHeight: z.number().min(0.4).max(1.5).optional().describe('Top of the conveyor belts (m)'),
  conveyor: z.object({
    speed: z.number().positive().max(3).optional().describe('m/s'),
    ramp: z.number().min(0).max(3).optional().describe('Acceleration ramp (s)'),
  }).optional(),
  lift: z.object({
    drop: z.number().min(0.2).max(1).optional().describe('Return line depth below the belt (m)'),
    duration: z.number().positive().max(10).optional().describe('Lift move (s)'),
  }).optional(),
  transferLength: z.number().positive().max(10).optional().describe('Gap between station conveyors (m)'),
  holdSeconds: z.number().positive().max(5).optional().describe('Re-check interval of a waiting station (s)'),
}).describe('Overrides of the line conventions (constitution.md); anything left out keeps its default');

export const LineInfo = z.object({
  id,
  title: z.string().min(1).max(60),
  units: z.literal('m').default('m'),
  flow: z.literal('+X').default('+X'),
  runSize: z.number().int().min(1).max(999).default(8).describe('Units released per run'),
  speeds: z.array(z.number().positive().max(100)).min(1).max(6).default([1, 2, 10]).describe('Simulation speed choices'),
  conventions: Conventions.default({}),
});

export const Product = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('catalog'),
    type: camelType.describe('Catalog product type'),
    params,
  }),
]).describe('What flows down the line');

export const Equipment = z.object({
  id,
  type: camelType.describe('Catalog component type'),
  params,
  position: vec3.default([0, 0, 0]).describe('Station-local position (m): flow +X, walkway +Z'),
  rotationY: z.number().min(-Math.PI * 2).max(Math.PI * 2).default(0).describe('Turn about the vertical axis (rad)'),
});

export const PortRef = z.object({
  machine: id.optional().describe('Machine the port belongs to (default: the station conveyor)'),
  port: id.optional().describe('Port name on that machine (default: the station port name)'),
  direction: z.enum(['in', 'out']).optional(),
  standalone: z.array(id).optional().describe('Machines that only serve this port when it is not connected'),
});

export const Station = z.object({
  id,
  code: z.string().min(1).max(8).optional(),
  title: z.string().min(1).max(40),
  shell: z.object({ type: camelType.describe('Catalog shell preset'), params }).optional()
    .describe('Shared furniture (slab, conveyor, lifts, sign, HMI, stack light)'),
  equipment: z.array(Equipment).default([]).describe('This station\'s own machines'),
  conveyor: id.optional().describe('Station conveyor id (default: the shell\'s)'),
  workState: upper.default('WORKING'),
  inputStage: z.string().optional().describe('Product stage a unit arrives in'),
  ports: z.record(id, PortRef).default({}),
  intake: z.array(opEntry).optional().describe('Default: raise stop, convey to work, locate'),
  process: z.array(opEntry).describe('The station\'s process as ops'),
  output: z.array(opEntry).optional().describe('Default: release, convey to output'),
  home: z.record(id, z.record(id, statusValue)).default({}),
  status: z.record(statusKey, statusValue).default({}),
  signals: z.object({
    beacon: z.object({ machine: id.optional(), motion: id.optional() }).optional(),
    display: z.object({
      machine: id.optional(),
      screen: id.optional(),
      rows: z.array(z.tuple([z.string().max(24), statusKey])).max(6).optional(),
      bar: z.object({ value: statusKey, total: statusKey, label: z.string().max(60) }).optional(),
    }).optional(),
  }).default({}),
  feed: z.object({ fromLift: z.boolean().default(true) }).optional(),
});

export const Edge = z.object({
  from: endpoint.describe('Output port, "station.port"'),
  to: endpoint.describe('Input port, "station.port"'),
  carries: z.enum(['unit', 'batch', 'case', 'pallet']).optional().describe('What flows (checked against both ports)'),
  transport: z.object({
    kind: z.enum(['conveyor']).default('conveyor'),
    type: camelType.describe('Catalog component for the transfer'),
    params,
  }),
});

export const Graph = z.object({
  edges: z.array(Edge).default([]),
});

export const FactorySchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(FACTORY_VERSION),
  line: LineInfo,
  product: Product,
  stations: z.array(Station).min(1).max(40),
  graph: Graph.default({ edges: [] }),
}).superRefine((f, ctx) => {
  const ids = new Set();
  f.stations.forEach((s, i) => {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['stations', i, 'id'], message: `station id "${s.id}" is used twice` });
    ids.add(s.id);
    if (!s.shell && !s.conveyor) ctx.addIssue({ code: 'custom', path: ['stations', i, 'conveyor'], message: 'give a shell or the id of the station conveyor' });
    const eq = new Set();
    s.equipment.forEach((e, j) => {
      if (eq.has(e.id)) ctx.addIssue({ code: 'custom', path: ['stations', i, 'equipment', j, 'id'], message: `equipment id "${e.id}" is used twice in station "${s.id}"` });
      eq.add(e.id);
    });
  });
  f.graph.edges.forEach((e, i) => {
    for (const end of ['from', 'to']) {
      const station = e[end].split('.')[0];
      if (!ids.has(station)) ctx.addIssue({ code: 'custom', path: ['graph', 'edges', i, end], message: `unknown station "${station}" (stations: ${[...ids].join(', ')})` });
    }
  });
});

export class FactoryError extends Error {
  constructor(message, issues = []) {
    super(message);
    this.issues = issues;
  }
}

/** JSON Pointer-like path of an issue, e.g. stations[1].equipment[0].id */
export function issuePath(path) {
  return path.reduce((s, k) => (typeof k === 'number' ? `${s}[${k}]` : s ? `${s}.${String(k)}` : String(k)), '') || '(file)';
}

/** Parses factory.json data. Throws a FactoryError listing every issue with its path. */
export function parseFactory(data) {
  const parsed = FactorySchema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: issuePath(i.path), message: i.message }));
    throw new FactoryError(`factory.json: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`, issues);
  }
  return parsed.data;
}

/** The JSON Schema of factory.json (what editors and, later, Structured Outputs read). */
export function factoryJsonSchema() {
  return {
    $id: 'https://twingen.local/spec/factory.schema.json',
    title: 'factory.json',
    description: 'A production line digital twin: line, product, stations (shell, equipment, process as ops) and the graph of typed ports. Generated from spec/factory.schema.js; do not edit.',
    ...z.toJSONSchema(FactorySchema, { io: 'input' }),
  };
}
