import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, seconds, stateOf } from '../args.js';

// Takes hold of an item: it is attached to one of the machine's anchors (a robot's tool point, a
// locating plate) and the grip motion closes. From then on the item follows the anchor exactly,
// whatever the machine does, until `release`.
defineOp({
  op: 'grip',
  summary: 'Take hold of an item: attach it to a machine anchor (tool, plate) and close the grip motion.',
  args: z.object({
    machine: id,
    item: id.describe('"product" or a named item'),
    motion: id.default('grip').describe('Motion that closes (gripper gap, clamp, locating plate)'),
    to: z.number().describe('Closed value of that motion'),
    anchor: id.default('tool').describe('Machine anchor the item is carried by'),
    indicator: id.default('holding').describe('On/off motion switched on once held (if the machine has it)'),
    seconds: seconds(10).default(0.3),
    ...common,
  }),
  expand(cycle, a) {
    cycle.item(a.item);
    cycle.checkAnchor(a.machine, a.anchor);
    const indicate = cycle.hasMotion(a.machine, a.indicator);
    if (indicate) cycle.checkValue(a.machine, a.indicator, 'on');
    let held = null;
    cycle.queueMotions({
      machine: a.machine,
      to: { [a.motion]: a.to },
      seconds: a.seconds,
      state: stateOf(cycle, a),
      label: a.label ?? `Gripping ${a.item}`,
      status: a.status,
      onStart: () => {
        held = cycle.item(a.item);
        cycle.attach(held, a.machine, a.anchor);
      },
      onEnd: () => { if (indicate) cycle.drive(a.machine, a.indicator, 'on'); },
    });
    if (indicate) cycle.plan(a.machine, a.indicator, 'on');
    // Remember where it was: released by the same machine (a locating plate), it is back there.
    cycle.locate(a.item, { machine: a.machine, anchor: a.anchor, was: cycle.locationOf(a.item) });
  },
});
