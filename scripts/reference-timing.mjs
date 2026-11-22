// Records the reference printer line's timing: runs the hand-built reference cycles headless and
// writes every step they play (state, label, duration) to
// benchmarks/expected/printer-line-reference-timing.json. That file is what Phase 4's acceptance
// test compares the compiled line against, so the comparison never depends on hand-copied numbers.
//
//   node scripts/reference-timing.mjs
//
// Needs the reference sources exported (read-only) into the git-ignored reference/_src:
//   git -C <reference repo> archive station-agent src/station src/motion | tar -x -C reference/_src
// The reference repo itself is never touched. Only its canvas use needs a stub (no DOM in Node).
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(root, 'reference/_src/src/station/printer-line');
const out = resolve(root, 'benchmarks/expected/printer-line-reference-timing.json');
if (!existsSync(src)) {
  console.error(`Reference sources not found at ${src}. Export them first (see the header of this script).`);
  process.exit(1);
}

// ---- Minimal canvas stub: every 2D context call is accepted and does nothing. ------------------
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

const load = (rel) => import(pathToFileURL(resolve(src, rel)).href);

const STATIONS = [
  ['st1', 'st1-kitting/KittingStation.js', 'buildKittingStation', 'st1-kitting/KittingCycle.js', 'KittingCycle'],
  ['st2', 'st2-frame/FrameAssemblyStation.js', 'buildFrameStation', 'st2-frame/FrameAssemblyCycle.js', 'FrameAssemblyCycle'],
  ['st3', 'st3-wiring/WiringStation.js', 'buildWiringStation', 'st3-wiring/WiringCycle.js', 'WiringCycle'],
  ['st4', 'st4-calibration/CalibrationStation.js', 'buildCalibrationStation', 'st4-calibration/CalibrationCycle.js', 'CalibrationCycle'],
  ['st5', 'st5-inspection/InspectionStation.js', 'buildInspectionStation', 'st5-inspection/InspectionCycle.js', 'InspectionCycle'],
  ['st6', 'st6-packaging/PackagingStation.js', 'buildPackagingStation', 'st6-packaging/PackagingCycle.js', 'PackagingCycle'],
];

const DT = 0.02;
const round = (v) => Math.round(v * 1e6) / 1e6;

/** Hooks a cycle's sequencer: records every step with the unit it belongs to and its start time. */
function recorder(cycle, clock) {
  const steps = [];
  const before = cycle.sequencer.onStepStart;
  cycle.sequencer.onStepStart = (step) => {
    before?.(step);
    steps.push({ t: round(clock.t), unit: cycle.status.unit, state: step.state, label: step.label, duration: round(step.duration) });
  };
  return steps;
}

const { PRINTER_LINE } = await load('common/PrinterLineDefinition.js');
const runSize = PRINTER_LINE.runSize;
const result = {
  about: 'Recorded from the reference printer line (3D-Digital-Twin-Visualization-Tool, branch station-agent) by scripts/reference-timing.mjs. Do not edit by hand.',
  recordedAt: new Date().toISOString().slice(0, 10),
  conventions: { conveyor: PRINTER_LINE.conveyor, ports: PRINTER_LINE.ports, lift: PRINTER_LINE.lift, transferLength: PRINTER_LINE.transferLength, runSize },
  stations: {},
  line: null,
};

// ---- Each station stand-alone, a whole run of units. -------------------------------------------
for (const [id, stationFile, buildName, cycleFile, cycleName] of STATIONS) {
  const build = (await load(stationFile))[buildName];
  const Cycle = (await load(cycleFile))[cycleName];
  const parts = build();
  const clock = { t: 0 };
  const cycle = new Cycle({ parts, onUpdate: null });
  cycle.reset();
  const steps = recorder(cycle, clock);
  cycle.start();
  const done = () => (cycle.status.completed + (cycle.status.rejected ?? 0)) >= runSize;
  while (!done() && clock.t < 5000) {
    cycle.update(DT);
    clock.t += DT;
  }
  if (!done()) throw new Error(`${id}: run did not finish`);
  // A little longer, so the last unit's closing steps (lowering, shutter) are recorded too.
  for (let extra = 0; extra < 3; extra += DT) { cycle.update(DT); clock.t += DT; }
  // Per unit: a unit starts with the first step shown under its label (ST4 opens its entry shutter
  // before the carrier rises); steps under '—' (lowering, waiting) belong to the unit before.
  const units = [];
  for (const s of steps) {
    if (s.unit !== '—' && s.unit !== units.at(-1)?.unit) units.push({ unit: s.unit, start: s.t, steps: [] });
    units.at(-1)?.steps.push({ state: s.state, label: s.label, duration: s.duration });
  }
  units.forEach((u, i) => { u.period = round((units[i + 1]?.start ?? clock.t) - u.start); });
  units.splice(runSize); // the next run has started meanwhile
  result.stations[id] = {
    code: cycle.code,
    unitSteps: units[0].steps,
    unitTime: round(units[0].steps.reduce((sum, s) => sum + s.duration, 0)),
    units: units.map((u) => ({ unit: u.unit, period: u.period, time: round(u.steps.reduce((sum, s) => sum + s.duration, 0)), stepCount: u.steps.length, steps: u.steps })),
  };
  console.log(`${id} ${cycle.code}: unit 1 = ${result.stations[id].unitTime.toFixed(2)} s over ${units[0].steps.length} steps`);
}

// ---- The whole line, one run. ----------------------------------------------------------------
{
  const { PrinterAssemblyLine } = await load('line/PrinterAssemblyLine.js');
  const scene = { add() {}, remove() {} };
  const line = new PrinterAssemblyLine({ scene, renderer: null });
  line.build();
  line.root.visible = true;
  const clock = { t: 0 };
  const exits = [];
  let last = { dispatched: 0, rejected: 0 };
  line.start();
  while (line.state !== 'FINISHED' && clock.t < 20000) {
    line.update(DT);
    clock.t += DT;
    const { dispatched, rejected } = line.counts;
    if (dispatched > last.dispatched) exits.push({ t: round(clock.t), exit: 'dispatched' });
    if (rejected > last.rejected) exits.push({ t: round(clock.t), exit: 'rejected' });
    last = { dispatched, rejected };
  }
  if (line.state !== 'FINISHED') throw new Error('line run did not finish');
  const gaps = exits.slice(1).map((e, i) => round(e.t - exits[i].t));
  result.line = {
    finished: round(clock.t),
    exits,
    transferDuration: round(line.transfers[0].duration),
    note: `Times are quantised to the ${DT} s recording step.`,
    exitGaps: gaps,
  };
  console.log(`line: run of ${runSize} finished at ${clock.t.toFixed(1)} s; exits at ${exits.map((e) => e.t.toFixed(1)).join(', ')}`);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(`written ${out}`);
