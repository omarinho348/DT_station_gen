import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// The work changes the product: it moves to another of its stages (filled, capped, framed,
// labelled…). Visual stage changes are the product's job; the op only says when.
defineOp({
  op: 'transform',
  summary: 'Change a product to another of its stages (filled, capped, assembled…), at the start or end of a timed step.',
  args: z.object({
    item: id.default('product'),
    stage: id,
    at: z.enum(['start', 'end']).default('end'),
    seconds: seconds().default(0),
    ...common,
  }),
  expand(cycle, a) {
    cycle.productItem(a.item);
    if (cycle.productStages && a.item === 'product' && !cycle.productStages.includes(a.stage)) {
      cycle.fail(`product has no stage "${a.stage}" (stages: ${cycle.productStages.join(', ')})`);
    }
    const apply = () => cycle.productItem(a.item).setStage(a.stage);
    cycle.queue(stateOf(cycle, a), a.label ?? `${a.item} → ${a.stage}`, a.seconds, a.status, a.at === 'start' ? { onStart: apply } : { onEnd: apply });
  },
});
