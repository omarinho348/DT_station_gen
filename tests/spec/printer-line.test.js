// The hand-written printer line (spec/examples/printer-line.factory.json) against the reference
// recording: the Phase 4 acceptance test, station by station as they are written.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { checkFactory, expandFactory } from '../../compiler/expand.js';
import { compareTiming, compareStation, lineTiming } from '../../compiler/timing.js';
import { Line, LINE_STATES } from '../../lib/line/index.js';
import { StationCycle, planStation } from '../../lib/station/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/printer-line.factory.json';
import reference from '../../benchmarks/expected/printer-line-reference-timing.json';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const KIT = ['Upright_L', 'Upright_R', 'TopBar', 'LeadScrew', 'XGantry', 'Bed', 'Motor_Z', 'Motor_Y', 'PrintHead', 'ElectronicsBox', 'PSU', 'Display', 'Harness'];
const FRAME = ['Motor_Z', 'Motor_Y', 'Bed', 'Upright_L', 'Upright_R', 'XGantry', 'LeadScrew', 'TopBar'];
const MODULES = ['ElectronicsBox', 'PSU', 'PrintHead', 'Display'];

describe('printer-line.factory.json against the reference recording', () => {
  const check = checkFactory(registry, factory);

  it('is a valid factory.json (schema, catalog, every op planned, layout)', () => {
    expect(check.errors).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('ST1 and ST2 match the reference step for step: labels, states, durations', () => {
    const c = compareTiming(check.timing, reference);
    const st1 = c.stations.find((s) => s.id === 'st1');
    const st2 = c.stations.find((s) => s.id === 'st2');
    expect(st1.mismatches).toEqual([]);
    expect(st2.mismatches).toEqual([]);
    expect(st1).toMatchObject({ ok: true, matched: 136 });
    expect(st2).toMatchObject({ ok: true, matched: 124 });
    close(st1.delta, 0, 1e-4);
    close(st2.delta, 0, 1e-4);
    expect(c.transfers.every((t) => t.ok)).toBe(true);
  });

  it('ST3 matches the reference step for step, clip-to-clip cable moves and zero-length clip marks included', () => {
    const c = compareTiming(check.timing, reference);
    const st3 = c.stations.find((s) => s.id === 'st3');
    expect(st3.mismatches).toEqual([]);
    expect(st3).toMatchObject({ ok: true, matched: 286 });
    close(st3.delta, 0, 1e-4);
    const rows = check.timing.stations.find((s) => s.id === 'st3').rows;
    expect(rows.filter((r) => r.duration === 0 && r.label.endsWith('through clips'))).toHaveLength(2 * 25); // 25 clips over 7 cables, as recorded
    expect(check.timing.bottleneck).toMatchObject({ kind: 'station', id: 'st3' }); // the reference bottleneck
  });

  it('ST4 matches the reference step for step: shutters around intake and output, the test sequence', () => {
    const c = compareTiming(check.timing, reference);
    const st4 = c.stations.find((s) => s.id === 'st4');
    expect(st4.mismatches).toEqual([]);
    expect(st4).toMatchObject({ ok: true, matched: 48 });
    close(st4.delta, 0, 1e-4);
    expect(c.transfers).toHaveLength(5);
    expect(c.transfers.every((t) => t.ok)).toBe(true);
  });

  it('ST5 matches the reference for a passing unit and for rejects to both bay places', () => {
    const { line, ctx, conventions } = check.expanded;
    const scenario = (facts) => lineTiming(registry, line, { ctx, conventions, facts: { st5: facts } }).stations.find((s) => s.id === 'st5');
    const units = reference.stations.st5.units;
    const pass = compareStation(scenario({ verdict: 'PASS' }).rows, units[0].steps);
    const reject1 = compareStation(scenario({ verdict: 'REJECT', rejectSlot: 0 }).rows, units[4].steps); // P1-0005
    const reject2 = compareStation(scenario({ verdict: 'REJECT', rejectSlot: 1 }).rows, units[7].steps); // P1-0008
    for (const c of [pass, reject1, reject2]) {
      expect(c.mismatches).toEqual([]);
      close(c.delta, 0, 1e-4);
    }
    expect([pass.matched, reject1.matched, reject2.matched]).toEqual([13, 13, 13]);
    expect(units[4].unit).toBe('P1-0005');
    expect(units[7].unit).toBe('P1-0008');
  });

  it('ST6 matches the reference for an ordinary unit and for the unit that fills and ships the pallet', () => {
    const { line, ctx, conventions } = check.expanded;
    const scenario = (facts) => lineTiming(registry, line, { ctx, conventions, facts: { st6: facts } }).stations.find((s) => s.id === 'st6');
    const units = reference.stations.st6.units;
    const ordinary = compareStation(scenario({ palletFills: 'no' }).rows, units[0].steps);
    const ships = compareStation(scenario({ palletFills: 'yes' }).rows, units[7].steps); // P1-0008 (stand-alone run)
    for (const c of [ordinary, ships]) {
      expect(c.mismatches).toEqual([]);
      close(c.delta, 0, 1e-4);
    }
    expect([ordinary.matched, ships.matched]).toEqual([42, 43]);
  });

  it('the whole line matches: every station and transfer, step for step (ordinary paths)', () => {
    const { line, ctx, conventions } = check.expanded;
    const t = lineTiming(registry, line, { ctx, conventions, facts: { st5: { verdict: 'PASS' }, st6: { palletFills: 'no' } } });
    const c = compareTiming(t, reference);
    expect(c.stations.map((s) => [s.id, s.ok, s.mismatches.length])).toEqual(['st1', 'st2', 'st3', 'st4', 'st5', 'st6'].map((id) => [id, true, 0]));
    expect(c.transfers).toHaveLength(5);
    expect(c.ok).toBe(true);
    expect(t.bottleneck).toMatchObject({ kind: 'station', id: 'st3' });
  });

  it('cycle times are the reference cycles (stand-alone lift moves left out)', () => {
    const cycle = (id) => check.timing.stations.find((s) => s.id === id).cycleTime;
    close(cycle('st1'), reference.stations.st1.unitTime - 1.8, 1e-4);
    close(cycle('st2'), reference.stations.st2.unitTime - 1.8, 1e-4);
    close(cycle('st3'), reference.stations.st3.unitTime - 1.8, 1e-4);
    close(cycle('st4'), reference.stations.st4.unitTime - 1.8, 1e-4);
    const ordinary = lineTiming(registry, check.expanded.line, { ...check.expanded, facts: { st5: { verdict: 'PASS' }, st6: { palletFills: 'no' } } }).stations;
    close(ordinary.find((s) => s.id === 'st5').cycleTime, reference.stations.st5.unitTime - 1.8, 1e-4);
    close(ordinary.find((s) => s.id === 'st6').cycleTime, reference.stations.st6.unitTime - 1.8, 1e-4);
  });
});

describe('the printer line plays', () => {
  const build = (runSize) => {
    const { line, conventions, ctx } = expandFactory(registry, { ...factory, line: { ...factory.line, runSize } });
    return new Line({ registry, line, ctx: { ...ctx, materials }, conventions });
  };

  it('ST1 kits, ST2 builds the frame, ST3 wires it, ST4 tests it, unit after unit', () => {
    const line = build(2);
    const st1 = line.byId.get('st1');
    const st2 = line.byId.get('st2');
    let kitted = null;
    let framed = null;
    const st3 = line.byId.get('st3');
    const st4 = line.byId.get('st4');
    let tested = null;
    let wired = null;
    let leadDuringTest = false;
    let restockedAfterKit = null;
    line.onUpdate = () => {
      if (st3.cycle.status.step?.startsWith('Continuity') && st3.cycle.unit?.root.getObjectByName('lead tester.testLead')) leadDuringTest = true;
      if (!tested && st4.cycle.status.step === 'Undocking connector' && st4.cycle.unit) {
        const s = st4.cycle.status;
        tested = { quality: st4.cycle.unit.api.quality(), serial: st4.cycle.unit.params.serial, mesh: s.mesh, probed: s.probed, result: s.result, flatness: s.flatness, belts: s.belts, print: s.print, plug: st4.equipment.dock.state.plug, shutters: [st4.equipment.enclosure.state.entryShutter, st4.equipment.enclosure.state.exitShutter] };
      }
      if (!wired && st3.cycle.phase === 'output' && st3.cycle.unit) {
        const u = st3.cycle.unit;
        wired = {
          modes: Object.fromEntries(MODULES.map((n) => [n, u.api.printer.parts[n].mode])),
          cables: u.api.printer.cables.map((cbl) => cbl.state.mode),
          features: { ...u.featureState },
          lead: Boolean(u.root.getObjectByName('lead tester.testLead')),
          tester: st3.equipment.tester.state.status,
        };
      }
      // Snapshot each unit as it leaves a station's work position.
      if (!kitted && st1.cycle.phase === 'output' && st1.cycle.unit) {
        const p = st1.cycle.unit.api.printer;
        kitted = { modes: Object.fromEntries(['BaseFrame', ...KIT].map((n) => [n, p.parts[n].mode])) };
        restockedAfterKit = Object.values(st1.cycle.stock).every((o) => o.visible);
      }
      if (!framed && st2.cycle.phase === 'output' && st2.cycle.unit) {
        const u = st2.cycle.unit;
        framed = { modes: Object.fromEntries(FRAME.map((n) => [n, u.api.printer.parts[n].mode])), features: { ...u.featureState } };
      }
    };
    line.start();
    let t = 0;
    while (line.state !== LINE_STATES.FINISHED && t < 520) { line.update(0.05); t += 0.05; }
    expect(line.stations.map((s) => s.cycle.error?.message ?? null)).toEqual(Array(6).fill(null));
    expect(line.state).toBe(LINE_STATES.FINISHED);
    expect(line.status.exited).toBe(2);
    // ST1: base frame on the locators, the other 13 parts in their kit cut-outs; stock refilled.
    expect(kitted.modes).toEqual({ BaseFrame: 'asm', ...Object.fromEntries(KIT.map((n) => [n, 'kit'])) });
    expect(restockedAfterKit).toBe(true);
    // ST2: the 8 frame parts assembled, belt engaged, the bed's cable coiled behind.
    expect(framed.modes).toEqual(Object.fromEntries(FRAME.map((n) => [n, 'asm'])));
    expect(framed.features).toEqual({ bedCable: 'stowed', yBelt: 'engaged' });
    // ST3: modules fitted, all 7 cables plugged at both ends and laid, the lead in during the test
    // and out afterwards, the tester showing pass.
    expect(wired.modes).toEqual(Object.fromEntries(MODULES.map((n) => [n, 'asm'])));
    expect(wired.cables).toEqual(Array(7).fill('done'));
    expect(wired.features).toMatchObject({ powerCable: 'stowed', hotendCable: 'stowed' });
    expect(leadDuringTest).toBe(true);
    expect(wired.lead).toBe(false);
    expect(wired.tester).toBe('pass');
    // ST4: docked, probed all 9 points, printed, results recorded on the unit (per serial).
    expect(tested.serial).toBe(1);
    expect(tested.quality).toEqual({ flatness: 0.08, dimError: 0.08 });
    expect(tested.mesh).toHaveLength(9);
    expect(tested.mesh.every((v) => Number.isFinite(v))).toBe(true);
    expect(Math.max(...tested.mesh) - Math.min(...tested.mesh)).toBeLessThanOrEqual(80 + 1); // peak-to-valley = flatness (µm)
    expect(tested).toMatchObject({ probed: 9, result: 'IN SPEC', flatness: '0.08 mm', belts: 'X 92 Hz · Y 88 Hz', print: 1, shutters: [0, 0] });
    close(tested.plug, 0.456, 1e-4); // docked (sampled as undocking starts): the reference's contact point, from a dock
    // standing behind the enclosure's rear panel since the step-7.3 clash fixes (0.366 from 9 cm closer in the reference)
    expect(st4.equipment.dock.state.plug).toBe(0); // undocked at the end
    // Pick lights end off.
    const lights = Object.entries(st1.equipment).filter(([id]) => id.startsWith('light'));
    expect(lights).toHaveLength(14);
    expect(lights.every(([, l]) => l.state.lamp === 'off')).toBe(true);
    // Played run ≈ the estimate (plus waiting re-checks).
    // Units 1 and 2 pass inspection: estimate with ST5's pass path.
    const two = expandFactory(registry, { ...factory, line: { ...factory.line, runSize: 2 } });
    const estimate = lineTiming(registry, two.line, { ctx: two.ctx, conventions: two.conventions, facts: { st5: { verdict: 'PASS' }, st6: { palletFills: 'no' } } }).runTime;
    expect(t).toBeGreaterThanOrEqual(estimate - 0.06);
    expect(t).toBeLessThan(estimate + 2 * 7 * 0.25 + 0.1); // one hold per hand-over: 2 units × 7
    line.dispose();
  }, 180000);

  it('a whole run of 8: 5 and 8 wait in the reject bay, the other six are packed and stacked on the pallet', () => {
    const line = build(8);
    const st5 = line.byId.get('st5');
    const labels = {};
    line.onUpdate = () => {
      const u = st5.cycle.unit;
      if (u && st5.cycle.status.step === 'Labeller retracting') labels[u.params.serial] = st5.cycle.status.verdict;
    };
    line.start();
    let t = 0;
    while (line.state !== LINE_STATES.FINISHED && t < 900) { line.update(0.05); t += 0.05; }
    expect(line.stations.map((s) => s.cycle.error?.message ?? null)).toEqual(Array(6).fill(null));
    expect(line.state).toBe(LINE_STATES.FINISHED);
    expect(line.status).toMatchObject({ released: 8, exited: 8 });
    // ST6: six cartons on the pallet (not full, so not shipped), each with its printer, closed and labelled.
    const st6 = line.byId.get('st6');
    expect(st6.cycle.status).toMatchObject({ completed: 6, palletCount: 6, palletShipped: 0 });
    const cartons = st6.cycle.stackItems.pallet;
    const spots = [[-0.31, -0.28, 0], [0.31, -0.28, 0], [-0.31, 0.28, 0], [0.31, 0.28, 0], [-0.31, -0.28, 1], [0.31, -0.28, 1]];
    cartons.forEach((carton, i) => {
      const at = st6.root.worldToLocal(worldOf(carton));
      const [dx, dz, layer] = spots[i];
      close(at.x, dx, 1e-3);
      close(at.z, -2.27 + dz, 1e-3); // the pallet at −2.27, clear of the carton line's legs (−2.15 in the reference)
      close(at.y, 0.144 + layer * 0.69 + 0.002, 1e-3);
      expect(carton.getObjectByName('Shipping label').visible).toBe(true);
      expect(carton.getObjectByName('Tape').visible).toBe(true);
      expect(carton.getObjectByName('Packing foam')).toBeTruthy();
    });
    const packed = cartons.map((c) => { let serial = null; c.traverse((o) => { if (o.name.startsWith('Printer') || o.name === 'printer') serial ??= o.name; }); return Boolean(serial); });
    expect(packed.every(Boolean)).toBe(true);
    expect(st5.cycle.status).toMatchObject({ completed: 6, rejectCount: 2 });
    expect(labels).toEqual({ 1: 'PASS', 2: 'PASS', 3: 'PASS', 4: 'PASS', 5: 'REJECT', 6: 'PASS', 7: 'PASS', 8: 'REJECT' });
    // The rejects rest on the reject lane at the reference bay places (station z −1.05, −1.7).
    const bay = st5.cycle.kept.reject;
    expect(bay.map((u) => u.params.serial)).toEqual([5, 8]);
    bay.forEach((unit, i) => {
      const local = st5.root.worldToLocal(worldOf(unit.root));
      close(local.z, [-1.05, -1.7][i], 1e-3);
      close(local.y, 0.85, 1e-3);
    });
    // The reference run of 8 ends with unit 8 rejected at ST5 at 771.1 s (recorded every 0.02 s).
    expect(Math.abs(t - reference.line.finished)).toBeLessThan(1.5);
    line.dispose();
  }, 180000);

  it('stock copies rest on their locations and are put into the kit exactly where the part goes', () => {
    const line = build(1);
    const st1 = line.byId.get('st1');
    for (const [name, object] of Object.entries(st1.cycle.stock)) {
      const at = st1.cycle.station.stock[name].at;
      const port = st1.equipment[at.machine].root.localToWorld(new THREE.Vector3(...st1.equipment[at.machine].ports[at.port].position).add(new THREE.Vector3(...at.offset)));
      expect(worldOf(object).distanceTo(port), name).toBeLessThan(1e-9);
      expect(object.visible).toBe(true);
    }
    // Run ST1 until the motor is placed, then compare the hidden copy with the product's own part.
    line.start();
    for (let t = 0; t < 60 && st1.cycle.unit?.api.printer.parts.Motor_Z.mode !== 'kit'; t += 0.02) line.update(0.02);
    const unit = st1.cycle.unit;
    const copy = st1.cycle.stock.motorZA;
    expect(copy.visible).toBe(false);
    const part = unit.assembly.object('Motor_Z');
    const inner = copy.children[0];
    expect(worldOf(inner).distanceTo(worldOf(part))).toBeLessThan(1e-6);
    line.dispose();
  }, 60000);
});

describe('contract pieces this step added', () => {
  it('products declare features; setFeature checks names and values; a stage change resets them', () => {
    const p = registry.buildProduct('printer', { serial: 3 }, { materials });
    expect(Object.keys(p.features)).toEqual(['yBelt', 'bedCable', 'powerCable', 'hotendCable']);
    p.setFeature('yBelt', 'engaged');
    expect(p.featureState).toEqual({ yBelt: 'engaged' });
    expect(() => p.setFeature('nope', 'x')).toThrow(/no feature "nope"/);
    expect(() => p.setFeature('yBelt', 'tight')).toThrow(/takes loose \| engaged/);
    p.setStage('framed');
    expect(p.featureState).toEqual({});
    p.dispose();
  });

  it('part copies: rest as in the kit tray, grasp point and part frame given, errors named', () => {
    const c = registry.partCopy('printer', 'Upright_L', 'kit', { materials });
    expect(c.object.userData.partCopy).toEqual({ product: 'printer', part: 'Upright_L', mode: 'kit' });
    const box = new THREE.Box3().setFromObject(c.object);
    expect(box.min.y).toBeGreaterThan(-0.002); // rests on its origin, nothing below
    expect(box.min.y).toBeLessThan(0.01);
    expect(c.object.userData.grasp.point.y).toBeGreaterThan(0);
    expect(() => registry.partCopy('printer', 'Nope')).toThrow(/no part "Nope"/);
    expect(() => registry.partCopy('printer', 'Bed', 'flat')).toThrow(/mode must be "kit" or "asm"/);
  });

  it('transform switches features; bad features fail in the dry plan', () => {
    const run = (process) => () => new StationCycle({
      registry, station: { id: 's', title: 'S', conveyor: 'line', process }, root: new THREE.Group(),
      equipment: { line: registry.buildComponent('palletConveyor', {}, { materials }) }, product: { type: 'printer' }, ctx: { materials },
    });
    expect(run([{ op: 'transform', set: { yBelt: 'engaged' }, seconds: 0.6 }])).not.toThrow();
    expect(run([{ op: 'transform', set: { belt: 'on' } }])).toThrow(/product has no feature "belt"/);
    expect(run([{ op: 'transform', set: { yBelt: 'on' } }])).toThrow(/feature "yBelt" takes loose \| engaged/);
    expect(run([{ op: 'transform' }])).toThrow(/give either stage or set/);
    expect(run([{ op: 'replenish' }])).not.toThrow(); // planned dry; nothing to refill is only known at run time
  });

  it('installPart from stock: wrong copy stops in ALARM; mode kit needs a stock item', () => {
    const mk = (process, stock) => {
      const root = new THREE.Group();
      const equipment = {
        line: registry.buildComponent('palletConveyor', {}, { materials }),
        robot: registry.buildComponent('cartesianGantry', { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.26 }, { materials }),
        nest: registry.buildComponent('partNest', {}, { materials }),
      };
      equipment.nest.root.position.set(0.6, 0, -0.45);
      Object.values(equipment).forEach((e) => root.add(e.root));
      return new StationCycle({ registry, station: { id: 's', title: 'S', conveyor: 'line', inputStage: 'empty', process, stock }, equipment, root, product: { type: 'printer' }, ctx: { materials } });
    };
    expect(() => mk([{ op: 'installPart', machine: 'robot', part: 'Bed', mode: 'kit', gap: 0.24, openGap: 0.26 }], {})).toThrow(/cannot be kitted again; give "from"/);
    const wrong = mk([{ op: 'installPart', machine: 'robot', part: 'Bed', from: 'copy', mode: 'kit', gap: 0.24, openGap: 0.26 }], { copy: { part: 'Motor_Z', at: { machine: 'nest', port: 'seat' } } });
    wrong.start();
    for (let t = 0; t < 20 && !wrong.error; t += 0.05) wrong.update(0.05);
    expect(wrong.error?.message).toMatch(/stock item "copy" holds part "Motor_Z", not "Bed"/);
    expect(() => mk([], { copy: { part: 'Nope', at: { machine: 'nest', port: 'seat' } } })).toThrow(/the product has no part "Nope"|no part "Nope"/);
    expect(() => mk([], { copy: { part: 'Bed', at: { machine: 'nest', port: 'top' } } })).toThrow(/machine "nest" has no port "top"/);
  });

  it('a pick never asks a robot to travel above its reach: the travel height is capped', () => {
    const root = new THREE.Group();
    const equipment = {
      line: registry.buildComponent('palletConveyor', {}, { materials }),
      robot: registry.buildComponent('cartesianGantry', { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.26 }, { materials }),
    };
    Object.values(equipment).forEach((e) => root.add(e.root));
    const cycle = new StationCycle({
      registry, root, equipment, product: { type: 'printer' }, ctx: { materials },
      station: { id: 's', title: 'S', conveyor: 'line', inputStage: 'kitted', process: [{ op: 'installPart', machine: 'robot', part: 'Motor_Z', gap: 0.047, openGap: 0.26, clearAbove: 2 }] }, // ≈ 2.9 m asked, 2.2 m reachable
    });
    const top = equipment.robot.motions.y.range[1];
    let highest = -Infinity;
    cycle.start();
    for (let t = 0; t < 20 && cycle.status.completed < 1; t += 0.02) { cycle.update(0.02); highest = Math.max(highest, equipment.robot.state.y); }
    expect(cycle.error).toBeNull();
    close(highest, top, 1e-9);
  });
});

describe('cables and leads (ST3 pieces)', () => {
  it('products declare cables: static routes in the product frame equal the built printer\'s own', () => {
    const p = registry.buildProduct('printer', { serial: 1 }, { materials });
    expect(p.cables).toEqual(['Z motor', 'Y motor', 'X motor', 'LCD', 'Hotend', 'Heated bed', 'Power']);
    const origin = p.ref('printerOrigin');
    p.cables.forEach((name, i) => {
      const r = p.cableRoute(name);
      const own = p.api.printer.cableRoute(i); // printer space
      expect(r.kind).toBe(own.kind);
      expect(r.b.socket).toBe(own.b.socket);
      own.clips.forEach((c, k) => expect(r.clips[k].distanceTo(c.clone().add(origin))).toBeLessThan(1e-12));
    });
    expect(() => p.cableRoute('Fan')).toThrow(/no cable "Fan"/);
    expect(() => p.setCable('LCD', { mode: 'tangled' })).toThrow(/cable mode must be/);
    p.setCable('LCD', { mode: 'pluggedA' });
    expect(p.api.printer.cables[3].state.mode).toBe('pluggedA');
    p.dispose();
  });

  const station = (process, product = { type: 'printer' }) => {
    const root = new THREE.Group();
    const equipment = {
      line: registry.buildComponent('palletConveyor', {}, { materials }),
      gantry: registry.buildComponent('cartesianGantry', { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.22, screwdriver: true }, { materials }),
      tester: registry.buildComponent('testCabinet', {}, { materials }),
    };
    equipment.tester.root.position.set(-1.2, 0, -0.75);
    Object.values(equipment).forEach((e) => root.add(e.root));
    return new StationCycle({ registry, root, equipment, product, ctx: { materials }, station: { id: 's', title: 'S', conveyor: 'line', inputStage: 'wired', process } });
  };

  it('routeCable refuses unknown cables and products without cables, in the dry plan', () => {
    expect(() => station([{ op: 'routeCable', machine: 'gantry', cable: 'Fan' }])).toThrow(/no cable "Fan" \(cables: Z motor/);
    expect(() => station([{ op: 'routeCable', machine: 'line', cable: 'LCD' }])).toThrow(/machine "line" has no motion "x"/);
  });

  it('routeCable on a loose cable: end A then end B, the cable ends done; durations as planned', () => {
    const c = station([{ op: 'routeCable', machine: 'gantry', cable: 'LCD', doneStatus: { cables: 1 } }]);
    const steps = [];
    const before = c.sequencer.onStepStart;
    c.sequencer.onStepStart = (s) => { before(s); steps.push({ state: s.state, label: s.label, duration: s.duration }); };
    let modeBeforeOutput = null;
    c.start();
    for (let t = 0; t < 40 && c.status.completed < 1; t += 0.02) {
      c.update(0.02);
      if (c.phase === 'output' && !modeBeforeOutput) modeBeforeOutput = c.unit.api.printer.cables[3].state.mode;
    }
    expect(c.error).toBeNull();
    expect(modeBeforeOutput).toBe('done');
    expect(c.status.cables).toBe(1);
    const played = steps.filter((s) => !/return line/.test(s.label)).slice(0, c.timing.steps.length);
    expect(played).toEqual(c.timing.steps.map(({ state, label, duration }) => ({ state, label, duration })));
    expect(c.timing.process.steps.map((s) => s.label)).toContain('LCD end A seated · latch clicked');
  });

  it('connectLead plugs a lead into the product at the end of its step and takes it out again', () => {
    const lead = { from: { machine: 'tester', port: 'testLead' }, to: { item: 'product', ref: 'dockPort', offset: [0, 0, -0.02] } };
    const c = station([
      { op: 'connectLead', ...lead, seconds: 0.4, label: 'Lead in' },
      { op: 'wait', seconds: 1, label: 'Testing' },
      { op: 'connectLead', ...lead, connect: false, seconds: 0.3, label: 'Lead out' },
    ]);
    const seen = {};
    c.start();
    for (let t = 0; t < 20 && c.status.completed < 1; t += 0.02) {
      c.update(0.02);
      seen[c.status.step] ??= Boolean(c.unit?.root.getObjectByName('lead tester.testLead'));
    }
    expect(seen).toMatchObject({ 'Lead in': false, Testing: true, 'Lead out': true, 'Releasing carrier': false });
    expect(() => station([{ op: 'connectLead', ...lead, to: { item: 'product', ref: 'nope' } }])).toThrow(/no ref "nope"/);
    expect(() => station([{ op: 'connectLead', from: { machine: 'tester', port: 'x' }, to: lead.to }])).toThrow(/no port "x"/);
  });
});

describe('product routines, live status, dashboard, hand-over (ST4 pieces)', () => {
  const cell = (process, extra = {}) => {
    const root = new THREE.Group();
    const equipment = {
      line: registry.buildComponent('palletConveyor', {}, { materials }),
      monitor: registry.buildComponent('statusMonitor', {}, { materials }),
      dock: registry.buildComponent('dockingUnit', { axisHeight: 0.92, stroke: 0.37 }, { materials }),
    };
    Object.values(equipment).forEach((e) => root.add(e.root));
    return new StationCycle({ registry, root, equipment, product: { type: 'printer' }, ctx: { materials }, station: { id: 's', title: 'S', conveyor: 'line', inputStage: 'wired', process, ...extra } });
  };
  const play = (c, until) => { c.start(); for (let t = 0; t < 40 && !until(); t += 0.02) c.update(0.02); };

  it('the printer declares its test routines; unknown routines and bad args fail in the dry plan', () => {
    const def = registry.getProduct('printer');
    expect(Object.keys(def.routines)).toEqual(expect.arrayContaining(['axes', 'probeDip', 'heat', 'printCube', 'record', 'display']));
    expect(() => cell([{ op: 'runRoutine', routine: 'dance', seconds: 1 }])).toThrow(/no routine "dance"/);
    expect(() => cell([{ op: 'runRoutine', routine: 'probeDip', args: { index: 12 }, seconds: 1 }])).toThrow(/routine "probeDip": index/);
    expect(() => cell([{ op: 'move', machine: 'dock', to: { plug: 0.1 }, seconds: 1, after: [{ routine: 'nope' }] }])).toThrow(/no routine "nope"/);
  });

  it('a routine drives the product and feeds the HMI status live (heat: temperatures rise to target)', () => {
    const c = cell([{ op: 'runRoutine', routine: 'heat', args: { hotend: 215, bed: 60, ambient: 24 }, seconds: 2, label: 'Heating' }]);
    const temps = [];
    play(c, () => { if (c.status.step === 'Heating') temps.push(c.status.hotend); return c.status.step === 'Releasing carrier'; });
    expect(temps.length).toBeGreaterThan(20);
    temps.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(temps[i]));
    close(temps.at(-1), 215, 0.01); // last frame before the step ends
    expect(c.status.temps).toBe('215 / 60 °C');
  });

  it('move before / after run product routines at the start / end of the move', () => {
    const c = cell([{ op: 'move', machine: 'dock', to: { plug: 0.2 }, seconds: 0.5, label: 'Dock', before: [{ routine: 'resetTest' }], after: [{ routine: 'record' }] }]);
    let duringDock = null;
    play(c, () => { if (c.status.step === 'Dock' && !duringDock) duringDock = { mesh: c.status.mesh, quality: c.unit.api.quality() }; return c.status.step === 'Releasing carrier'; });
    expect(duringDock.mesh).toEqual(Array(9).fill(null));
    expect(duringDock.quality).toBeNull(); // not recorded yet
    expect(c.status.result).toBe('IN SPEC'); // record ran after the move
  });

  it('the dashboard signal fills a structured screen from the status (gauges, grid, footer)', () => {
    const c = cell([{ op: 'wait', seconds: 1 }], {
      status: { hotend: 108, flatness: '0.08 mm' },
      signals: { dashboard: { machine: 'monitor', title: 'BENCH · {unit}', gauges: [{ label: 'Hotend', value: 'hotend', target: 215, unit: '°C' }], grid: { label: 'Mesh', cols: 3, values: 'mesh', range: [-80, 80] }, footer: 'Flatness {flatness}' } },
    });
    const d = c.dashboardData();
    expect(d).toMatchObject({ title: 'BENCH · —', gauges: [{ label: 'Hotend', value: 108, target: 215, unit: '°C' }], grid: { cols: 3, values: [] }, footer: 'Flatness 0.08 mm' });
    c.status.mesh = [1, 2, null];
    expect(c.dashboardData().grid.values).toEqual([1, 2, null]);
    expect(() => cell([], { signals: { dashboard: { machine: 'dock' } } })).toThrow(/machine "dock" has no display "screen"/);
  });

  it('the unit is handed over as it reaches the output port; trailing output steps still play', () => {
    const a = cell([{ op: 'wait', seconds: 0.5 }], {
      output: [
        { op: 'release', machine: 'line', item: 'product', motion: 'locate', to: 0, also: { stop: 0 }, seconds: 0.35 },
        { op: 'transfer', conveyor: 'line', from: 'work', to: 'output' },
        { op: 'wait', seconds: 2, label: 'Closing behind it' },
      ],
    });
    let handedDuring = null;
    const put = a.ports.output.put;
    a.ports.output.put = (unit) => { handedDuring = a.status.step; put(unit); };
    play(a, () => handedDuring !== null && a.status.step === 'Closing behind it');
    expect(handedDuring).toBe('Transport to output');
    expect(a.status.completed).toBe(1);
  });
});

describe('facts, bays, cross-machine transfers (ST5 pieces)', () => {
  const cell = (process, extra = {}) => {
    const root = new THREE.Group();
    const equipment = {
      line: registry.buildComponent('palletConveyor', {}, { materials }),
      diverter: registry.buildComponent('crossTransfer', { rise: 0.022 }, { materials }),
      lane: registry.buildComponent('rollerConveyor', {}, { materials }),
      scanner: registry.buildComponent('visionScanner', {}, { materials }),
      monitor: registry.buildComponent('statusMonitor', {}, { materials }),
    };
    equipment.lane.root.position.set(0, 0, -1.29);
    equipment.lane.root.rotation.y = Math.PI / 2;
    Object.values(equipment).forEach((e) => root.add(e.root));
    return new StationCycle({
      registry, root, equipment, product: { type: 'printer' }, ctx: { materials },
      station: { id: 's', title: 'S', conveyor: 'line', inputStage: 'tested', ports: { reject: { machine: 'lane', port: 'input', direction: 'out', slots: 2 } }, process, ...extra },
    });
  };
  const divert = (offset) => [
    { op: 'grip', machine: 'diverter', item: 'product', motion: 'raise', to: 1, anchor: 'carrier', seconds: 0.3, alongside: [{ machine: 'line', to: { locate: 0, stop: 0 } }], label: 'Rising' },
    { op: 'transfer', conveyor: 'lane', from: { machine: 'diverter', port: 'transfer', offset: [0, 0.022, 0] }, to: { machine: 'lane', port: 'input', offset: [offset, 0, 0] }, label: 'Diverting' },
    { op: 'move', machine: 'diverter', to: { raise: 0 }, seconds: 0.3, label: 'Lowering' },
  ];

  it('the printer\'s verdict is a fact, deterministic per serial', () => {
    expect(registry.getProduct('printer').facts).toEqual({ verdict: { values: ['PASS', 'REJECT'] } });
    const verdicts = [1, 2, 3, 4, 5, 6, 7, 8].map((serial) => {
      const p = registry.buildProduct('printer', { serial }, { materials });
      const v = p.facts.verdict();
      p.dispose();
      return v;
    });
    expect(verdicts).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'REJECT', 'PASS', 'PASS', 'REJECT']);
  });

  it('a known fact plans its branch step by step; an unknown one keeps a summary step', () => {
    const data = { id: 's', title: 'S', conveyor: 'line', process: [{ op: 'decide', on: 'verdict', cases: { PASS: [{ op: 'wait', seconds: 1, label: 'ok' }], REJECT: [{ op: 'wait', seconds: 3, label: 'no' }] } }] };
    const equipment = { line: { type: 'palletConveyor' } };
    const steps = (facts) => planStation(registry, data, { equipment, product: 'printer', facts }).process.steps.map((s) => s.label);
    expect(steps({ verdict: 'PASS' })).toEqual(['ok', 'Process complete']);
    expect(steps({ verdict: 'REJECT' })).toEqual(['no', 'Process complete']);
    expect(steps({})).toEqual(['Decide on verdict', 'Process complete']);
  });

  it('a reject leaves through the bay port, no output phase; the bay fills its places in turn', () => {
    const process = [{ op: 'decide', on: 'rejectSlot', cases: { 0: divert(0.67), 1: divert(1.32) } }];
    const c = cell(process);
    const plan = planStation(registry, c.station, { equipment: c.equipment, product: 'printer', facts: { rejectSlot: 0 } });
    expect(plan.exit).toBe('reject');
    expect(plan.output.steps).toEqual([]);
    close(plan.process.steps.find((s) => s.label === 'Diverting').duration, 1.05 / 0.45 + 0.35, 1e-9); // along the floor
    c.start();
    for (let t = 0; t < 120 && c.status.rejectCount < 3; t += 0.05) c.update(0.05);
    expect(c.error).toBeNull();
    expect(c.status).toMatchObject({ rejectCount: 3, completed: 0 });
    const bay = c.kept.reject;
    expect(bay.map((u) => u.params.serial)).toEqual([2, 3]); // two places: the oldest (unit 1) was cleared
    const z = bay.map((u) => c.root.worldToLocal(worldOf(u.root)).z);
    close(z[0], -1.7, 1e-3); // unit 2 went to the second place
    close(z[1], -1.05, 1e-3); // unit 3 took the first place again
  });

  it('alongside moves two machines in one step; move switches a value motion as it starts', () => {
    const c = cell([
      { op: 'move', machine: 'scanner', to: { x: 0.5 }, switches: { scan: 'on' }, seconds: 1, label: 'Scan' },
      ...divert(0.67),
    ]);
    let duringScan = null;
    let duringRise = null;
    c.start();
    for (let t = 0; t < 40 && c.status.rejectCount < 1; t += 0.02) {
      c.update(0.02);
      if (c.status.step === 'Scan' && !duringScan) duringScan = c.equipment.scanner.state.scan;
      if (c.status.step === 'Rising') duringRise = { raise: c.equipment.diverter.state.raise, locate: c.equipment.line.state.locate };
    }
    expect(duringScan).toBe('on');
    expect(duringRise.raise).toBeGreaterThan(0.5);
    expect(duringRise.locate).toBeLessThan(0.5);
    expect(c.equipment.line.state).toMatchObject({ locate: 0, stop: 0 });
    expect(() => cell([{ op: 'grip', machine: 'diverter', item: 'product', motion: 'raise', to: 1, anchor: 'carrier', alongside: [{ machine: 'diverter', to: { spin: 0 } }] }])).toThrow(/names the step's own machine/);
  });

  it('the dashboard shows checks and a verdict from the status', () => {
    const c = cell([{ op: 'wait', seconds: 1 }], {
      status: { checks: 'pass', cube: 'fail', verdict: 'REJECT', flatness: '0.13 mm' },
      signals: { dashboard: { machine: 'monitor', checks: [{ label: 'Fasteners', value: '22/22', state: '{checks}' }, { label: 'Cube', value: '{flatness}', state: '{cube}' }, { label: 'Other', state: '{nope}' }], verdict: 'verdict' } },
    });
    const d = c.dashboardData();
    expect(d.checks).toEqual([{ label: 'Fasteners', value: '22/22', state: 'pass' }, { label: 'Cube', value: '0.13 mm', state: 'fail' }, { label: 'Other', value: '', state: 'pending' }]);
    expect(d.verdict).toBe('REJECT');
    c.status.verdict = '—';
    expect(c.dashboardData().verdict).toBeNull();
  });
});
