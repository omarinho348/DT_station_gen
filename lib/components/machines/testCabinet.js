// Test cabinet: a floor-standing tester (continuity, leak, function test…) with a display and
// status lamps, and a test lead that leaves from its front. Ported from the reference ST3
// WiringEquipment.js (createContinuityTester). Origin at floor, centre; the front faces +Z.
// The lead itself is a cable between the `testLead` port and the unit under test; it moves with
// the process, so the station runtime draws it (Phase 3), not this component.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const LAMPS = [
  { key: 'pass', color: 0x39d353, name: 'Pass lamp' },
  { key: 'fail', color: 0xe5372b, name: 'Fail lamp' },
  { key: 'testing', color: 0xf2a516, name: 'Test lamp' },
];

defineComponent({
  type: 'testCabinet',
  category: 'machine',
  summary: 'Floor-standing test cabinet (continuity, function test) with display, pass / fail / testing lamps and a test lead.',
  params: z.object({
    width: z.number().min(0.4).max(0.9).default(0.5).describe('Width (m)'),
    height: z.number().min(0.7).max(1.6).default(0.9).describe('Height (m)'),
    depth: z.number().min(0.3).max(0.8).default(0.4).describe('Depth (m)'),
  }),
  footprint: (p) => ({ x: [-p.width / 2, p.width / 2], z: [-p.depth / 2, p.depth / 2 + 0.02], height: p.height + 0.205 }),
  mount: 'floor',
  // Where the test lead leaves the cabinet (reference: front face at 0.9 m).
  ports: (p) => ({ testLead: { position: [0, p.height, p.depth / 2], direction: 'work', carries: 'unit' } }),
  motions: { status: { values: ['idle', 'testing', 'pass', 'fail'] } },
  build({ params, materials }) {
    const { width, height, depth } = params;
    const root = group(null, 'testCabinet');
    roundedBox(root, [width, height, depth], [0, height / 2, 0], materials.machineGrey, 'Tester cabinet', 0.02);
    // Display panel above the front: reference 0.42 × 0.25 at 0.98 m, standing on the cabinet top.
    const panelH = 0.25;
    roundedBox(root, [width - 0.08, panelH, 0.02], [0, height + 0.205 - panelH / 2, depth / 2 - 0.05], materials.darkPanel, 'Tester display', 0.01);
    const lampY = height - 0.15;
    const lamps = LAMPS.map((l, i) => {
      const material = createLampMaterial(l.color);
      material.name = `${l.key} lamp`;
      cylinder(root, 0.03, 0.02, [(i - 1) * 0.1, lampY, depth / 2 + 0.005], material, l.name, { axis: 'z', segments: 16 });
      return { ...l, material };
    });
    return {
      root,
      motions: {
        status: (mode) => lamps.forEach((l) => setLamp(l.material, l.key === mode)),
      },
    };
  },
});
