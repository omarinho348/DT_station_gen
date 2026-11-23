import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { OpError, UNKNOWN } from '../OpCycle.js';
import { smoother } from '../../core/motion.js';
import { common, id } from '../args.js';
import { once } from '../sequences.js';

// An articulated robot with a vacuum tool takes an item off a conveyor and sets it on the next
// spot of a stack (cases on a pallet), then returns home. Port of the reference station-3
// StationCycle (APPROACH_BOX … RETURN_HOME):
//
//   swing over the item → lower onto its top → vacuum on (it is held) → lift → swing over the
//   stack spot → lower → vacuum off (it rests exactly on its spot) → settle → retract → swing home
//
// The machine's roles: motions x / y / z (the tool point, tool pointing down, in the robot's
// frame) and yaw, a grip motion (vacuum 0 off / 1 on), anchor `tool`. Swings turn about the
// robot's own vertical axis (radius, angle and height eased together), as an arm swings in joint
// space; lowering and lifting are straight. The tool keeps the yaw it starts with, so the item
// keeps its heading. Home is where the robot stands when the op starts. Every step has a fixed
// time, so the plan's duration is exact.
const TIMING = { approach: 1.8, lower: 1.0, grip: 0.45, lift: 1.1, move: 2.0, place: 0.9, release: 0.45, settle: 0.16, retract: 0.8, home: 2.2 };
const LABELS = {
  approach: 'Swinging over the item', lower: 'Lowering onto the item', grip: 'Vacuum on', lift: 'Lifting the item',
  move: 'Swinging to the stack', place: 'Lowering onto the stack', release: 'Vacuum off', settle: 'Placement settling',
  retract: 'Retracting', home: 'Returning home',
};
const upper = z.string().regex(/^[A-Z][A-Z0-9_]*$/);
const GRIP_TOLERANCE = 0.035; // m, reference: no grip when the tool is further than this from the top

defineOp({
  op: 'armPalletize',
  summary: 'Articulated robot with a vacuum tool: take an item off a conveyor by its top and set it on the next spot of a station stack (swinging about its base), then return home.',
  args: z.object({
    machine: id,
    item: id.default('product'),
    stack: id,
    top: id.default('top').describe('Ref of the item the tool lands on (the middle of its top)'),
    gap: z.number().min(0).max(0.02).default(0.001).describe('Tool above the top at contact (m)'),
    approachHeight: z.number().min(0.05).max(1).default(0.3).describe('Hover above the item before lowering (m)'),
    liftHeight: z.number().min(0.05).max(1.5).default(0.52).describe('Lift above the pick point, at least (m)'),
    carryClearance: z.number().min(0.02).max(0.6).default(0.12).describe('Carried item bottom above its spot when swinging in (m)'),
    gripMotion: id.default('grip'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0).max(30).default(v)]))).default(TIMING),
    labels: z.object(Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, z.string().min(1).max(80).default(v)]))).default(LABELS),
    states: z.object(Object.fromEntries(Object.keys(TIMING).map((k) => [k, upper.optional()]))).default({}),
    ...common,
  }),
  expand(cycle, a) {
    const m = a.machine;
    for (const motion of ['x', 'y', 'z', 'yaw']) cycle.motionSpec(m, motion);
    cycle.checkValue(m, a.gripMotion, 0);
    cycle.checkValue(m, a.gripMotion, 1);
    cycle.checkAnchor(m, 'tool');
    cycle.item(a.item);
    cycle.stackSpec(a.stack);
    const spec = cycle.itemSpec(a.item);
    if (spec && !(spec.refs ?? []).includes(a.top)) cycle.fail(`item "${a.item}" has no ref "${a.top}" for the tool to land on`);

    const state = (key) => a.states[key] ?? a.state ?? cycle.workState;
    const status = (robot, gripper) => ({ ...a.status, robot, gripper });
    // Geometry in the robot frame, once the first step starts (the item is in place by then).
    const g = once(() => {
      const robot = cycle.machine(m);
      const root = robot.root;
      root.updateWorldMatrix(true, false);
      const inRobot = (world) => root.worldToLocal(world.clone());
      const object = cycle.item(a.item);
      object.updateWorldMatrix(true, false);
      const topLocal = cycle.productItem(a.item).ref(a.top);
      const contact = inRobot(object.localToWorld(topLocal.clone())).add(new THREE.Vector3(0, a.gap, 0));
      const spot = cycle.stacks.slotPoint(a.stack); // world: where the item's origin goes
      const spotContact = inRobot(spot.clone().add(topLocal)).add(new THREE.Vector3(0, a.gap, 0));
      const carry = spotContact.clone().add(new THREE.Vector3(0, topLocal.y + a.carryClearance, 0));
      const hover = contact.clone().add(new THREE.Vector3(0, a.approachHeight, 0));
      const lift = contact.clone().setY(Math.max(contact.y + a.liftHeight, carry.y));
      const s = robot.state;
      return { home: { x: s.x, y: s.y, z: s.z }, yaw: s.yaw, contact, hover, lift, carry, spotContact, spot };
    });

    // A straight move of the tool point.
    const straight = (key, point, robotState, gripper) => cycle.queueMotions({
      machine: m, state: state(key), seconds: a.timing[key], label: a.labels[key], status: status(robotState, gripper),
      to: { x: () => point().x, y: () => point().y, z: () => point().z },
    });
    // A swing about the robot's vertical axis: radius, angle and height eased together.
    const swing = (key, target, robotState, gripper) => {
      let from = null;
      let to = null;
      cycle.queue(state(key), a.labels[key], a.timing[key], status(robotState, gripper), {
        onStart: () => {
          const s = cycle.machine(m).state;
          from = { r: Math.hypot(s.x, s.z), angle: Math.atan2(s.z, s.x), y: s.y };
          const t = target();
          to = { r: Math.hypot(t.x, t.z), angle: Math.atan2(t.z, t.x), y: t.y };
        },
        onUpdate: (progress) => {
          const k = smoother(progress);
          const turn = Math.atan2(Math.sin(to.angle - from.angle), Math.cos(to.angle - from.angle));
          const r = from.r + (to.r - from.r) * k;
          const angle = from.angle + turn * k;
          cycle.drive(m, 'x', r * Math.cos(angle));
          cycle.drive(m, 'z', r * Math.sin(angle));
          cycle.drive(m, 'y', from.y + (to.y - from.y) * k);
        },
      });
      for (const motion of ['x', 'y', 'z']) cycle.plan(m, motion, UNKNOWN);
    };

    swing('approach', () => g().hover, 'APPROACH', 'APPROACHING');
    straight('lower', () => g().contact, 'APPROACH', 'APPROACHING');
    cycle.queueMotions({
      machine: m, state: state('grip'), seconds: a.timing.grip, label: a.labels.grip, status: status('PICKING', 'GRIPPING'),
      to: { [a.gripMotion]: 1 },
      onEnd: () => {
        const object = cycle.item(a.item);
        const tool = cycle.machine(m).anchor('tool');
        tool.updateWorldMatrix(true, false);
        object.updateWorldMatrix(true, false);
        const at = new THREE.Vector3().setFromMatrixPosition(tool.matrixWorld);
        const top = object.localToWorld(cycle.productItem(a.item).ref(a.top));
        if (at.distanceTo(top) > GRIP_TOLERANCE + a.gap) {
          throw new OpError(`armPalletize: the tool is ${at.distanceTo(top).toFixed(3)} m from the top of "${a.item}" (no grip beyond ${GRIP_TOLERANCE} m)`);
        }
        cycle.attach(object, m, 'tool');
      },
    });
    straight('lift', () => g().lift, 'CARRYING', 'HOLDING');
    swing('move', () => g().carry, 'CARRYING', 'HOLDING');
    straight('place', () => g().spotContact, 'PLACING', 'HOLDING');
    cycle.queueMotions({
      machine: m, state: state('release'), seconds: a.timing.release, label: a.labels.release, status: status('PLACING', 'RELEASING'),
      to: { [a.gripMotion]: 0 },
      onEnd: () => {
        // Off the tool and onto its spot, exactly (no drift from the hand-over), square to the station.
        const object = cycle.item(a.item);
        cycle.detach(object);
        cycle.stacks.place(a.stack, object);
        object.parent.updateWorldMatrix(true, false);
        object.position.copy(object.parent.worldToLocal(g().spot.clone()));
        object.quaternion.identity();
        object.updateMatrixWorld(true);
      },
    });
    cycle.queue(state('settle'), a.labels.settle, a.timing.settle, status('PLACING', 'OPEN'));
    straight('retract', () => g().carry, 'RETURNING HOME', 'OPEN');
    swing('home', () => g().home, 'RETURNING HOME', 'OPEN');
    cycle.locate(a.item, { stack: a.stack });
  },
});
