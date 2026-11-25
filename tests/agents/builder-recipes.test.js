// Machine routines (Phase 13, step 1; lib/recipes.js): each machine's standard process, written once in
// its component file. The Builder offers a station's routines in the process phase as
// { use: "machine.routine", ...args } and expands them into plain ops before the checks.
//
// The main test builds a real station around every routine through the Builder (scripted answers made
// with the schemas' own encode(), as in builder.test.js: no network) and needs the deterministic
// reviewer to pass and the run to play: a routine that doesn't work on its machine fails here.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { createBuilder } from '../../agents/builder/builder.js';
import { layoutSchema, machinesSchema, processSchema } from '../../agents/builder/schemas.js';
import { checkStrict } from '../../agents/strict.js';
import { recipeLines, expandRecipes, stationRecipes, expandCall, candidatesFor, RecipeError } from '../../lib/recipes.js';
import { measureUnit } from '../../lib/station/unit.js';
import { reachPose, reachNeeded, workPlaceOf } from '../../lib/station/reach.js';

const bottling = JSON.parse(readFileSync('spec/examples/bottling-line.factory.json', 'utf8'));
// The bottling line's glass bottle, every 2nd serial failing inspection (so a run of 4 rejects some).
const product = { ...bottling.product, params: { ...bottling.product.params, rejectEvery: 2 } };
const belt = { id: 'belt', type: 'beltConveyor', why: 'carries the units', place: 'line', at: 'whole' };

/**
 * One station per routine: the machines around it (with placement hints, as the layout phase gives
 * them), the routine call, and the stage units arrive in. Test data, so it may name components.
 */
const CASES = [
  { use: 'filler.fillUnit', equipment: [{ id: 'filler', type: 'filler', why: 'fills', place: 'overLine', at: 'work' }], call: { seconds: 3, liquid: 'juice' }, stage: 'raw' },
  {
    use: 'filler.fillUnit', name: 'with its supply tank',
    equipment: [{ id: 'filler', type: 'filler', why: 'fills', place: 'overLine', at: 'work' }, { id: 'tank', type: 'supplyTank', why: 'holds the juice', place: 'rear', at: 'work' }],
    call: { seconds: 3, supply: 'tank' }, stage: 'raw',
  },
  { use: 'capper.capUnit', equipment: [{ id: 'capper', type: 'capper', why: 'caps', place: 'overLine', at: 'work' }], call: { turns: 2 }, stage: 'filled' },
  { use: 'scanner.scan', equipment: [{ id: 'scanner', type: 'visionScanner', why: 'checks', place: 'overLine', at: 'work' }], call: {}, stage: 'capped' },
  {
    use: 'scanner.inspect',
    equipment: [{ id: 'scanner', type: 'visionScanner', why: 'checks', place: 'overLine', at: 'work' }, { id: 'rejectLane', type: 'rollerConveyor', why: 'takes rejects', place: 'besideLine', at: 'work', turned: true }],
    ports: [{ name: 'reject', machine: 'rejectLane', port: 'output', direction: 'out' }],
    call: { seconds: 3, rejectLane: 'rejectLane' }, stage: 'capped',
  },
  { use: 'labeller.applyLabel', equipment: [{ id: 'labeller', type: 'labelApplicator', why: 'labels', place: 'besideLine', at: 'work', side: 'walkway' }], call: {}, stage: 'capped' },
  { use: 'machine.work', equipment: [{ id: 'machine', type: 'genericMachine', why: 'stands in for the oven', place: 'overLine', at: 'work' }], call: { seconds: 4, task: 'Baking' }, stage: 'raw' },
  { use: 'tester.test', equipment: [{ id: 'tester', type: 'testCabinet', why: 'tests', place: 'besideLine', at: 'work' }], call: { seconds: 2 }, stage: 'capped' },
  { use: 'dock.dock', equipment: [{ id: 'dock', type: 'dockingUnit', why: 'connects', place: 'besideLine', at: 'work' }], call: { seconds: 1 }, stage: 'capped' },
  { use: 'eye.detect', equipment: [{ id: 'eye', type: 'photoEye', why: 'sees the unit', place: 'overLine', at: 'work' }], call: {}, stage: 'raw' },
  {
    use: 'robot.moveUnit', name: 'scara: to a table and back onto the belt',
    equipment: [{ id: 'robot', type: 'scara', why: 'moves the unit', place: 'besideLine', at: 'work' }, { id: 'table', type: 'workTable', why: 'work place', place: 'besideLine', at: 'output' }],
    params: { belt: { length: 1.6 } },
    steps: [{ use: 'robot.moveUnit', to: 'table.top' }, { use: 'robot.moveUnit', to: 'belt.work' }], stage: 'raw',
  },
  {
    use: 'robot.moveUnit', name: 'gantry: into a nest and back onto the belt',
    equipment: [{ id: 'robot', type: 'cartesianGantry', why: 'moves the unit', place: 'overLine', at: 'work' }, { id: 'nest', type: 'partNest', why: 'locates it', place: 'besideLine', at: 'work' }],
    params: { robot: { spanZ: 1.1 } },
    steps: [{ use: 'robot.moveUnit', to: 'nest.seat' }, { use: 'robot.moveUnit', to: 'belt.work' }], stage: 'raw',
  },
  {
    use: 'robot.moveUnit', name: 'palletizer robot (vacuum): to a table and back',
    equipment: [{ id: 'robot', type: 'palletizerRobot', why: 'moves the unit', place: 'rear', at: 'work' }, { id: 'table', type: 'workTable', why: 'work place', place: 'besideLine', at: 'output' }],
    steps: [{ use: 'robot.moveUnit', to: 'table.top' }, { use: 'robot.moveUnit', to: 'belt.work' }], stage: 'raw',
  },
  { use: 'light.signal', equipment: [{ id: 'light', type: 'pickToLight', why: 'shows the operator', place: 'front', at: 'work' }], call: { seconds: 0.5 }, stage: 'raw' },
];

const job = (stationId) => ({
  line: { id: 'routineLine', title: 'Routines', runSize: 4, conventions: { beltHeight: 0.86 }, transport: { type: 'beltConveyor', params: {} } },
  product,
  stations: [],
  plan: { id: stationId, title: 'Routine check', does: 'one routine', steps: ['in', 'work', 'out'] },
});

/** A model that answers from a script, per schema name, and records what it was asked. */
function scripted(script) {
  const calls = [];
  const queues = Object.fromEntries(Object.entries(script).map(([k, v]) => [k, [...v]]));
  return {
    calls,
    call: async ({ schemaName, schema, messages }) => {
      calls.push({ schemaName, schema, messages });
      const next = queues[schemaName]?.shift();
      if (!next) throw new Error(`no scripted answer for ${schemaName}`);
      return { output: next, cost: 0, source: 'mock', key: schemaName };
    },
  };
}

/** The station's routines as the process phase offers them (candidates for station args included). */
function offered(equipment) {
  const all = [{ ...belt, params: {} }, ...equipment.map((e) => ({ ...e, params: {} }))];
  return stationRecipes(registry, all, { productDef: registry.getProduct('parametric') }).map((r) => ({
    ...r,
    candidates: Object.fromEntries(Object.entries(r.def.stationArgs ?? {}).map(([k, rule]) => [k, candidatesFor(registry, rule, all, {}, { exclude: r.machine })])),
  }));
}

/** The three scripted answers for a station built around one routine call. */
function answersFor(c, { call = c.call, stationId = 'routine' } = {}) {
  const equipment = [belt, ...c.equipment];
  const layout = { id: stationId, title: 'Routine check', equipment, conveyor: 'belt', ops: [], ...(c.ports ? { ports: c.ports } : {}) };
  const machines = equipment.map((e) => e.id);
  const process = processSchema(registry, { ops: [], machines, items: ['product'], recipes: offered(c.equipment) });
  return {
    stationLayout: [layoutSchema(registry, { product: 'parametric' }).encode(layout)],
    stationMachines: [machinesSchema(registry, equipment).encode({ params: Object.fromEntries(machines.map((id) => [id, c.params?.[id] ?? {}])) })],
    stationProcess: [process.encode({ process: c.steps ?? [{ use: c.use, ...call }], inputStage: c.stage })],
  };
}

describe('machine routines in the library', () => {
  it('the routines the first step adds, each listed for the Builder with its args', () => {
    const lines = recipeLines(registry);
    for (const l of [
      'filler.fillUnit(seconds?, liquid?, supply?)', 'capper.capUnit(turns?)', 'visionScanner.scan(seconds?)',
      'visionScanner.inspect(seconds?, rejectLane)', 'labelApplicator.applyLabel(seconds?)', 'genericMachine.work(seconds?, task?)',
      'testCabinet.test(seconds?)', 'dockingUnit.dock(seconds?)', 'photoEye.detect(seconds?)', 'pickToLight.signal(seconds?)',
      'scara.moveUnit(clearance?, task?, to)', 'cartesianGantry.moveUnit(clearance?, task?, to)', 'palletizerRobot.moveUnit(clearance?, task?, to)', 'abbIrb6760.moveUnit(clearance?, task?, to)',
    ]) expect(lines.some((x) => x.startsWith(`${l} — `))).toBe(true);
  });

  it('every routine of every component: its args all have defaults or are station args, and it expands at its defaults into known ops', () => {
    let count = 0;
    for (const def of registry.components()) {
      for (const [name, r] of Object.entries(def.recipes)) {
        count += 1;
        expect(r.args.safeParse({}).success, `${def.type}.${name} args at defaults`).toBe(true);
        const machines = [{ id: 'm', type: def.type, params: {} }, { id: 'other', type: 'rollerConveyor', params: {} }, { id: 'tank', type: 'supplyTank', params: {} }];
        const stationArgs = Object.fromEntries(Object.entries(r.stationArgs).filter(([, v]) => !v.optional).map(([k, v]) => [k, v.kind === 'place' ? 'other.output' : 'other']));
        const ops = expandCall(registry, { use: `m.${name}`, ...stationArgs }, { conveyor: 'other', machines });
        const walk = (list) => list.forEach((o) => {
          expect(registry.getOp(o.op), `${def.type}.${name}: op "${o.op}"`).toBeTruthy();
          if (o.op === 'decide') Object.values(o.cases).forEach(walk);
        });
        walk(ops);
      }
    }
    expect(count).toBe(14);
  });

  it('a product without what a routine needs is not offered it (a filler routine needs a product that fills)', () => {
    const all = [{ id: 'filler', type: 'filler' }, { id: 'tester', type: 'testCabinet' }];
    const fakeProduct = { routines: {}, features: {}, facts: {} };
    expect(stationRecipes(registry, all, { productDef: fakeProduct }).map((r) => r.use)).toEqual([]);
    expect(stationRecipes(registry, all, { productDef: registry.getProduct('parametric') }).map((r) => r.use)).toEqual(['filler.fillUnit', 'tester.test']);
  });

  it('expansion problems are named for the agent, nothing thrown: unknown machine, unknown routine, arg out of range, wrong station arg', () => {
    const station = { conveyor: 'belt', machines: [{ id: 'belt', type: 'beltConveyor' }, { id: 'filler', type: 'filler' }, { id: 'eye', type: 'photoEye' }] };
    const { ops, problems } = expandRecipes(registry, [
      { use: 'oven.work' },
      { use: 'filler.bake' },
      { use: 'filler.fillUnit', seconds: 900 },
      { use: 'filler.fillUnit', supply: 'eye' },
      { op: 'wait', seconds: 1 },
      { op: 'decide', on: 'quality', cases: { reject: [{ use: 'belt.work' }] } },
    ], station);
    expect(problems).toEqual([
      'process[0]: use "oven.work": "oven" is no machine of this station (belt, filler, eye)',
      'process[1]: use "filler.bake": a filler has no routine "bake" (its routines: fillUnit)',
      'process[2]: use "filler.fillUnit": seconds: Too big: expected number to be <=60',
      'process[3]: use "filler.fillUnit": "supply" must name a supply tank of the station (a machine with a level) and the station has none: add one, or leave it out',
      'process[5].cases.reject[0]: use "belt.work": a beltConveyor has no routine "work" (it has none: write its ops instead)',
    ]);
    expect(ops.map((o) => o.op)).toEqual(['wait', 'decide']);
    // Text over its length (strict mode can't carry maxLength) is shortened at a word, not refused.
    const long = expandRecipes(registry, [{ use: 'filler.fillUnit', liquid: 'cold pressed apple juice' }], station);
    expect(long.problems).toEqual([]);
    expect(long.ops[0].liquid).toBe('cold pressed apple');
    expect(() => expandCall(registry, { use: 'nonsense' }, station)).toThrow(RecipeError);
  });

  it('the process schema with routines is strict-valid; a routine step decodes to its call, an op step to its op', () => {
    const c = CASES.find((x) => x.use === 'scanner.inspect');
    const def = processSchema(registry, { ops: ['wait'], machines: ['belt', 'scanner', 'rejectLane'], items: ['product'], recipes: offered(c.equipment) });
    expect(checkStrict(def.schema)).toEqual([]);
    const ir = { process: [{ use: 'scanner.inspect', seconds: 2, rejectLane: 'rejectLane' }, { op: 'wait', seconds: 1 }] };
    expect(def.decode(def.encode(ir)).process).toEqual(ir.process);
  });
});

describe('every routine builds a station that passes the reviewer and plays', () => {
  for (const c of CASES) {
    it(`${c.use}${c.name ? ` (${c.name})` : ''}`, async () => {
      const answers = answersFor(c);
      // Spare copies, so a refusal shows its reasons instead of running out of answers.
      const llm = scripted(Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, [...v, ...v, ...v]])));
      const r = await createBuilder({ registry, llm }).buildStation(job('routine'));
      if (!r.ok || r.attempts.length) throw new Error(`not built first time: ${JSON.stringify(r.attempts.map((a) => a.problems), null, 1)}`);
      expect(r.attempts).toEqual([]);
      // The station holds plain ops only (no routine calls left), and they are the routine's.
      const flat = JSON.stringify(r.station.process);
      expect(flat).not.toMatch(/"use":/);
      expect(r.station.process.length).toBeGreaterThan(0);
      expect(r.findings.find((f) => f.check === 'play')?.message).toMatch(/^played a run of 4: every unit left the line/);
    }, 60000);
  }
});

describe('the Builder with routines', () => {
  it('the routines are in the stable prompt start (the same for every call) and offered in the process phase with their args', async () => {
    const c = CASES[0];
    const llm = scripted(answersFor(c));
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job('routine'));
    expect(r.ok).toBe(true);
    const systems = new Set(llm.calls.map((x) => x.messages[0].content));
    expect(systems.size).toBe(1);
    expect([...systems][0]).toMatch(/ROUTINES \(type\.routine\(args\) — what it does\)\n\[.*"filler\.fillUnit\(seconds\?, liquid\?, supply\?\) — Fill the unit/);
    const task = llm.calls.find((x) => x.schemaName === 'stationProcess').messages[1].content;
    expect(task).toMatch(/ROUTINES\n\[\{"use":"filler\.fillUnit","does":"Fill the unit at the work place/);
    expect(task).toMatch(/"seconds":"number, 1–60, default 5, Dispense time \(s\)"/);
    expect(r.station.process).toEqual([{ op: 'fill', machine: 'filler', units: 'Unit', liquid: 'juice', timing: { dispense: 3 } }]);
  }, 60000);

  it('a wrong routine call is refused with the reason and the model\'s own answer shown back; the fixed answer passes', async () => {
    const c = CASES[0];
    const good = answersFor(c);
    const bad = answersFor(c, { call: { seconds: 900 } });
    const llm = scripted({ ...good, stationProcess: [bad.stationProcess[0], good.stationProcess[0]] });
    const r = await createBuilder({ registry, llm, play: false }).buildStation(job('routine'));
    expect(r.ok).toBe(true);
    expect(r.attempts).toEqual([{ phase: 'process', problems: ['process[0]: use "filler.fillUnit": seconds: Too big: expected number to be <=60'] }]);
    const retry = llm.calls.filter((x) => x.schemaName === 'stationProcess')[1].messages[1].content;
    expect(retry).toMatch(/PREVIOUS ANSWER\n\{"process":\[\{"use":"filler\.fillUnit"/);
    expect(retry).toMatch(/FEEDBACK\nYour process answer was refused/);
  }, 60000);

  it('routines and ops mix in one process, inside decision branches too', async () => {
    const c = CASES.find((x) => x.use === 'tester.test');
    const base = answersFor(c);
    const equipment = [belt, ...c.equipment];
    const layout = { id: 'routine', title: 'Routine check', equipment, conveyor: 'belt', ops: ['wait', 'decide'] };
    const process = processSchema(registry, { ops: ['wait', 'decide'], machines: ['belt', 'tester'], items: ['product'], recipes: offered(c.equipment) });
    const llm = scripted({
      ...base,
      stationLayout: [layoutSchema(registry, { product: 'parametric' }).encode(layout)],
      stationProcess: [process.encode({
        inputStage: 'capped',
        process: [{ op: 'wait', seconds: 0.5, label: 'Settle' }, { op: 'decide', on: 'quality', planAs: 'pass', cases: { pass: [{ use: 'tester.test', seconds: 1 }], reject: [] } }],
      })],
    });
    const r = await createBuilder({ registry, llm }).buildStation(job('routine'));
    expect(r.ok).toBe(true);
    expect(r.station.process[1].cases.pass.map((o) => o.op)).toEqual(['toolOn', 'decide']);
    expect(r.findings.find((f) => f.check === 'play')?.message).toMatch(/^played a run of 4/);
  }, 60000);
});

describe('the routine contract', () => {
  it('a component routine is validated where it is defined (a summary, args as a z.object, ops a function)', () => {
    const def = (recipes) => ({
      type: 'routineProbe', category: 'fixture', summary: 'A probe for the routine contract test only.',
      params: z.object({}), footprint: () => ({ x: [-0.1, 0.1], z: [-0.1, 0.1], height: 0.1 }), mount: 'floor', build: () => ({}), recipes,
    });
    expect(() => registry.defineComponent(def({ go: { summary: 'short', ops: () => [] } }))).toThrow(/recipes\.go\.summary/);
    expect(() => registry.defineComponent(def({ go: { summary: 'A routine without its ops function.' } }))).toThrow(/recipes\.go\.ops/);
  });
});

describe('machines fitted to the unit (step 13.2)', () => {
  const unit = measureUnit(registry, product, { beltHeight: 0.86 });
  const build = async (c) => {
    const r = await createBuilder({ registry, llm: scripted(answersFor(c)) }).buildStation(job('routine'));
    if (!r.ok) throw new Error(JSON.stringify(r.attempts.at(-1)));
    return r;
  };

  it('the bottle measured: its neck, cap seat, label spot and size', () => {
    expect(unit.size[1]).toBeGreaterThan(0.25);
    for (const ref of ['neckTop', 'capSeat', 'labelSpot', 'grasp', 'top']) expect(unit.refs[ref]).toHaveLength(3);
  });

  it('the capper seats its cap at the bottle\'s cap seat; the filler\'s nozzle dips 3 cm into its neck; noted', async () => {
    const cap = await build(CASES.find((x) => x.use === 'capper.capUnit'));
    expect(cap.station.equipment.find((e) => e.id === 'capper').params.seatHeight).toBeCloseTo(unit.refs.capSeat[1], 2);
    expect(cap.notes.map((n) => n.message).join(' | ')).toMatch(/capper: seatHeight 0\.388 → [\d.]+.*\(fitted to the unit\)/);
    const fill = await build(CASES.find((x) => x.use === 'filler.fillUnit'));
    expect(fill.station.equipment.find((e) => e.id === 'filler').params.tipHeight).toBeCloseTo(unit.refs.neckTop[1] - 0.03, 3);
  }, 60000);

  it('a photo-eye placed over the line stands on the conveyor\'s top (its side frames), not on the floor under it', async () => {
    const r = await build(CASES.find((x) => x.use === 'eye.detect'));
    expect(r.station.equipment.find((e) => e.id === 'eye').position[1]).toBeCloseTo(0.86, 3);
  }, 60000);

  for (const [use, id, motion] of [['labeller.applyLabel', 'labeller', 'tamp'], ['dock.dock', 'dock', 'plug']]) {
    it(`${id}: turned to face the line, its tool at the conveyor's edge, and it goes exactly to the unit's face`, async () => {
      const r = await build(CASES.find((x) => x.use === use));
      const m = r.station.equipment.find((e) => e.id === id);
      const pose = reachPose(registry, m, { beltHeight: 0.86 });
      // Facing the line from the walkway / equipment side.
      expect(Math.sign(pose.dir[2])).toBe(-Math.sign(m.position[2]));
      const belt = r.station.equipment.find((e) => e.id === 'belt');
      const needed = reachNeeded(pose, unit, workPlaceOf(registry, belt, { beltHeight: 0.86 }));
      expect(needed).toBeGreaterThan(0);
      expect(needed).toBeLessThanOrEqual(pose.max);
      const out = r.station.process.find((o) => o.op === 'move' && o.to?.[motion] > 0);
      expect(out.to[motion]).toBeCloseTo(needed, 3);
    }, 60000);
  }
});
