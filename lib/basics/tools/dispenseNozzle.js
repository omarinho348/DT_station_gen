// Basic tool: a dispensing nozzle (valve body, needle tip) for liquids, glue or sealant. Origin at
// the TOOL POINT, the nozzle tip; the mounting face is on top (footprint height), as for every tool.
// Motion `flow` (0 … 1): the stream below the tip, from nothing to its full `jetLength`.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const BODY = 0.09;
const NEEDLE = 0.05;

export const LIQUID_COLORS = { oil: 0xc8901c, water: 0x8fc9e8, glue: 0xf2efe4, sealant: 0x3a3f44 };

defineComponent({
  type: 'dispenseNozzle',
  category: 'tool',
  summary: 'Basic dispensing nozzle: valve body and needle tip; the stream below the tip follows the flow.',
  params: z.object({
    jetLength: z.number().min(0.02).max(0.6).default(0.12).describe('Stream length at full flow (m)'),
    liquid: z.enum(Object.keys(LIQUID_COLORS)).default('oil').describe('What it dispenses (stream colour)'),
  }),
  footprint: (p) => ({ x: [-0.035, 0.035], z: [-0.035, 0.035], height: NEEDLE + BODY + 0.012, bottom: -p.jetLength }),
  mount: 'tool',
  motions: { flow: { range: [0, 1], default: 0 } },
  build({ params: p, materials }) {
    const root = group(null, 'dispenseNozzle');
    cylinder(root, 0.004, NEEDLE, [0, NEEDLE / 2, 0], materials.stainless, 'Needle', { radiusBottom: 0.0025, segments: 12 });
    roundedBox(root, [0.05, BODY, 0.05], [0, NEEDLE + BODY / 2, 0], materials.machineGrey, 'Valve body', 0.006);
    cylinder(root, 0.03, 0.012, [0, NEEDLE + BODY + 0.006, 0], materials.stainless, 'Mounting flange', { segments: 20 });
    const lamp = createLampMaterial(0x2ecc59);
    cylinder(root, 0.006, 0.006, [0.028, NEEDLE + BODY * 0.7, 0], lamp, 'Valve lamp', { axis: 'x', segments: 10 });
    const liquid = new THREE.MeshStandardMaterial({ color: LIQUID_COLORS[p.liquid], roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85 });
    liquid.name = `liquid ${p.liquid}`;
    // The stream: a unit-length cylinder hanging from the tip, scaled to the flow.
    const holder = group(root, 'Stream holder');
    const stream = cylinder(holder, 0.0025, 1, [0, -0.5, 0], liquid, 'Stream', { segments: 10 });
    const set = (v) => {
      holder.scale.y = Math.max(1e-3, v) * p.jetLength;
      stream.visible = v > 0;
      setLamp(lamp, v > 0);
    };
    set(0);
    return { root, motions: { flow: set } };
  },
});
