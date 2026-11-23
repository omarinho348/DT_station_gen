// Retro-reflective photo-eye across a conveyor: emitter / receiver with a status LED on the front
// (+Z) rod, reflector on the rear rod, the beam across the belt. Port of the reference station-1
// OilSensors.js (createPhotoEye). It stands on the conveyor's side frames: y = 0 is the frame top
// (mount `surface`), the rods are `span` apart, centred on the belt.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const ROD = 0.23;
const BEAM = 0.19; // beam height above the frame top (0.2 m above the belt on a belt conveyor)

defineComponent({
  type: 'photoEye',
  category: 'fixture',
  summary: 'Retro-reflective photo-eye across a conveyor on rods standing on its side frames; LED green while a unit breaks the beam.',
  params: z.object({
    span: z.number().min(0.2).max(1.2).default(0.4).describe('Distance between the rods: the side-frame spacing of the conveyor (m)'),
  }),
  footprint: (p) => ({ x: [-0.025, 0.025], z: [-(p.span / 2 + 0.02), p.span / 2 + 0.04], height: ROD }),
  mount: 'surface',
  motions: { beam: { values: ['clear', 'blocked'], default: 'clear' } },
  ops: [],
  build({ params, materials }) {
    const half = params.span / 2;
    const root = group(null, 'photoEye');
    [-1, 1].forEach((side) => cylinder(root, 0.008, ROD, [0, ROD / 2, side * half], materials.stainless, 'Mounting rod', { segments: 10 }));

    // Emitter / receiver on the outer face of the front rod.
    const head = group(root, 'Sensor head', [0, BEAM, half + 0.023]);
    roundedBox(head, [0.035, 0.055, 0.03], [0, 0, 0], materials.plasticBlack, 'Sensor housing', 0.005);
    cylinder(head, 0.011, 0.006, [0, 0.008, -0.016], materials.lens, 'Sensor lens', { axis: 'z', segments: 16 });
    // One LED material, recoloured: amber while the beam is clear, green while it is blocked.
    const LED = { clear: [0xf2a516, 0.9], blocked: [0x39d353, 1.8] };
    const lamp = createLampMaterial(LED.clear[0]);
    addMesh(head, new THREE.SphereGeometry(0.005, 10, 8), lamp, 'Status LED', [0, 0.031, 0.006], { castShadow: false });
    // The reference cable hung 2.5 cm below the housing; it leaves the housing's underside here.
    addMesh(head, new THREE.CylinderGeometry(0.003, 0.003, 0.12, 8), materials.rubber, 'Sensor cable', [0, -0.087, 0.008]);

    // Reflector on the outer face of the rear rod, facing the emitter.
    const reflector = group(root, 'Reflector', [0, BEAM, -(half + 0.012)]);
    roundedBox(reflector, [0.04, 0.04, 0.008], [0, 0, 0], materials.plasticBlack, 'Reflector frame', 0.003);
    const prism = new THREE.MeshStandardMaterial({ color: 0xc8302a, metalness: 0.3, roughness: 0.2 });
    prism.name = 'reflector prism';
    box(reflector, [0.032, 0.032, 0.002], [0, 0, 0.005], prism, 'Reflector prism');

    return {
      root,
      motions: {
        beam(v) {
          const [color, intensity] = LED[v];
          lamp.userData.baseColor.set(color);
          lamp.emissive.set(color);
          setLamp(lamp, true, intensity);
        },
      },
    };
  },
});
