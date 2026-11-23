// Basic tool: a laser head (marking, cutting or welding) with its focusing optic, looking down.
// Origin at the TOOL POINT, the nozzle exit; mounting face on top. Motion `beam` (0 … 1): the beam
// from the nozzle down to the focus `focusDistance` below it, brighter as the power rises.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox, box } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const NOZZLE = 0.03;
const OPTIC = 0.08;
const SOURCE = 0.12;

const BEAM_COLORS = { red: 0xff3b30, green: 0x39ff6a, infrared: 0xff9a5a };

defineComponent({
  type: 'laserHead',
  category: 'tool',
  summary: 'Basic laser head (marking, cutting, welding): source, focusing optic and nozzle; the beam reaches the focus as it fires.',
  params: z.object({
    focusDistance: z.number().min(0.005).max(0.5).default(0.15).describe('Nozzle exit to the focus (m)'),
    beamColor: z.enum(Object.keys(BEAM_COLORS)).default('red').describe('How the beam is drawn'),
  }),
  footprint: (p) => ({ x: [-0.06, 0.06], z: [-0.05, 0.05], height: NOZZLE + OPTIC + SOURCE + 0.012, bottom: -p.focusDistance }),
  mount: 'tool',
  motions: { beam: { range: [0, 1], default: 0 } },
  build({ params: p, materials }) {
    const root = group(null, 'laserHead');
    cylinder(root, 0.012, NOZZLE, [0, NOZZLE / 2, 0], materials.brushed, 'Nozzle', { radiusBottom: 0.005, segments: 16 });
    cylinder(root, 0.03, OPTIC, [0, NOZZLE + OPTIC / 2, 0], materials.machineGrey, 'Focusing optic', { segments: 24 });
    roundedBox(root, [0.1, SOURCE, 0.09], [0, NOZZLE + OPTIC + SOURCE / 2, 0], materials.darkPanel, 'Laser source', 0.008);
    box(root, [0.02, 0.02, 0.004], [0.03, NOZZLE + OPTIC + SOURCE * 0.7, 0.047], materials.safetyYellow, 'Laser warning label');
    box(root, [0.1, 0.012, 0.09], [0, NOZZLE + OPTIC + SOURCE + 0.006, 0], materials.stainless, 'Mounting plate');
    const glow = createLampMaterial(BEAM_COLORS[p.beamColor]);
    glow.name = 'laser beam';
    const beam = new THREE.Mesh(new THREE.ConeGeometry(0.004, p.focusDistance, 10, 1, true).rotateX(Math.PI), glow);
    beam.name = 'Beam';
    beam.position.y = -p.focusDistance / 2; // converges to the focus point
    root.add(beam);
    const set = (v) => {
      beam.visible = v > 0;
      setLamp(glow, v > 0, 1 + 2 * v);
    };
    set(0);
    return { root, motions: { beam: set } };
  },
});
