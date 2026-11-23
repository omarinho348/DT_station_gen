// Dev only: plays the hand-built REFERENCE printer line (3D-Digital-Twin-Visualization-Tool,
// branch station-agent) inside our viewer, so it can be screenshot from exactly the same camera, at
// exactly the same moment, under exactly the same lights as our compiled line (Phase 4's visual
// acceptance test, scripts/visual-compare.mjs). Open with #/twin?demo=reference (?t, ?speed, ?cam as
// for compiled lines).
//
// The sources come from the git-ignored, read-only export in reference/_src (see the header of
// scripts/reference-timing.mjs). They are found through import.meta.glob, so the app still builds
// and runs when the export is missing; this page then says so.
//
// The reference line's own StationEnvironment is NOT applied: our viewer already applies the same
// room environment (lib/core/environment.js is its port), and using one lighting set for both
// renders keeps the comparison about geometry and motion only.
import * as THREE from 'three';

const MODULES = import.meta.glob('../../reference/_src/src/station/printer-line/line/PrinterAssemblyLine.js');

export const hasReferenceLine = () => Object.keys(MODULES).length > 0;

/** Loads the reference line and starts it; resolves to a player like linePlayer.js's. */
export async function loadReferenceLine({ speed = 1, onStatus = null } = {}) {
  const [load] = Object.values(MODULES);
  if (!load) {
    throw new Error('Reference sources not found in reference/_src (export them as described in scripts/reference-timing.mjs)');
  }
  const { PrinterAssemblyLine } = await load();
  const holder = new THREE.Group();
  holder.name = 'reference line holder';
  const line = new PrinterAssemblyLine({ scene: holder, renderer: null });
  line.build();
  line.root.visible = true;
  line.reset();
  line.onUpdate = (l) => {
    const s = l.status ?? {};
    onStatus?.(`REFERENCE · ${l.state} · released ${l.released}/8 · `
      + l.stations.map((st, i) => `ST${i + 1}: ${st.cycle.status?.state ?? '?'}`).join('  |  ')
      + (s.pallet ? ` · pallet ${s.pallet}` : ''));
  };
  line.setSpeed(speed);
  line.start();

  return {
    root: holder,
    line,
    update(dt) {
      line.update(Math.min(dt, 0.1));
    },
    /** Jump ahead with the same 0.05 s steps as linePlayer.js's skip. */
    skip(seconds) {
      for (let left = seconds; left > 1e-9; left -= 0.05) line.update(Math.min(0.05, left));
      line.stations.forEach((station) => station.refreshPanel());
    },
    dispose() {
      line.reset();
      holder.removeFromParent();
      holder.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [o.material].flat()) {
          if (!m) continue;
          for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
          m.dispose();
        }
      });
    },
  };
}
