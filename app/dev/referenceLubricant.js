// Dev only: plays the hand-built REFERENCE lubricant factory (3D-Digital-Twin-Visualization-Tool,
// LubricantFactory: stations 1–3 with the can and case transfers, the supply racks and signs) inside
// our viewer, so it can be screenshot from the same camera, at the same moment and under the same
// lights as our compiled lubricant line (Phase 5 step 9d, scripts/visual-compare.mjs). Open with
// #/twin?demo=reference&line=lubricant-line (?t, ?speed, ?cam as for compiled lines).
//
// As app/dev/referenceLine.js (the printer line):
//   - the sources come from the git-ignored, read-only export in reference/_src, found through
//     import.meta.glob (the app still builds without it; this page then says so)
//   - the reference's own StationEnvironment is not applied (built without a renderer it does
//     nothing anyway); our viewer's room environment lights both renders
// Specific to this line:
//   - the stretch wrapper is ours in both renders (app/dev/referenceWrapStub.js, see vite.config.js)
//   - station 3's robot is the same IRB 6760 model, placed and rigged as the reference AssetManager
//     and rig do (as scripts/reference-timing-lubricant.mjs)
//   - the reference factory stays at the world origin: its station 3 mixes station-local and world
//     coordinates (checked: moved by our layout's offset, its robot never grips and the cases back
//     up). Our line is moved to stand where it stands instead (#/twin?...&shift=x,y,z,
//     scripts/visual-views.js), which our station-local runtime allows (rule 4).
//   - it is stepped as the timing recording was (0.02 s, world matrices brought up to date after
//     every update, as rendering does: the factory re-parents cans and cases keeping world poses)
import * as THREE from 'three';
import { loadAsset, instantiate } from '../../lib/core/assets.js';
import { registry } from '../../lib/components/index.js';
import factory from '../../spec/examples/lubricant-line.factory.json';

const FACTORY = import.meta.glob('../../reference/_src/src/station/factory/LubricantFactory.js');
const RIG = import.meta.glob('../../reference/_src/src/motion/Rig.js');
const IRB = import.meta.glob('../../reference/_src/src/rigs/abbIrb67*0.js'); // the reference IRB 6760 rig (a pattern: rule 6 keeps component names out of app/)
// The robot model: the one our station-3 robot uses (our lib/assets copy of the reference
// src/assets/robot.glb), found through the data, so no component is named here (rule 6).
const robotType = factory.stations.flatMap((s) => s.equipment ?? []).find((e) => e.id === 'robot')?.type;
const ROBOT_MODEL = robotType ? registry.getComponent(robotType).assets[0] : null;
const DT = 0.02; // the timing recording's step

export const hasReferenceLubricant = () => [FACTORY, RIG, IRB].every((m) => Object.keys(m).length > 0);

const first = async (modules) => {
  const [load] = Object.values(modules);
  if (!load) throw new Error('Reference lubricant sources not found in reference/_src (export them as described in scripts/reference-timing-lubricant.mjs)');
  return load();
};

/** The robot asset as the reference AssetManager builds it: root → orientation → content, rested on the floor, centred. */
async function robotAsset(Rig, definition) {
  await loadAsset(ROBOT_MODEL);
  const content = instantiate(ROBOT_MODEL);
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
  return { model, content, orientation, rig: new Rig({ root: model, content, definition }) };
}

/** Loads the reference factory and starts it; resolves to a player like linePlayer.js's. */
export async function loadReferenceLubricant({ speed = 1, onStatus = null } = {}) {
  const [{ LubricantFactory }, { Rig }, { ABB_IRB6760_RIG }] = await Promise.all([first(FACTORY), first(RIG), first(IRB)]);
  const holder = new THREE.Group();
  holder.name = 'reference lubricant factory holder';
  const line = new LubricantFactory({ scene: holder, renderer: null });
  line.build();
  holder.updateMatrixWorld(true);
  // The reference logs its placement checks; quiet while station 3 is built.
  const log = console.log;
  console.log = () => {};
  try {
    await line.show(await robotAsset(Rig, ABB_IRB6760_RIG));
  } finally {
    console.log = log;
  }
  line.onUpdate = (f) => {
    const s = f.status;
    onStatus?.(`REFERENCE · ${s.state} · S1 ${s.station1} | S2 ${s.station2} | S3 ${s.station3} · cases ${s.casesPacked} · pallet ${s.palletBoxes}/${s.palletTotal}`);
  };
  line.setSpeed(speed);
  holder.updateMatrixWorld(true);
  line.start();

  const step = (dt) => {
    console.log = () => {};
    try {
      line.update(dt);
    } finally {
      console.log = log;
    }
    holder.updateMatrixWorld(true);
  };
  return {
    root: holder,
    line,
    update(dt) {
      step(Math.min(dt, 0.1));
    },
    /** Jump ahead with the timing recording's 0.02 s steps. */
    skip(seconds) {
      for (let left = seconds; left > 1e-9; left -= DT) step(Math.min(DT, left));
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
