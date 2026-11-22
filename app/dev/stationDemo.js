// Dev-only check scene for the station runtime: builds the equipment listed in a station file
// (app/dev/stations/<name>.json) from the registry and plays the station stand-alone through the
// generic StationCycle (units rise from the return line, are worked, and are lowered away).
// Open with #/twin?demo=station (station "frame"); ?station=<name> picks another file.
// Nothing here knows a component or product by name (rule 6): it is all data.
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import '../../lib/products/index.js';
import '../../lib/ops/index.js';
import { StationCycle } from '../../lib/station/index.js';
import { createMaterials, disposeMaterials } from '../../lib/core/materials.js';

const STATIONS = Object.fromEntries(Object.entries(import.meta.glob('./stations/*.json', { eager: true, import: 'default' }))
  .map(([path, data]) => [path.match(/([^/]+)\.json$/)[1], data]));

export const stationNames = () => Object.keys(STATIONS);

export function createStationDemo({ station: name = 'frame', onStep } = {}) {
  const data = STATIONS[name];
  if (!data) throw new Error(`Unknown dev station "${name}" (stations: ${stationNames().join(', ')})`);
  const materials = createMaterials();
  const root = new THREE.Group();
  root.name = `stationDemo ${name}`;
  const equipment = {};
  for (const e of data.equipment) {
    const inst = registry.buildComponent(e.type, e.params, { materials });
    inst.root.position.fromArray(e.position);
    inst.root.rotation.y = e.rotationY ?? 0;
    root.add(inst.root);
    equipment[e.id] = inst;
  }
  const cycle = new StationCycle({
    registry, station: data.station, equipment, root, product: data.product, ctx: { materials },
    onUpdate: (c) => onStep?.(`${c.status.unit} · ${c.status.state} · ${c.status.step}`),
  });
  console.info(`[stationDemo] ${name}: cycle ${cycle.timing.cycleTime.toFixed(2)} s`
    + ` (intake ${cycle.timing.intake.duration.toFixed(2)}, process ${cycle.timing.process.duration.toFixed(2)}, output ${cycle.timing.output.duration.toFixed(2)})`);
  cycle.start();

  return {
    root,
    cycle,
    camera: data.camera ?? null,
    update(dt) {
      cycle.update(Math.min(dt, 0.1));
    },
    /** Jump ahead (screenshots of a given moment). */
    skip(seconds) {
      for (let left = seconds; left > 1e-9; left -= 0.05) cycle.update(Math.min(0.05, left));
      cycle.refresh(true);
    },
    dispose() {
      cycle.dispose();
      Object.values(equipment).forEach((e) => e.dispose());
      root.removeFromParent();
      disposeMaterials(materials);
    },
  };
}
