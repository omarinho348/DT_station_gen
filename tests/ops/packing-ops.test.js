// The pieces Phase 5 step 9b added for case packing: batches standing in rows, port offsets, the
// run extent of a station, the ops accumulate / groupPickPlace / closeCase / swapUnit, transfer's
// `passes`, and the carton's foldUnder / tapeAlong routines.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import { OpCycle, dryRun } from '../../lib/ops/index.js';
import { StepSequencer } from '../../lib/core/StepSequencer.js';
import { createMaterials } from '../../lib/core/materials.js';
import { rampedDuration, rampedTravel, smoothMin, stoppingTravel, trapezoidDuration, trapezoidTravel } from '../../lib/core/motion.js';
import { planStation } from '../../lib/station/StationCycle.js';
import { BatchSpec, batchOffsets } from '../../lib/station/batchSpec.js';
import { createBatch } from '../../lib/station/indexing.js';
import { parseStation, resolvePorts } from '../../lib/station/stationSpec.js';
import { runExtent, layoutLine } from '../../lib/line/layout.js';

const materials = createMaterials();
const BH = 0.86;
const ctx = { beltHeight: BH };

describe('batches in rows', () => {
  it('members stand rear row first, each row along +X, centred', () => {
    expect(batchOffsets({ members: 4, pitch: 0.6, rows: 2, rowPitch: 0.26 })).toEqual([[-0.3, -0.13], [0.3, -0.13], [-0.3, 0.13], [0.3, 0.13]]);
    expect(batchOffsets({ members: 4, pitch: 0.4 })).toEqual([[-0.6, 0], [-0.2, 0], [0.2, 0], [0.6, 0]]); // one row: the indexing batch
  });

  it('rowsFrom front: the member numbers start in the front row', () => {
    expect(batchOffsets({ members: 4, pitch: 0.4, rows: 2, rowPitch: 0.26, rowsFrom: 'front' })).toEqual([[-0.2, 0.13], [0.2, 0.13], [-0.2, -0.13], [0.2, -0.13]]);
  });

  it('rebase: the origin moves, the members stay, their places in the batch are recorded', () => {
    const def = registry.getProduct('jerryCan');
    const members = [1, 2].map(() => registry.buildProduct('jerryCan', {}, { materials }));
    const batch = createBatch({ members, pitch: 0.4, def, serial: 1 });
    members[1].root.position.z = 0.13; // pushed into a lane
    batch.rebase(new THREE.Vector3(1, 0, 0));
    expect(batch.root.position.x).toBe(1);
    expect(batch.memberOffsets).toEqual([[-1.2, 0], [-0.8, 0.13]]);
    expect(members[0].root.position.x + batch.root.position.x).toBeCloseTo(-0.2, 12);
  });

  it('the spec refuses rows that are not full and rows without a spacing', () => {
    expect(BatchSpec.safeParse({ members: 5, pitch: 0.3, rows: 2, rowPitch: 0.2 }).success).toBe(false);
    expect(BatchSpec.safeParse({ members: 4, pitch: 0.3, rows: 2 }).success).toBe(false);
  });

  it('a batch offers its members as items member1 … memberN (product instances)', () => {
    const def = registry.getProduct('jerryCan');
    const members = [1, 2, 3, 4].map(() => registry.buildProduct('jerryCan', {}, { materials }));
    const batch = createBatch({ members, pitch: 0.6, rows: 2, rowPitch: 0.26, def, serial: 3 });
    expect(batch.payloads).toEqual(['member1', 'member2', 'member3', 'member4']);
    expect(batch.payload('member3')).toBe(members[2]);
    expect(members[3].root.position.toArray()).toEqual([0.3, 0, 0.13]);
    expect(() => batch.payload('member9')).toThrow(/no member/);
    // A member packed elsewhere is not freed with the batch.
    const elsewhere = new THREE.Group();
    elsewhere.add(members[0].root);
    batch.dispose();
    expect(members[0].root.parent).toBe(elsewhere);
  });
});

describe('ports and station runs', () => {
  it('a station port may sit at an offset from its machine port', () => {
    const station = parseStation({ id: 's', title: 'S', conveyor: 'belt', ports: { input: { offset: [1.2, 0, 0] } } });
    const specs = { belt: registry.componentSpec('beltConveyor', { length: 4 }, ctx) };
    const ports = resolvePorts(station, specs);
    expect(ports.input.position).toEqual([-2 + 1.2, BH, 0]);
    expect(ports.output.position).toEqual([2, BH, 0]);
  });

  it('direct edges stand stations so the ports meet; ports are lined up across the flow', () => {
    const l = layoutLine({
      stations: [
        { id: 'a', extent: { start: -4, end: 9 }, ports: { output: { x: 8, z: 0 } } },
        { id: 't', extent: { start: -1.5, end: 1.5 }, ports: { input: { x: -2.45, z: 0 }, output: { x: 2.85, z: 0 } } },
        { id: 'b', extent: { start: -4.2, end: 5.6 }, ports: { input: { x: -2.9, z: 0.75 }, output: { x: 4.8, z: -0.75 } } },
        { id: 'c', extent: { start: -2, end: 2 }, ports: { input: { x: -2, z: 0 } } },
      ],
      edges: [
        { from: 'a.output', to: 't.input', direct: true },
        { from: 't.output', to: 'b.input', direct: true },
        { from: 'b.output', to: 'c.input' },
      ],
      transferLength: 1.6,
    });
    const at = (id) => l.stations[id];
    expect(at('t').x - at('a').x).toBeCloseTo(10.45, 12);
    expect(at('b').x - at('a').x).toBeCloseTo(16.2, 12);
    expect(at('b').z).toBeCloseTo(-0.75, 12);
    expect(at('c').z).toBeCloseTo(-1.5, 12); // b's output at its z −0.75 → c's input in line with it
    expect(l.transfers).toHaveLength(1); // only the conveyor edge
    expect(l.transfers[0]).toMatchObject({ from: 'b', to: 'c' });
    expect(l.transfers[0].length).toBeCloseTo(1.6, 12);
    expect(l.transfers[0].z).toBeCloseTo(-1.5, 12);
  });

  it('a station runs from its input machine\'s start to its output machine\'s end', () => {
    expect(runExtent([-4, 4], [-4.5, 0], [3, 9])).toEqual({ start: -4.5, end: 9 });
    expect(runExtent([-4, 4], null, null)).toEqual({ start: -4, end: 4 });
  });
});

describe('tunnel hood and connected-only machines', () => {
  it('a hood open at both ends: no end wall, no lining, a trim at each opening, ports at both ends', () => {
    const hood = registry.buildComponent('conveyorTunnel', { open: 'both', length: 1.8 }, { ...ctx, materials });
    const names = [];
    hood.root.traverse((o) => names.push(o.name));
    expect(names).not.toContain('End wall');
    expect(names).not.toContain('Interior lining');
    expect(names.filter((n) => n === 'Opening trim top')).toHaveLength(2);
    expect(Object.keys(hood.ports)).toEqual(['entry', 'opening']);
    hood.dispose();
  });

  it('a port names machines that only exist when it is connected', () => {
    const station = parseStation({ id: 's', title: 'S', conveyor: 'belt', ports: { output: { connected: ['hood'] } } });
    const specs = { belt: registry.componentSpec('beltConveyor', {}, ctx), hood: registry.componentSpec('conveyorTunnel', { open: 'both' }, ctx) };
    expect(resolvePorts(station, specs).output.connected).toEqual(['hood']);
    const bad = parseStation({ id: 's', title: 'S', conveyor: 'belt', ports: { output: { connected: ['nope'] } } });
    expect(() => resolvePorts(bad, specs)).toThrow(/unknown connected-only machine "nope"/);
  });
});

describe('belt motion helpers', () => {
  it('ramped travel, its inverse, the stop and the smooth minimum', () => {
    expect(rampedTravel(0.5, 0.6, 0.5)).toBeCloseTo(0.15, 12);
    expect(rampedTravel(2.5, 0.6, 0.5)).toBeCloseTo(1.35, 12);
    expect(rampedDuration(3.36, 0.6, 0.5)).toBeCloseTo(5.85, 12); // the reference case packer's arrival
    expect(rampedTravel(rampedDuration(0.1, 0.6, 0.5), 0.6, 0.5)).toBeCloseTo(0.1, 12); // short: inside the ramp
    expect(stoppingTravel(1, 0.6, 0.5)).toBeCloseTo(0.15, 12);
    expect(smoothMin(1, 3, 0.06)).toBe(1);
    expect(smoothMin(2.99, 3, 0.06)).toBeLessThan(2.99);
  });

  it('a trapezoid without a ramp is a constant-speed move (the station-3 roller belt, 0.7 m/s)', () => {
    expect(trapezoidDuration(2.592, 0.7, 0)).toBeCloseTo(3.702857, 6);
    expect(trapezoidTravel(1, 2.592, 0.7, 0)).toBeCloseTo(0.7, 12);
    expect(trapezoidTravel(0, 2.592, 0.7, 0)).toBe(0);
    expect(trapezoidTravel(10, 2.592, 0.7, 0)).toBeCloseTo(2.592, 12);
  });
});

// A small packing cell: an infeed belt with an end stop, a case belt, a gantry over both.
const cellEquipment = {
  canBelt: { type: 'beltConveyor', params: { length: 4.75, beltWidth: 0.52, guideGap: 0.46, carries: 'batch' }, position: [-1.825, 0, 0.75] },
  canStop: { type: 'beltEndStop', params: { span: 0.58 }, position: [0.28, BH + 0.01, 0.75] },
  boxBelt: { type: 'beltConveyor', params: { length: 5.2, beltWidth: 0.52, guideGap: 0.43, carries: 'case' }, position: [-1.7, 0, -0.75] },
  gantry: { type: 'packingGantry', params: {}, position: [-0.054, 0, 0] },
  closer: { type: 'caseCloser', params: {}, position: [1.35, 0, -0.75] },
  taper: { type: 'inlineTaper', params: {}, position: [2.3, 0, -0.75] },
};
const dryEquipment = () => Object.fromEntries(Object.entries(cellEquipment).map(([id, e]) => [id, { ...registry.componentSpec(e.type, e.params, ctx), placement: { position: e.position, rotationY: 0 } }]));
const CASE = { length: 0.62, width: 0.42, height: 0.42, foam: 0 };
const spawnCase = { op: 'spawn', items: [{ item: 'case', product: { type: 'carton', params: CASE }, at: { machine: 'boxBelt', port: 'input', offset: [1, 0, 0] } }] };
const slots = [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.1], [0.14, 0.1]];
const pick = { op: 'groupPickPlace', machine: 'gantry', items: [1, 2, 3, 4].map((i) => ({ item: `member${i}`, anchor: `grip${i}` })), into: 'case', slots, gap: 0.047, openGap: 0.09 };
const batchSpec = () => {
  const def = registry.getProduct('jerryCan');
  return { stages: def.stages, refs: def.refs, features: def.features, routines: def.routines, payloads: ['member1', 'member2', 'member3', 'member4'], memberSpec: def, memberOffsets: batchOffsets({ members: 4, pitch: 0.6, rows: 2, rowPitch: 0.26 }) };
};
const dry = (ops, extra = {}) => dryRun(registry, ops, {
  equipment: dryEquipment(), productSpec: batchSpec(), at: { product: { machine: 'canBelt', port: 'input', offset: [1.2, 0, 0] } }, ...extra,
});

describe('accumulate', () => {
  it('runs until the item with the longest way is at its stop (+ blend), then a stopping step', () => {
    const { steps } = dry([spawnCase, {
      op: 'accumulate',
      items: [{ item: 'member1', conveyor: 'canBelt', to: { machine: 'canStop', port: 'stop', offset: [-0.42, 0, -0.13] } },
        { item: 'case', conveyor: 'boxBelt', to: { machine: 'boxBelt', port: 'output', offset: [-0.9, 0, 0] } }],
    }], { conventions: { conveyor: { speed: 0.6, ramp: 0.5 } } });
    // the case's 3.3 m is the longest: 0.5 + (3.36 − 0.15) / 0.6
    expect(steps.map((s) => s.label)).toEqual(['Making case', 'Conveyors running', 'Conveyors stopping']);
    expect(steps[1].duration).toBeCloseTo(5.85, 9);
    expect(steps[2].duration).toBe(0.5);
  });

  it('needs to know where each item starts', () => {
    expect(() => dry([{ op: 'accumulate', items: [{ item: 'product', conveyor: 'canBelt', to: { machine: 'canStop', port: 'stop' } }] }], { at: {} }))
      .toThrow(/where is "product"/);
  });
});

describe('groupPickPlace', () => {
  it('nine fixed-time steps (reference 9.85 s); one slot per item; one item per gripper', () => {
    const { steps } = dry([spawnCase, pick]);
    expect(steps.slice(1).map((s) => s.duration)).toEqual([1.1, 0.4, 1.2, 2.2, 1.5, 0.35, 1.0, 1.8, 0.3]);
    expect(() => dry([spawnCase, { ...pick, slots: slots.slice(1) }])).toThrow(/one slot per item/);
    expect(() => dry([spawnCase, { ...pick, items: [{ item: 'member1', anchor: 'grip1' }, { item: 'member2', anchor: 'grip1' }], slots: slots.slice(2) }])).toThrow(/two items/);
    expect(() => dry([spawnCase, { ...pick, gap: 0.01 }])).toThrow(/grip must stay in/);
  });
});

describe('closeCase and swapUnit', () => {
  it('the closer: seven steps (reference 5.1 s), tools checked against its motions', () => {
    const { steps, cycle } = dry([spawnCase, { op: 'swapUnit', item: 'case' }, { op: 'closeCase', machine: 'closer' }]);
    expect(steps.slice(2).map((s) => s.duration)).toEqual([0.4, 0.9, 0.6, 0.7, 0.9, 0.4, 1.2]);
    expect(cycle.planned('closer', 'plateUp')).toBe(0.3);
    expect(() => dry([spawnCase, { op: 'closeCase', machine: 'closer', item: 'case', tools: { pushIn: 0.5 } }])).toThrow(/tuckerOut must stay in/);
    expect(() => dry([spawnCase, { op: 'closeCase', machine: 'gantry', item: 'case' }])).toThrow(/no motion "tuckerOut"/);
  });

  it('only an item the station made can become the unit; its members stay reachable', () => {
    expect(() => dry([{ op: 'swapUnit', item: 'member1' }])).toThrow(/cannot become the unit/);
    const { cycle } = dry([spawnCase, { op: 'swapUnit', item: 'case' }]);
    expect(cycle.productSpec.refs).toContain('bottom');
    expect(cycle.knownItems()).toContain('member2');
    expect(cycle.locationOf('product')).toEqual({ machine: 'boxBelt', port: 'input', offset: [1, 0, 0] });
  });
});

describe('push, stopConveyors and accumulate handing over early', () => {
  const rowEquipment = () => {
    const e = {
      belt: { type: 'beltConveyor', params: { length: 3, beltWidth: 0.52, guideGap: 0.46, carries: 'batch' }, position: [0, 0, 0] },
      pusherA: { type: 'sidePusher', params: {}, position: [0.55, 0, 0] },
      pusherB: { type: 'sidePusher', params: {}, position: [0.55, 0, 0], rotationY: Math.PI },
    };
    return Object.fromEntries(Object.entries(e).map(([id, x]) => [id, { ...registry.componentSpec(x.type, x.params, ctx), placement: { position: x.position, rotationY: x.rotationY ?? 0 } }]));
  };
  const rowSpec = () => {
    const def = registry.getProduct('jerryCan');
    return { stages: def.stages, refs: def.refs, features: def.features, routines: def.routines, payloads: ['member1', 'member2', 'member3', 'member4'], memberSpec: def, memberOffsets: batchOffsets({ members: 4, pitch: 0.4 }) };
  };
  const rowDry = (ops) => dryRun(registry, ops, { equipment: rowEquipment(), productSpec: rowSpec(), conventions: { conveyor: { speed: 0.6, ramp: 0.5 } }, at: { product: { machine: 'belt', port: 'input', offset: [1.65, 0, 0] } } });

  it('push: out and back (reference 0.7 + 0.45 s); with rest, the plan knows where the pushed items stand', () => {
    const { steps, cycle } = rowDry([{ op: 'push', machine: 'pusherB', items: ['member1', 'member2'], to: -0.035, rest: -0.13 }]);
    expect(steps.map((s) => s.duration)).toEqual([0.7, 0.45]);
    expect(cycle.planned('pusherB', 'face')).toBe(0.25); // retracted again
    const p = cycle.plannedPoint('member1');
    expect(p.z).toBeCloseTo(0.13, 12); // pusher B stands on −Z, so its machine Z −0.13 is the station's +0.13
    expect(p.x).toBeCloseTo(-1.5 + 1.65 - 0.6, 12);
    expect(() => rowDry([{ op: 'push', machine: 'pusherA', items: ['member1'], to: 0.25 }])).toThrow(/already at 0.25/);
    expect(() => rowDry([{ op: 'push', machine: 'belt', items: ['member1'], to: 0.1 }])).toThrow(/no motion "face"/);
  });

  it('pushed members move with their batch afterwards; accumulate without its stop, then stopConveyors', () => {
    const { steps, cycle } = rowDry([
      { op: 'push', machine: 'pusherA', items: ['member4', 'member3'], to: -0.035, rest: -0.13 },
      { op: 'transfer', conveyor: 'belt', to: { machine: 'belt', port: 'input', offset: [2.45, 0, 0] } },
      { op: 'push', machine: 'pusherB', items: ['member2', 'member1'], to: -0.035, rest: -0.13 },
      {
        op: 'accumulate', stopping: false, unitTo: { machine: 'belt', port: 'output', offset: [1.35, 0, 0] },
        items: [
          { item: 'member4', conveyor: 'belt', to: { machine: 'belt', port: 'output', offset: [1.55, 0, -0.13] } },
          { item: 'member3', conveyor: 'belt', to: { machine: 'belt', port: 'output', offset: [1.15, 0, -0.13] } },
          { item: 'member2', conveyor: 'belt', to: { machine: 'belt', port: 'output', offset: [1.55, 0, 0.13] } },
          { item: 'member1', conveyor: 'belt', to: { machine: 'belt', port: 'output', offset: [1.15, 0, 0.13] } },
        ],
      },
      { op: 'stopConveyors', conveyors: ['belt'] },
    ]);
    // the reference transfer: index 1.833 s, feed 4.183 s (the longest way 2.3 m), stop 0.5 s
    expect(steps.map((s) => +s.duration.toFixed(6))).toEqual([0.7, 0.45, 1.833333, 0.7, 0.45, 4.183333, 0.5]);
    expect(cycle.locationOf('product')).toEqual({ machine: 'belt', port: 'output', offset: [1.35, 0, 0] });
  });
});

describe('palletizing with an arm: armPalletize, units left on a stack', () => {
  const cell = () => {
    const e = {
      belt: { type: 'beltConveyor', params: { length: 4.8, beltWidth: 1.05, guides: false, carries: 'case' }, position: [0, 0, 0] },
      robot: { type: 'palletizerRobot', params: {}, position: [0.9, 0, 1.4], rotationY: Math.PI },
      pallet: { type: 'blockPallet', params: { length: 2.06, width: 1.46 }, position: [0.14, 0, 2.84] },
    };
    return e;
  };
  const station = (process) => ({
    id: 's3', title: 'S3', conveyor: 'belt', unit: { type: 'carton', params: CASE }, output: [],
    stacks: { pallet: { machine: 'pallet', port: 'top', columns: [-0.64, 0, 0.64], rows: [-0.44, 0, 0.44], layers: 3, layerHeight: 0.42 } },
    process,
  });
  const plan = (process) => planStation(registry, station(process), { equipment: cell(), product: 'carton', ctx });

  it('ten fixed-time steps (reference 10.86 s); the unit stays on the stack: no output phase', () => {
    const p = plan([{ op: 'armPalletize', machine: 'robot', stack: 'pallet' }]);
    expect(p.process.steps.map((s) => s.duration).slice(0, 10)).toEqual([1.8, 1.0, 0.45, 1.1, 2.0, 0.9, 0.45, 0.16, 0.8, 2.2]);
    expect(p.process.duration).toBeCloseTo(10.86, 9);
    expect(p.stacked).toBe('pallet');
    expect(p.output.duration).toBe(0);
  });

  it('haulStack: the reference outbound, ten fixed-time steps (14.87 s); positions and fork heights checked', () => {
    const e = cell();
    e.worker = { type: 'palletJackWorker', params: { travel: 7 }, position: [-2.26, 0, 2.84] };
    e.wrapper = { type: 'stretchWrapper', params: {}, position: [4.34, 0, 2.84] };
    const haul = { op: 'haulStack', machine: 'worker', stack: 'pallet', to: { machine: 'wrapper', anchor: 'deck' }, at: { under: 1.85, destination: 4.215, place: 6.05, clear: 3.97 }, forks: { down: 0.045, lift: 0.55, set: 0.485, free: 0.455 } };
    const p = planStation(registry, station([haul]), { equipment: e, product: 'carton', ctx });
    expect(p.process.steps.map((s) => s.duration).slice(0, 10)).toEqual([0.35, 2.4, 0.72, 1.0, 4.2, 1.8, 0.9, 0.5, 2.4, 0.6]);
    expect(p.process.duration).toBeCloseTo(14.87, 9);
    expect(() => planStation(registry, station([{ ...haul, at: { ...haul.at, place: 9 } }]), { equipment: e, product: 'carton', ctx })).toThrow(/x must stay in/);
    expect(() => planStation(registry, station([{ ...haul, forks: { ...haul.forks, lift: 0.9 } }]), { equipment: e, product: 'carton', ctx })).toThrow(/forks must stay in/);
    expect(() => planStation(registry, station([{ ...haul, to: { machine: 'wrapper', anchor: 'nope' } }]), { equipment: e, product: 'carton', ctx })).toThrow(/no anchor "nope"/);
  });

  it('decide planAs: the dry plan takes the usual branch, not the longest', () => {
    const ops = (planAs) => [{ op: 'decide', on: 'palletFills', ...(planAs ? { planAs } : {}), cases: { yes: [{ op: 'wait', seconds: 20 }] }, otherwise: [{ op: 'wait', seconds: 0.2 }] }];
    expect(plan(ops()).process.duration).toBeCloseTo(20, 9);
    expect(plan(ops('otherwise')).process.duration).toBeCloseTo(0.2, 9);
    expect(plan(ops('yes')).process.duration).toBeCloseTo(20, 9);
    expect(() => plan(ops('maybe'))).toThrow(/planAs "maybe" is not one of the cases/);
  });

  it('needs a tool robot, the item\'s top and a known stack', () => {
    expect(() => plan([{ op: 'armPalletize', machine: 'belt', stack: 'pallet' }])).toThrow(/no motion "x"/);
    expect(() => plan([{ op: 'armPalletize', machine: 'robot', stack: 'nope' }])).toThrow(/unknown stack "nope"/);
    expect(() => plan([{ op: 'armPalletize', machine: 'robot', stack: 'pallet', top: 'lid' }])).toThrow(/no ref "lid"/);
  });

  it('a station\'s own unit type: a closed carton fed stand-alone, with its top on the tape', () => {
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.setStage('closed');
    expect(carton.root.getObjectByName('Minor flap leading').rotation.z).toBeCloseTo(0, 12);
    expect(carton.root.getObjectByName('Tape clip trailing').visible).toBe(true);
    expect(carton.ref('top').y).toBeCloseTo(0.42 + 0.0012, 12);
    carton.setStage('erected');
    expect(Math.abs(carton.root.getObjectByName('Minor flap leading').rotation.z)).toBeGreaterThan(1.8);
    carton.dispose();
  });
});

describe('carton: flaps folded by tools, tape laid by a fixed head', () => {
  it('foldUnder: a bar folds the flaps in as far as it lets them, never back open; a plate presses them flat', () => {
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.setStage('erected');
    const lead = carton.root.getObjectByName('Minor flap leading');
    const open = Math.abs(lead.rotation.z);
    carton.routine('foldUnder', { flaps: 'minor', bar: { out: 0.12, up: 0.15, radius: 0.012 } }).update(1, 0);
    expect(Math.abs(lead.rotation.z)).toBeCloseTo(open, 9); // parked bar: outside the open flaps
    carton.routine('foldUnder', { flaps: 'minor', bar: { out: -0.1, up: 0.15, radius: 0.012 } }).update(1, 0);
    const pushed = Math.abs(lead.rotation.z);
    expect(pushed).toBeLessThan(Math.PI / 2);
    carton.routine('foldUnder', { flaps: 'minor', bar: { out: 0.12, up: 0.15, radius: 0.012 } }).update(1, 0);
    expect(Math.abs(lead.rotation.z)).toBeCloseTo(pushed, 9); // the bar backs off; the flap stays
    carton.routine('foldUnder', { flaps: 'minor', plate: 0 }).update(1, 0);
    expect(Math.abs(lead.rotation.z)).toBeLessThan(0.05);
    carton.routine('foldUnder', { flaps: 'minor', angle: 0 }).update(1, 0);
    expect(lead.rotation.z).toBeCloseTo(0, 12);
    carton.dispose();
  });

  it('tapeAlong: from the leading edge back as the carton passes; the trailing clip once past', () => {
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.setStage('erected');
    const h = carton.routine('tapeAlong', {});
    const tape = carton.root.getObjectByName('Tape');
    h.update(0, 0);
    expect(tape.visible).toBe(false);
    h.update(0.5, 0);
    expect(tape.visible).toBe(true);
    expect(carton.root.getObjectByName('Tape seam').scale.x).toBeCloseTo(0.31, 9);
    expect(carton.root.getObjectByName('Tape clip trailing').visible).toBe(false);
    h.end();
    expect(carton.root.getObjectByName('Tape clip trailing').visible).toBe(true);
    carton.dispose();
  });
});

describe('transfer passes a fixed machine', () => {
  it('the routine runs only while the body crosses the port; the machine\'s tape feed turns with the travel', () => {
    const root = new THREE.Group();
    const equipment = Object.fromEntries(['boxBelt', 'taper'].map((id) => {
      const e = cellEquipment[id];
      const inst = registry.buildComponent(e.type, e.params, { ...ctx, materials });
      inst.root.position.fromArray(e.position);
      root.add(inst.root);
      return [id, inst];
    }));
    // a taper over the case belt at x 0 for this check
    equipment.taper.root.position.set(0, 0, -0.75);
    const carton = registry.buildProduct('carton', CASE, { materials });
    carton.setStage('erected');
    for (const flaps of ['minor', 'major']) carton.routine('foldUnder', { flaps, angle: 0 }).update(1, 0); // closed, as after the closer
    root.add(carton.root);
    const sequencer = new StepSequencer();
    const cycle = new OpCycle({ registry, sequencer, equipment, product: carton, conventions: { conveyor: { speed: 0.6, ramp: 0.5 } }, at: { product: { machine: 'boxBelt', port: 'input' } } });
    carton.root.position.copy(root.worldToLocal(cycle.portPoint({ machine: 'boxBelt', port: 'input' })));
    cycle.expand([{ op: 'transfer', conveyor: 'boxBelt', to: 'output', passes: { machine: 'taper', routine: 'tapeAlong' } }]);
    const tape = carton.root.getObjectByName('Tape');
    const feeds = [];
    let tapedAt = null;
    for (let t = 0; t <= cycle.time + 0.05; t += 0.02) {
      sequencer.advance(0.02);
      const x = carton.root.position.x;
      feeds.push(equipment.taper.state.feed);
      if (tape.visible && tapedAt === null) tapedAt = x;
    }
    expect(tapedAt).toBeGreaterThan(-0.32); // leading face (x + 0.31) reached the head at x 0
    expect(tapedAt).toBeLessThan(-0.28);
    expect(carton.root.getObjectByName('Tape clip trailing').visible).toBe(true);
    expect(new Set(feeds).size).toBeGreaterThan(5);
    carton.dispose();
  });
});
