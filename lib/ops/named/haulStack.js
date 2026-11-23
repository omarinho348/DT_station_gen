import * as THREE from 'three';
import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { common, id } from '../args.js';

// A pallet truck takes a finished stack away: the stack's machine (the pallet) with everything on
// it, set down on another machine (the deck of a stretch wrapper), and the truck backs out. Port of
// the reference station-3 outbound (WORKER_SPAWN … JACK_STOW):
//
//   ready → drive in under the pallet → settle → lift (the pallet rides the forks) → drive to the
//   destination → roll in → lower onto it → release (the pallet rests on the destination anchor and
//   moves with it from then on, e.g. turning with a wrapper deck) → back out → lower the forks
//
// The truck's roles: motions `x` (its travel, in its own placement frame), `forks` (fork height),
// optionally `stride` (the walking legs, one cycle per `strideLength` m), anchor `cargo`. Where it
// drives to and its fork heights are given (station data, from the station's geometry); every step
// has a fixed time, so the plan's duration is exact.
const TIMING = { ready: 0.35, approach: 2.4, insert: 0.72, lift: 1.0, transport: 4.2, place: 1.8, lower: 0.9, release: 0.5, withdraw: 2.4, stow: 0.6 };
const LABELS = {
  ready: 'Worker ready', approach: 'Driving under the pallet', insert: 'Forks under the pallet', lift: 'Lifting the pallet',
  transport: 'Taking the pallet away', place: 'Rolling in', lower: 'Lowering the pallet', release: 'Releasing the pallet',
  withdraw: 'Backing out', stow: 'Lowering the forks',
};
const upper = z.string().regex(/^[A-Z][A-Z0-9_]*$/);

defineOp({
  op: 'haulStack',
  summary: 'Pallet truck: take a station stack (its pallet with everything on it) to a machine anchor (a wrapper deck), set it down there and back out.',
  args: z.object({
    machine: id.describe('The pallet truck'),
    stack: id,
    to: z.object({ machine: id, anchor: id }).strict().describe('Where the pallet is set down (it moves with that anchor afterwards)'),
    at: z.object({
      under: z.number().describe('Truck x with its forks under the pallet'),
      destination: z.number().describe('Truck x at the destination entrance'),
      place: z.number().describe('Truck x with the pallet over its spot'),
      clear: z.number().describe('Truck x with its forks clear of the pallet'),
    }).strict(),
    forks: z.object({
      down: z.number().describe('Lowered'),
      lift: z.number().describe('Carrying (clear of the destination)'),
      set: z.number().describe('The pallet resting on the destination'),
      free: z.number().describe('Just below the pallet, to back out'),
    }).strict(),
    strideLength: z.number().positive().max(5).default(1.2).describe('Metres per walking cycle'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0).max(60).default(v)]))).default(TIMING),
    labels: z.object(Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, z.string().min(1).max(80).default(v)]))).default(LABELS),
    states: z.object(Object.fromEntries(Object.keys(TIMING).map((k) => [k, upper.optional()]))).default({}),
    ...common,
  }),
  expand(cycle, a) {
    const m = a.machine;
    for (const motion of ['x', 'forks']) cycle.motionSpec(m, motion);
    cycle.checkAnchor(m, 'cargo');
    const stack = cycle.stackSpec(a.stack);
    cycle.machine(stack.machine);
    cycle.machine(a.to.machine);
    cycle.checkAnchor(a.to.machine, a.to.anchor);
    for (const x of Object.values(a.at)) cycle.checkValue(m, 'x', x);
    for (const f of Object.values(a.forks)) cycle.checkValue(m, 'forks', f);
    const walks = cycle.hasMotion(m, 'stride');

    const state = (key) => a.states[key] ?? a.state ?? cycle.workState;
    const step = (key, to, extra = {}) => cycle.queueMotions({
      machine: m, state: state(key), seconds: a.timing[key], label: a.labels[key], status: a.status, to, ...extra,
    });
    // Driving: the legs walk with the distance.
    const drive = (key, x, extra = {}) => {
      const from = cycle.planned(m, 'x');
      const by = walks && typeof from === 'number' ? { stride: Math.abs(x - from) / a.strideLength } : {};
      step(key, { x }, { by, ...extra });
    };
    let pallet = null;

    cycle.queue(state('ready'), a.labels.ready, a.timing.ready, a.status);
    drive('approach', a.at.under);
    cycle.queue(state('insert'), a.labels.insert, a.timing.insert, a.status);
    step('lift', { forks: a.forks.lift }, {
      onStart: () => {
        pallet = cycle.stacks.gather(a.stack); // the cases ride on the pallet
        cycle.attach(pallet, m, 'cargo');
      },
    });
    drive('transport', a.at.destination);
    drive('place', a.at.place);
    step('lower', { forks: a.forks.set });
    step('release', { forks: a.forks.free }, {
      onStart: () => {
        // Resting on the destination: seated exactly on its anchor, square, and moving with it.
        cycle.detach(pallet);
        const anchor = cycle.machine(a.to.machine).anchor(a.to.anchor);
        anchor.updateWorldMatrix(true, false);
        const world = new THREE.Vector3().setFromMatrixPosition(anchor.matrixWorld);
        pallet.parent.updateWorldMatrix(true, false);
        pallet.position.copy(pallet.parent.worldToLocal(world));
        const turn = new THREE.Quaternion().setFromRotationMatrix(anchor.matrixWorld);
        const parentTurn = new THREE.Quaternion().setFromRotationMatrix(pallet.parent.matrixWorld);
        pallet.quaternion.copy(parentTurn.invert().multiply(turn));
        pallet.updateMatrixWorld(true);
        cycle.attach(pallet, a.to.machine, a.to.anchor);
      },
    });
    drive('withdraw', a.at.clear);
    step('stow', { forks: a.forks.down });
  },
});
