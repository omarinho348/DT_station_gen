// Case erector: a housing that folds flat carton blanks into open cases and puts them on the
// carton line, with a magazine of flat blanks beside it. Ported from the reference ST6
// PackagingEquipment.js (CaseErector). Origin on the floor at the housing centre; erected cases
// leave through the +X face at the line's belt height.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, roundedBox } from '../../core/primitives.js';

const HOUSING = [0.8, 1.5, 0.9];
const LEGS = 0.25; // the reference housing started 0.25 m above the floor, on nothing
const MAGAZINE = 0.05;
const BLANK = 0.008;

const magazineZ = (p) => -(HOUSING[2] / 2 + p.blankWidth / 2 + 0.03);

defineComponent({
  type: 'caseErector',
  category: 'machine',
  summary: 'Case erector that folds flat carton blanks into open cases, with a blank magazine beside it.',
  params: z.object({
    blanks: z.number().int().min(0).max(20).default(8).describe('Flat blanks in the magazine'),
    blankLength: z.number().min(0.4).max(1.2).default(0.75).describe('Blank length along X (m)'),
    blankWidth: z.number().min(0.4).max(1.4).default(1.05).describe('Blank width along Z (m)'),
  }),
  footprint: (p) => {
    const magX = p.blankLength / 2 + 0.02;
    return {
      x: [Math.min(-HOUSING[0] / 2, -0.1 - magX), Math.max(HOUSING[0] / 2, -0.1 + magX)],
      z: [magazineZ(p) - p.blankWidth / 2 - 0.02, HOUSING[2] / 2 + 0.002],
      height: LEGS + HOUSING[1],
    };
  },
  mount: 'floor',
  ports: (p, ctx) => ({ output: { position: [HOUSING[0] / 2, ctx.beltHeight, 0], direction: 'out', carries: 'case' } }),
  build({ params, materials }) {
    const { blanks, blankLength, blankWidth } = params;
    const root = group(null, 'caseErector');
    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      box(root, [0.06, LEGS, 0.06], [sx * (HOUSING[0] / 2 - 0.06), LEGS / 2, sz * (HOUSING[2] / 2 - 0.06)], materials.frame, 'Erector leg');
    }));
    roundedBox(root, HOUSING, [0, LEGS + HOUSING[1] / 2, 0], materials.machineWhite, 'Erector housing', 0.02);
    addMesh(root, new THREE.PlaneGeometry(0.6, 0.5), materials.guard, 'Erector window', [0, 1.2, HOUSING[2] / 2 + 0.001], { castShadow: false });
    // Blank magazine beside the housing (the reference stack ran through the housing and hovered
    // 5 cm above the floor).
    const mz = magazineZ(params);
    box(root, [blankLength + 0.04, MAGAZINE, blankWidth + 0.04], [-0.1, MAGAZINE / 2, mz], materials.frameDark, 'Blank magazine');
    for (let i = 0; i < blanks; i += 1) {
      box(root, [blankLength, BLANK, blankWidth], [-0.1, MAGAZINE + BLANK / 2 + i * (BLANK + 0.001), mz], materials.cardboard, 'Flat carton blank');
    }
    return { root, motions: {} };
  },
});
