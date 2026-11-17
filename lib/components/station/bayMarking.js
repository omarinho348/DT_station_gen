// Bay marking: a translucent coloured rectangle painted on the floor (dispatch bay, reject bay,
// buffer area). From the reference ST6 "Dispatch bay marking" (and ST5's reject bay). Origin at
// its centre on the floor.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh } from '../../core/primitives.js';

const COLORS = { green: 0x2f9a4a, red: 0xb8302a, yellow: 0xd9a21e, blue: 0x2f6fb8 };

defineComponent({
  type: 'bayMarking',
  category: 'station',
  summary: 'Translucent coloured floor marking for a bay (dispatch, reject, buffer area).',
  params: z.object({
    length: z.number().min(0.3).max(8).default(1.55).describe('Length along X (m)'),
    width: z.number().min(0.3).max(8).default(1.45).describe('Width along Z (m)'),
    color: z.enum(['green', 'red', 'yellow', 'blue']).default('green').describe('Colour'),
  }),
  footprint: (p) => ({ x: [-p.length / 2, p.length / 2], z: [-p.width / 2, p.width / 2], height: 0.004 }),
  mount: 'floor',
  build({ params }) {
    const root = group(null, 'bayMarking');
    const paint = new THREE.MeshStandardMaterial({ color: COLORS[params.color], roughness: 0.8, transparent: true, opacity: 0.3, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    paint.name = 'bay paint';
    const mesh = addMesh(root, new THREE.PlaneGeometry(params.length, params.width).rotateX(-Math.PI / 2), paint, 'Bay marking', [0, 0.002, 0], { castShadow: false });
    mesh.receiveShadow = true;
    return { root, motions: {} };
  },
});
