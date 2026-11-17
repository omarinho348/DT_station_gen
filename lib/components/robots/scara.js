// SCARA robot: column, shoulder link (J1), elbow link (J2), vertical quill (J3) and tool roll
// (J4) carrying a parallel gripper, optionally with an automatic screwdriver beside it.
// Ported from the reference Robots.js (createScaraRobot). The column stands on the origin.
//
// Same tool interface as the gantry: motions x, y, z are the TOOL POINT (the centre between the
// fingertips) in the robot's frame, yaw is the tool's heading. Joint angles come from analytic
// two-link inverse kinematics in the XZ plane (elbow right-handed, as in the reference).
//
// The x / z motion ranges are the bounding square of the reach circle. The real workspace is an
// annulus (see scaraReach): a target outside it is clamped to the nearest reachable point on the
// same heading, so the arm never breaks or jumps.
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, cylinder, roundedBox } from '../../core/primitives.js';
import { buildFingerGripper } from '../tools/fingerGripper.js';
import { buildScrewdriver, screwdriverMotions, SCREWDRIVER_MOTIONS } from '../tools/screwdriver.js';

const COLUMN_RADIUS = 0.12;
const TOOL_CLEARANCE = 0.05; // between the tool and the column at the inner reach limit
const SCREWDRIVER_SPAN = 0.17; // bit offset 0.13 + spindle motor and feed tube
const QUILL_ABOVE = 0.2; // spline length above the quill origin (as in the reference)
const FLANGE = 0.03;

/** Horizontal radius of the gripper (or screwdriver) around the tool point. */
function toolSpan(p) {
  const gripper = Math.hypot(0.05, (p.maxGap + 0.05) / 2);
  return Math.max(gripper, p.screwdriver ? SCREWDRIVER_SPAN : 0);
}

/**
 * Reach of the tool point, horizontal distance from the column axis: { min, max } (m). The inner
 * limit keeps the tool clear of the column (and inside the J2 fold limit).
 */
export function scaraReach(p) {
  return {
    min: Math.max(Math.abs(p.link1 - p.link2) + 0.01, COLUMN_RADIUS + TOOL_CLEARANCE + toolSpan(p)),
    max: p.link1 + p.link2 - 1e-4,
  };
}

/** Quill geometry from the params: highest / lowest quill position in the elbow frame. */
function quillGeometry(p) {
  const length = p.stroke + 0.3; // 0.7 m at the default stroke, as in the reference
  // Fully raised, the flange meets the quill head (the reference ST1 home pose, y 1.12 at
  // armHeight 1.3, needs exactly that).
  const top = p.stroke + 0.08;
  const toolDrop = length - QUILL_ABOVE + FLANGE + p.fingerLength + 0.05; // quill origin → tool point
  const elbowY = p.armHeight - 0.08 + 0.1; // elbow frame height
  return { length, top, bottom: top - p.stroke, toolDrop, elbowY };
}

defineComponent({
  type: 'scara',
  category: 'robot',
  summary: 'SCARA robot (two-link arm, vertical quill, tool roll) with a parallel gripper and optional screwdriver.',
  params: z.object({
    link1: z.number().min(0.3).max(0.8).default(0.55).describe('Shoulder link length (m)'),
    link2: z.number().min(0.25).max(0.7).default(0.5).describe('Elbow link length (m)'),
    armHeight: z.number().min(1).max(2).default(1.45).describe('Arm height (m)'),
    stroke: z.number().min(0.15).max(0.5).default(0.4).describe('Quill stroke (m)'),
    maxGap: z.number().min(0.06).max(0.3).default(0.26).describe('Gripper opening (m)'),
    fingerLength: z.number().min(0.06).max(0.2).default(0.1).describe('Finger length (m)'),
    screwdriver: z.boolean().default(false).describe('Screwdriver beside the gripper'),
  }),
  footprint: (p) => {
    const r = p.link1 + p.link2 + toolSpan(p) + 0.005;
    return { x: [-r, r], z: [-r, r], height: p.armHeight + p.stroke + 0.3 };
  },
  mount: 'floor',
  // The tool point (centre between the fingertips), and the screwdriver's extended bit tip.
  anchors: (p) => (p.screwdriver ? ['tool', 'bit'] : ['tool']),
  motions: (p) => {
    const { max } = scaraReach(p);
    const q = quillGeometry(p);
    const yAt = (quillY) => quillY + q.elbowY - q.toolDrop;
    return {
      x: { range: [-max, max], default: p.link1 + p.link2 * 0.5 },
      y: { range: [yAt(q.bottom), yAt(q.top)], default: yAt((q.bottom + q.top) / 2) },
      z: { range: [-max, max], default: 0 },
      yaw: { range: [-Math.PI, Math.PI], default: 0, wrap: true },
      grip: { range: [0, p.maxGap], default: p.maxGap },
      holding: { values: ['off', 'on'] },
      ...(p.screwdriver ? SCREWDRIVER_MOTIONS : {}),
    };
  },
  build({ params, materials }) {
    const { link1: l1, link2: l2, armHeight, maxGap, fingerLength } = params;
    const q = quillGeometry(params);
    const reach = scaraReach(params);
    const root = group(null, 'scara');

    roundedBox(root, [0.32, 0.03, 0.32], [0, 0.015, 0], materials.frameDark, 'Base plate', 0.006);
    cylinder(root, COLUMN_RADIUS, armHeight - 0.18, [0, (armHeight - 0.18) / 2 + 0.03, 0], materials.machineWhite, 'Column', { segments: 28 });
    cylinder(root, 0.13, 0.06, [0, armHeight - 0.12, 0], materials.machineBlue, 'J1 housing', { segments: 28 });

    const shoulder = group(root, 'J1', [0, armHeight - 0.08, 0]);
    roundedBox(shoulder, [l1 + 0.16, 0.12, 0.17], [l1 / 2, 0, 0], materials.machineWhite, 'Link 1', 0.04);
    cylinder(shoulder, 0.09, 0.13, [0, 0, 0], materials.machineBlue, 'J1 cap', { segments: 24 });
    const elbow = group(shoulder, 'J2', [l1, 0.1, 0]);
    cylinder(elbow, 0.08, 0.1, [0, 0, 0], materials.machineBlue, 'J2 cap', { segments: 24 });
    roundedBox(elbow, [l2 + 0.13, 0.09, 0.14], [l2 / 2, 0, 0], materials.machineWhite, 'Link 2', 0.035);
    roundedBox(elbow, [0.1, 0.16, 0.12], [l2, 0.06, 0], materials.machineWhite, 'Quill head', 0.02);

    const quill = group(elbow, 'J3', [l2, 0, 0]);
    cylinder(quill, 0.02, q.length, [0, QUILL_ABOVE - q.length / 2, 0], materials.chrome, 'Ball screw spline', { segments: 16 });
    const roll = group(quill, 'J4', [0, QUILL_ABOVE - q.length, 0]);
    cylinder(roll, 0.04, FLANGE, [0, -FLANGE / 2, 0], materials.machineBlue, 'Tool flange', { segments: 20 });
    // The tool group's origin is the tool point; the gripper body hangs from the flange above it.
    const tool = group(roll, 'Tool', [0, -FLANGE - (fingerLength + 0.05), 0]);
    const gripper = buildFingerGripper(tool, materials, { fingerLength, maxGap });
    const driver = params.screwdriver ? buildScrewdriver(tool, materials, { fingerLength }) : null;

    const pose = { x: 0, z: 0, yaw: 0 };
    const solve = () => {
      const distance = Math.min(Math.max(Math.hypot(pose.x, pose.z), reach.min), reach.max);
      // Rotation about +Y turns +X towards −Z, so a heading angle is atan2(−z, x).
      const heading = Math.atan2(-pose.z, pose.x);
      const cosElbow = Math.min(Math.max((distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1), 1);
      const q2 = Math.acos(cosElbow);
      const q1 = heading - Math.atan2(l2 * Math.sin(q2), l1 + l2 * Math.cos(q2));
      shoulder.rotation.y = q1;
      elbow.rotation.y = q2;
      roll.rotation.y = pose.yaw - q1 - q2;
    };

    return {
      root,
      anchors: driver ? { tool, bit: driver.tip } : { tool },
      motions: {
        x: (v) => { pose.x = v; solve(); },
        y: (v) => { quill.position.y = v + q.toolDrop - q.elbowY; },
        z: (v) => { pose.z = v; solve(); },
        yaw: (v) => { pose.yaw = v; solve(); },
        grip: (v) => gripper.setGap(v),
        holding: (v) => gripper.setHolding(v === 'on'),
        ...(driver ? screwdriverMotions(driver) : {}),
      },
    };
  },
});
