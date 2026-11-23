// Records the reference LUBRICANT line's timing (3D-Digital-Twin-Visualization-Tool, branch
// station-agent): station 1 (filling and capping) and station 2 (case packing) each stand-alone,
// and the whole factory (stations 1–3 with the can and case transfers) to a finished pallet.
// Every step is written with its start time, state, label and duration to
// benchmarks/expected/lubricant-line-reference-timing.json, the target of Phase 5 step 9.
//
//   node scripts/reference-timing-lubricant.mjs
//
// Needs the read-only export in reference/_src (src/station, src/motion, src/rigs; see
// scripts/reference-timing.mjs). The reference repo itself is never touched.
//
// It runs in a Vite SSR module graph (as scripts/compile.mjs), because the factory imports images
// by `?url` and station 3 loads assets. A small plugin points what is not exported, or not
// loadable in Node, at stand-ins:
//   - AssetWrapMachine.js (the stretch wrapper, loaded from Wrapping.STEP through occt): a stub with
//     the same interface and the reference's nominal bay size. Its wrap is a fixed 12 s step and
//     the outbound moves are fixed times, so the timing is unaffected; only positions are nominal.
//   - *.png?url (the can label and logo): dummy URLs (labels need a DOM image anyway).
// Station 3's robot is the same IRB 6760 model (our lib/assets/abbIrb6760.glb = the reference
// src/assets/robot.glb), placed and rigged as the reference AssetManager and rig do.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'reference/_src/src');
const out = resolve(root, 'benchmarks/expected/lubricant-line-reference-timing.json');
for (const need of ['station/factory/LubricantFactory.js', 'motion/Rig.js', 'rigs/abbIrb6760.js']) {
  if (!existsSync(resolve(src, need))) {
    console.error(`Reference source ${need} not found in reference/_src. Export it first (see scripts/reference-timing.mjs).`);
    process.exit(1);
  }
}

// ---- Canvas stub (no DOM in Node), as scripts/reference-timing.mjs ----------------------------
const noop = () => ctx;
const ctx = new Proxy({}, {
  get: (_, key) => {
    if (key === 'measureText') return (text) => ({ width: String(text).length * 6 });
    if (key === 'createLinearGradient' || key === 'createRadialGradient' || key === 'createPattern') return () => ({ addColorStop() {} });
    if (key === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return noop;
  },
  set: () => true,
});
globalThis.document = { createElement: () => ({ width: 1, height: 1, style: {}, getContext: () => ctx }) };

// ---- Stand-ins ----------------------------------------------------------------------------------
const WRAP_STUB = `
import * as THREE from 'three';
export async function createAssetWrapMachine() {
  const root = new THREE.Group();
  root.name = 'AssetWrapMachine (timing stub)';
  let progress = 0;
  return {
    root, carriage: new THREE.Group(), rotorPivot: new THREE.Group(), filmRoot: new THREE.Group(),
    deckHeight: 0.44, bayLength: 3.67, bayWidth: 1.4, height: 2.1,
    references: { bayCenter: new THREE.Vector3(), inbound: new THREE.Vector3(-2.04, 0, 0), deck: new THREE.Vector3(0, 0.44, 0) },
    setWrapProgress(p) { progress = p; },
    getWrapProgress() { return progress; },
    resetWrap() { progress = 0; },
  };
}`;
const stubs = {
  name: 'reference-stubs',
  enforce: 'pre',
  resolveId(id, importer) {
    if (id.endsWith('AssetWrapMachine.js') && importer?.includes('reference')) return '\0wrap-stub';
    if (/\.png\?url$/.test(id)) return `\0png:${id}`;
    return null;
  },
  load(id) {
    if (id === '\0wrap-stub') return WRAP_STUB;
    if (id.startsWith('\0png:')) return 'export default "stub.png";';
    return null;
  },
};

const server = await createServer({ root, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, plugins: [stubs], optimizeDeps: { noDiscovery: true, include: [] } });
const load = (p) => server.ssrLoadModule(p);

const DT = 0.02;
const round = (v) => Math.round(v * 1e6) / 1e6;

/**
 * Waiting stations re-check every 0.1 s, as a run of identical short steps; each run is folded into
 * one entry (start time, total duration, `repeats`), so the file holds the work, not thousands of
 * re-checks.
 */
function fold(steps) {
  const out = [];
  for (const s of steps) {
    const prev = out.at(-1);
    const same = prev && prev.state === s.state && prev.label === s.label && s.duration !== null && s.duration <= 0.1 && prev.unit === s.duration;
    if (same) {
      prev.repeats += 1;
      prev.duration = round(prev.duration + s.duration);
    } else {
      out.push({ ...s, ...(s.duration !== null && s.duration <= 0.1 ? { unit: s.duration, repeats: 1 } : {}) });
    }
  }
  return out.map(({ unit, ...rest }) => rest);
}

/** The reference logs placement checks with console.log; quiet while it runs. */
const say = console.log.bind(console);
const sayInfo = console.info.bind(console);
const quiet = (fn) => async (...args) => {
  console.log = () => {};
  console.info = () => {};
  try { return await fn(...args); } finally { console.log = say; console.info = sayInfo; }
};

try {
  const THREE = await load('three');
  const { loadAsset, instantiate } = await load('/lib/core/assets.js');
  const { Rig } = await load('/reference/_src/src/motion/Rig.js');
  const { ABB_IRB6760_RIG } = await load('/reference/_src/src/rigs/abbIrb6760.js');
  const { OilFillingStation } = await load('/reference/_src/src/station/station-1/OilFillingStation.js');
  const { CasePackingStation } = await load('/reference/_src/src/station/station-2/CasePackingStation.js');
  const { FACTORY_STATION1_DEFINITION } = await load('/reference/_src/src/station/factory/FactoryLayout.js');
  const { LubricantFactory } = await load('/reference/_src/src/station/factory/LubricantFactory.js');
  const NO_CAMERA = { frameObject() {} };
  const fakeScene = () => ({ add() {}, remove() {} });

  /** The robot asset as the reference AssetManager builds it: root → orientation → content, rested on the floor centred. */
  async function robotAsset() {
    await loadAsset('abbIrb6760.glb');
    const content = instantiate('abbIrb6760.glb');
    const orientation = new THREE.Group();
    orientation.name = 'Orientation';
    orientation.add(content);
    const model = new THREE.Group();
    model.name = 'AssetRoot';
    model.add(orientation);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(orientation);
    const centre = bounds.getCenter(new THREE.Vector3());
    orientation.position.sub(new THREE.Vector3(centre.x, bounds.min.y, centre.z));
    model.updateMatrixWorld(true);
    const rig = new Rig({ root: model, content, definition: ABB_IRB6760_RIG });
    return { model, content, orientation, rig };
  }

  /** Steps of a StepSequencer-driven cycle (station 2). */
  const hookSequencer = (sequencer, clock, steps) => {
    const before = sequencer.onStepStart;
    sequencer.onStepStart = (step) => {
      before?.(step);
      steps.push({ t: round(clock.t), state: step.state, label: step.label, duration: round(step.duration) });
    };
  };
  /** Steps of station 1's own queue. */
  const hookOilCycle = (cycle, clock, steps) => {
    const begin = cycle.beginNextStep.bind(cycle);
    cycle.beginNextStep = () => {
      begin();
      const s = cycle.active;
      steps.push({ t: round(clock.t), state: s.state, label: s.label, duration: round(s.duration) });
    };
  };
  /** States of station 3's state machine, with the fixed time each was given (null: until an event). */
  const hookStation3 = (cycle, clock, steps) => {
    const wrap = (name, durationOf) => {
      const original = cycle[name].bind(cycle);
      cycle[name] = (...args) => {
        const result = original(...args);
        steps.push({ t: round(clock.t), state: cycle.state, label: name, duration: durationOf(args) });
        return result;
      };
    };
    wrap('beginMove', (a) => round(a[2]));
    wrap('beginHold', (a) => round(a[1]));
    wrap('animateClaw', (a) => round(a[2]));
    wrap('beginOutboundTween', (a) => round(a[2]));
  };

  const result = {
    about: 'Recorded from the reference lubricant line (3D-Digital-Twin-Visualization-Tool, branch station-agent) by scripts/reference-timing-lubricant.mjs. Do not edit by hand. Station 3 ran with the same robot model and rig, the stretch wrapper stubbed (its wrap is a fixed 12 s step).',
    recordedAt: new Date().toISOString().slice(0, 10),
    dt: DT,
    stations: {},
    line: null,
  };

  // ---- Station 1 stand-alone (the factory's can), 8 batches out. -------------------------------
  {
    const s1 = new OilFillingStation({ scene: fakeScene(), renderer: null, cameraManager: NO_CAMERA, controls: null, definition: FACTORY_STATION1_DEFINITION });
    s1.build();
    s1.root.visible = true;
    const clock = { t: 0 };
    const steps = [];
    hookOilCycle(s1.cycle, clock, steps);
    s1.startCycle();
    const batches = 8;
    const cansPerBatch = FACTORY_STATION1_DEFINITION.line.cansPerBatch;
    while (s1.cycle.status.outputCount < batches * cansPerBatch && clock.t < 5000) { s1.update(DT); clock.t += DT; }
    if (s1.cycle.status.outputCount < batches * cansPerBatch) throw new Error(`station 1: ${s1.cycle.status.outputCount} cans out by ${clock.t} s`);
    result.stations.s1 = { run: `${batches} batches of ${cansPerBatch} cans out`, finished: round(clock.t), status: { ...s1.cycle.status }, steps: fold(steps) };
    console.log(`station 1: ${batches} batches out at ${clock.t.toFixed(2)} s over ${steps.length} steps (cycles ${s1.cycle.status.cycles})`);
  }

  // ---- Station 2 stand-alone, 6 cases closed. ----------------------------------------------------
  {
    const s2 = new CasePackingStation({ scene: fakeScene(), renderer: null, cameraManager: NO_CAMERA, controls: null });
    s2.build();
    s2.root.visible = true;
    const clock = { t: 0 };
    const steps = [];
    hookSequencer(s2.cycle.sequencer, clock, steps);
    s2.startCycle();
    const cases = 6;
    while ((s2.cycle.status.boxesCompleted ?? 0) < cases && clock.t < 5000) { s2.update(DT); clock.t += DT; }
    if ((s2.cycle.status.boxesCompleted ?? 0) < cases) throw new Error(`station 2: ${s2.cycle.status.boxesCompleted} cases by ${clock.t} s`);
    result.stations.s2 = { run: `${cases} cases completed`, finished: round(clock.t), status: { ...s2.cycle.status }, steps: fold(steps) };
    console.log(`station 2: ${cases} cases at ${clock.t.toFixed(2)} s over ${steps.length} steps`);
  }

  // ---- The whole factory to a finished pallet. ---------------------------------------------------
  {
    const factory = new LubricantFactory({ scene: fakeScene(), renderer: null });
    factory.build();
    await quiet(async () => factory.show(await robotAsset()))();
    const clock = { t: 0 };
    const s1 = []; const s2 = []; const s3 = []; const transfer = [];
    hookOilCycle(factory.s1.cycle, clock, s1);
    hookSequencer(factory.s2.cycle.sequencer, clock, s2);
    hookStation3(factory.s3.cycle, clock, s3);
    hookSequencer(factory.canSequencer, clock, transfer);
    const events = [];
    let last = { cases: 0, boxes: 0 };
    factory.start();
    console.log = () => {};
    console.info = () => {};
    while (factory.state !== 'FINISHED_PALLET' && clock.t < 20000) {
      factory.update(DT);
      clock.t += DT;
      const s = factory.status;
      if (s.casesPacked > last.cases) events.push({ t: round(clock.t), event: `case ${s.casesPacked} packed` });
      if (s.palletBoxes > last.boxes) events.push({ t: round(clock.t), event: `case ${s.palletBoxes} on the pallet` });
      last = { cases: s.casesPacked, boxes: s.palletBoxes };
    }
    console.log = say;
    console.info = sayInfo;
    if (factory.state !== 'FINISHED_PALLET') throw new Error(`factory: not finished by ${clock.t} s (${JSON.stringify(factory.status)})`);
    result.line = {
      finished: round(clock.t),
      status: factory.status,
      events,
      steps: { s1: fold(s1), s2: fold(s2), s3: fold(s3), canTransfer: fold(transfer) },
    };
    console.log(`factory: pallet of ${factory.status.palletBoxes} cases finished at ${clock.t.toFixed(1)} s (steps after folding the re-checks: s1 ${fold(s1).length}, s2 ${fold(s2).length}, s3 ${fold(s3).length}, transfer ${fold(transfer).length})`);
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(result)}\n`);
  console.log(`written ${out}`);
} finally {
  await server.close();
}
