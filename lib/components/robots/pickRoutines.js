// The robots' shared routine (Phase 13): move the unit from wherever it is to a place of the station
// (a machine's port: a fixture's seat, a tote, a table top, the conveyor's work place), with the
// standard pick-and-place moves. Each robot file adds it to its own `recipes` with how it holds things:
//
//   fingers: grips the unit at its grasp point, the fingers closing on its width
//   vacuum:  lifts the unit by its top with a suction pad (grip 1 on, 0 off)
//
// The gripper settings and the grasp height come from the measured unit (lib/station/unit.js), so the
// model never sets them. Registers nothing itself (no defineComponent here).
import { z } from 'zod';

const r3 = (v) => Math.round(v * 1000) / 1000;

/** The place with the hold point raised by `y` above it (on top of any offset the place has). */
const at = (place, y) => {
  const o = place.offset ?? [0, 0, 0];
  return { machine: place.machine, port: place.port, offset: [r3(o[0]), r3(o[1] + y), r3(o[2])] };
};

/**
 * The `moveUnit` routine for a robot. hold: 'fingers' | 'vacuum'.
 */
export function moveUnitRoutine({ hold }) {
  return {
    summary: hold === 'vacuum'
      ? 'Move the unit to a place of the station: suction pad down on its top, lift, carry, set it down there, release'
      : 'Move the unit to a place of the station: grip it, lift, carry, set it down there, open',
    args: z.object({
      clearance: z.number().min(0.03).max(0.6).default(0.12).describe('Travel height above both points (m)'),
      task: z.string().min(1).max(40).optional().describe('What the move is, on the HMI'),
    }),
    stationArgs: { to: { kind: 'place', carries: 'unit', about: 'where to put the unit: "machine.port" of the station' } },
    ops: ({ machine, args, spec, unit }) => {
      const refY = (name, fallback) => unit?.refs?.[name]?.[1] ?? fallback;
      const height = unit?.size?.[1] ?? 0.1;
      const common = { op: 'pickPlace', machine, item: 'product', clearance: args.clearance, ...(args.task ? { name: args.task } : {}) };
      if (hold === 'vacuum') {
        const top = refY('top', height);
        const [lo, hi] = spec.motions.grip.range;
        return [{ ...common, from: { item: 'product', ref: 'top' }, to: at(args.to, top), gap: hi, openGap: lo }];
      }
      const width = unit ? Math.min(unit.size[0], unit.size[2]) : 0.06;
      const maxGap = spec.motions.grip.range[1];
      const gap = r3(Math.min(maxGap, width));
      const openGap = r3(Math.min(maxGap, width + 0.05));
      return [{ ...common, from: { item: 'product', ref: 'grasp' }, to: at(args.to, refY('grasp', height / 2)), gap, openGap }];
    },
  };
}
