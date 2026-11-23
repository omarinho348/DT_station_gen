// Dev-only check scene for the line runtime: builds a factory.json (app/dev/lines/<name>.json under
// "factory", or spec/examples/<name>.factory.json) through compiler/expand.js and plays it with the
// generic Line (layout from lib/line/layout.js, stations chained through typed ports). This plays
// the IR directly; the compiled files of a line play at #/twin?line=<folder> (compiledLines.js).
// Open with #/twin?demo=line (line "printer"); ?line=<name>, ?station=<id> (that station alone, fed
// stand-alone), ?t=<s> frozen, ?speed=<n>, ?cam=x,y,z,tx,ty,tz.
// Nothing here knows a component or product by name (rule 6): it is all data.
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { Line } from '../../lib/line/index.js';
import { expandFactory } from '../../compiler/expand.js';
import { createMaterials } from '../../lib/core/materials.js';
import { playLine } from '../pages/twin/linePlayer.js';
import { preloadComponentAssets } from '../../lib/core/assets.js';

const LINES = Object.fromEntries(Object.entries(import.meta.glob('./lines/*.json', { eager: true, import: 'default' }))
  .map(([path, data]) => [path.match(/([^/]+)\.json$/)[1], data]));
// The hand-written example factories play here too.
for (const [path, factory] of Object.entries(import.meta.glob('../../spec/examples/*.factory.json', { eager: true, import: 'default' }))) {
  LINES[path.match(/([^/]+)\.factory\.json$/)[1]] = { factory, camera: null };
}

export const lineNames = () => Object.keys(LINES);

/** Loads the model assets any component may need (call before createLineDemo). */
export const preloadLineAssets = () => preloadComponentAssets(registry);

export function createLineDemo({ line: name = 'printer', station = null, speed = 1, onStatus } = {}) {
  const data = LINES[name];
  if (!data) throw new Error(`Unknown dev line "${name}" (lines: ${lineNames().join(', ')})`);
  const materials = createMaterials();
  const expanded = expandFactory(registry, data.factory);
  let lineData = expanded.line;
  if (station) {
    if (!lineData.stations.some((s) => s.id === station)) throw new Error(`Line "${name}" has no station "${station}"`);
    lineData = { ...lineData, stations: lineData.stations.filter((s) => s.id === station), edges: [] };
  }
  const line = new Line({ registry, line: lineData, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions });
  return { ...playLine(line, { materials, name, speed, onStatus }), camera: data.camera ?? null };
}
