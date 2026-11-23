// Dev only: stands in for the reference lubricant factory's stretch wrapper (AssetWrapMachine.js)
// when the reference factory plays in our viewer (app/dev/referenceLubricant.js). The reference
// loads its wrapper from Wrapping.STEP through occt-import-js, which this project does not carry
// (owner's decision, PROGRESS.md: the wrapper is procedural). vite.config.js points the reference's
// import here.
//
// So both renders show the SAME wrapper: ours, built from the wrapper entry of
// spec/examples/lubricant-line.factory.json (found by its id, no component named here, rule 6).
// The interface and the bay sizes are the ones scripts/reference-timing-lubricant.mjs stubs, so the
// reference worker stops where it did when its timing was recorded.
import * as THREE from 'three';
import { registry } from '../../lib/components/index.js';
import { createMaterials } from '../../lib/core/materials.js';
import factory from '../../spec/examples/lubricant-line.factory.json';

const entry = factory.stations.flatMap((s) => s.equipment ?? []).find((e) => e.id === 'wrapper');

export async function createAssetWrapMachine() {
  if (!entry) throw new Error('referenceWrapStub: no "wrapper" equipment in lubricant-line.factory.json');
  const built = registry.buildComponent(entry.type, entry.params ?? {}, { materials: createMaterials() });
  let progress = 0;
  const set = (p) => {
    progress = p;
    built.set('wrap', p);
  };
  return {
    root: built.root,
    carriage: new THREE.Group(),
    rotorPivot: new THREE.Group(),
    filmRoot: new THREE.Group(),
    deckHeight: 0.44,
    bayLength: 3.67,
    bayWidth: 1.4,
    height: 2.1,
    references: { bayCenter: new THREE.Vector3(), inbound: new THREE.Vector3(-2.04, 0, 0), deck: new THREE.Vector3(0, 0.44, 0) },
    setWrapProgress: set,
    getWrapProgress: () => progress,
    resetWrap: () => set(0),
  };
}
