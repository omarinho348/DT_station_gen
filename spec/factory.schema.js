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
import { Connections } from '../lib/station/connectionSpec.js';
import { IndexingSpec } from '../lib/station/indexingSpec.js';
import { BatchSpec } from '../lib/station/batchSpec.js';
import { Sensors } from '../lib/station/sensorSpec.js';
import { Supplies } from '../lib/station/supplySpec.js';

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
  beltHeight: z.number().min(0.2).max(1.5).optional().describe('This machine\'s own belt / surface height when it differs from the line (a lower carton line)'),
});

export const PortRef = z.object({
  machine: id.optional().describe('Machine the port belongs to (default: the station conveyor)'),
  port: id.optional().describe('Port name on that machine (default: the station port name)'),
  offset: vec3.optional().describe('The place is this far from the machine port, in the machine frame (m): e.g. inside an infeed tunnel'),
  direction: z.enum(['in', 'out']).optional(),
  slots: z.number().int().min(1).max(20).optional().describe('Extra output: places it holds, filled in turn (the oldest is cleared when full); the station offers the fact <port>Slot'),
  standalone: z.array(id).optional().describe('Machines that only serve this port when it is not connected'),
  connected: z.array(id).optional().describe('Machines that only exist when the port is connected (an open-ended hood instead of a closed tunnel)'),
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
  role: z.enum(['station', 'transfer']).default('station').describe('transfer: a station that carries units between two others (a row former); a line plays it with its transfers, after the stations each frame'),
  inputStage: z.string().optional().describe('Product stage a unit arrives in'),
  unit: z.object({ type: camelType.describe('Catalog product type'), params }).optional()
    .describe('What this station\'s units are, when not the line product (cases a station upstream packed the products into): fed stand-alone and planned with'),
  ports: z.record(id, PortRef).default({}),
  prepare: z.array(opEntry).optional().describe('Ops played at the start of each cycle once a unit is waiting, before it is taken in (the station readies itself; they cannot touch the unit)'),
  intake: z.array(opEntry).optional().describe('Default: raise stop, convey to work, locate'),
  process: z.array(opEntry).default([]).describe('The station\'s process as ops (an indexing station leaves it empty)'),
  batch: BatchSpec.optional().describe('Units arrive as batches standing like this (a 2 × 2 group of cans); ops reach single members as items member1 … memberN'),
  indexing: IndexingSpec.optional().describe('Indexing station: batches of units at positions along the conveyor, moved together one position per machine cycle'),
  output: z.array(opEntry).optional().describe('Default: release, convey to output'),
  home: z.record(id, z.record(id, statusValue)).default({}),
  stock: z.record(id, z.object({
    part: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).describe('Product part this is a copy of'),
    mode: z.enum(['kit', 'asm']).default('kit').describe('How it rests: as in the kit tray, or as assembled'),
    at: z.object({
      machine: id.describe('Machine holding it (a bin, saddle, nest…)'),
      port: id.describe('Port it rests on'),
      offset: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]).describe('From the port, machine frame (m)'),
    }),
  })).default({}).describe('Stock items: copies of product parts presented at machine ports (a supermarket)'),
  stacks: z.record(id, z.object({
    machine: id.describe('Machine the stack is built on (a pallet)'),
    port: id.describe('Its surface port'),
    columns: z.array(z.number()).min(1).max(10).describe('Spot offsets along the machine X (m)'),
    rows: z.array(z.number()).min(1).max(10).describe('Spot offsets along the machine Z (m)'),
    layers: z.number().int().min(1).max(10),
    layerHeight: z.number().positive().max(2).describe('Height of one layer (m)'),
    gap: z.number().min(0).max(0.05).default(0).describe('Clearance above the surface / layer below (m)'),
  })).default({}).describe('Stacks the station builds across units (cases on a pallet); facts <stack>Slot and <stack>Fills'),
  sensors: Sensors.describe('Presence sensors: a machine motion that reads blocked while a unit crosses it (photo-eyes)'),
  supplies: Supplies.describe('Supply stock on the decks of a machine (a rack of empty containers, flat cases), drawn one by one as the station brings units in or makes items'),
  connections: Connections.describe('Pipes and hoses between machine anchors ("machine.anchor"), e.g. from a supply pump to a machine inlet'),
  status: z.record(statusKey, statusValue).default({}),
  signals: z.object({
    beacon: z.object({ machine: id.optional(), motion: id.optional() }).optional(),
    display: z.object({
      machine: id.optional(),
      screen: id.optional(),
      rows: z.array(z.tuple([z.string().max(24), statusKey])).max(6).optional(),
      bar: z.object({ value: statusKey, total: statusKey, label: z.string().max(100) }).optional(),
    }).optional(),
    dashboard: z.object({
      machine: id,
      screen: id.default('screen').describe('Display name on that machine'),
      title: z.string().max(60).default('{unit}').describe('Text with {statusKey} fields'),
      gauges: z.array(z.object({
        label: z.string().max(16),
        value: statusKey.describe('Status key with the value'),
        target: z.number().positive(),
        unit: z.string().max(6).default(''),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#2fd0c6'),
      })).max(4).default([]),
      grid: z.object({
        label: z.string().max(24),
        cols: z.number().int().min(1).max(5),
        values: statusKey.describe('Status key holding a list of numbers (null = not yet)'),
        range: z.tuple([z.number(), z.number()]),
      }).optional(),
      checks: z.array(z.object({
        label: z.string().max(40),
        value: z.string().max(40).default('').describe('Text with {statusKey} fields'),
        state: z.string().max(40).default('pending').describe('pending | pass | fail, or a {statusKey} holding one'),
      })).max(8).default([]),
      verdict: statusKey.optional().describe('Status key holding PASS / REJECT (anything else: none yet)'),
      footer: z.string().max(100).default('').describe('Text with {statusKey} fields'),
    }).optional().describe('A structured status dashboard (gauges, heat-map grid, footer)'),
  }).default({}),
  feed: z.object({ fromLift: z.boolean().default(true) }).optional(),
});

export const Edge = z.object({
  from: endpoint.describe('Output port, "station.port"'),
  to: endpoint.describe('Input port, "station.port"'),
  carries: z.enum(['unit', 'batch', 'case', 'pallet']).optional().describe('What flows (checked against both ports)'),
  transport: z.object({
    kind: z.enum(['conveyor', 'direct']).default('conveyor').describe('conveyor: a transfer conveyor fills the gap; direct: the two ports meet (the layout stands the stations so) and the unit is handed over where it stands'),
    type: camelType.optional().describe('Catalog component for the transfer (conveyor)'),
    params,
  }).refine((t) => t.kind === 'direct' || t.type, { message: 'a conveyor transport needs its catalog type', path: ['type'] }),
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
