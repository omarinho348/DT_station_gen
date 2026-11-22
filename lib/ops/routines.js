// Product routines as seen by the ops: checks (dry and run) and instant calls. A routine is
// something the product does by itself (see `routines` in the registry's product contract); an
// instant call may also switch features (`set`).
import { z } from 'zod';
import { id } from './args.js';

/** An instant call on an item at the start or end of a step: a routine, or feature switches. */
export const routineCall = z.object({
  item: id.default('product'),
  routine: id.optional(),
  args: z.record(z.string(), z.unknown()).default({}),
  set: z.record(id, z.string()).optional().describe('Features to switch: { feature: value }'),
}).refine((c) => (c.routine === undefined) !== (c.set === undefined), { message: 'give either routine or set' });

/** Checks a routine (or feature switches) on a product item; args fit (dry plans too). */
export function checkRoutine(cycle, item, routine, args, set) {
  cycle.productItem(item);
  const spec = cycle.itemSpec(item);
  if (!spec) return;
  if (set) {
    for (const [name, value] of Object.entries(set)) {
      const feature = spec.features?.[name];
      if (!feature) cycle.fail(`item "${item}" has no feature "${name}" (features: ${Object.keys(spec.features ?? {}).join(', ') || 'none'})`);
      if (!feature.values.includes(value)) cycle.fail(`item "${item}" feature "${name}" takes ${feature.values.join(' | ')}, got "${value}"`);
    }
    return;
  }
  const def = spec.routines?.[routine];
  if (!def) cycle.fail(`${item === 'product' ? 'the product' : `item "${item}"`} has no routine "${routine}" (routines: ${Object.keys(spec.routines ?? {}).join(', ') || 'none'})`);
  const parsed = def.args.safeParse(args);
  if (!parsed.success) cycle.fail(`routine "${routine}": ${parsed.error.issues.map((i) => `${i.path.join('.') || '(args)'}: ${i.message}`).join('; ')}`);
}

/** Checks a list of instant calls. */
export function checkCalls(cycle, calls) {
  for (const c of calls) checkRoutine(cycle, c.item, c.routine, c.args, c.set);
}

/** Runs instant calls at once (start, full progress, end); their status values go to the HMI. */
export function runInstant(cycle, calls) {
  for (const call of calls) {
    const item = cycle.productItem(call.item);
    if (call.set) {
      for (const [name, value] of Object.entries(call.set)) item.setFeature(name, value);
      continue;
    }
    const handler = item.routine(call.routine, call.args);
    handler.start?.();
    const a = handler.update?.(1, 0);
    const b = handler.end?.();
    if (a) cycle.setStatus(a);
    if (b) cycle.setStatus(b);
  }
}

/** A routine driven by a step's progress (e.g. tape laid as the taper head runs): { onStart, onUpdate, onEnd }. */
export function routineAlong(cycle, call) {
  let handler = null;
  let previous = 0;
  return {
    onStart: () => {
      handler = cycle.productItem(call.item).routine(call.routine, call.args);
      handler.start?.();
      previous = 0;
    },
    onUpdate: (progress) => {
      const status = handler.update?.(progress, previous);
      previous = progress;
      if (status) cycle.setStatus(status);
    },
    onEnd: () => {
      const status = handler.end?.();
      if (status) cycle.setStatus(status);
    },
  };
}
