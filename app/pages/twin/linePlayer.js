// Plays a built Line in the twin page: status text for the HUD, frame updates, jumping to a moment
// (screenshots) and cleanup. Used for compiled lines (generated/<line>/line.js) and the dev line demo.
import * as THREE from 'three';
import { disposeMaterials } from '../../../lib/core/materials.js';

/**
 * @param {object} line          a lib/line/Line.js instance
 * @param {object} o
 * @param {object} o.materials   the materials the line was built with (disposed with it)
 * @param {string} o.name        shown in the console timing line
 * @param {number} [o.speed]
 * @param {Function} [o.onStatus] (text) on every update
 */
export function playLine(line, { materials, name, speed = 1, onStatus = null }) {
  const root = new THREE.Group();
  root.name = `line player ${name}`;
  root.add(line.root);
  line.onUpdate = (l) => {
    const s = l.status;
    onStatus?.(`${s.state} · released ${s.released}/${s.runSize} · done ${s.exited} · `
      + l.layout.order.map((id) => `${id}: ${s.stations[id]}`).join('  |  '));
  };
  const t = line.timing;
  console.info(`[line] ${name}: bottleneck ${t.bottleneck.station} ${t.bottleneck.cycleTime.toFixed(2)} s;`,
    Object.fromEntries(Object.entries(t.stations).map(([id, p]) => [id, Number(p.cycleTime.toFixed(2))])),
    'transfers', t.transfers.map((x) => Number(x.duration.toFixed(2))));
  line.setSpeed(speed);
  line.start();

  return {
    root,
    line,
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
