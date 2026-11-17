// Overhead Cartesian gantry: two rails along X on four posts, a bridge (X axis) along Z, a
// carriage (Z axis), a vertical ram (Y axis) and a rotary wrist carrying a parallel gripper,
// optionally with an automatic screwdriver beside it. Ported from the reference Robots.js
// (createCartesianGantry). Centred on the origin: the tool travels x ∈ ±spanX/2, z ∈ ±spanZ/2,
// and the frame is built around that travel.
//
// Motions are in metres / radians in the gantry's frame. x, y, z are the TOOL POINT (the centre
// between the fingertips), so ops can aim it straight at a grasp point.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';
import { buildFingerGripper } from '../tools/fingerGripper.js';
import { buildScrewdriver, screwdriverMotions, SCREWDRIVER_MOTIONS } from '../tools/screwdriver.js';

const POST_OUT_X = 0.3; // posts stand this far beyond the X travel
const RAIL_OUT_Z = 0.32; // rails run this far beyond the Z travel

defineComponent({
  type: 'cartesianGantry',
  category: 'robot',
  summary: 'Overhead Cartesian gantry (X bridge, Z carriage, Y ram, rotary wrist) with a parallel gripper and optional screwdriver.',
  params: z.object({
    spanX: z.number().min(0.4).max(4).default(1.2).describe('Tool travel along X (m)'),
    spanZ: z.number().min(0.3).max(3).default(0.8).describe('Tool travel along Z (m)'),
    beamY: z.number().min(1.6).max(3.2).default(2.4).describe('Rail height (m)'),
    minToolY: z.number().min(0.3).max(1.5).default(0.85).describe('Lowest tool point (m)'),
    maxGap: z.number().min(0.06).max(0.7).default(0.2).describe('Gripper opening (m)'),
    fingerLength: z.number().min(0.06).max(0.2).default(0.12).describe('Finger length (m)'),
    frameColor: z.enum(['gantryOrange', 'machineBlue', 'machineGrey', 'safetyYellow']).default('gantryOrange').describe('Beam colour'),
    screwdriver: z.boolean().default(false).describe('Screwdriver beside the gripper'),
  }).refine((p) => p.minToolY <= p.beamY - 0.6, {
    message: 'minToolY must be at least 0.6 m below beamY',
    path: ['minToolY'],
  }),
  footprint: (p) => {
    const hx = p.spanX / 2 + POST_OUT_X + 0.12;
    const railZ = p.spanZ / 2 + RAIL_OUT_Z;
    const yTop = p.beamY - 0.1;
    return {
      x: [-hx, hx],
      z: [-(railZ + 0.12), railZ + 0.2],
      // The ram sticks up out of the carriage when the tool is raised.
      height: Math.max(p.beamY + 0.49, p.beamY + 0.45 + (yTop - p.minToolY)),
    };
  },
  mount: 'floor',
  // The tool point (centre between the fingertips), and the screwdriver's extended bit tip.
  anchors: (p) => (p.screwdriver ? ['tool', 'bit'] : ['tool']),
  motions: (p) => ({
    x: { range: [-p.spanX / 2, p.spanX / 2], default: 0 },
    y: { range: [p.minToolY, p.beamY - 0.1], default: Math.max(p.minToolY, p.beamY - 0.8) },
    z: { range: [-p.spanZ / 2, p.spanZ / 2], default: 0 },
    yaw: { range: [-Math.PI, Math.PI], default: 0, wrap: true },
    grip: { range: [0, p.maxGap], default: p.maxGap },
    holding: { values: ['off', 'on'] },
    ...(p.screwdriver ? SCREWDRIVER_MOTIONS : {}),
  }),
  build({ params, materials }) {
    const { spanX, spanZ, beamY, minToolY, maxGap, fingerLength, frameColor } = params;
    const frameMaterial = materials[frameColor];
    const root = group(null, 'cartesianGantry');
    const postX = [-spanX / 2 - POST_OUT_X, spanX / 2 + POST_OUT_X];
    const railZ = [-spanZ / 2 - RAIL_OUT_Z, spanZ / 2 + RAIL_OUT_Z];
    const railLength = postX[1] - postX[0] + 0.12;

    postX.forEach((px) => railZ.forEach((pz) => {
      roundedBox(root, [0.12, beamY, 0.12], [px, beamY / 2, pz], materials.frame, 'Gantry post', 0.01);
      roundedBox(root, [0.24, 0.02, 0.24], [px, 0.01, pz], materials.frameDark, 'Post foot', 0.005);
    }));
    railZ.forEach((pz) => {
      roundedBox(root, [railLength, 0.14, 0.12], [0, beamY + 0.07, pz], frameMaterial, 'X rail beam', 0.01);
      box(root, [railLength - 0.1, 0.02, 0.03], [0, beamY + 0.15, pz], materials.chrome, 'Linear guide');
    });
    postX.forEach((px) => box(root, [0.1, 0.1, railZ[1] - railZ[0]], [px, beamY + 0.05, 0], materials.frame, 'End tie'));

    const bridge = group(root, 'XAxis');
    const bridgeLength = railZ[1] - railZ[0] + 0.16;
    roundedBox(bridge, [0.16, 0.18, bridgeLength], [0, beamY + 0.25, 0], frameMaterial, 'Bridge beam', 0.012);
    railZ.forEach((pz) => roundedBox(bridge, [0.22, 0.08, 0.16], [0, beamY + 0.18, pz], materials.machineGrey, 'Bridge truck', 0.01));
    cylinder(bridge, 0.05, 0.16, [0, beamY + 0.25, railZ[1] + 0.12], materials.motor, 'X servo', { axis: 'z', segments: 18 });
    box(bridge, [0.08, 0.04, bridgeLength * 0.8], [0.11, beamY + 0.36, 0], materials.plasticBlack, 'Energy chain');

    const carriage = group(bridge, 'ZAxis');
    roundedBox(carriage, [0.26, 0.26, 0.22], [0, beamY + 0.25, 0], materials.machineGrey, 'Carriage', 0.02);
    cylinder(carriage, 0.045, 0.14, [0, beamY + 0.42, 0], materials.motor, 'Z servo', { segments: 18 });

    const ram = group(carriage, 'YAxis');
    // Long enough to stay in the carriage at the lowest tool position.
    const toolDrop = 0.04 + fingerLength + 0.05; // ram bottom → tool point
    const ramLength = beamY + 0.45 - (minToolY + toolDrop);
    roundedBox(ram, [0.1, ramLength, 0.1], [0, ramLength / 2, 0], materials.aluminium, 'Ram', 0.01);
    cylinder(ram, 0.06, 0.04, [0, -0.02, 0], materials.machineBlue, 'Wrist motor', { segments: 20 });
    const wrist = group(ram, 'Wrist', [0, -0.04, 0]);
    const tool = group(wrist, 'Tool', [0, -(fingerLength + 0.05), 0]);
    const gripper = buildFingerGripper(tool, materials, { fingerLength, maxGap });
    const driver = params.screwdriver ? buildScrewdriver(tool, materials, { fingerLength }) : null;

    return {
      root,
      anchors: driver ? { tool, bit: driver.tip } : { tool },
      motions: {
        x: (v) => { bridge.position.x = v; },
        y: (v) => { ram.position.y = v + toolDrop; },
        z: (v) => { carriage.position.z = v; },
        yaw: (v) => { wrist.rotation.y = v; },
        grip: (v) => gripper.setGap(v),
        holding: (v) => gripper.setHolding(v === 'on'),
        ...(driver ? screwdriverMotions(driver) : {}),
      },
    };
  },
});
