// Case source machine: an enclosure at the head of a conveyor that delivers cases onto it through
// an exit chute (case erector / infeed cell). Port of the reference station-3
// ProceduralBoxSourceMachine.js, on the shared material library. Origin at the exit opening on the
// floor (x = 0); the body stands behind it towards −X; cases leave along +X at the belt height.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, box, cylinder } from '../../core/primitives.js';
import { createLampMaterial, setLamp } from '../../core/materials.js';

const CHUTE = 0.28; // chute depth in front of the body
const WALL = 0.06;

const openingOf = (p, beltHeight) => ({ centreY: beltHeight + p.caseHeight / 2, ...p });

defineComponent({
  type: 'caseSource',
  category: 'machine',
  summary: 'Case source enclosure at the head of a conveyor: cases come out of its exit chute onto the belt.',
  params: z.object({
    depth: z.number().min(0.8).max(2.5).default(1.55).describe('Depth along X, chute included (m)'),
    width: z.number().min(0.9).max(2.5).default(1.45).describe('Width along Z (m)'),
    height: z.number().min(1.4).max(2.6).default(1.85).describe('Body height (m)'),
    openingWidth: z.number().min(0.3).max(1.4).default(0.78).describe('Exit opening width (m)'),
    openingHeight: z.number().min(0.2).max(1.0).default(0.58).describe('Exit opening height (m)'),
    caseHeight: z.number().min(0.1).max(0.9).default(0.42).describe('Case height: the opening is centred on it (m)'),
    rearPort: z.boolean().default(false).describe('Infeed port on the back, where a transfer conveyor feeds cases in'),
  }).refine((p) => p.openingWidth <= p.width - 0.2, { message: 'openingWidth must leave 10 cm of front plate each side', path: ['openingWidth'] }),
  footprint: (p, ctx) => ({
    x: [-p.depth - (p.rearPort ? 0.04 : 0), 0.065],
    z: [-(p.width / 2 + 0.315), p.width / 2], // the status lamp on the control panel
    height: Math.max(p.height + 0.24, openingOf(p, ctx.beltHeight).centreY + p.openingHeight / 2 + WALL),
  }),
  mount: 'floor',
  ports: (p, ctx) => ({
    output: { position: [0.04, ctx.beltHeight, 0], direction: 'out', carries: 'case' },
    ...(p.rearPort ? { input: { position: [-p.depth, ctx.beltHeight, 0], direction: 'in', carries: 'case' } } : {}),
  }),
  motions: { beacon: { values: ['off', 'run', 'wait', 'alarm'], default: 'off' } },
  ops: [],
  build({ params: p, materials, beltHeight }) {
    const { depth, width, height, openingWidth, openingHeight } = p;
    const { centreY } = openingOf(p, beltHeight);
    const bodyDepth = depth - CHUTE;
    const bodyX = -(CHUTE + bodyDepth / 2);
    const root = group(null, 'caseSource');
    const interior = new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.15, roughness: 0.9, side: THREE.DoubleSide });
    interior.name = 'chute interior';

    box(root, [bodyDepth, height, width], [bodyX, height / 2, 0], materials.frame, 'Cabinet body');
    box(root, [bodyDepth - 0.04, height - 0.12, width - 0.12], [bodyX, height / 2, 0], materials.frameDark, 'Cabinet inset');

    // Front plates around the exit opening.
    const side = (width - openingWidth) / 2;
    const frontX = -CHUTE / 2;
    [-1, 1].forEach((s) => box(root, [CHUTE, height, side], [frontX, height / 2, s * (openingWidth / 2 + side / 2)], materials.frameDark, s < 0 ? 'Front left plate' : 'Front right plate'));
    const below = Math.max(0.08, centreY - openingHeight / 2);
    const aboveStart = centreY + openingHeight / 2;
    const above = Math.max(0.08, height - aboveStart);
    box(root, [CHUTE, below, openingWidth], [frontX, below / 2, 0], materials.frameDark, 'Front lower plate');
    box(root, [CHUTE, above, openingWidth], [frontX, aboveStart + above / 2, 0], materials.frameDark, 'Front upper plate');

    // Exit chute lined dark inside.
    const chute = group(root, 'Exit chute');
    const tunnel = CHUTE + 0.12;
    const tunnelX = -tunnel / 2 + 0.02;
    box(chute, [tunnel, WALL, openingWidth + WALL * 2], [tunnelX, centreY - openingHeight / 2 - WALL / 2, 0], materials.frameDark, 'Chute floor');
    box(chute, [tunnel, WALL, openingWidth + WALL * 2], [tunnelX, centreY + openingHeight / 2 + WALL / 2, 0], materials.frameDark, 'Chute roof');
    [-1, 1].forEach((s) => box(chute, [tunnel, openingHeight, WALL], [tunnelX, centreY, s * (openingWidth / 2 + WALL / 2)], materials.frameDark, s < 0 ? 'Chute left wall' : 'Chute right wall'));
    addMesh(chute, new THREE.BoxGeometry(tunnel - 0.04, openingHeight - 0.02, openingWidth - 0.02), interior, 'Chute interior', [tunnelX - 0.01, centreY, 0]);
    // Trim frame around the opening. (The reference's was a solid plate across the exit.)
    const trim = 0.05;
    [-1, 1].forEach((s) => box(root, [0.04, openingHeight + 2 * trim, trim], [0.02, centreY, s * (openingWidth / 2 + WALL + trim / 2)], materials.gantryOrange, 'Exit trim side'));
    box(root, [0.04, trim, openingWidth + 2 * (WALL + trim)], [0.02, centreY + openingHeight / 2 + WALL / 2 + trim / 2, 0], materials.gantryOrange, 'Exit trim top');
    box(root, [0.05, 0.03, openingWidth + 0.18], [0.04, centreY - openingHeight / 2 - 0.02, 0], materials.safetyYellow, 'Exit lip');
    for (let i = 0; i < 4; i += 1) {
      box(root, [0.03, 0.12, 0.08], [0.01, aboveStart + 0.1, -openingWidth / 2 + 0.1 + i * ((openingWidth - 0.12) / 3)], materials.safetyYellow, `Hazard stripe ${i + 1}`);
    }

    // Frame rails and rear posts.
    [-1, 1].forEach((s, i) => {
      box(root, [depth - 0.08, 0.08, 0.08], [-(depth / 2) + 0.04, 0.06, s * (width / 2 - 0.05)], materials.frameDark, `Base rail ${i + 1}`);
      box(root, [depth - 0.08, 0.08, 0.08], [-(depth / 2) + 0.04, height - 0.06, s * (width / 2 - 0.05)], materials.frameDark, `Top rail ${i + 1}`);
      box(root, [0.08, height, 0.08], [-depth + 0.08, height / 2, s * (width / 2 - 0.05)], materials.frameDark, s < 0 ? 'Rear post L' : 'Rear post R');
    });

    // Side window, control cabinet with panel and status lamp, roof motor housing and vent.
    const windowWidth = Math.min(0.7, bodyDepth - 0.12); // fits a shallow cabinet too
    box(root, [windowWidth, 0.45, 0.03], [bodyX, height * 0.62, width / 2 - 0.04], materials.sightGlass, 'Side window');
    [0.24, -0.24].forEach((dy, i) => box(root, [windowWidth + 0.08, 0.04, 0.04], [bodyX, height * 0.62 + dy, width / 2 - 0.03], materials.frameDark, i ? 'Window frame bottom' : 'Window frame top'));
    const cabX = bodyX + bodyDepth * 0.15;
    box(root, [0.22, 0.55, 0.32], [cabX, 1.05, -width / 2 - 0.12], materials.frameDark, 'Control cabinet');
    box(root, [0.18, 0.28, 0.02], [cabX, 1.12, -width / 2 - 0.28], materials.machineGrey, 'Control panel');
    const lamp = createLampMaterial(0x3dcf6a);
    cylinder(root, 0.035, 0.04, [cabX, 1.32, -width / 2 - 0.29], lamp, 'Status light', { axis: 'z', segments: 16 });
    // Roof parts stay on the body roof, also on a shallow cabinet.
    box(root, [Math.min(0.55, bodyDepth - 0.02), 0.18, 0.45], [bodyX, height + 0.06, 0], materials.frameDark, 'Motor housing');
    cylinder(root, 0.12, 0.16, [bodyX - Math.min(0.25, bodyDepth / 2 - 0.15), height + 0.16, 0.18], materials.frame, 'Vent', { radiusBottom: 0.14, segments: 20 });

    // Infeed port on the back (reference TransferLines.js S3_InfeedPort): dark opening, trim, strip curtain.
    if (p.rearPort) {
      const port = group(root, 'Infeed port', [-depth, 0, 0]);
      const dark = new THREE.MeshStandardMaterial({ color: 0x101316, roughness: 0.95, metalness: 0.1 });
      dark.name = 'port opening';
      addMesh(port, new THREE.PlaneGeometry(openingWidth - 0.02, openingHeight - 0.02), dark, 'Port opening', [-0.004, centreY, 0], { castShadow: false }).rotation.y = -Math.PI / 2;
      [-1, 1].forEach((s) => box(port, [0.04, openingHeight + 0.08, 0.06], [-0.02, centreY, s * (openingWidth / 2 + 0.03)], materials.safetyYellow, 'Port trim side'));
      box(port, [0.04, 0.06, openingWidth + 0.12], [-0.02, centreY + openingHeight / 2 + 0.01, 0], materials.safetyYellow, 'Port trim top');
      const strip = new THREE.MeshStandardMaterial({ color: 0x9fb0b8, transparent: true, opacity: 0.55, roughness: 0.2 });
      strip.name = 'curtain strip';
      const strips = Math.max(2, Math.round(openingWidth / 0.13));
      for (let i = 0; i < strips; i += 1) {
        box(port, [0.004, 0.08, (openingWidth - 0.04) / strips - 0.01], [-0.03, centreY + openingHeight / 2 - 0.04, -openingWidth / 2 + 0.02 + (i + 0.5) * (openingWidth - 0.04) / strips], strip, 'Curtain strip');
      }
    }

    const MODES = { off: [0x3dcf6a, false], run: [0x3dcf6a, true], wait: [0xf2a516, true], alarm: [0xe23a2e, true] };
    return {
      root,
      motions: {
        beacon(mode) {
          const [color, on] = MODES[mode];
          lamp.userData.baseColor.set(color);
          lamp.emissive.set(color);
          setLamp(lamp, on, 0.9);
        },
      },
    };
  },
});
