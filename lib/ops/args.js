// Argument pieces shared by the ops. Every op is plain JSON in factory.json: { op, ...args }.
import { z } from 'zod';

export const id = z.string().regex(/^[a-z][a-zA-Z0-9]*$/, 'use camelCase, e.g. robot1');

/** Arguments every op takes: the step label shown on the HMI, the cycle state, extra status. */
export const common = {
  label: z.string().min(1).max(80).optional().describe('Step text shown on the HMI'),
  state: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'use UPPER_CASE, e.g. ASSEMBLING').optional().describe('Cycle state (default: the station work state)'),
  status: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Extra status fields for the HMI'),
};

export const seconds = (max = 120) => z.number().min(0).max(max);

/** Timing of a motion: a fixed time, or a speed (units per second) with an optional ramp. */
export const timing = {
  seconds: seconds().optional().describe('Duration (s); or give speed'),
  speed: z.number().positive().max(50).optional().describe('Units per second of the largest change; or give seconds'),
  ramp: z.number().min(0).max(5).optional().describe('Trapezoid ramp time (s, default the line conveyor ramp)'),
  profile: z.enum(['smooth', 'linear', 'trapezoid']).default('smooth').describe('Speed profile'),
};

/** Refinements for `timing`: exactly one of seconds / speed; a trapezoid needs a speed. */
export function checkTiming(schema) {
  return schema
    .refine((a) => (a.seconds === undefined) !== (a.speed === undefined), { message: 'give either seconds or speed', path: ['seconds'] })
    .refine((a) => a.profile !== 'trapezoid' || a.speed !== undefined, { message: 'a trapezoid profile needs a speed', path: ['speed'] });
}

/** One nested op (validated when it is expanded). */
export const opEntry = z.looseObject({ op: id });

/** The step state an op uses: its own, or the cycle's work state. */
export const stateOf = (cycle, args) => args.state ?? cycle.workState;
