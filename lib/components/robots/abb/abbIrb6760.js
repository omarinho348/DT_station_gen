// ABB IRB 6760 six-axis robot with a vacuum pad, from the reference model (lib/assets/abbIrb6760.glb
// = reference src/assets/robot.glb) and its rig (abbIrb6760Rig.js, abbRobotStudio.js), driven by
// the reference's generic inverse kinematics (lib/motion/InverseKinematics.js). Optional: the
// procedural `palletizerRobot` is the default; this one gives the reference-quality station 3
// (owner's decision "both", 2026-11-23).
//
// Same interface as `palletizerRobot`, so the same ops drive either: motions x / y / z / yaw are
// the tool point (centre of the cup faces) in the robot frame and the tool's turn, with the tool
// pointing straight down; `grip` is the vacuum; anchor `tool`. Axes 1–5 come from the IK, axis 6
// sets the yaw. A target out of reach leaves the arm at the closest pose the solver found;
// `lastSolve` on the root's userData says whether it was reached.
// The model must be loaded first (assets): await preloadComponentAssets(registry).
// Origin: axis 1 on the floor, the arm along +X at rest (as the model was exported).
import * as THREE from 'three';
import { z } from 'zod';
import { defineComponent } from '../../../registry.js';
import { moveUnitRoutine } from '../pickRoutines.js';
import { group } from '../../../core/primitives.js';
import { instantiate } from '../../../core/assets.js';
import { Rig } from '../../../motion/Rig.js';
import { resolveTool, solveReach } from '../../../motion/InverseKinematics.js';
import { ABB_IRB6760_RIG } from './abbIrb6760Rig.js';
import { buildVacuumPad, VACUUM_PAD_HEIGHT } from '../../tools/vacuumPad.js';

const ASSET = 'abbIrb6760.glb';
const FLANGE = 0.2; // tool flange along Link6's Z (extras.ABB_ro_int_mountOffset)
const REACH = 3.0;
const D2R = Math.PI / 180;

const headingOf = (dir) => Math.atan2(-dir.z, dir.x);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

defineComponent({
  type: 'abbIrb6760',
  category: 'robot',
  summary: 'ABB IRB 6760 six-axis robot (reference model) with a vacuum pad gripper; driven by tool point x/y/z/yaw like the palletizer.',
  params: z.object({
    padLength: z.number().min(0.2).max(0.9).default(0.5).describe('Vacuum pad length (m)'),
    padWidth: z.number().min(0.18).max(0.6).default(0.34).describe('Vacuum pad width (m)'),
  }),
  footprint: () => ({ x: [-REACH - 0.6, REACH + 0.6], z: [-REACH - 0.6, REACH + 0.6], height: 4.2 }),
  mount: 'floor',
  assets: [ASSET],
  anchors: ['tool'],
  recipes: { moveUnit: moveUnitRoutine({ hold: 'vacuum' }) },
  motions: {
    x: { range: [-REACH, REACH], default: 1.8 },
    y: { range: [0.2, 2.8], default: 1.2 },
    z: { range: [-REACH, REACH], default: 0 },
    yaw: { range: [-Math.PI, Math.PI], default: 0, wrap: true },
    grip: { range: [0, 1], default: 0 }, // vacuum: 0 off, 1 on
  },
  ops: [],
  build({ params, materials }) {
    const root = group(null, 'abbIrb6760');
    // The rig moves its own base joints on modelRoot (kept at the origin); our root carries the placement.
    const modelRoot = group(root, 'ABB IRB 6760');
    const content = instantiate(ASSET);
    content.name = 'IRB 6760 model';
    content.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    modelRoot.add(content);
    modelRoot.updateMatrixWorld(true);
    const rig = new Rig({ root: modelRoot, content, definition: ABB_IRB6760_RIG });

    // Vacuum pad seated on the flange, its axis along the flange axis (reference mountOnFlange).
    const axis6 = rig.jointsById.get('axis6').group;
    const flange = resolveTool(rig, rig.tools.find((t) => t.joint === 'axis6'));
    axis6.updateMatrixWorld(true);
    const inverse = axis6.matrixWorld.clone().invert();
    const point = flange.position().applyMatrix4(inverse);
    const axis = flange.direction().transformDirection(inverse);
    const mount = group(axis6, 'Tool mount');
    mount.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis);
    mount.position.copy(point).addScaledVector(axis, VACUUM_PAD_HEIGHT);
    const pad = buildVacuumPad(mount, materials, params);
    const tool = group(mount, 'Tool point');
    // IK tool: the pad's tool point, pointing out of the flange.
    const resolved = resolveTool(rig, { id: 'pad', joint: 'axis6', frame: 'part', point: [0, 0, FLANGE + VACUUM_PAD_HEIGHT], direction: [0, 0, 1] });

    const target = { x: 1.8, y: 1.2, z: 0, yaw: 0 };
    const solve = () => {
      root.updateMatrixWorld(true);
      const world = new THREE.Vector3(target.x, target.y, target.z).applyMatrix4(root.matrixWorld);
      const down = new THREE.Vector3(0, -1, 0).transformDirection(root.matrixWorld);
      // Live motion solves: from the current pose a nearby target converges in a few iterations;
      // 60 bounds the time an unreachable one costs (the solver default is 150).
      const result = solveReach(rig, resolved, world, { orient: down, quick: true, maxIterations: 60 });
      rig.setValues(result.values);
      // Yaw with axis 6: it turns about the tool axis, which points down.
      root.updateMatrixWorld(true);
      const rootInverse = root.matrixWorld.clone().invert();
      const toolX = new THREE.Vector3(1, 0, 0).transformDirection(tool.matrixWorld).transformDirection(rootInverse);
      const toolAxis = resolved.direction().transformDirection(rootInverse);
      const delta = wrapAngle(target.yaw - headingOf(toolX));
      const joint = rig.jointsById.get('axis6');
      let value = joint.value + (delta / toolAxis.y) / D2R;
      if (value > joint.max) value -= 360;
      if (value < joint.min) value += 360;
      rig.setValues({ axis6: value });
      root.userData.lastSolve = { reached: result.reached, error: result.error, tilt: result.tilt };
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
        grip: (v) => pad.setVacuum(v >= 0.5),
      },
    };
  },
});
