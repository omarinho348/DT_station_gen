// A line as data: stations (each a station spec plus its equipment by catalog type) and the
// graph edges between their typed ports, each with its transport. A preview of the line part of
// factory.json; Phase 4's factory.schema.js takes this over. No positions for stations: those
// come from lib/line/layout.js.
import { z } from 'zod';
import { id } from '../ops/args.js';

export const Equipment = z.object({
  id,
  type: z.string().min(1).describe('Catalog component type'),
  params: z.record(z.string(), z.unknown()).default({}),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]).describe('Station-local position (m)'),
  rotationY: z.number().default(0).describe('Turn about the vertical axis (rad)'),
  beltHeight: z.number().min(0.2).max(1.5).optional().describe('This machine\'s own belt / surface height when it differs from the line (a lower carton line)'),
});

export const LineStation = z.looseObject({
  id,
  equipment: z.array(Equipment).min(1),
});

export const Edge = z.object({
  from: z.string().describe('"station.port" (an output port)'),
  to: z.string().describe('"station.port" (an input port)'),
  carries: z.enum(['unit', 'batch', 'case', 'pallet']).optional().describe('What flows (checked against both ports)'),
  transport: z.object({
    kind: z.enum(['conveyor']).default('conveyor').describe('agv | robot | worker come with Phase 6'),
    type: z.string().min(1).describe('Catalog component for the transfer'),
    params: z.record(z.string(), z.unknown()).default({}).describe('Its length is set from the layout unless given'),
  }),
});

export const LineSpec = z.object({
  id,
  title: z.string().min(1).max(60),
  runSize: z.number().int().min(1).max(999).default(8).describe('Units released into the line per run'),
  product: z.object({ type: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) }),
  transferLength: z.number().positive().max(10).optional().describe('Gap between station conveyors (default: line conventions)'),
  stations: z.array(LineStation).min(1),
  edges: z.array(Edge).default([]),
});

export class LineError extends Error {}

export function parseLine(data) {
  const parsed = LineSpec.safeParse(data);
  if (!parsed.success) {
    const name = typeof data?.id === 'string' ? `line "${data.id}"` : 'line';
    throw new LineError(`${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(spec)'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
