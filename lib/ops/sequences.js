// Step sequences shared by the named ops. Ported from the reference PickPlace.js (queuePickPlace),
// rebuilt on the OpCycle step machinery: every step is a queueMotions step with a fixed time, so a
// named op's duration is exactly the sum of its steps (dry or run).
import * as THREE from 'three';
import { z } from 'zod';
import { smoother } from '../core/motion.js';
import { id } from './args.js';

/** Step times of a pick-and-place (s). Defaults = reference ST2. */
export const PICK_TIMING = Object.freeze({ approach: 0.6, descend: 0.35, grip: 0.2, lift: 0.35, transfer: 0.8, place: 0.5, release: 0.2 });

export const pickTiming = z.object(Object.fromEntries(
  Object.entries(PICK_TIMING).map(([k, v]) => [k, z.number().min(0).max(30).default(v)]),
)).default(PICK_TIMING);

export const vec3 = z.tuple([z.number(), z.number(), z.number()]);

/** Gripper arguments shared by the pick-and-place ops. */
export const gripperArgs = {
  gap: z.number().min(0).describe('Closed gripper gap on the item (m)'),
  openGap: z.number().min(0).describe('Open gripper gap (m)'),
  gripMotion: id.default('grip'),
  anchor: id.default('tool').describe('Anchor the item is carried by'),
  indicator: id.default('holding'),
  timing: pickTiming,
};

/** Checks the tool interface a pick-and-place needs: x, y, z, yaw, the grip motion and the anchor. */
export function checkGripper(cycle, a) {
  for (const motion of ['x', 'y', 'z', 'yaw']) cycle.motionSpec(a.machine, motion);
  cycle.checkValue(a.machine, a.gripMotion, a.gap);
  cycle.checkValue(a.machine, a.gripMotion, a.openGap);
  cycle.checkAnchor(a.machine, a.anchor);
}

/** A value computed once, the first time it is asked for (when the op's first step starts). */
export function once(compute) {
  let value;
  let done = false;
  return () => {
    if (!done) {
      value = compute();
      done = true;
    }
    return value;
  };
}

function blendMatrix(a, b, k) {
  const pa = new THREE.Vector3(); const qa = new THREE.Quaternion(); const sa = new THREE.Vector3();
  const pb = new THREE.Vector3(); const qb = new THREE.Quaternion(); const sb = new THREE.Vector3();
  a.decompose(pa, qa, sa);
  b.decompose(pb, qb, sb);
  return new THREE.Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), sa.lerp(sb, k));
}

const toolPose = (p) => new THREE.Matrix4().compose(
  new THREE.Vector3(p.x, p.y, p.z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw),
  new THREE.Vector3(1, 1, 1),
);

/**
 * Queues  clear up → approach → descend → grip → lift → transfer → (lower → insert | place) → release.
 *
 *   geometry() → { from, to, entry, clearY, placed? } in the machine's frame, called when the
 *     first step starts (the product is in place by then). from / to / entry: { x, y, z, yaw }
 *     tool poses. `placed`: the item's final transform (Matrix4, machine frame); when given, the
 *     way the item sits in the gripper changes during the transfer so it arrives exactly in that
 *     pose (a part picked lying and installed upright).
 *   item() → the Object3D carried.
 *   spinTurns: the item turns this many times about its own Y while placed (a screw threading).
 *   hasInsert: true when entry differs from to (lower, then slide in).
 */
export function queuePickSequence(cycle, {
  machine, name, state, status = {}, gap, openGap, gripMotion, anchor, indicator, timing,
  geometry, item, hasInsert = false, spinTurns = 0, onPick, onPlace, onReleased,
}) {
  const robotStatus = (robot, gripper) => ({ ...status, robot, gripper });
  const state0 = () => cycle.machine(machine).state;
  // Travel height: as asked, but never above what the machine's y axis can reach (the reference
  // let a SCARA quill rise past its travel instead).
  const yMax = cycle.motionSpec(machine, 'y').range[1];
  const g = once(() => {
    const geo = geometry();
    return { ...geo, clearY: Math.min(geo.clearY, yMax) };
  });
  const indicate = cycle.hasMotion(machine, indicator);
  let carried = null;
  let fromOffset = null;
  let placedOffset = null;

  // Straight up first, then across: the empty gripper never cuts through what is already built.
  cycle.queueMotions({
    machine, state, seconds: 0.2, label: 'Gripper clearing up', status: robotStatus('CLEAR', 'OPEN'),
    to: { y: () => Math.max(state0().y, g().clearY) },
  });
  cycle.queueMotions({
    machine, state, seconds: timing.approach, label: `Moving to ${name}`, status: robotStatus('APPROACH', 'OPEN'),
    to: { x: () => g().from.x, z: () => g().from.z, yaw: () => g().from.yaw, y: () => g().clearY, [gripMotion]: openGap },
  });
  cycle.queueMotions({
    machine, state, seconds: timing.descend, label: `Descending to ${name}`, status: robotStatus('DESCEND', 'OPEN'),
    to: { x: () => g().from.x, y: () => g().from.y, z: () => g().from.z },
  });
  cycle.queueMotions({
    machine, state, seconds: timing.grip, label: `Gripping ${name}`, status: robotStatus('GRIP', 'CLOSING'),
    to: { [gripMotion]: gap },
    onStart: () => {
      carried = item();
      onPick?.();
      cycle.attach(carried, machine, anchor);
    },
    onEnd: () => { if (indicate) cycle.drive(machine, indicator, 'on'); },
  });
  if (indicate) cycle.plan(machine, indicator, 'on');
  cycle.queueMotions({
    machine, state, seconds: timing.lift, label: `Lifting ${name}`, status: robotStatus('LIFT', 'HOLDING'),
    to: { y: () => g().clearY },
  });
  cycle.queueMotions({
    machine, state, seconds: timing.transfer, label: `Transferring ${name}`, status: robotStatus('TRANSFER', 'HOLDING'),
    to: { x: () => g().entry.x, z: () => g().entry.z, yaw: () => g().to.yaw, y: () => g().clearY },
    onStart: () => {
      fromOffset = cycle.attachmentOffset(carried);
      const { placed, to } = g();
      placedOffset = placed ? toolPose(to).invert().multiply(placed) : fromOffset;
    },
    onUpdate: (progress) => {
      if (g().placed) cycle.setAttachmentOffset(carried, blendMatrix(fromOffset, placedOffset, smoother(progress)));
    },
  });
  const spin = spinTurns ? (progress) => {
    const turn = new THREE.Matrix4().makeRotationY(progress * spinTurns * Math.PI * 2);
    cycle.setAttachmentOffset(carried, placedOffset.clone().multiply(turn));
  } : undefined;
  if (hasInsert) {
    cycle.queueMotions({
      machine, state, seconds: timing.place, label: `Lowering ${name}`, status: robotStatus('PLACE', 'HOLDING'),
      to: { x: () => g().entry.x, y: () => g().entry.y, z: () => g().entry.z },
    });
    cycle.queueMotions({
      machine, state, seconds: timing.place, label: `Sliding ${name} into place`, status: robotStatus('INSERT', 'HOLDING'),
      to: { x: () => g().to.x, y: () => g().to.y, z: () => g().to.z }, onUpdate: spin,
    });
  } else {
    cycle.queueMotions({
      machine, state, seconds: timing.place, label: `Placing ${name}`, status: robotStatus('PLACE', 'HOLDING'),
      to: { x: () => g().to.x, y: () => g().to.y, z: () => g().to.z }, onUpdate: spin,
    });
  }
  cycle.queueMotions({
    machine, state, seconds: timing.release, label: `Releasing ${name}`, status: robotStatus('RELEASE', 'OPENING'),
    to: { [gripMotion]: openGap },
    onStart: () => {
      if (indicate) cycle.drive(machine, indicator, 'off');
      cycle.detach(carried);
      onPlace?.(carried);
    },
    onEnd: () => onReleased?.(carried),
  });
  if (indicate) cycle.plan(machine, indicator, 'off');
}

/** A tool pose { x, y, z, yaw } in the machine frame from a point and yaw in `owner`'s frame. */
export function poseIn(cycle, machine, owner, point, yaw = 0) {
  const p = cycle.toMachine(machine, owner, point);
  return { x: p.x, y: p.y, z: p.z, yaw: yaw + cycle.yawToMachine(machine, owner) };
}
