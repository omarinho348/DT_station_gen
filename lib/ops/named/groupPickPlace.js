import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { OpError } from '../OpCycle.js';
import { smoother } from '../../core/motion.js';
import { common, id } from '../args.js';
import { once } from '../sequences.js';

// A multi-gripper head picks a whole group at once and sets it into a container: a packing gantry
// taking a 2 × 2 group of cans by their handles off the infeed and putting them into a case. Port
// of the reference CasePackingCycle planPick / planPlace / planCompletion.
//
//   lower → close grippers → lift → travel (rows close to the container's spacing on the way)
//   → lower into the container → release → retract → return to the pick side → done
//
// The machine's roles: `y` (gripper origin height), `z` (travel between the two sides), `pitch`
// (row spacing), the grip motion, and one anchor per item (each gripper's origin is the point it
// holds). Heights and travel come from the items' grasp points and the container's slots, worked
// out when the first step starts; every step has a fixed time, so the plan's duration is exact.
// The items must stand under their grippers along X (the head has no X axis): checked when picked.
const TIMING = { lower: 1.1, grip: 0.4, lift: 1.2, transfer: 2.2, place: 1.5, release: 0.35, retract: 1.0, return: 1.8, done: 0.3 };
const LABELS = {
  lower: 'Lowering to the items', grip: 'Closing grippers', lift: 'Lifting the items', transfer: 'Transferring to the container',
  place: 'Lowering into the container', release: 'Releasing the items', retract: 'Retracting from the container',
  return: 'Container filled · returning', done: 'Container filled',
};
const upper = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const TOLERANCE = 0.01; // m: an item further than this from its gripper is not under it

defineOp({
  op: 'groupPickPlace',
  summary: 'Multi-gripper head: pick a group of items at once (each by its own gripper), carry them over, set them into a container at its slots (rows re-spaced on the way), return.',
  args: z.object({
    machine: id,
    items: z.array(z.object({ item: id, anchor: id.describe('The gripper (machine anchor) that holds it') })).min(1).max(8),
    grasp: id.default('grasp').describe('Ref of each item where it is held'),
    into: id.describe('Container item they are put into'),
    at: id.default('bottom').describe('Ref of the container the items stand on'),
    slots: z.array(z.tuple([z.number(), z.number()])).min(1).max(8).describe('[x, z] of each item in the container frame, from the `at` ref, in item order'),
    gap: z.number().min(0).describe('Closed gripper value'),
    openGap: z.number().min(0).describe('Open gripper value'),
    gripMotion: id.default('grip'),
    travelLift: z.number().min(0.05).max(1.5).default(0.7).describe('Travel height above the pick height (m)'),
    pitchWindow: z.tuple([z.number().min(0).max(1), z.number().min(0.05).max(1)]).default([0.15, 0.6]).describe('Rows re-space from this share of the travel, over this share'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0).max(30).default(v)]))).default(TIMING),
    labels: z.object(Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, z.string().min(1).max(80).default(v)]))).default(LABELS),
    states: z.object({ pick: upper.optional(), place: upper.optional(), done: upper.optional() }).default({}),
    countStatus: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/).optional().describe('Status key: items in the container (0 when picked, all once released)'),
    ...common,
  }),
  expand(cycle, a) {
    if (a.slots.length !== a.items.length) cycle.fail(`give one slot per item (${a.items.length} items, ${a.slots.length} slots)`);
    for (const m of ['y', 'z', 'pitch']) cycle.motionSpec(a.machine, m);
    cycle.checkValue(a.machine, a.gripMotion, a.gap);
    cycle.checkValue(a.machine, a.gripMotion, a.openGap);
    const anchors = new Set();
    for (const it of a.items) {
      cycle.item(it.item);
      cycle.checkAnchor(a.machine, it.anchor);
      if (anchors.has(it.anchor)) cycle.fail(`gripper "${it.anchor}" is given two items`);
      anchors.add(it.anchor);
      const spec = cycle.itemSpec(it.item);
      if (spec && !(spec.refs ?? []).includes(a.grasp)) cycle.fail(`item "${it.item}" has no ref "${a.grasp}" to hold it by`);
      if (it.item === a.into) cycle.fail('an item cannot be put into itself');
    }
    cycle.item(a.into);
    const container = cycle.itemSpec(a.into);
    if (container && !(container.refs ?? []).includes(a.at)) cycle.fail(`container "${a.into}" has no ref "${a.at}"`);

    const pickState = a.states.pick ?? a.state ?? cycle.workState;
    const placeState = a.states.place ?? pickState;
    const doneState = a.states.done ?? placeState;
    const n = String(a.items.length);
    const text = (s) => s.replaceAll('{n}', n);
    const st = (robot, gripper, extra = {}) => ({ ...a.status, robot, ...(gripper ? { gripper } : {}), ...extra });

    // Geometry, in the machine frame, once the first step starts (everything is in place by then).
    const g = once(() => {
      const root = cycle.machine(a.machine).root;
      root.updateWorldMatrix(true, false);
      const inMachine = (world) => root.worldToLocal(world);
      const state = cycle.machine(a.machine).state;
      const picks = a.items.map((it) => {
        const object = cycle.item(it.item);
        object.updateWorldMatrix(true, false);
        const grasp = cycle.productItem(it.item).ref(a.grasp);
        const anchor = cycle.machine(a.machine).anchor(it.anchor);
        anchor.updateWorldMatrix(true, false);
        const at = inMachine(new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld));
        return { it, grasp, point: inMachine(object.localToWorld(grasp.clone())), anchorX: at.x, row: Math.sign(Math.round((at.z - state.z) * 1e6)) };
      });
      const box = cycle.productItem(a.into);
      const boxRoot = cycle.item(a.into);
      boxRoot.updateWorldMatrix(true, false);
      const base = box.ref(a.at);
      const slotsLocal = a.slots.map(([x, sz]) => base.clone().add(new THREE.Vector3(x, 0, sz)));
      const slots = slotsLocal.map((p, i) => inMachine(boxRoot.localToWorld(p.clone())).add(new THREE.Vector3(0, picks[i].grasp.y, 0)));
      const zs = picks.map((p) => p.point.z);
      const spread = (list) => Math.max(...list) - Math.min(...list);
      const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
      const rows = picks.some((p) => p.row !== 0);
      const pick = { y: mean(picks.map((p) => p.point.y)), z: mean(zs), pitch: rows ? spread(zs) : state.pitch };
      const place = { y: mean(slots.map((p) => p.y)), z: mean(slots.map((p) => p.z)), pitch: rows ? spread(slots.map((p) => p.z)) : state.pitch };
      for (const p of picks) {
        const dz = pick.z + (p.row * pick.pitch) / 2 - p.point.z;
        if (Math.abs(p.anchorX - p.point.x) > TOLERANCE || Math.abs(dz) > TOLERANCE) {
          throw new OpError(`groupPickPlace: item "${p.it.item}" is not under gripper "${p.it.anchor}" (off by ${Math.hypot(p.anchorX - p.point.x, dz).toFixed(3)} m)`);
        }
      }
      return { pick, place, travel: pick.y + a.travelLift, slotsLocal };
    });

    const m = a.machine;
    const t = a.timing;
    cycle.queueMotions({
      machine: m, state: pickState, seconds: t.lower, label: text(a.labels.lower), status: st('LOWERING', null),
      to: { y: () => g().pick.y, z: () => g().pick.z, pitch: () => g().pick.pitch },
    });
    cycle.queueMotions({
      machine: m, state: pickState, seconds: t.grip, label: text(a.labels.grip), status: st('GRIPPING', 'CLOSING'),
      to: { [a.gripMotion]: a.gap },
      onEnd: () => {
        for (const it of a.items) cycle.attach(cycle.item(it.item), m, it.anchor);
        if (a.countStatus) cycle.setStatus({ [a.countStatus]: 0 });
      },
    });
    cycle.queueMotions({
      machine: m, state: pickState, seconds: t.lift, label: text(a.labels.lift), status: st('LIFTING', 'CLOSED'),
      to: { y: () => g().travel },
    });
    const [w0, w1] = a.pitchWindow;
    cycle.queueMotions({
      machine: m, state: placeState, seconds: t.transfer, label: text(a.labels.transfer), status: st('TRANSFERRING', null),
      to: { z: () => g().place.z, pitch: () => g().place.pitch },
      ease: { pitch: (p) => smoother((p - w0) / w1) },
    });
    cycle.queueMotions({
      machine: m, state: placeState, seconds: t.place, label: text(a.labels.place), status: st('PLACING', null),
      to: { y: () => g().place.y },
    });
    cycle.queueMotions({
      machine: m, state: placeState, seconds: t.release, label: text(a.labels.release), status: st('RELEASING', 'OPENING'),
      to: { [a.gripMotion]: a.openGap },
      onStart: () => {
        // Into the container, each exactly at its slot (no drift from the hand-over), upright.
        const boxRoot = cycle.item(a.into);
        a.items.forEach((it, i) => {
          const object = cycle.item(it.item);
          cycle.detach(object);
          boxRoot.attach(object);
          object.position.copy(g().slotsLocal[i]);
          object.quaternion.identity();
          object.updateMatrixWorld(true);
        });
        if (a.countStatus) cycle.setStatus({ [a.countStatus]: a.items.length });
      },
    });
    cycle.queueMotions({
      machine: m, state: placeState, seconds: t.retract, label: text(a.labels.retract), status: st('RETRACTING', 'OPEN'),
      to: { y: () => g().travel },
    });
    cycle.queueMotions({
      machine: m, state: doneState, seconds: t.return, label: text(a.labels.return), status: st('RETURNING', null),
      to: { z: () => g().pick.z, pitch: () => g().pick.pitch },
    });
    cycle.queue(doneState, text(a.labels.done), t.done, st('HOME', null));
    for (const it of a.items) cycle.locate(it.item, { on: a.into });
  },
});
