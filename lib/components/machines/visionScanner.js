// Vision scanning bridge: rails on four posts and a travelling arch with side and top cameras,
// LED light bars and a laser line, passing over the product on the conveyor (automated visual
// inspection). Ported from the reference ST5 InspectionEquipment.js (createScanner). Centred on
// the origin; the arch travels along X, the conveyor runs through it along X.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder, roundedBox } from '../../core/primitives.js';

const POST = 0.1;
const LIGHT_ON = 2.2;
const LIGHT_IDLE = 0.15;
const LASER_ON = 0.28;

defineComponent({
  type: 'visionScanner',
  category: 'machine',
  summary: 'Vision scanning bridge: travelling arch with side and top cameras, LED light bars and a laser line.',
  params: z.object({
    length: z.number().min(1.2).max(4).default(2.7).describe('Rail length along X (m)'),
    width: z.number().min(0.8).max(2.4).default(1.44).describe('Post spacing along Z (m)'),
    railHeight: z.number().min(1.6).max(3).default(2.05).describe('Rail height (m)'),
    archWidth: z.number().min(0.5).max(2).default(1.0).describe('Arch inner width (m)'),
    archBottom: z.number().min(0.9).max(2).default(1.0).describe('Lower end of the arch legs (m)'),
  }).superRefine((p, ctx) => {
    if (p.archWidth > p.width - 0.3) ctx.addIssue({ code: 'custom', path: ['archWidth'], message: 'the arch must fit between the posts' });
    if (p.archBottom > p.railHeight - 0.6) ctx.addIssue({ code: 'custom', path: ['archBottom'], message: 'arch legs must be at least 0.6 m long' });
  }),
  footprint: (p) => ({
    x: [-(p.length / 2 + POST / 2), p.length / 2 + POST / 2],
    z: [-(p.width / 2 + 0.07), p.width / 2 + 0.07],
    height: p.railHeight + 0.24,
  }),
  mount: 'overConveyor',
  motions: (p) => {
    const travel = p.length / 2 - 0.15;
    return {
      x: { range: [-travel, travel], default: -travel }, // arch position (m); parked at the entry end
      scan: { values: ['off', 'on'] }, // light bars and laser
    };
  },
  build({ params, materials, beltHeight }) {
    const { length, width, railHeight: railY, archWidth, archBottom } = params;
    const railX = length / 2;
    const railZ = width / 2;
    const archHalfZ = archWidth / 2;
    const root = group(null, 'visionScanner');
    // Own light / laser materials, so scanners switch independently (the reference changed the
    // shared lightBar material, lighting every scanner and light bar in the line at once).
    const light = new THREE.MeshStandardMaterial({ color: 0xdff8ff, emissive: 0x9feaff, emissiveIntensity: LIGHT_IDLE, metalness: 0, roughness: 0.3 });
    light.name = 'scanner light';
    const laser = new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    laser.name = 'scanner laser';

    [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
      roundedBox(root, [POST, railY, POST], [sx * railX, railY / 2, sz * railZ], materials.frame, 'Scanner post', 0.01);
    }));
    [-1, 1].forEach((sz) => roundedBox(root, [length + POST, 0.12, 0.1], [0, railY + 0.06, sz * railZ], materials.machineGrey, 'Scanner rail', 0.01));

    const arch = group(root, 'ScanArch');
    roundedBox(arch, [0.12, 0.12, width + 0.14], [0, railY + 0.18, 0], materials.machineWhite, 'Arch beam', 0.012);
    [-1, 1].forEach((sz) => {
      roundedBox(arch, [0.08, railY + 0.12 - archBottom, 0.06], [0, (railY + 0.12 + archBottom) / 2, sz * archHalfZ], materials.machineWhite, 'Arch leg', 0.01);
      box(arch, [0.05, 0.5, 0.02], [0.06, archBottom + 0.45, sz * (archHalfZ - 0.04)], light, 'Side light bar');
      const camera = group(arch, 'Side camera', [-0.06, archBottom + 0.32, sz * (archHalfZ - 0.05)]);
      roundedBox(camera, [0.06, 0.06, 0.09], [0, 0, 0], materials.plasticBlack, 'Camera body', 0.008);
      cylinder(camera, 0.02, 0.03, [0, 0, -sz * 0.055], materials.lens, 'Camera lens', { axis: 'z', segments: 16 });
    });
    // Top light bar against the beam's underside (the reference hung it 1 cm below, unattached).
    box(arch, [0.06, 0.02, archWidth - 0.1], [0.06, railY + 0.11, 0], light, 'Top light bar');
    [-0.22, 0.22].map((f) => f * archWidth / 1.0).forEach((zc) => {
      const camera = group(arch, 'Top camera', [-0.06, railY + 0.08, zc]);
      roundedBox(camera, [0.07, 0.09, 0.07], [0, 0, 0], materials.plasticBlack, 'Camera body', 0.008);
      cylinder(camera, 0.022, 0.03, [0, -0.06, 0], materials.lens, 'Camera lens', { segments: 16 });
    });
    // Laser line: an emitter under the beam and a thin sheet of red light down to the belt.
    roundedBox(arch, [0.05, 0.1, 0.05], [0, railY + 0.07, 0], materials.plasticBlack, 'Laser emitter', 0.006);
    const sheetTop = railY + 0.02;
    const sheetBottom = beltHeight + 0.025;
    const sheet = addMesh(arch, new THREE.PlaneGeometry(archWidth - 0.1, sheetTop - sheetBottom).rotateY(Math.PI / 2), laser, 'Laser sheet', [0, (sheetTop + sheetBottom) / 2, 0], { castShadow: false });
    sheet.receiveShadow = false;

    return {
      root,
      motions: {
        x: (v) => { arch.position.x = v; },
        scan: (v) => {
          light.emissiveIntensity = v === 'on' ? LIGHT_ON : LIGHT_IDLE;
          laser.opacity = v === 'on' ? LASER_ON : 0;
        },
      },
    };
  },
});
