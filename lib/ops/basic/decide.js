import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { UNKNOWN } from '../OpCycle.js';
import { common, id, opEntry, stateOf } from '../args.js';

// Branches on a fact (e.g. the unit's quality verdict, a deterministic function of its serial,
// rule 5). The decision is taken when the cycle is planned, so the twin plays one branch.
// Every branch is checked either way, so an error never depends on which serial comes along.
// Dry runs (timing) take the longest branch; motions the branches leave in different places
// are UNKNOWN afterwards (a later move from there is planned at its worst case).
defineOp({
  op: 'decide',
  summary: 'Branch on a fact such as the quality verdict: run the ops of the matching case (or otherwise).',
  args: z.object({
    on: id.describe('Fact to branch on, e.g. quality'),
    cases: z.record(z.string(), z.array(opEntry)).refine((c) => Object.keys(c).length > 0, 'give at least one case'),
    otherwise: z.array(opEntry).optional(),
    ...common,
  }),
  expand(cycle, a) {
    const branches = Object.entries(a.cases).map(([value, ops]) => [`case "${value}"`, value, ops]);
    if (a.otherwise) branches.push(['otherwise', null, a.otherwise]);

    // Look at every branch on a dry copy: validation, durations and where each leaves things.
    const looked = branches.map(([scope, value, ops]) => {
      const fork = cycle.fork();
      fork.expand(ops, scope);
      return { scope, value, ops, fork, duration: fork.time };
    });

    // Run mode, or a dry plan with the fact given (a pass / reject scenario): the chosen branch is
    // expanded step by step, exactly as it will play.
    const known = cycle.fact(a.on);
    if (!cycle.dry || known !== UNKNOWN) {
      const fact = known;
      const chosen = looked.find((b) => b.value === String(fact)) ?? looked.find((b) => b.value === null);
      if (!chosen) cycle.fail(`no case for ${a.on} = "${fact}" and no "otherwise"`);
      cycle.expand(chosen.ops, chosen.scope);
      return;
    }

    const longest = Math.max(...looked.map((b) => b.duration));
    cycle.queue(stateOf(cycle, a), a.label ?? `Decide on ${a.on}`, longest, a.status);
    cycle.steps.at(-1).branches = Object.fromEntries(looked.map((b) => [b.value ?? 'otherwise', b.duration]));
    merge(cycle, looked.map((b) => b.fork));
  },
});

/** After a dry decision: keep what all branches agree on, mark the rest UNKNOWN. */
function merge(cycle, forks) {
  const keys = new Set(forks.flatMap((f) => [...f.plannedValues.keys()]));
  for (const key of keys) {
    const [machine, motion] = key.split('.');
    const values = forks.map((f) => (f.plannedValues.has(key) ? f.plannedValues.get(key) : cycle.planned(machine, motion)));
    cycle.plan(machine, motion, values.every((v) => v === values[0]) ? values[0] : UNKNOWN);
  }
  const items = new Set(forks.flatMap((f) => [...f.plannedAt.keys()]));
  for (const item of items) {
    const places = forks.map((f) => JSON.stringify(f.plannedAt.get(item) ?? null));
    cycle.locate(item, places.every((p) => p === places[0]) ? forks[0].plannedAt.get(item) : undefined);
  }
}
