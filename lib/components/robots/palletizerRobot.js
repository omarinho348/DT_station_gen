// Four-axis palletizing robot (the kind used to stack cases on pallets, e.g. ABB IRB 660 class):
// a turret turning on a pedestal (axis 1), a lower arm (axis 2) and an upper arm (axis 3) whose
// parallelogram linkage keeps the wrist level, so the tool always points straight down, and a
// wrist turning the tool about the vertical (axis 6). A vacuum pad gripper is fitted.
// Procedural (not a port): the reference station 3 used an ABB IRB 6760 model with inverse
// kinematics; the owner chose a procedural palletizer as the default (the ABB comes as an
// optional component later).
//
// Driven like the gantries: motions x / y / z / yaw are the tool point (centre of the suction-cup
// faces) in the robot's frame and the tool's turn, solved by closed-form inverse kinematics
// (elbow up), so the generic pick-and-place ops work with it. A target out of reach is clamped to
// the reach limit; palletizerReach() says whether a point is reachable (tests, the reviewer).
// Origin: axis 1 on the floor; with yaw 0 and the arm along +X.
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, addMesh, cylinder, roundedBox } from '../../core/primitives.js';
import { buildVacuumPad, VACUUM_PAD_HEIGHT } from '../tools/vacuumPad.js';

const TURNTABLE_TOP = 0.7;
const SHOULDER_FORWARD = 0.25; // axis 2 ahead of axis 1
const WRIST_FORWARD = 0.2; // tool axis ahead of the wrist joint
const WRIST_DROP = 0.15; // flange below the wrist joint
const TOOL_LENGTH = 0.015 + VACUUM_PAD_HEIGHT; // flange disc half + the vacuum pad
const REAR = 0.4; // upper arm extends this far behind the elbow (parallelogram crank)
const ROD_Z = 0.22; // parallelogram rod beside the lower arm

const dims = (p) => {
  const reachMax = SHOULDER_FORWARD + p.lowerArm + p.upperArm + WRIST_FORWARD;
  return { reachMax, yRange: [0.3, p.shoulderHeight + p.lowerArm + 0.3] };
};

/**
 * Closed-form inverse kinematics. Tool point (x, y, z) and yaw in the robot frame → joint values
 * and the arm points in the turret plane (forward r, up y). `clamped` when the target is out of reach.
 */
export function palletizerIK(p, { x, y, z: zz, yaw }) {
  const r = Math.max(Math.hypot(x, zz), SHOULDER_FORWARD + WRIST_FORWARD + 0.3);
  const base = Math.atan2(-zz, x);
  const shoulder = new THREE.Vector2(SHOULDER_FORWARD, p.shoulderHeight);
  const wrist = new THREE.Vector2(r - WRIST_FORWARD, y + WRIST_DROP + TOOL_LENGTH);
  const toWrist = wrist.clone().sub(shoulder);
  const d = toWrist.length();
  const dMin = Math.abs(p.lowerArm - p.upperArm) + 0.05;
  const dMax = p.lowerArm + p.upperArm - 0.001;
  const clamped = d > dMax || d < dMin;
  const dc = THREE.MathUtils.clamp(d, dMin, dMax);
  const dir = toWrist.clone().normalize();
  const reached = shoulder.clone().addScaledVector(dir, dc);
  const beta = Math.acos(THREE.MathUtils.clamp((p.lowerArm ** 2 + dc ** 2 - p.upperArm ** 2) / (2 * p.lowerArm * dc), -1, 1));
  const lower = Math.atan2(dir.y, dir.x) + beta; // elbow up
  const elbow = shoulder.clone().add(new THREE.Vector2(Math.cos(lower), Math.sin(lower)).multiplyScalar(p.lowerArm));
  return { base, lower, shoulder, elbow, wrist: reached, wristYaw: yaw - base, clamped };
}

/** Whether a tool point is within reach (and above the lowest tool height). */
export function palletizerReach(params, point) {
  const p = { shoulderHeight: 1.05, lowerArm: 1.2, upperArm: 1.35, ...params };
  return !palletizerIK(p, { ...point, yaw: 0 }).clamped && point.y >= dims(p).yRange[0];
}

defineComponent({
  type: 'palletizerRobot',
  category: 'robot',
  summary: 'Four-axis palletizing robot (turret, parallelogram arm keeping the tool level, wrist turn) with a vacuum pad gripper; driven by tool point x/y/z/yaw.',
  params: z.object({
    shoulderHeight: z.number().min(0.8).max(1.4).default(1.05).describe('Axis 2 height above the floor (m)'),
    lowerArm: z.number().min(0.8).max(1.6).default(1.2).describe('Lower arm length, axis 2 to axis 3 (m)'),
    upperArm: z.number().min(0.9).max(1.8).default(1.35).describe('Upper arm length, axis 3 to the wrist (m)'),
    padLength: z.number().min(0.2).max(0.9).default(0.5).describe('Vacuum pad length along the tool X (m)'),
    padWidth: z.number().min(0.18).max(0.6).default(0.34).describe('Vacuum pad width along the tool Z (m)'),
    color: z.enum(['machineWhite', 'gantryOrange', 'safetyYellow']).default('machineWhite').describe('Arm colour'),
  }),
  footprint: (p) => {
    const { reachMax, yRange } = dims(p);
    const pad = Math.hypot(p.padLength, p.padWidth) / 2;
    const half = reachMax + pad + 0.01;
    return {
      x: [-half, half],
      z: [-half, half],
      height: Math.max(yRange[1] + WRIST_DROP + TOOL_LENGTH + 0.14, p.shoulderHeight + p.lowerArm + REAR + 0.25),
    };
  },
  mount: 'floor',
  anchors: ['tool'],
  motions: (p) => {
    const { reachMax, yRange } = dims(p);
    const home = { x: SHOULDER_FORWARD + p.lowerArm * 0.6 + WRIST_FORWARD + 0.4, y: p.shoulderHeight + 0.4 };
    return {
      x: { range: [-reachMax, reachMax], default: home.x },
      y: { range: yRange, default: home.y },
      z: { range: [-reachMax, reachMax], default: 0 },
      yaw: { range: [-Math.PI, Math.PI], default: 0, wrap: true },
      grip: { range: [0, 1], default: 0 }, // vacuum: 0 off, 1 on (the pick ops' open / closed values)
    };
  },
  ops: [],
  build({ params, materials }) {
    const p = params;
    const paint = materials[p.color];
    const root = group(null, 'palletizerRobot');

    // Pedestal (fixed).
    cylinder(root, 0.45, 0.04, [0, 0.02, 0], materials.frameDark, 'Base plate', { segments: 32 });
    cylinder(root, 0.34, TURNTABLE_TOP - 0.19, [0, 0.04 + (TURNTABLE_TOP - 0.19) / 2, 0], paint, 'Pedestal', { segments: 32 });

    // Turret (axis 1).
    const turret = group(root, 'Turret');
    cylinder(turret, 0.42, 0.15, [0, TURNTABLE_TOP - 0.075, 0], paint, 'Turntable', { segments: 36 });
    const housingTop = p.shoulderHeight + 0.1;
    roundedBox(turret, [SHOULDER_FORWARD + 0.45, housingTop - TURNTABLE_TOP, 0.5], [SHOULDER_FORWARD / 2 - 0.05, (TURNTABLE_TOP + housingTop) / 2, 0], paint, 'Shoulder housing', 0.03);
    roundedBox(turret, [0.32, 0.38, 0.44], [-0.38, TURNTABLE_TOP + 0.19, 0], materials.frameDark, 'Axis motors', 0.03);
    cylinder(turret, 0.18, 0.62, [SHOULDER_FORWARD, p.shoulderHeight, 0], materials.frameDark, 'Axis 2 joint', { axis: 'z', segments: 28 });

    // Arm links, placed between joint points every update (all in the turret plane).
    const link = (name, width, depth, material, zOff = 0) => {
      const holder = group(turret, name);
      const mesh = addMesh(holder, new THREE.BoxGeometry(1, width, depth), material, `${name} body`);
      return { holder, mesh, zOff };
    };
    const place = (l, a, b) => {
      const d = b.clone().sub(a);
      l.holder.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, l.zOff);
      l.holder.rotation.z = Math.atan2(d.y, d.x);
      l.mesh.scale.x = Math.max(d.length(), 1e-4);
    };
    const lowerArm = link('Lower arm', 0.26, 0.3, paint);
    const upperArm = link('Upper arm', 0.22, 0.26, paint);
    const crank = link('Parallelogram crank', 0.08, 0.06, materials.frameDark, ROD_Z);
    const rod = link('Parallelogram rod', 0.06, 0.06, materials.frameDark, ROD_Z);
    const elbowJoint = cylinder(turret, 0.14, 0.42, [0, 0, 0], materials.frameDark, 'Axis 3 joint', { axis: 'z', segments: 24 });
    const rodPin = cylinder(turret, 0.04, ROD_Z + 0.04, [0, 0, ROD_Z / 2], materials.chrome, 'Rod pin', { axis: 'z', segments: 12 });

    // Wrist (level) and the tool on its yaw axis.
    const wrist = group(turret, 'Wrist');
    roundedBox(wrist, [WRIST_FORWARD + 0.22, 0.25, 0.3], [WRIST_FORWARD / 2, 0, 0], paint, 'Wrist housing', 0.03);
    const flange = group(turret, 'Flange');
    cylinder(flange, 0.07, WRIST_DROP, [0, WRIST_DROP / 2, 0], materials.frameDark, 'Axis 6 motor', { segments: 20 });
    cylinder(flange, 0.12, 0.03, [0, 0, 0], materials.chrome, 'Tool flange', { segments: 28 });
    const tool = group(flange, 'Tool point', [0, -TOOL_LENGTH, 0]);
    const pad = buildVacuumPad(tool, materials, { padLength: p.padLength, padWidth: p.padWidth });

    const target = { x: 0, y: 0, z: 0, yaw: 0 };
    const solve = () => {
      const k = palletizerIK(p, target);
      turret.rotation.y = k.base;
      place(lowerArm, k.shoulder, k.elbow);
      const upperDir = k.wrist.clone().sub(k.elbow).normalize();
      const rear = k.elbow.clone().addScaledVector(upperDir, -REAR);
      place(upperArm, rear, k.wrist);
      // Parallelogram: crank from axis 2 parallel to the upper arm's rear, rod parallel to the lower arm.
      const crankEnd = k.shoulder.clone().addScaledVector(upperDir, -REAR);
      place(crank, k.shoulder, crankEnd);
      place(rod, crankEnd, rear);
      elbowJoint.position.set(k.elbow.x, k.elbow.y, 0);
      rodPin.position.set(rear.x, rear.y, ROD_Z / 2);
      wrist.position.set(k.wrist.x, k.wrist.y, 0);
      flange.position.set(k.wrist.x + WRIST_FORWARD, k.wrist.y - WRIST_DROP, 0);
      flange.rotation.y = k.wristYaw;
    };
    const set = (key) => (v) => { target[key] = v; solve(); };

    return {
      root,
      anchors: { tool },
      motions: {
        x: set('x'),
        y: set('y'),
        z: set('z'),
        yaw: set('yaw'),
        grip(v) { pad.setVacuum(v >= 0.5); },
      },
    };
  },
});
