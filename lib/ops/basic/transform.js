import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// The work changes the product: it moves to another of its stages (filled, capped, framed,
// labelled…), or one visual detail of it is switched (`set`: a belt engaged, a cable stowed; the
// product declares its features). Visual changes are the product's job; the op only says when.
defineOp({
  op: 'transform',
  summary: 'Change a product to another of its stages, or switch one of its features (set), at the start or end of a timed step.',
  args: z.object({
    item: id.default('product'),
    stage: id.optional().describe('New stage'),
    set: z.record(id, z.string()).optional().describe('Features to switch: { feature: value }'),
    at: z.enum(['start', 'end']).default('end'),
    seconds: seconds().default(0),
    ...common,
  }).refine((a) => (a.stage === undefined) !== (a.set === undefined), { message: 'give either stage or set', path: ['stage'] }),
  expand(cycle, a) {
    cycle.productItem(a.item);
    const spec = cycle.itemSpec(a.item);
    if (a.stage && spec?.stages && !spec.stages.includes(a.stage)) {
      cycle.fail(`product has no stage "${a.stage}" (stages: ${spec.stages.join(', ')})`);
    }
    for (const [name, value] of Object.entries(a.set ?? {})) {
      if (!spec) continue;
      const feature = spec.features?.[name];
      if (!feature) cycle.fail(`product has no feature "${name}" (features: ${Object.keys(spec.features ?? {}).join(', ') || 'none'})`);
      if (!feature.values.includes(value)) cycle.fail(`product feature "${name}" takes ${feature.values.join(' | ')}, got "${value}"`);
    }
    const apply = () => {
      const product = cycle.productItem(a.item);
      if (a.stage) product.setStage(a.stage);
      for (const [name, value] of Object.entries(a.set ?? {})) product.setFeature(name, value);
    };
    const label = a.label ?? (a.stage ? `${a.item} → ${a.stage}` : `${a.item}: ${Object.entries(a.set).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    cycle.queue(stateOf(cycle, a), label, a.seconds, a.status, a.at === 'start' ? { onStart: apply } : { onEnd: apply });
  },
});
