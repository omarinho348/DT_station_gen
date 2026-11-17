// Closed enclosure over a conveyor section (test, laser, curing, inspection cells): aluminium
// frame, acrylic walls and roof, kick panels below the belt, an optional fume-extraction hood,
// and a lifting shutter at each end that rises for the carrier. Ported from the reference ST4
// CalibrationEquipment.js (TestEnclosure). Centred on the origin; the conveyor runs along X
// (entry at −X, exit at +X), the walkway is +Z.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, roundedBox } from '../../core/primitives.js';

const POST = 0.06;
const RAIL = 0.05;
const GUIDE = { x: 0.05, z: 0.02 };

function dims(p, ctx) {
  const halfX = p.length / 2;
  const halfZ = p.width / 2;
  const shutterBottom = ctx.beltHeight + 0.02;
  const shutterHeight = p.height - shutterBottom - 0.06;
  const kick = Math.max(0.2, ctx.beltHeight - 0.25); // 0.6 m at the 0.85 m belt (reference)
  return { halfX, halfZ, shutterBottom, shutterHeight, kick, guideTop: p.height + p.shutterRise + 0.02 };
}

defineComponent({
  type: 'shutterEnclosure',
  category: 'station',
  summary: 'Closed enclosure over a conveyor with acrylic walls, extraction hood and lifting entry / exit shutters.',
  params: z.object({
    length: z.number().min(1).max(4).default(1.64).describe('Length along X (m)'),
    width: z.number().min(0.6).max(2).default(1.12).describe('Width along Z (m)'),
    height: z.number().min(1.6).max(3).default(2.05).describe('Roof height (m)'),
    shutterRise: z.number().min(0.3).max(1.2).default(0.82).describe('Shutter lift (m)'),
    extraction: z.boolean().default(true).describe('Fume extraction hood'),
  }),
  footprint: (p, ctx) => {
    const d = dims(p, ctx);
    return {
      x: [-(d.halfX + POST / 2), d.halfX + POST / 2],
      z: [-(d.halfZ + POST / 2), d.halfZ + POST / 2],
      height: Math.max(d.guideTop, p.extraction ? p.height + 0.98 : p.height + RAIL / 2),
    };
  },
  mount: 'overConveyor',
  motions: {
    entryShutter: { range: [0, 1] }, // 0 closed, 1 fully raised
    exitShutter: { range: [0, 1] },
  },
  build({ params, materials, ...ctx }) {
    const { height, shutterRise, extraction } = params;
    const d = dims(params, ctx);
    const { halfX, halfZ } = d;
    const root = group(null, 'shutterEnclosure');
    const glass = (parent, w, h, position, rotateY, name) => {
      const geometry = new THREE.PlaneGeometry(w, h);
      if (rotateY) geometry.rotateY(rotateY);
      return addMesh(parent, geometry, materials.guard, name, position, { castShadow: false });
    };

    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      roundedBox(root, [POST, height, POST], [sx * halfX, height / 2, sz * halfZ], materials.aluminium, 'Enclosure post', 0.006);
    }));
    [-1, 1].forEach((sz) => box(root, [halfX * 2, RAIL, RAIL], [0, height, sz * halfZ], materials.aluminium, 'Roof rail'));
    [-1, 1].forEach((sx) => box(root, [RAIL, RAIL, halfZ * 2], [sx * halfX, height, 0], materials.aluminium, 'Roof rail'));
    glass(root, halfX * 2 - POST, height - 0.1, [0, height / 2, -halfZ], 0, 'Acrylic panel');
    const frontBottom = d.kick - 0.05;
    glass(root, halfX * 2 - POST, height - 0.05 - frontBottom, [0, (frontBottom + height - 0.05) / 2, halfZ], 0, 'Acrylic panel');
    const roof = addMesh(root, new THREE.PlaneGeometry(halfX * 2, halfZ * 2).rotateX(-Math.PI / 2), materials.guard, 'Roof panel', [0, height, 0], { castShadow: false });
    roof.renderOrder = 1;
    [-1, 1].forEach((sz) => box(root, [halfX * 2, d.kick, 0.01], [0, d.kick / 2, sz * halfZ], materials.darkPanel, 'Kick panel'));
    if (extraction) {
      roundedBox(root, [0.5, 0.18, 0.4], [0, height + 0.09, 0], materials.machineGrey, 'Extraction hood', 0.02);
      cylinder(root, 0.09, 0.8, [0, height + 0.58, 0], materials.brushed, 'Extraction duct', { segments: 20 });
    }

    // Shutters run in guide channels on the end posts. The guides reach above the roof by the
    // lift: a raised shutter stands above the enclosure, as on guillotine doors. (The reference
    // shutters had no guides: they floated 1 cm from the posts and rose through the roof rail.)
    const guideBottom = d.shutterBottom - 0.04;
    const shutters = [-1, 1].map((sx) => {
      [-1, 1].forEach((sz) => {
        const h = d.guideTop - guideBottom;
        box(root, [GUIDE.x, h, GUIDE.z], [sx * halfX, guideBottom + h / 2, sz * (halfZ - POST / 2 - GUIDE.z / 2)], materials.frameDark, 'Shutter guide');
      });
      const shutter = group(root, sx < 0 ? 'Entry shutter' : 'Exit shutter', [sx * halfX, 0, 0]);
      const span = halfZ * 2 - 0.08;
      box(shutter, [0.03, 0.04, span], [0, d.shutterBottom, 0], materials.frameDark, 'Shutter bottom rail');
      box(shutter, [0.03, 0.04, span], [0, d.shutterBottom + d.shutterHeight, 0], materials.frameDark, 'Shutter top rail');
      glass(shutter, span, d.shutterHeight, [0, d.shutterBottom + d.shutterHeight / 2, 0], Math.PI / 2, 'Shutter glass');
      return shutter;
    });

    return {
      root,
      motions: {
        entryShutter: (v) => { shutters[0].position.y = v * shutterRise; },
        exitShutter: (v) => { shutters[1].position.y = v * shutterRise; },
      },
    };
  },
});
