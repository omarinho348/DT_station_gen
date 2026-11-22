import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// Stock locations are refilled (kanban replenishment from the flow rack): at the end of a timed
// step every stock item, or the ones listed, is back at its start place and visible.
defineOp({
  op: 'replenish',
  summary: 'Refill the station\'s stock locations: stock items go back to their start places at the end of a timed step.',
  args: z.object({
    items: z.array(id).min(1).optional().describe('Stock items to refill (default: all)'),
    seconds: seconds().default(1),
    ...common,
  }),
  expand(cycle, a) {
    for (const item of a.items ?? []) cycle.item(item);
    if (!cycle.dry && !cycle.restock) cycle.fail('this station has no stock to replenish');
    cycle.queue(stateOf(cycle, a), a.label ?? 'Replenishing stock', a.seconds, a.status, {
      onEnd: () => cycle.restock(a.items ?? null),
    });
  },
});
