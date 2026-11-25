import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id, stateOf } from '../args.js';

// Wires one cable of the product's harness with a gripper robot. Port of the reference
// WiringCycle.planCable, for any product that declares cables (static routes in its frame):
//   loose cables:  end A out of the harness bag, carried to the device socket, aligned, plugged
//   every cable:   end B taken, laid clip by clip along the frame (pressed into each clip), carried
//                  to its board socket and plugged.
// Every move has a fixed time, except the clip-to-clip moves: distance × perMetre (at least min),
// worked out from the static route, so the dry plan has the played durations exactly. After each
// clip waypoint a zero-length step records it (the reference does the same). While the gripper
// holds a connector the cable follows the tool point.
export const CABLE_TIMING = Object.freeze({ gap: 0.008, open: 0.04, rise: 0.25, travel: 0.5, descend: 0.3, grip: 0.15, insert: 0.22, release: 0.15, perMetre: 1.8, min: 0.18 });

defineOp({
  op: 'routeCable',
  needs: { product: ['cables'] },
  summary: 'Wire one product cable: plug end A at its device (loose cables), lay it through its clips, plug end B into its board socket.',
  args: z.object({
    machine: id.describe('Gripper robot with x, y, z, yaw, grip'),
    cable: z.string().min(1).describe('Cable name of the product'),
    name: z.string().min(1).max(30).optional().describe('Cable name on the HMI (default: the cable)'),
    safeHeight: z.number().min(0).max(2).default(0.58).describe('Cable-handling travel height above the product assembly origin (m)'),
    entry: z.number().min(0).max(0.2).default(0.04).describe('Connector aligned this far out of its socket before plugging (m)'),
    clipLift: z.tuple([z.number().min(0).max(0.1), z.number().min(0).max(0.1)]).default([0.02, 0.004]).describe('Over each clip, then pressed into it (m above the clip)'),
    timing: z.object(Object.fromEntries(Object.entries(CABLE_TIMING).map(([k, v]) => [k, z.number().min(0).max(30).default(v)]))).default(CABLE_TIMING),
    gripMotion: id.default('grip'),
    anchor: id.default('tool'),
    indicator: id.default('holding'),
    doneStatus: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('Status set when the cable is done'),
    ...common,
  }),
  expand(cycle, a) {
    const m = a.machine;
    for (const motion of ['x', 'y', 'z', 'yaw']) cycle.motionSpec(m, motion);
    cycle.checkValue(m, a.gripMotion, a.timing.gap);
    cycle.checkValue(m, a.gripMotion, a.timing.open);
    cycle.checkAnchor(m, a.anchor);
    const spec = cycle.productSpec;
    if (!spec?.cables?.length) cycle.fail('the product has no cables');
    if (!spec.cables.includes(a.cable)) cycle.fail(`the product has no cable "${a.cable}" (cables: ${spec.cables.join(', ')})`);
    const route = spec.cableRoute(a.cable);
    if (!route.clips.length) cycle.fail(`cable "${a.cable}" has no clips to lay it through`);
    const t = a.timing;
    const name = a.name ?? a.cable;
    const state = stateOf(cycle, a);
    const indicate = cycle.hasMotion(m, a.indicator);

    // Product-frame points → machine frame, when a step starts (the product is located by then).
    const owner = () => cycle.product.root;
    const P = (p) => cycle.toMachine(m, owner(), p);
    const safeY = () => P(originOf(cycle).add(new THREE.Vector3(0, a.safeHeight, 0))).y;
    const toolInProduct = () => {
      const frame = cycle.machine(m).anchor(a.anchor);
      frame.updateWorldMatrix(true, false);
      return owner().worldToLocal(new THREE.Vector3().setFromMatrixPosition(frame.matrixWorld));
    };
    const setCable = (mode, extra = {}) => cycle.product.setCable(a.cable, { mode, ...extra });
    const follow = (mode, extra = () => ({})) => () => setCable(mode, { grip: toolInProduct(), ...extra() });

    // Tool moves (yaw squared to 0, as in the reference); targets resolved at step start.
    const move = (label, seconds, target, status, onUpdate, extraTo = {}) => cycle.queueMotions({
      machine: m, state, label, seconds, status: { ...a.status, ...status },
      to: { x: () => target().x, y: () => target().y, z: () => target().z, yaw: 0, ...extraTo },
      onUpdate,
    });
    const rise = (label, onUpdate) => cycle.queueMotions({
      machine: m, state, label, seconds: t.rise, status: { ...a.status, robot: 'RISE' },
      to: { y: () => Math.max(cycle.machine(m).state.y, safeY()) },
      onUpdate,
    });
    const above = (p) => () => { const q = P(p); q.y = safeY(); return q; };
    const at = (p) => () => P(p);
    const grip = (closing) => {
      cycle.queueMotions({
        machine: m, state, label: closing ? `Gripping ${name} connector` : `Releasing ${name} connector`, seconds: closing ? t.grip : t.release,
        status: { ...a.status, gripper: closing ? 'HOLDING' : 'OPEN' },
        to: { [a.gripMotion]: closing ? t.gap : t.open },
        onEnd: () => { if (indicate) cycle.drive(m, a.indicator, closing ? 'on' : 'off'); },
      });
      if (indicate) cycle.plan(m, a.indicator, closing ? 'on' : 'off');
    };
    const mark = (label, onEnd, status = {}) => cycle.queue(state, label, 0.1, { ...a.status, ...status }, { onEnd });

    // End A (loose cables): out of the harness bag, into the device.
    if (route.kind === 'loose') {
      const socket = route.a.point;
      const entryA = socket.clone().addScaledVector(route.a.dir, -a.entry);
      rise(`Clearing for ${name} cable`);
      move(`Picking ${name} cable from harness bag`, t.travel, above(route.coil), { robot: 'APPROACH', gripper: 'OPEN' }, undefined, { [a.gripMotion]: t.open });
      move(`Picking ${name} cable from harness bag`, t.descend, at(route.coil), { robot: 'PICK' });
      grip(true);
      const carryA = follow('carryA');
      rise(`Lifting ${name} end A`, carryA);
      move(`Carrying ${name} connector to device socket`, t.travel, above(entryA), { robot: 'CARRY' }, carryA);
      move(`Aligning ${name} connector · device socket`, t.descend, at(entryA), { robot: 'ALIGN' }, carryA);
      move(`Plugging ${name} · device socket`, t.insert, at(socket), { robot: 'INSERT' }, carryA);
      mark(`${name} end A seated · latch clicked`, () => setCable('pluggedA'));
      grip(false);
    }

    // End B: take it, lay the cable through each clip, plug it into its board socket.
    rise(`Clearing for ${name} end B`);
    move(`Taking ${name} end B`, t.travel, above(route.coil), { robot: 'APPROACH', gripper: 'OPEN' }, undefined, { [a.gripMotion]: t.open });
    move(`Taking ${name} end B`, t.descend, at(route.coil), { robot: 'PICK' });
    grip(true);
    let passed = 0;
    const routing = follow('routing', () => ({ passed }));
    rise(`Lifting ${name} end B`, routing);
    move(`Laying ${name} cable`, t.travel, above(route.clips[0]), { robot: 'LAYING' }, routing);
    const [over, press] = a.clipLift;
    const waypoints = route.clips.flatMap((c) => [c.clone().add(new THREE.Vector3(0, over, 0)), c.clone().add(new THREE.Vector3(0, press, 0))]);
    const layLabel = `Laying ${name} cable through clips`;
    waypoints.forEach((point, index) => {
      // First waypoint: the minimum time (the reference starts the path there); then by distance.
      const seconds = index === 0 ? t.min : Math.max(t.min, waypoints[index - 1].distanceTo(point) * t.perMetre);
      move(layLabel, seconds, at(point), { robot: 'LAYING' }, routing);
      cycle.queue(state, layLabel, 0, {}, { onEnd: () => { if (index % 2 === 1) passed += 1; } });
    });
    const board = route.b.point;
    const boardEntry = board.clone().addScaledVector(route.b.dir, -a.entry);
    move(`${name} cable to mainboard J${route.b.socket}`, t.travel, at(boardEntry), { robot: 'CARRY' }, routing);
    move(`Plugging ${name} · mainboard J${route.b.socket}`, t.insert, at(board), { robot: 'INSERT' }, routing);
    mark(`${name} end B seated · J${route.b.socket}`, () => setCable('done'), a.doneStatus ?? {});
    grip(false);
  },
});

/** The product's assembly origin (heights are measured from it), or its frame origin. */
function originOf(cycle) {
  const asm = cycle.product?.assembly;
  return asm ? asm.origin() : new THREE.Vector3();
}
