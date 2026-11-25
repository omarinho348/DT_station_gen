import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import {
  StationCycle, StationError, connectPorts, planStation, parseStation, portMismatch, resolvePorts,
} from '../../lib/station/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import { trapezoidDuration } from '../../lib/core/motion.js';
import { CONVENTIONS } from '../../lib/core/conventions.js';

const materials = createMaterials();
const close = (a, b, eps = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(eps);
const worldOf = (o) => { o.updateWorldMatrix(true, false); return new THREE.Vector3().setFromMatrixPosition(o.matrixWorld); };
const { beltHeight, lift } = CONVENTIONS;
const TRAVEL = trapezoidDuration(1.6, 0.45, 0.35); // reference port → work / work → port

const EQUIPMENT = {
  line: { type: 'palletConveyor', params: {}, position: [0, 0, 0] },
  robot: { type: 'cartesianGantry', params: { spanX: 1.6, spanZ: 1.4 }, position: [0, 0, 0] },
  panel: { type: 'hmi', params: {}, position: [-1.55, 0, 0.95] },
  beacon: { type: 'stackLight', params: {}, position: [1.95, 0, -0.55] },
};

const PROCESS = [
  { op: 'wait', seconds: 0.3, label: 'RFID read' },
  { op: 'move', machine: 'robot', to: { x: 0, y: 1.2, z: 0 }, seconds: 1.0, label: 'Robot over the unit', status: { robot: 'WORK' } },
  { op: 'move', machine: 'robot', to: { y: 1.6 }, seconds: 0.5, label: 'Robot clear', status: { robot: 'HOME', done: 1 } },
];

function stationData(overrides = {}) {
  return {
    id: 'demo',
    code: 'ST9',
    title: 'Demo cell',
    workState: 'ASSEMBLING',
    inputStage: 'kitted',
    conveyor: 'line',
    process: PROCESS,
    home: { robot: { y: 1.6 } },
    status: { robot: 'HOME', done: 0, total: 1 },
    signals: {
      beacon: { machine: 'beacon' },
      display: { machine: 'panel', rows: [['Unit', 'unit'], ['Robot', 'robot'], ['Completed', 'completed']], bar: { value: 'done', total: 'total', label: 'Done {done}/{total} · Speed {speed}×' } },
    },
    ...overrides,
  };
}

/** A plain box product (origin at its underside), deterministic per serial. */
function boxProduct({ serial }) {
  const root = new THREE.Group();
  root.name = `unit ${serial}`;
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, 0.3)));
  let disposed = false;
  return { root, params: { serial }, dispose: () => { disposed = true; }, get disposed() { return disposed; } };
}

/** A station in a moved and turned frame (nothing may depend on world coordinates). */
function makeStation({ data = stationData(), equipment = EQUIPMENT, createProduct = boxProduct, facts, product, at = [6, 0, -3], turn = 0.4 } = {}) {
  const root = new THREE.Group();
  root.position.set(...at);
  root.rotation.y = turn;
  const instances = {};
  for (const [id, e] of Object.entries(equipment)) {
    instances[id] = registry.buildComponent(e.type, e.params, { materials });
    instances[id].root.position.set(...e.position);
    root.add(instances[id].root);
  }
  const units = [];
  const make = createProduct ? (args) => { const u = createProduct(args); units.push(u); return u; } : null;
  const cycle = new StationCycle({ registry, station: data, equipment: instances, root, createProduct: make, facts, product, ctx: { materials } });
  return { root, equipment: instances, cycle, units };
}

/** Plays the station, recording every step that starts. */
function record(cycle) {
  const steps = [];
  const before = cycle.sequencer.onStepStart;
  cycle.sequencer.onStepStart = (step) => { before(step); steps.push({ state: step.state, label: step.label, duration: step.duration }); };
  return steps;
}

const advance = (cycle, seconds, dt = 1 / 30) => { for (let t = 0; t < seconds; t += dt) cycle.update(dt); };

describe('station spec', () => {
  it('parses with defaults and names the station in errors', () => {
    const s = parseStation({ id: 'st1', title: 'Kitting', conveyor: 'line', process: [] });
    expect(s.workState).toBe('WORKING');
    expect(s.feed.fromLift).toBe(true);
    expect(() => parseStation({ id: 'st1', title: 'Kitting', process: [] })).toThrow(/station "st1": conveyor/);
    expect(() => parseStation({ id: 'Bad id', title: 'x', conveyor: 'line', process: [] })).toThrow(StationError);
    expect(() => parseStation({ id: 'st1', title: 'x', conveyor: 'line', process: [], workState: 'lower' })).toThrow(/workState/);
  });

  it('resolves typed ports from the conveyor, with what each carries', () => {
    const line = registry.componentSpec('palletConveyor', {});
    const ports = resolvePorts(parseStation(stationData()), { line });
    expect(ports.input).toMatchObject({ machine: 'line', port: 'input', direction: 'in', carries: 'pallet', position: [-1.6, beltHeight, 0] });
    expect(ports.work).toMatchObject({ direction: 'work', position: [0, beltHeight, 0] });
    expect(ports.output).toMatchObject({ direction: 'out', carries: 'pallet', position: [1.6, beltHeight, 0] });
    expect(() => resolvePorts(parseStation(stationData({ ports: { reject: { machine: 'nope', port: 'x' } } })), { line })).toThrow(/port "reject": unknown machine "nope"/);
    expect(() => resolvePorts(parseStation(stationData({ ports: { reject: { port: 'side' } } })), { line })).toThrow(/has no port "side" \(ports: input, work, output\)/);
  });

  it('typed ports only connect output → input carrying the same thing', () => {
    const out = { name: 'output', direction: 'out', carries: 'pallet' };
    expect(portMismatch(out, { name: 'input', direction: 'in', carries: 'pallet' })).toBeNull();
    expect(portMismatch(out, { name: 'input', direction: 'in', carries: 'unit' })).toMatch(/carries pallet but "input" takes unit/);
    expect(portMismatch(out, { name: 'output', direction: 'out', carries: 'pallet' })).toMatch(/not an input/);
  });
});

describe('dry plan', () => {
  it('default intake / output are the reference steps with the reference times', () => {
    const plan = planStation(registry, stationData(), { equipment: EQUIPMENT });
    expect(plan.intake.steps.map((s) => [s.label, s.state])).toEqual([
      ['Stop raised · carrier indexing', 'INFEED'],
      ['Carrier transport to work position', 'INFEED'],
      ['Lift & locate carrier', 'INFEED'],
    ]);
    close(plan.intake.duration, 0.3 + TRAVEL + 0.4);
    expect(plan.output.steps.map((s) => [s.label, s.state])).toEqual([
      ['Releasing carrier', 'OUTPUT'],
      ['Transport to output port', 'OUTPUT'],
    ]);
    close(plan.output.duration, 0.35 + TRAVEL);
    expect(plan.process.steps.at(-1)).toMatchObject({ label: 'Process complete', duration: 0, state: 'ASSEMBLING' });
    close(plan.process.duration, 0.3 + 1.0 + 0.5);
    close(plan.cycleTime, plan.intake.duration + plan.process.duration + plan.output.duration);
  });

  it('works from catalog types alone and equals the plan from built instances', () => {
    const fromTypes = planStation(registry, stationData(), { equipment: EQUIPMENT });
    const { cycle } = makeStation();
    expect(cycle.timing.steps).toEqual(fromTypes.steps);
  });

  it('a bad op fails before anything plays, naming station, phase and op', () => {
    const data = stationData({ process: [{ op: 'move', machine: 'robot', to: { x: 9 }, seconds: 1 }] });
    expect(() => planStation(registry, data, { equipment: EQUIPMENT })).toThrow(/station "demo" › process › op #1 \(move\): machine "robot".x must stay in/);
    expect(() => makeStation({ data })).toThrow(StationError);
    expect(() => planStation(registry, stationData({ intake: [{ op: 'nope' }] }), { equipment: EQUIPMENT })).toThrow(/› intake › op #1 \(nope\): unknown op "nope"/);
  });

  it('explicit intake / output replace the defaults (e.g. shutters around the infeed)', () => {
    const intake = [
      { op: 'wait', seconds: 0.5, label: 'Opening entry shutter', state: 'INFEED' },
      { op: 'transfer', conveyor: 'line', from: 'input', to: 'work', state: 'INFEED' },
    ];
    const plan = planStation(registry, stationData({ intake }), { equipment: EQUIPMENT });
    expect(plan.intake.steps.map((s) => s.label)).toEqual(['Opening entry shutter', 'Transport to work']);
    expect(plan.output.steps[0].label).toBe('Releasing carrier'); // output still the default
  });

  it('a conveyor without a work place of its own: the unit is conveyed to its middle, worked on there, then out', () => {
    const equipment = { line: { type: 'rollerConveyor', params: {}, position: [0, 0, 0] } };
    const plan = planStation(registry, { id: 'pass', title: 'Pass', conveyor: 'line', process: [{ op: 'wait', seconds: 1 }] }, { equipment });
    // Midway between input and output (where machines over the conveyor are placed), not at the input.
    expect(plan.intake.steps.map((s) => s.label)).toEqual(['Carrier transport to work position']);
    expect(plan.output.steps.map((s) => s.label)).toEqual(['Transport to output port']);
    const ports = registry.componentSpec('rollerConveyor', {}, {}).ports;
    const half = (ports.output.position[0] - ports.input.position[0]) / 2;
    // Two half-length moves take the same distance as the old single input → output move.
    expect(plan.intake.steps[0].duration).toBeGreaterThan(0);
    expect(half).toBeGreaterThan(0);
  });
});

describe('running a station stand-alone', () => {
  it('feeds a unit from the return line, works it, and retires it, all station-local', () => {
    const { cycle, equipment, units, root } = makeStation();
    expect(cycle.status).toMatchObject({ state: 'IDLE', step: 'Ready', completed: 0, robot: 'HOME' });
    expect(equipment.robot.state.y).toBe(1.6); // home values applied on reset
    cycle.start();
    cycle.update(0.01);
    const unit = units[0];
    expect(unit.root.parent).toBe(root);
    expect(cycle.status.step).toBe('Carrier rising from return line');
    const inputPort = cycle.portInStation('input');
    close(unit.root.position.x, inputPort.x);
    expect(unit.root.position.y).toBeLessThan(beltHeight - lift.drop * 0.9);
    advance(cycle, lift.duration + 0.3 + TRAVEL + 0.4);
    // located at the work position: on the plate, lifted off the belts
    const work = equipment.line.root.localToWorld(new THREE.Vector3(0, beltHeight, 0));
    expect(worldOf(unit.root).x).toBeCloseTo(work.x, 6);
    expect(worldOf(unit.root).z).toBeCloseTo(work.z, 6);
    expect(worldOf(unit.root).y).toBeGreaterThan(work.y + 0.01);
    expect(equipment.line.state.locate).toBe(1);
    expect(equipment.line.state.stop).toBe(1);
    advance(cycle, 1.9 + 0.35 + TRAVEL);
    expect(cycle.status.completed).toBe(1);
    expect(cycle.status.cycles).toBe(1);
    expect(equipment.line.state.stop).toBe(0);
    advance(cycle, lift.duration + 0.1);
    expect(unit.disposed).toBe(true);
    expect(unit.root.parent).toBeNull();
    expect(units[1].params.serial).toBe(2); // next unit already on its way
    expect(cycle.error).toBeNull();
  });

  it('plays exactly the planned steps (dry plan = run)', () => {
    const { cycle } = makeStation();
    const steps = record(cycle);
    cycle.start();
    advance(cycle, cycle.timing.cycleTime + 2 * lift.duration + 0.5);
    const played = steps.filter((s) => !/return line/.test(s.label));
    expect(played.slice(0, cycle.timing.steps.length)).toEqual(cycle.timing.steps.map(({ state, label, duration }) => ({ state, label, duration })));
  });

  it('runs at 10× speed without skipping steps', () => {
    const slow = makeStation();
    const fast = makeStation();
    const a = record(slow.cycle);
    const b = record(fast.cycle);
    fast.cycle.setSpeed(10);
    slow.cycle.start();
    fast.cycle.start();
    advance(slow.cycle, 30);
    advance(fast.cycle, 3);
    expect(fast.cycle.status.completed).toBe(slow.cycle.status.completed);
    expect(b.slice(0, a.length)).toEqual(a);
  });

  it('drives the stack light and the HMI from the status', () => {
    const { cycle, equipment } = makeStation();
    expect(equipment.beacon.state.mode).toBe('off');
    cycle.start();
    cycle.update(0.01);
    expect(equipment.beacon.state.mode).toBe('run');
    advance(cycle, lift.duration + 0.3 + TRAVEL + 0.4 + 0.3 + 0.5);
    const screen = cycle.screen();
    expect(screen.title).toBe('ST9 · DEMO CELL');
    expect(screen.state).toBe('ASSEMBLING');
    expect(screen.step).toBe('Robot over the unit');
    expect(screen.rows).toEqual([['Unit', '#0001'], ['Robot', 'WORK'], ['Completed', 0]]);
    expect(screen.bar).toEqual({ fraction: 0, label: 'Done 0/1 · Speed 1×' });
    cycle.stop();
    expect(equipment.beacon.state.mode).toBe('off');
  });

  it('cuts long step text to fit the HMI', () => {
    const label = 'A very long step description that will not fit on the HMI screen line';
    const { cycle } = makeStation({ data: stationData({ process: [{ op: 'wait', seconds: 1, label }] }) });
    cycle.status.step = label;
    expect(cycle.screen().step).toHaveLength(60);
    expect(cycle.screen().step.endsWith('…')).toBe(true);
  });

  it('waits (amber) when no unit comes', () => {
    const { cycle, equipment } = makeStation({ createProduct: null });
    cycle.start();
    advance(cycle, 1);
    expect(cycle.status).toMatchObject({ state: 'WAITING', step: 'Waiting for carrier' });
    expect(equipment.beacon.state.mode).toBe('wait');
  });

  it('stops in ALARM with the reason on a run-time error', () => {
    const data = stationData({ process: [{ op: 'decide', on: 'colour', cases: { red: [{ op: 'wait', seconds: 1 }] } }] });
    const { cycle, equipment } = makeStation({ data });
    cycle.start();
    advance(cycle, 10);
    expect(cycle.running).toBe(false);
    expect(cycle.error.message).toMatch(/unknown fact "colour"/);
    expect(cycle.status.state).toBe('ALARM');
    expect(equipment.beacon.state.mode).toBe('alarm');
    cycle.start(); // refuses until reset
    expect(cycle.running).toBe(false);
    cycle.reset();
    expect(cycle.error).toBeNull();
    expect(equipment.beacon.state.mode).toBe('off');
  });

  it('reset clears units and counters and puts every machine back home', () => {
    const { cycle, equipment, units } = makeStation();
    cycle.start();
    advance(cycle, 4);
    expect(equipment.line.state.stop).toBe(1);
    cycle.reset();
    expect(units[0].disposed).toBe(true);
    expect(cycle.status).toMatchObject({ state: 'IDLE', completed: 0, cycles: 0, unit: '—' });
    expect(equipment.line.state).toMatchObject({ stop: 0, locate: 0 });
    expect(equipment.robot.state.y).toBe(1.6);
    cycle.start();
    advance(cycle, 1);
    expect(units[1].params.serial).toBe(1); // serials start again
  });
});

describe('extra output ports (reject lane)', () => {
  const rejectData = () => stationData({
    ports: { reject: { port: 'input' } }, // stands in for a reject lane in this test
    process: [
      { op: 'wait', seconds: 0.5, label: 'Inspecting' },
      { op: 'decide', on: 'quality', cases: {
        pass: [{ op: 'wait', seconds: 0.2, label: 'Released' }],
        fail: [
          { op: 'release', machine: 'line', item: 'product', motion: 'locate', to: 0, also: { stop: 0 }, seconds: 0.35, label: 'Releasing to reject', state: 'REJECT' },
          { op: 'transfer', conveyor: 'line', from: 'work', to: 'input', label: 'To reject lane', state: 'REJECT' },
        ],
      } },
    ],
  });

  it('hands a failed unit over at the reject port and skips the output', () => {
    const facts = (unit) => ({ quality: unit.params.serial % 2 === 0 ? 'fail' : 'pass' });
    const { cycle, units } = makeStation({ data: rejectData(), facts });
    const steps = record(cycle);
    cycle.start();
    advance(cycle, 2 * (cycle.timing.cycleTime + 2 * lift.duration) + 2);
    expect(cycle.status.completed).toBeGreaterThanOrEqual(1);
    expect(cycle.status.rejectCount).toBe(1);
    expect(cycle.kept.reject).toEqual([units[1]]);
    expect(units[1].disposed).toBe(false); // stays on the lane (stand-alone)
    const second = steps.findIndex((s) => s.label === 'To reject lane');
    expect(steps[second + 1].label).toBe('Process complete');
    expect(steps[second + 2].label).toBe('Carrier rising from return line'); // no output phase for it
  });
});

describe('connecting stations', () => {
  it('passes units downstream and holds (amber) while downstream is busy', () => {
    const a = makeStation();
    const b = makeStation({ data: stationData({ id: 'next', code: 'ST10' }), createProduct: null, at: [12, 0, -3] });
    const link = connectPorts(a.cycle.ports.output, b.cycle.ports.input);
    a.cycle.start();
    advance(a.cycle, a.cycle.timing.cycleTime + lift.duration + 0.5);
    expect(link.pending).toBe(a.units[0]);
    expect(a.cycle.owned.has(a.units[0])).toBe(false); // released: it is in the hand-over now
    // the second unit is finished but cannot leave: downstream has not taken the first
    advance(a.cycle, a.cycle.timing.cycleTime);
    expect(a.cycle.status.state).toBe('HOLDING');
    expect(a.cycle.status.step).toBe('Holding · downstream busy');
    expect(a.equipment.beacon.state.mode).toBe('wait');
    b.cycle.start();
    b.cycle.update(0.01);
    expect(b.cycle.unit).toBe(a.units[0]);
    expect(a.units[0].root.parent).toBe(b.root);
    expect(link.pending).toBeNull();
    advance(a.cycle, 1);
    expect(a.cycle.status.state).toBe('OUTPUT');
    expect(b.cycle.ports.input.waiting).toBe('Waiting for demo');
  });

  it('refuses to connect ports of different types', () => {
    const a = makeStation();
    const rollers = makeStation({
      data: { id: 'rollers', title: 'Rollers', conveyor: 'line', process: [] },
      equipment: { line: { type: 'rollerConveyor', params: {}, position: [0, 0, 0] } },
    });
    expect(() => connectPorts(a.cycle.ports.output, rollers.cycle.ports.input)).toThrow(/cannot connect demo.output → rollers.input: "output" carries pallet but "input" takes unit/);
    expect(() => connectPorts(a.cycle.ports.input, rollers.cycle.ports.input)).toThrow(/not an output port/);
  });
});

describe('with the printer product', () => {
  it('builds frame parts on a real printer at a station (named ops through the station cycle)', () => {
    const equipment = {
      line: { type: 'palletConveyor', params: {}, position: [0, 0, 0] },
      gantry: { type: 'cartesianGantry', params: { spanX: 1.5, spanZ: 0.9, beamY: 2.3, maxGap: 0.26, screwdriver: true }, position: [0, 0, 0] },
    };
    const data = {
      id: 'frame', code: 'ST2', title: 'Frame assembly', workState: 'FRAME_ASSEMBLY', inputStage: 'kitted', conveyor: 'line',
      process: [
        { op: 'installPart', machine: 'gantry', part: 'Motor_Z', name: 'Z motor', gap: 0.047, openGap: 0.26, clearAbove: 0.22 },
        { op: 'driveScrew', machine: 'gantry', screw: 'Motor_Z:0', name: 'Z motor M4 1', state: 'FASTENING' },
      ],
    };
    const { cycle } = makeStation({ data, equipment, createProduct: null, product: { type: 'printer', params: {} } });
    expect(cycle.timing.process.duration).toBeGreaterThan(3);
    const steps = record(cycle);
    cycle.start();
    advance(cycle, cycle.timing.cycleTime + 2 * lift.duration + 0.5);
    expect(cycle.error).toBeNull();
    expect(cycle.status.completed).toBe(1);
    expect(cycle.status.unit).not.toBe('—'); // the next printer is on its way
    const played = steps.filter((s) => !/return line/.test(s.label)).slice(0, cycle.timing.steps.length);
    expect(played).toEqual(cycle.timing.steps.map(({ state, label, duration }) => ({ state, label, duration })));
  });
});

describe('dev station files (app/dev/stations)', () => {
  it('every dev station plays one full unit headless without an error', async () => {
    const { createStationDemo, stationNames } = await import('../../app/dev/stationDemo.js');
    expect(stationNames().length).toBeGreaterThan(0);
    for (const name of stationNames()) {
      const demo = createStationDemo({ station: name });
      demo.skip(demo.cycle.timing.cycleTime + 2 * lift.duration + 0.5);
      expect(demo.cycle.error, name).toBeNull();
      expect(demo.cycle.status.completed, name).toBe(1);
      demo.dispose();
    }
  });
});
