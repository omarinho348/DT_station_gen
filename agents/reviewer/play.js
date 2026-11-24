// The reviewer's play check (Claude.md §7.3 "reach checks", step 7.3): the line plays its run
// headless, as the twin will. The dry plan already checks every value an op names; what it cannot
// check are targets worked out when a step starts (a part's seat, a screw hole, a pallet slot: the
// points named ops aim robots and gantries at). Those are checked here, where they are worked out:
//   - a station that stops in ALARM (a target out of reach, an item that isn't there) is an error at
//     the op that failed, when its step label names it (its label or its name), otherwise at the station
//   - a run that does not finish (units stuck: a station waiting for something that never comes) or
//     loses units is an error at "(line)", naming the stations still holding units
//   - a run that finishes is a note with its time against the estimate
// Deterministic: fixed time steps, quality by serial (rule 5), so the same file plays the same way.
import { Line } from '../../lib/line/Line.js';
import { createMaterials } from '../../lib/core/materials.js';
import { stationOps } from './deterministic.js';

/**
 * The op a step came from: the one whose label it is, else the one whose `name` the step label
 * carries (named ops label their steps from it: "Moving to Z motor assy"; the longest such name).
 */
export function opOfStep(ops, label) {
  const byLabel = ops.find((o) => o.op?.label === label);
  if (byLabel) return byLabel;
  const named = ops.filter((o) => typeof o.op?.name === 'string' && o.op.name && label.includes(o.op.name));
  return named.sort((a, b) => b.op.name.length - a.op.name.length)[0] ?? null;
}

/** Time step of the headless run (s); the tests that play lines use the same. */
export const STEP = 0.05;

let sharedMaterials = null;

/**
 * Plays the line of an expanded factory.json and returns its findings.
 * @param {object} registry
 * @param {object} factory   the parsed factory.json
 * @param {object} expanded  expandFactory's result ({ line, ctx, conventions })
 * @param {object} timing    lineTiming's result (the run time estimate)
 * @param {object} [o]       { step, limit: simulated seconds (default 2 × the estimate + 120) }
 */
export function reviewPlay(registry, factory, expanded, timing, { step = STEP, limit } = {}) {
  const { line: data, ctx, conventions } = expanded;
  const original = (id) => data.stations.find((s) => s.id === id)?.copyOf ?? id;
  const indexOf = (id) => factory.stations.findIndex((s) => s.id === original(id));
  let line;
  try {
    sharedMaterials ??= createMaterials();
    line = new Line({ registry, line: data, ctx: { ...ctx, materials: sharedMaterials }, conventions });
  } catch (error) {
    if (/needs its model loaded first/.test(error.message)) {
      return [{ check: 'play', severity: 'info', path: '(line)', message: `run not played: ${error.message.replace(/: await .*$/, '')}`, hint: 'preload the models first (preloadComponentAssets in lib/core/assets.js); npm run review does' }];
    }
    return [{ check: 'play', severity: 'error', path: '(line)', message: `the line does not build headless: ${error.message}` }];
  }
  const estimate = timing?.runTime ?? 0;
  const until = limit ?? 2 * estimate + 120;
  try {
    line.start();
    let t = 0;
    let faulted = null;
    for (; t < until && line.state !== 'FINISHED'; t += step) {
      line.update(step);
      faulted = line.stations.find((s) => s.cycle.error);
      if (faulted) break;
    }
    const runSize = line.spec.runSize;
    if (faulted) {
      const i = indexOf(faulted.id);
      const message = faulted.cycle.error.message;
      const label = /^step "([^"]+)"/.exec(message)?.[1];
      const op = label ? opOfStep(stationOps(factory.stations[i], `stations[${i}]`), label) : null;
      const reach = /cannot reach (\w+) = ([-\d.e]+) \(range \[([^\]]+)\]\)/.exec(message);
      return [{
        check: 'play', severity: 'error', path: op?.path ?? `stations[${i}]`,
        message: `station "${faulted.id}" stopped in ALARM at ${t.toFixed(1)} s of the run (unit ${line.status.released} of ${runSize} released): ${message}`,
        ...(reach
          ? { hint: `the target is worked out from the product and the station layout: move the machine closer to it (equipment position), or pick one with a longer ${reach[1]} (reaches [${reach[3]}])` }
          : {}),
      }];
    }
    if (line.state !== 'FINISHED') {
      const holding = line.stations.filter((s) => s.cycle.unit).map((s) => `"${s.id}" (${s.cycle.status.state}${s.cycle.status.step ? `: ${s.cycle.status.step}` : ''})`);
      return [{
        check: 'play', severity: 'error', path: '(line)',
        message: `the run of ${runSize} did not finish in ${until.toFixed(0)} s (estimated ${estimate.toFixed(0)} s): ${line.status.released} released, ${line.exited} left the line${holding.length ? `; units held at ${holding.join(', ')}` : ''}`,
        hint: 'a station is waiting for something that never comes (a port nothing feeds, a buffer that never empties): check the graph and the ports',
      }];
    }
    if (line.exited !== runSize) {
      return [{ check: 'play', severity: 'error', path: '(line)', message: `the run finished with ${line.exited} of ${runSize} units out of the line` }];
    }
    return [{ check: 'play', severity: 'info', path: '(line)', message: `played a run of ${runSize}: every unit left the line after ${t.toFixed(1)} s (estimated ${estimate.toFixed(1)} s)` }];
  } finally {
    line.dispose?.();
  }
}
