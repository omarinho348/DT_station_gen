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
import { Connections } from './connectionSpec.js';
import { IndexingSpec } from './indexingSpec.js';
import { BatchSpec } from './batchSpec.js';
import { Sensors } from './sensorSpec.js';
import { Supplies } from './supplySpec.js';

const statusKey = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/, 'a status key, e.g. unit');
const statusValue = z.union([z.string(), z.number()]);

export const StationPort = z.object({
  machine: id.optional().describe('Machine the port belongs to (default: the station conveyor)'),
  port: id.optional().describe('Port name on that machine (default: the station port name)'),
  offset: z.tuple([z.number(), z.number(), z.number()]).optional().describe('The place is this far from the machine port, in the machine frame (m): e.g. inside an infeed tunnel'),
  direction: z.enum(['in', 'out']).optional().describe('Default: in for "input", out otherwise'),
  slots: z.number().int().min(1).max(20).optional().describe('Extra output: places it holds, filled in turn (the oldest is cleared when full); the station offers the fact <port>Slot'),
  standalone: z.array(id).default([]).describe('Machines that only serve this port when nothing is connected to it (e.g. a return-line lift); a line hides them'),
  connected: z.array(id).default([]).describe('Machines that only exist when the port is connected (an open-ended hood where stand-alone a closed tunnel stands); hidden stand-alone'),
});

export const StationSpec = z.object({
  id,
  code: z.string().min(1).max(8).optional().describe('Short code shown on the HMI, e.g. ST2'),
  title: z.string().min(1).max(40),
  workState: z.string().regex(/^[A-Z][A-Z0-9_]*$/).default('WORKING'),
  role: z.enum(['station', 'transfer']).default('station').describe('transfer: a station that carries units between two others (a row former); a line plays it with its transfers, after the stations each frame'),
  inputStage: z.string().optional().describe('Product stage a unit arrives in (stand-alone feed)'),
  unit: z.object({ type: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) }).optional()
    .describe('What this station\'s units are, when not the line product (cases a station upstream packed the products into): fed stand-alone and planned with'),
  conveyor: id.describe('Id of the station conveyor (carries units through the station)'),
  ports: z.record(id, StationPort).default({}),
  prepare: z.array(opEntry).default([]).describe('Ops played at the start of each cycle once a unit is waiting, before it is taken in (the station readies itself; they cannot touch the unit)'),
  intake: z.array(opEntry).optional(),
  process: z.array(opEntry).default([]).describe('Ops of a single-unit station (an indexing station leaves it empty)'),
  output: z.array(opEntry).optional(),
  batch: BatchSpec.optional().describe('Units arrive as batches standing like this (a 2 × 2 group of cans); ops reach single members as items member1 … memberN'),
  indexing: IndexingSpec.optional().describe('Indexing station: batches at positions along the conveyor, moved together (lib/station/indexing.js)'),
  home: z.record(id, z.record(id, statusValue)).default({}).describe('Motion values set on reset: { machine: { motion: value } }'),
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
  sensors: Sensors.describe('Presence sensors: a machine motion set to blocked while a unit crosses it (photo-eyes)'),
  supplies: Supplies.describe('Supply stock on the decks of a machine (a rack of empty containers), drawn as units come in or items are made'),
  connections: Connections.describe('Pipes and hoses between machine anchors, drawn by the station (connections.js)'),
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
        label: z.string().max(100).describe('Text with {statusKey} fields, e.g. "Kit {picked}/{total}" (the shown text is cut to the screen)'),
      }).optional(),
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
      if (name === 'work' && !given.work?.port) {
        // A conveyor with no work place of its own (a plain belt): the station works midway between its
        // input and output, where machines over the conveyor are placed (lib/station/place.js); before,
        // it worked where the unit stood, at the input, and a machine over the belt missed it.
        const mid = midWork(spec);
        if (mid) ports.work = { name: 'work', machine, port: mid.port, direction: 'work', carries: mid.carries, position: mid.position, offset: mid.offset, standalone: [], connected: [], slots: null };
        continue;
      }
      throw new StationError(`station "${station.id}" port "${name}": machine "${machine}" has no port "${p.port}" (ports: ${Object.keys(spec.ports ?? {}).join(', ') || 'none'})`);
    }
    if (!own.carries) throw new StationError(`station "${station.id}" port "${name}": port "${machine}.${p.port}" does not say what it carries`);
    const direction = name === 'work' ? 'work' : p.direction ?? (name === 'input' ? 'in' : 'out');
    for (const m of p.standalone ?? []) if (!specs[m]) throw new StationError(`station "${station.id}" port "${name}": unknown stand-alone machine "${m}"`);
    for (const m of p.connected ?? []) if (!specs[m]) throw new StationError(`station "${station.id}" port "${name}": unknown connected-only machine "${m}"`);
    const position = p.offset ? own.position.map((v, i) => v + p.offset[i]) : own.position;
    ports[name] = { name, machine, port: p.port, direction, carries: own.carries, position, offset: p.offset ?? null, standalone: p.standalone ?? [], connected: p.connected ?? [], slots: p.slots ?? null };
  }
  return ports;
}

/** The midpoint between a conveyor's input and output ports, as an offset from its input; or null. */
function midWork(spec) {
  const ports = spec.ports ?? {};
  if (Object.values(ports).some((p) => p.direction === 'work')) return null; // it has work places: not a plain conveyor
  const input = ports.input ? ['input', ports.input] : Object.entries(ports).find(([, p]) => p.direction === 'in');
  const output = ports.output ?? Object.values(ports).find((p) => p.direction === 'out');
  if (!input || !output) return null;
  const [name, i] = input;
  const offset = output.position.map((v, k) => (k === 1 ? 0 : (v - i.position[k]) / 2));
  return { port: name, carries: i.carries, offset, position: i.position.map((v, k) => v + offset[k]) };
}

/** A port as a transfer's place: its name, or { machine, port, offset } when it is offset. */
const placeOf = (p) => (p.offset ? { machine: p.machine, port: p.port, offset: p.offset } : p.port);

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
  ops.push({ op: 'transfer', conveyor: c, from: placeOf(input), to: placeOf(work), label: 'Carrier transport to work position', state: 'INFEED' });
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
  ops.push({ op: 'transfer', conveyor: c, from: placeOf(work), to: placeOf(output), label: 'Transport to output port', state: 'OUTPUT' });
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
