// Sheet-metal tunnel hood over a belt conveyor, closed at one end: units appear from it (infeed) or
// disappear into it (outfeed), so a line can start and end inside a station. Open at both ends
// (`open: 'both'`) it is a hood units pass through (the reference factory opened its tunnels so). Port of the reference
// station-1 OilConveyor.js (createConveyorTunnel). Centred on the origin, along X over a conveyor
// centred on z = 0.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, roundedBox } from '../../core/primitives.js';

const BELOW_BELT = 0.16; // walls reach this far below the belt, alongside the conveyor frames
const WALL = 0.025;
const STAND = 0.03;

// Wall centre lines. The reference's (belt / 2 + 0.07) put the walls 1 cm into a conveyor's
// drum bearing housings where the tunnel covers a conveyor end; these clear them by 5 mm.
const innerZOf = (p) => p.beltWidth / 2 + 0.09;

defineComponent({
  type: 'conveyorTunnel',
  category: 'conveyor',
  summary: 'Sheet-metal tunnel hood over a belt conveyor, closed at one end: units enter or leave the line through it.',
  params: z.object({
    length: z.number().min(0.5).max(4).default(1.9).describe('Length along X (m)'),
    beltWidth: z.number().min(0.15).max(1.0).default(0.34).describe('Width of the belt it covers (m)'),
    clearHeight: z.number().min(0.2).max(1.2).default(0.58).describe('Clear height above the belt (m)'),
    open: z.enum(['+X', '-X', 'both']).default('+X').describe('End with the product opening (the other end is closed), or both ends open (a hood)'),
  }),
  footprint: (p, ctx) => {
    const outer = innerZOf(p) + 0.025 + 0.02; // opening trim stands proud of the walls
    return { x: [-p.length / 2 - 0.015, p.length / 2 + 0.015], z: [-outer, outer], height: ctx.beltHeight + p.clearHeight + 0.0125 };
  },
  mount: 'overConveyor',
  ports: (p, ctx) => {
    if (p.open === 'both') {
      return {
        entry: { position: [-p.length / 2, ctx.beltHeight, 0], direction: 'in', carries: 'unit' },
        opening: { position: [p.length / 2, ctx.beltHeight, 0], direction: 'out', carries: 'unit' },
      };
    }
    const sign = p.open === '+X' ? 1 : -1;
    return { opening: { position: [sign * p.length / 2, ctx.beltHeight, 0], direction: sign > 0 ? 'out' : 'in', carries: 'unit' } };
  },
  motions: {},
  ops: [],
  build({ params, materials, beltHeight }) {
    const { length, clearHeight } = params;
    const innerZ = innerZOf(params);
    const bottom = beltHeight - BELOW_BELT;
    const top = beltHeight + clearHeight;
    const wallHeight = top - bottom;
    const root = group(null, 'conveyorTunnel');
    [-1, 1].forEach((side) => roundedBox(root, [length, wallHeight, WALL], [0, bottom + wallHeight / 2, side * innerZ], materials.brushed, 'Side wall', 0.006));
    roundedBox(root, [length + 0.02, 0.025, innerZ * 2 + 0.05], [0, top, 0], materials.brushed, 'Roof', 0.006);
    const openSides = params.open === 'both' ? [-1, 1] : [params.open === '+X' ? 1 : -1];
    if (openSides.length === 1) roundedBox(root, [WALL, wallHeight, innerZ * 2], [-openSides[0] * length / 2, bottom + wallHeight / 2, 0], materials.brushed, 'End wall', 0.006);
    // Safety-yellow trim around each product opening.
    for (const openSide of openSides) {
      const openX = openSide * length / 2;
      roundedBox(root, [0.03, 0.04, innerZ * 2 + 0.06], [openX, top - 0.02, 0], materials.safetyYellow, 'Opening trim top', 0.006);
      [-1, 1].forEach((side) => roundedBox(root, [0.03, wallHeight, 0.04], [openX, bottom + wallHeight / 2, side * (innerZ + 0.005)], materials.safetyYellow, 'Opening trim side', 0.006));
    }
    // Dark interior lining (a closed tunnel only: through an open hood one sees the units pass).
    if (openSides.length === 1) {
      const lining = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.9, metalness: 0.1, side: THREE.BackSide });
      lining.name = 'tunnel lining';
      addMesh(root, new THREE.BoxGeometry(length - 0.01, wallHeight - 0.04, innerZ * 2 - 0.03), lining, 'Interior lining', [0, bottom + wallHeight / 2, 0], { castShadow: false });
    }
    // Stands on the outer faces of the walls, clear of the conveyor's legs and feet. (The reference
    // walls hung beside the conveyor frames, touching nothing.)
    const standZ = innerZ + WALL / 2 + STAND / 2;
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      roundedBox(root, [STAND, bottom + 0.1, STAND], [sx * (length / 2 - 0.08), (bottom + 0.1) / 2, sz * standZ], materials.brushed, 'Stand', 0.004);
    }));
    return { root, motions: {} };
  },
});
