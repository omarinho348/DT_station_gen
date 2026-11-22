import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// Lets go: the grip motion opens and the item stays where it is (it is no longer carried).
// With `onto`, the item is put onto another item (a part on a carrier, a case on a pallet) and
// moves with it from then on.
defineOp({
  op: 'release',
  summary: 'Let go of an item: open the grip motion; the item stays where it was put.',
  args: z.object({
    machine: id,
    item: id.optional().describe('Item to let go (default: everything the machine holds)'),
    motion: id.default('grip'),
    to: z.number().describe('Open value of that motion'),
    onto: id.optional().describe('Item it is put onto, and then moves with'),
    alongside: z.array(z.object({ machine: id, to: z.record(id, z.number()) })).max(4).default([]).describe('Other machines moved in the same step (a plate lowering as wheels rise)'),
    also: z.record(id, z.number()).optional().describe('Other range motions of the same machine moved in the same step (e.g. a stop pin)'),
    indicator: id.default('holding'),
    seconds: seconds(10).default(0.3),
    ...common,
  }),
  expand(cycle, a) {
    if (a.item) cycle.item(a.item);
    if (a.also && a.motion in a.also) cycle.fail(`motion "${a.motion}" is both the grip motion and in "also"`);
    if (a.onto) {
      if (!a.item) cycle.fail('"onto" needs the "item" that is put down');
      if (a.onto === a.item) cycle.fail('an item cannot be put onto itself');
      cycle.item(a.onto);
    }
    const indicate = cycle.hasMotion(a.machine, a.indicator);
    if (indicate) cycle.checkValue(a.machine, a.indicator, 'off');
    cycle.queueMotions({
      machine: a.machine,
      to: { ...a.also, [a.motion]: a.to },
      alongside: a.alongside,
      seconds: a.seconds,
      state: stateOf(cycle, a),
      label: a.label ?? `Releasing ${a.item ?? 'item'}`,
      status: a.status,
      onStart: () => { if (indicate) cycle.drive(a.machine, a.indicator, 'off'); },
      onEnd: () => {
        const items = a.item ? [cycle.item(a.item)] : cycle.attachedTo(a.machine);
        items.forEach((object) => cycle.detach(object));
        if (a.onto) cycle.item(a.onto).attach(items[0]); // reparent, keeping the world pose
      },
    });
    if (indicate) cycle.plan(a.machine, a.indicator, 'off');
    for (const [item, where] of cycle.plannedAt) {
      if (where?.machine !== a.machine || !where.anchor || (a.item && item !== a.item)) continue;
      if (a.onto) cycle.locate(item, { on: a.onto });
      else cycle.locate(item, where.was?.machine === a.machine ? where.was : { released: true });
    }
  },
});
