// Presence sensors of a station (data only): a machine motion that reads `blocked` while a unit's
// body crosses the sensor (a photo-eye beam across the conveyor) and `clear` otherwise. Updated
// by StationCycle on every refresh (lib/station/StationCycle.js).
import { z } from 'zod';
import { id } from '../ops/args.js';

export const Sensors = z.array(z.object({
  machine: id.describe('The sensor (e.g. a photo-eye standing on the conveyor)'),
  motion: id.default('beam').describe('Its motion with the two values below'),
  clear: z.string().min(1).default('clear'),
  blocked: z.string().min(1).default('blocked'),
  across: z.number().positive().max(3).default(0.75).describe('Units within this distance across the conveyor (Z) count (m)'),
})).default([]);

/** Problems with sensors against the station's machines (instances or specs, both list motions). */
export function sensorProblems(sensors, machines) {
  const problems = [];
  for (const s of sensors) {
    const spec = machines[s.machine];
    if (!spec) { problems.push(`sensor: unknown machine "${s.machine}"`); continue; }
    const motion = spec.motions?.[s.motion];
    if (!motion?.values) problems.push(`sensor "${s.machine}": no switch motion "${s.motion}" (motions: ${Object.keys(spec.motions ?? {}).join(', ') || 'none'})`);
    else for (const v of [s.clear, s.blocked]) if (!motion.values.includes(v)) problems.push(`sensor "${s.machine}".${s.motion} has no value "${v}" (values: ${motion.values.join(' | ')})`);
  }
  return problems;
}
