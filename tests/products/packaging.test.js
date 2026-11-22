// ST6 pieces: the carton and packing-foam products, the block pallet, and the ops / station
// support for items made during the process (spawn), payloads, stacks and dispatch.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { StationCycle, planStation } from '../../lib/station/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { OPEN_ANGLE } from '../../lib/products/carton/index.js';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const boxOf = (o) => new THREE.Box3().setFromObject(o);

describe('carton product', () => {
  it('is erected open, with refs where contents stand and where it is held', () => {
    const c = registry.buildProduct('carton', { title: 'T', code: 'P1-0007' }, { materials });
    expect(c.stage).toBe('erected');
    close(c.ref('bottom').y, 0.006 + 0.035);
    close(c.ref('grasp').y, 0.62 - 0.06);
    const flap = c.root.getObjectByName('Major flap front');
    close(Math.abs(flap.rotation.x), OPEN_ANGLE);
    expect(c.root.getObjectByName('Tape').visible).toBe(false);
    expect(c.root.getObjectByName('Shipping label').visible).toBe(false);
    expect(boxOf(c.root).min.y).toBeGreaterThanOrEqual(-1e-6);
    c.dispose();
  });

  it('routines fold the flaps and lay the tape; features show the bag and the label', () => {
    const c = registry.buildProduct('carton', {}, { materials });
    const play = (name, args) => { const h = c.routine(name, args); h.start?.(); h.update?.(0.5, 0); h.update?.(1, 0.5); h.end?.(); };
    play('foldMinor');
    play('foldMajor');
    close(c.root.getObjectByName('Minor flap leading').rotation.z, 0);
    close(c.root.getObjectByName('Major flap rear').rotation.x, 0);
    const half = c.routine('tape', { from: 0.35, to: -0.27 });
    half.update(0.5, 0);
    const tape = c.root.getObjectByName('Tape seam');
    expect(c.root.getObjectByName('Tape').visible).toBe(true);
    close(tape.position.x, 0.04, 1e-9); // 0.35 → −0.27 half way: 0.04
    expect(c.root.getObjectByName('Tape clip trailing').visible).toBe(false);
    half.end();
    close(tape.scale.x, 0.6, 1e-9); // fully taped
    expect(c.root.getObjectByName('Tape clip trailing').visible).toBe(true);
    c.setFeature('bag', 'on');
    c.setFeature('label', 'on');
    expect(c.root.getObjectByName('Dust-cover bag').visible).toBe(true);
    expect(c.root.getObjectByName('Shipping label').visible).toBe(true);
    expect(() => c.routine('tape', { from: 'x' })).toThrow(/routine "tape"/);
    c.dispose();
  });

  it('packing foam rests on its origin, grasped 2 cm under its top', () => {
    const f = registry.buildProduct('packingFoam', {}, { materials });
    close(boxOf(f.root).min.y, 0, 1e-9);
    close(f.ref('grasp').y, 0.03, 1e-9);
    f.dispose();
  });
});

describe('block pallet', () => {
  it('stacks on its deck: port top at the deck height', () => {
    const p = registry.buildComponent('blockPallet', { length: 1.25, width: 1.15, height: 0.144 }, { materials });
    expect(p.ports.top).toMatchObject({ position: [0, 0.144, 0], carries: 'case' });
    close(boxOf(p.root).max.y, 0.144, 1e-9);
    p.dispose();
  });
});

describe('spawn, payloads, stacks, dispatch', () => {
  // A small packing cell: main conveyor, a lower carton line, a gantry, a pallet.
  const cell = (process, extra = {}) => {
    const root = new THREE.Group();
    root.position.set(4, 0, 2); // nothing depends on world coordinates
    const make = (type, params, position, ctx = {}) => {
      const inst = registry.buildComponent(type, params, { materials, ...ctx });
      inst.root.position.set(...position);
      root.add(inst.root);
      return inst;
    };
    const equipment = {
      line: make('palletConveyor', {}, [0, 0, 0]),
      cartonLine: make('rollerConveyor', { length: 2.8, rollerPitch: 0.11, color: 'machineGrey', endStop: false, bayMarking: false }, [-0.9, 0, -1.15], { beltHeight: 0.55 }),
      gantry: make('cartesianGantry', { spanX: 1.4, spanZ: 2.55, beamY: 2.7, maxGap: 0.64, fingerLength: 0.2, minToolY: 0.62 }, [0, 0, -1.175]),
      pallet: make('blockPallet', { length: 1.25, width: 1.15, height: 0.144 }, [0, 0, -2.15]),
    };
    return new StationCycle({
      registry, root, equipment, product: { type: 'printer' }, ctx: { materials },
      station: {
        id: 's', title: 'S', conveyor: 'line', inputStage: 'inspected', process,
        stacks: { pallet: { machine: 'pallet', port: 'top', columns: [-0.31, 0.31], rows: [-0.28, 0.28], layers: 2, layerHeight: 0.62, gap: 0.002 } },
        ...extra,
      },
    });
  };
  const at = (x) => ({ machine: 'cartonLine', port: 'input', offset: [x + 2.3, 0, 0] });
  const pick = { machine: 'gantry', openGap: 0.62, clearY: 2.1 };
  const spawnCarton = { op: 'spawn', items: [{ item: 'carton', product: { type: 'carton', params: { code: '{label}' } }, at: at(-1.75), to: at(0), conveyor: 'cartonLine' }], seconds: 1.5, label: 'Infeed' };
  const pack = { op: 'pickPlace', ...pick, item: 'printer', gap: 0.025, onto: 'carton', from: { item: 'product', ref: 'printerOrigin', offset: [0.09, 0.466, -0.035] }, to: { item: 'carton', ref: 'bottom', offset: [0.09, 0.466, -0.052] }, label: 'Pack' };
  const stack = { op: 'palletize', ...pick, item: 'carton', gap: 0.54, from: { item: 'carton', ref: 'grasp' }, stack: 'pallet' };
  const ship = { op: 'decide', on: 'palletFills', cases: { yes: [{ op: 'dispatch', stack: 'pallet', seconds: 1.6, label: 'Ship' }], no: [] } };
  const run = (c, until, limit = 600) => { c.start(); for (let t = 0; t < limit && !until(); t += 0.05) c.update(0.05); };

  it('spawn makes an item at a machine place and carries it along the carton line, the rollers turning', () => {
    const c = cell([spawnCarton, { op: 'wait', seconds: 1, label: 'Hold' }]);
    let made = null;
    let rollers = null;
    run(c, () => {
      if (c.status.step === 'Infeed' && !rollers) rollers = c.equipment.cartonLine.state.rollers;
      if (c.status.step === 'Hold' && !made) made = [...c.made][0];
      return made;
    });
    expect(made.type).toBe('carton');
    expect(made.params.code).toBe('P1-0001'); // the unit's label filled in
    const local = c.root.worldToLocal(worldOf(made.root));
    close(local.x, 0, 1e-6);
    close(local.y, 0.55, 1e-6); // on the carton line's own belt height
    close(local.z, -1.15, 1e-6);
    expect(c.equipment.cartonLine.state.rollers).not.toBe(rollers);
  });

  it('spawn checks the product type and its params before anything plays', () => {
    expect(() => cell([{ op: 'spawn', items: [{ item: 'box', product: { type: 'nope' }, at: at(0) }] }])).toThrow(/unknown product type "nope"/);
    expect(() => cell([{ op: 'spawn', items: [{ item: 'c', product: { type: 'carton', params: { height: 9 } }, at: at(0) }] }])).toThrow(/item "c" \(carton\): height/);
    expect(() => cell([{ op: 'spawn', items: [{ item: 'product', product: { type: 'carton' }, at: at(0) }] }])).toThrow(/"product" is the unit/);
    expect(() => cell([{ op: 'pickPlace', ...pick, item: 'ghost', gap: 0.1, from: { machine: 'line', port: 'work' }, to: { machine: 'line', port: 'output' } }])).toThrow(/unknown item "ghost"/);
  });

  it('a payload is taken off the unit into a carton; the empty carrier leaves without it', () => {
    const c = cell([spawnCarton, pack]);
    let carton = null;
    run(c, () => { carton ??= [...c.made][0]; return c.status.completed >= 1; });
    expect(c.error).toBeNull();
    const printer = carton.root.getObjectByName('Printer');
    expect(printer).toBeTruthy(); // packed: now part of the carton
    expect(printer.parent).toBe(carton.root);
    const bottom = carton.root.localToWorld(carton.ref('bottom'));
    close(worldOf(printer).y, bottom.y, 1e-6); // stands exactly on the bottom foam
  });

  it('palletize fills the pallet spot by spot (column, row, layer); the unit that fills it ships it', () => {
    const c = cell([spawnCarton, pack, stack, ship]);
    const positions = [];
    let seenShip = 0;
    run(c, () => {
      if (c.status.step === 'Ship') seenShip = 1;
      if (c.stackItems.pallet.length > positions.length) positions.push(c.root.worldToLocal(worldOf(c.stackItems.pallet.at(-1))));
      return c.status.completed >= 9;
    }, 2000);
    expect(c.error).toBeNull();
    expect(seenShip).toBe(1);
    expect(c.status).toMatchObject({ palletShipped: 1, palletCount: 1, palletCapacity: 8 }); // unit 9 started the next pallet
    const expected = [[-0.31, -0.28, 0], [0.31, -0.28, 0], [-0.31, 0.28, 0], [0.31, 0.28, 0], [-0.31, -0.28, 1], [0.31, -0.28, 1], [-0.31, 0.28, 1], [0.31, 0.28, 1]];
    expected.forEach(([dx, dz, layer], i) => {
      close(positions[i].x, dx, 1e-3);
      close(positions[i].z, -2.15 + dz, 1e-3);
      close(positions[i].y, 0.144 + layer * 0.62 + 0.002, 1e-3);
    });
    // The shipped cartons and everything packed in them are gone.
    expect(c.made.size).toBe(1);
  }, 60000);

  it('plans the shipping branch only when told the pallet fills; a full stack refuses another item', () => {
    const c = cell([spawnCarton, stack, ship]);
    const plan = (fills) => planStation(registry, c.station, { equipment: c.equipment, product: 'printer', facts: { palletFills: fills } }).process.steps.map((s) => s.label);
    expect(plan('yes')).toContain('Ship');
    expect(plan('no')).not.toContain('Ship');
    expect(() => cell([{ op: 'dispatch', stack: 'shelf' }])).toThrow(/unknown stack "shelf" \(stacks: pallet\)/);
    expect(() => cell([], { stacks: { pallet: { machine: 'nope', port: 'top', columns: [0], rows: [0], layers: 1, layerHeight: 1 } } })).toThrow(/stack "pallet": unknown machine "nope"/);
    // Without dispatching, the ninth carton has nowhere to go.
    const full = cell([spawnCarton, stack]);
    full.start();
    for (let t = 0; t < 2000 && !full.error; t += 0.05) full.update(0.05);
    expect(full.error?.message).toMatch(/stack "pallet" is full \(8 items\)/);
  }, 60000);

  it('a reset frees everything the station made, packed printers included', () => {
    const c = cell([spawnCarton, pack, stack]);
    run(c, () => c.stackItems.pallet.length >= 2, 2000);
    const freed = [];
    for (const carton of c.stackItems.pallet) carton.traverse((o) => { if (o.userData.dispose) { const f = o.userData.dispose; o.userData.dispose = () => { freed.push(o.name); f(); }; } });
    c.reset();
    expect(c.made.size).toBe(0);
    expect(c.stackItems.pallet).toEqual([]);
    expect(freed.filter((n) => n === 'Printer')).toHaveLength(2);
    expect(freed.filter((n) => n === 'Carton')).toHaveLength(2);
  }, 60000);
});
