// What a station is, as data: the part of factory.json one StationCycle plays. Equipment is
// referred to by id only; which catalog component each id is lives in the IR (Phase 4).
//
//   intake   ops that bring a unit from the input port to the work position (default below)
//   process  the station's own ops, written per station
//   output   ops that take the finished unit from the work position to the output port (default)
//
// Ports are typed: each names a port of one of the station's machines and inherits what that
// port carries (unit | batch | case | pallet), so two stations only connect when the types match.
import { z } from 'zod';
import { id, opEntry } from '../ops/args.js';
import { CONVENTIONS } from '../core/conventions.js';

const statusKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'a status key, e.g. unit');
const statusValue = z.union([z.string(), z.number()]);

export const StationPort = z.object({
  machine: id.optional().describe('Machine the port belongs to (default: the station conveyor)'),
  port: id.optional().describe('Port name on that machine (default: the station port name)'),
  direction: z.enum(['in', 'out']).optional().describe('Default: in for "input", out otherwise'),
  standalone: z.array(id).default([]).describe('Machines that only serve this port when nothing is connected to it (e.g. a return-line lift); a line hides them'),
});

export const StationSpec = z.object({
  id,
  code: z.string().min(1).max(8).optional().describe('Short code shown on the HMI, e.g. ST2'),
  title: z.string().min(1).max(40),
  workState: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default('WORKING'),
  inputStage: z.string().optional().describe('Product stage a unit arrives in (stand-alone feed)'),
  conveyor: id.describe('Id of the station conveyor (carries units through the station)'),
  ports: z.record(id, StationPort).default({}),
  intake: z.array(opEntry).optional(),
  process: z.array(opEntry),
  output: z.array(opEntry).optional(),
  home: z.record(id, z.record(id, statusValue)).default({}).describe('Motion values set on reset: { machine: { motion: value } }'),
  status: z.record(statusKey, statusValue).default({}).describe('Extra HMI status fields and their start values'),
  signals: z.object({
    beacon: z.object({ machine: id, motion: id.default('mode') }).optional().describe('Status light: a motion with values off | run | wait | alarm'),
    display: z.object({
      machine: id,
      screen: id.default('screen').describe('Display name on that machine (title, state, step, rows, bar)'),
      rows: z.array(z.tuple([z.string().max(24), statusKey])).max(6)
        .default([['Unit', 'unit'], ['Conveyor', 'conveyor'], ['Completed', 'completed'], ['Cycles', 'cycles']]),
      bar: z.object({
        value: statusKey,
        total: statusKey,
        label: z.string().max(60).describe('Text with {statusKey} fields, e.g. "Kit {picked}/{total}"'),
      }).optional(),
    }).optional(),
  }).default({}),
  feed: z.object({
    fromLift: z.boolean().default(true).describe('Stand-alone: new units rise from the return line'),
  }).default({ fromLift: true }),
});

export class StationError extends Error {}

/** Parses a station spec, with errors that name the station and the field. */
export function parseStation(data) {
  const parsed = StationSpec.safeParse(data);
  if (!parsed.success) {
    const name = typeof data?.id === 'string' ? `station "${data.id}"` : 'station';
    throw new StationError(`${name}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(spec)'}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}

/**
 * The station's ports, resolved against its machines (`specs`: { id: instance or componentSpec }).
 * input / work / output default to the conveyor's ports of the same names. Returns
 * { name: { name, machine, port, direction, carries, position } } (position in the machine frame).
 */
export function resolvePorts(station, specs) {
  const given = station.ports;
  const wanted = {
    input: { port: 'input', ...given.input },
    work: { port: 'work', ...given.work },
    output: { port: 'output', ...given.output },
  };
  for (const [name, p] of Object.entries(given)) if (!(name in wanted)) wanted[name] = { port: name, ...p };
  const ports = {};
  for (const [name, p] of Object.entries(wanted)) {
    const machine = p.machine ?? station.conveyor;
    const spec = specs[machine];
    if (!spec) throw new StationError(`station "${station.id}" port "${name}": unknown machine "${machine}" (machines: ${Object.keys(specs).join(', ')})`);
    const own = spec.ports?.[p.port];
    if (!own) {
      if (name === 'work' && !given.work?.port) continue; // a station without a work stop works where it stands
      throw new StationError(`station "${station.id}" port "${name}": machine "${machine}" has no port "${p.port}" (ports: ${Object.keys(spec.ports ?? {}).join(', ') || 'none'})`);
    }
    if (!own.carries) throw new StationError(`station "${station.id}" port "${name}": port "${machine}.${p.port}" does not say what it carries`);
    const direction = name === 'work' ? 'work' : p.direction ?? (name === 'input' ? 'in' : 'out');
    for (const m of p.standalone ?? []) if (!specs[m]) throw new StationError(`station "${station.id}" port "${name}": unknown stand-alone machine "${m}"`);
    ports[name] = { name, machine, port: p.port, direction, carries: own.carries, position: own.position, standalone: p.standalone ?? [] };
  }
  return ports;
}

/**
 * Default intake: raise the stop, convey the unit from the input port to the work position,
 * lift and locate it. Without a work stop / locator on the conveyor those steps are left out.
 */
export function defaultIntake(station, specs, ports, conventions = CONVENTIONS) {
  const ws = conventions.workStop;
  const { input, work } = ports;
  if (!work) return [];
  requireSameConveyor(station, input, work, 'intake');
  const c = work.machine;
  const has = (m) => Boolean(specs[c].motions?.[m]);
  const ops = [];
  if (has(ws.stop)) {
    ops.push({ op: 'move', machine: c, to: { [ws.stop]: 1 }, seconds: ws.raise, label: 'Stop raised · carrier indexing', state: 'INFEED', status: { conveyor: 'STARTING' } });
  }
  ops.push({ op: 'transfer', conveyor: c, from: input.port, to: work.port, label: 'Carrier transport to work position', state: 'INFEED' });
  if (has(ws.locate) && specs[c].anchors?.includes(ws.anchor)) {
    ops.push({ op: 'grip', machine: c, item: 'product', motion: ws.locate, to: 1, anchor: ws.anchor, seconds: ws.locateSeconds, label: 'Lift & locate carrier', state: 'INFEED', status: { conveyor: 'STOPPED' } });
  }
  return ops;
}

/** Default output: release the carrier (plate and stop down together), convey it to the output port. */
export function defaultOutput(station, specs, ports, conventions = CONVENTIONS) {
  const ws = conventions.workStop;
  const { input, work, output } = ports;
  if (!work) {
    // No work stop: the unit is worked on at the input port and conveyed straight through.
    requireSameConveyor(station, input, output, 'output');
    return [{ op: 'transfer', conveyor: input.machine, from: input.port, to: output.port, label: 'Transport to output port', state: 'OUTPUT' }];
  }
  requireSameConveyor(station, work, output, 'output');
  const c = work.machine;
  const has = (m) => Boolean(specs[c].motions?.[m]);
  const ops = [];
  if (has(ws.locate) && specs[c].anchors?.includes(ws.anchor)) {
    ops.push({
      op: 'release', machine: c, item: 'product', motion: ws.locate, to: 0, ...(has(ws.stop) ? { also: { [ws.stop]: 0 } } : {}),
      seconds: ws.release, label: 'Releasing carrier', state: 'OUTPUT', status: { conveyor: 'STOPPED' },
    });
  } else if (has(ws.stop)) {
    ops.push({ op: 'move', machine: c, to: { [ws.stop]: 0 }, seconds: ws.release, label: 'Releasing carrier', state: 'OUTPUT', status: { conveyor: 'STOPPED' } });
  }
  ops.push({ op: 'transfer', conveyor: c, from: work.port, to: output.port, label: 'Transport to output port', state: 'OUTPUT' });
  return ops;
}

function requireSameConveyor(station, a, b, phase) {
  if (a.machine !== b.machine) {
    throw new StationError(`station "${station.id}": ports "${a.name}" and "${b.name}" are on different machines, so the default ${phase} cannot convey between them; write "${phase}" ops`);
  }
}

/** The three op lists a unit goes through (defaults filled in). */
export function stationPhases(station, specs, ports, conventions = CONVENTIONS) {
  return {
    intake: station.intake ?? defaultIntake(station, specs, ports, conventions),
    process: station.process,
    output: station.output ?? defaultOutput(station, specs, ports, conventions),
  };
}

/** Do two ports fit together (an output feeding an input)? Returns null or the reason they don't. */
export function portMismatch(from, to) {
  if (from.direction !== 'out') return `"${from.name}" is not an output port`;
  if (to.direction !== 'in') return `"${to.name}" is not an input port`;
  if (from.carries !== to.carries) return `"${from.name}" carries ${from.carries} but "${to.name}" takes ${to.carries}`;
  return null;
}
