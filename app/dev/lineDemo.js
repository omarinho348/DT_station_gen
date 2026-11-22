// Dev-only check scene for the line runtime: builds a factory.json (app/dev/lines/<name>.json under
// "factory", or spec/examples/<name>.factory.json) through compiler/expand.js and plays it with the
// generic Line (layout from lib/line/layout.js, stations chained through typed ports).
// Open with #/twin?demo=line (line "printer"); ?line=<name>, ?t=<s> frozen, ?speed=<n>, ?cam=x,y,z,tx,ty,tz.
// Nothing here knows a component or product by name (rule 6): it is all data.
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { Line } from '../../lib/line/index.js';
import { expandFactory } from '../../compiler/expand.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';

const LINES = Object.fromEntries(Object.entries(import.meta.glob('./lines/*.json', { eager: true, import: 'default' }))
  .map(([path, data]) => [path.match(/([^/]+)\.json$/)[1], data]));
// The hand-written example factories play here too.
for (const [path, factory] of Object.entries(import.meta.glob('../../spec/examples/*.factory.json', { eager: true, import: 'default' }))) {
  LINES[path.match(/([^/]+)\.factory\.json$/)[1]] = { factory, camera: null };
}

export const lineNames = () => Object.keys(LINES);

export function createLineDemo({ line: name = 'printer', speed = 1, onStatus } = {}) {
  const data = LINES[name];
  if (!data) throw new Error(`Unknown dev line "${name}" (lines: ${lineNames().join(', ')})`);
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = `lineDemo ${name}`;
  const expanded = expandFactory(registry, data.factory);
  const line = new Line({
    registry, line: expanded.line, ctx: { ...expanded.ctx, materials }, conventions: expanded.conventions,
    onUpdate: (l) => {
      const s = l.status;
      onStatus?.(`${s.state} · released ${s.released}/${s.runSize} · done ${s.exited} · `
        + l.layout.order.map((id) => `${id}: ${s.stations[id]}`).join('  |  '));
    },
  });
  root.add(line.root);
  const t = line.timing;
  console.info(`[lineDemo] ${name}: bottleneck ${t.bottleneck.station} ${t.bottleneck.cycleTime.toFixed(2)} s;`,
    Object.fromEntries(Object.entries(t.stations).map(([id, p]) => [id, Number(p.cycleTime.toFixed(2))])),
    'transfers', t.transfers.map((x) => Number(x.duration.toFixed(2))));
  line.setSpeed(speed);
  line.start();

  return {
    root,
    line,
    camera: data.camera ?? null,
    update(dt) {
      line.update(Math.min(dt, 0.1));
    },
    /** Jump ahead (screenshots of a given moment). */
    skip(seconds) {
      for (let left = seconds; left > 1e-9; left -= 0.05) line.update(Math.min(0.05, left));
      line.stations.forEach((s) => s.cycle.refresh(true));
    },
    dispose() {
      line.dispose();
      root.removeFromParent();
      disposeMaterials(materials);
    },
  };
}
