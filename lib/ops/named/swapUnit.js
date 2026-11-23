import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// What flows on changes: the units were packed into an item the station made (a case), and from
// now on that item is the station's unit: 'product' means it, it leaves through the output port and
// the next station receives it. The old unit is used up (what was packed belongs to the new one).
defineOp({
  op: 'swapUnit',
  summary: 'From now on the station\'s unit is an item it made (the case the units were packed into); it is what leaves through the output port.',
  args: z.object({
    item: id.describe('An item made during the process (spawn)'),
    seconds: seconds(10).default(0),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    cycle.swapUnit(a.item);
    cycle.queue(stateOf(cycle, a), a.label ?? `${a.item} becomes the unit`, a.seconds, a.status, {
      onStart: () => cycle.swapUnitNow(a.item),
    });
  },
});
