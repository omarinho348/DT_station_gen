// Basic tool: an industrial vision camera looking down (camera body, lens, ring light). Origin at
// the TOOL POINT, the lens front; mounting face on top. Motion `light`: the ring light off / on
// (flashes while an inspection takes its picture). `workingDistance` is where it is in focus: the
// ops aim the lens that far above what they look at (a dashed sight line shows it while lit).
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox, box } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const LENS = 0.05;
const BODY = 0.07;

defineComponent({
  type: 'visionCamera',
  category: 'tool',
  summary: 'Basic vision camera looking down: body, lens and a ring light that switches on for a picture.',
  params: z.object({
    workingDistance: z.number().min(0.05).max(1.5).default(0.3).describe('Lens front to the object in focus (m)'),
    ringRadius: z.number().min(0.03).max(0.15).default(0.05).describe('Ring light outer radius (m)'),
  }),
  footprint: (p) => {
    const half = Math.max(p.ringRadius, 0.04);
    return { x: [-half, half], z: [-half, half], height: LENS + BODY + 0.012, bottom: -p.workingDistance };
  },
  mount: 'tool',
  motions: { light: { values: ['off', 'on'] } },
  build({ params: p, materials }) {
    const root = group(null, 'visionCamera');
    const ring = createLampMaterial(0xe8f4ff);
    ring.name = 'ring light';
    const ringGeom = new THREE.TorusGeometry(p.ringRadius - 0.008, 0.008, 8, 32).rotateX(Math.PI / 2);
    const ringMesh = new THREE.Mesh(ringGeom, ring);
    ringMesh.name = 'Ring light';
    ringMesh.position.y = 0.008;
    root.add(ringMesh);
    // Spokes from the ring to the lens barrel hold it.
    for (const [i, a] of [0, Math.PI / 2, Math.PI, 1.5 * Math.PI].entries()) {
      const len = p.ringRadius - 0.008 - 0.016;
      const spoke = box(root, [len, 0.004, 0.006], [Math.cos(a) * (0.016 + len / 2), 0.008, -Math.sin(a) * (0.016 + len / 2)], materials.frameDark, `Ring spoke ${i + 1}`);
      spoke.rotation.y = a;
    }
    cylinder(root, 0.02, LENS, [0, LENS / 2, 0], materials.plasticBlack, 'Lens barrel', { segments: 20 });
    cylinder(root, 0.016, 0.002, [0, 0.001, 0], materials.lens, 'Lens glass', { segments: 20 });
    roundedBox(root, [0.06, BODY, 0.06], [0, LENS + BODY / 2, 0], materials.machineBlue, 'Camera body', 0.006);
    box(root, [0.07, 0.012, 0.07], [0, LENS + BODY + 0.006, 0], materials.stainless, 'Mounting plate');
    // Sight line to the focus plane, shown while lit.
    const sight = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -p.workingDistance, 0)]),
      new THREE.LineDashedMaterial({ color: 0x7fd8ff, dashSize: 0.02, gapSize: 0.015 }),
    );
    sight.computeLineDistances();
    sight.name = 'Sight line';
    root.add(sight);
    const set = (v) => {
      setLamp(ring, v === 'on', 2.2);
      sight.visible = v === 'on';
    };
    set('off');
    return { root, motions: { light: set } };
  },
});
