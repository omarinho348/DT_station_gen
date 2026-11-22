// Printer parts: poses (kit tray / assembled), screws, axes, dock port, cable routes and the
// procedural geometry of every part. Ported from the reference PrinterModel.js (kept close to it
// so Phase 4 can compare against the reference line). Printer space: origin on the carrier's
// build zone, metres, +X right, +Z front.
import * as THREE from 'three';
import { addMesh, box, cylinder, group, roundedBoxGeometry } from '../../core/primitives.js';
import { CARRIER, TRAY } from './definition.js';

const HALF_PI = Math.PI / 2;
/** Tray centre in printer space (the printer sits on the build zone, the tray beside it). */
export const TRAY_OFFSET = new THREE.Vector3(CARRIER.trayX - CARRIER.buildX, 0, 0);
const tray = (x, y, z) => [TRAY_OFFSET.x + x, TRAY.floor + y, z];

// ---- Key dimensions (printer space, metres) ---------------------------------------------------

const RAIL_TOP = 0.052; // top of the base rails (feet 12 mm + 40 mm profile)
const UPRIGHT_Z = -0.035;
const GANTRY_Y = 0.245; // X gantry rest height (rail centre)
const GANTRY_Z = 0.001;
const BED_Y = 0.09; // Y carriage plate centre
const BED_TOP = BED_Y + 0.0195; // build sheet surface
const NOZZLE_BELOW_GANTRY = 0.0435;
const LEAD_X = -0.135;
const LEAD_Z = 0.03;

/** Station that installs each part, in that station's assembly order. */
export const PART_ORDER = {
  ST1: ['BaseFrame', 'Upright_L', 'Upright_R', 'TopBar', 'LeadScrew', 'XGantry', 'Bed', 'Motor_Z', 'Motor_Y', 'PrintHead', 'ElectronicsBox', 'PSU', 'Display', 'Harness'],
  ST2: ['Motor_Z', 'Motor_Y', 'Bed', 'Upright_L', 'Upright_R', 'XGantry', 'LeadScrew', 'TopBar'],
  ST3: ['ElectronicsBox', 'PSU', 'PrintHead', 'Display'],
};

export const PART_LABELS = {
  BaseFrame: 'base frame (Y-axis assy)',
  Motor_Z: 'Z motor assy',
  Motor_Y: 'Y motor assy',
  Upright_L: 'left upright',
  Upright_R: 'right upright',
  TopBar: 'top bar',
  LeadScrew: 'Z lead screw',
  XGantry: 'X-axis assy',
  Bed: 'bed assy',
  ElectronicsBox: 'mainboard enclosure',
  PSU: 'power supply',
  PrintHead: 'hotend assy',
  Display: 'LCD module',
  Harness: 'cable harness',
};

/** Part numbers printed on bins, nests and the kit tray foam. */
export const PART_NUMBERS = {
  BaseFrame: 'P1-100', Motor_Z: 'P1-210', Motor_Y: 'P1-220', Upright_L: 'P1-110', Upright_R: 'P1-111', TopBar: 'P1-120',
  LeadScrew: 'P1-230', XGantry: 'P1-300', Bed: 'P1-400', ElectronicsBox: 'P1-500', PSU: 'P1-510', PrintHead: 'P1-600',
  Display: 'P1-520', Harness: 'P1-530',
};

export const PART_POSES = {
  // Held by the front cross member (the gripper clamps across its 20 mm depth).
  BaseFrame: { asm: { at: [0, 0.032, 0] }, grasp: [0, 0, 0.19] },
  Motor_Z: { asm: { at: [LEAD_X, 0.077, LEAD_Z] }, kit: { at: tray(0.09, 0.025, -0.025) }, grasp: [0, 0.021, 0] },
  Motor_Y: { asm: { at: [-0.045, 0.077, -0.19] }, kit: { at: tray(0.17, 0.025, -0.025) }, grasp: [0, 0.021, 0] },
  Upright_L: { asm: { at: [-0.16, 0.256, UPRIGHT_Z] }, kit: { at: tray(-0.26, 0.02, 0), yaw: HALF_PI, swing: HALF_PI }, grasp: [0, 0.17, 0] },
  Upright_R: { asm: { at: [0.16, 0.256, UPRIGHT_Z] }, kit: { at: tray(-0.17, 0.02, 0), yaw: HALF_PI, swing: HALF_PI }, grasp: [0, 0.17, 0] },
  TopBar: { asm: { at: [0, 0.466, UPRIGHT_Z] }, kit: { at: tray(-0.11, 0.01, 0), yaw: HALF_PI }, grasp: [0.09, 0, 0] },
  LeadScrew: { asm: { at: [LEAD_X, 0.275, LEAD_Z] }, kit: { at: tray(-0.075, 0.004, 0), yaw: HALF_PI, swing: HALF_PI }, grasp: [0, 0.13, 0] },
  XGantry: { asm: { at: [0, GANTRY_Y, GANTRY_Z] }, kit: { at: tray(0.005, 0.04, 0), yaw: HALF_PI }, grasp: [0.09, 0.015, 0] },
  // Kit height: the V-wheels reach 63 mm below the plate (the reference used 69 mm, so the bed
  // hovered 6 mm above the foam).
  Bed: { asm: { at: [0, BED_Y, 0] }, kit: { at: tray(0.1725, 0.063, -0.1775) }, grasp: [0.07, 0.017, 0] },
  ElectronicsBox: { asm: { at: [0.224, 0.032, -0.03] }, kit: { at: tray(0.175, 0.02, 0.05), yaw: HALF_PI } },
  PSU: { asm: { at: [-0.234, 0.032, -0.01] }, kit: { at: tray(0.175, 0.02, 0.155), yaw: HALF_PI } },
  PrintHead: { asm: { at: [0, GANTRY_Y + 0.0025, GANTRY_Z + 0.0345] }, kit: { at: tray(0.25, 0.046, -0.025) }, grasp: [0, 0.02, 0] },
  Display: { asm: { at: [0.215, 0.047, 0.215] }, kit: { at: tray(0.12, 0.0275, 0.255) }, grasp: [-0.02, 0.02, 0] },
  Harness: { asm: { at: tray(0.24, 0.003, 0.255) }, kit: { at: tray(0.24, 0.003, 0.255) }, grasp: [0, 0.02, 0] },
};

/** Vertical cap screws per part (part-local position of the screw head's seat). */
export const PART_SCREWS = {
  Motor_Z: [[-0.035, -0.021, -0.018], [-0.035, -0.021, 0.018]],
  Upright_L: [[0, -0.2, -0.03], [0, -0.2, 0.03]],
  Upright_R: [[0, -0.2, -0.03], [0, -0.2, 0.03]],
  Motor_Y: [[-0.03, -0.021, 0], [0.033, -0.021, 0]],
  Bed: [[-0.018, 0.002, 0.12], [0.018, 0.002, 0.12]],
  TopBar: [[-0.16, 0.01, 0], [0.16, 0.01, 0]],
  ElectronicsBox: [[-0.058, 0.0235, -0.06], [-0.058, 0.0235, 0.06]],
  PSU: [[0.067, 0.0235, -0.085], [0.067, 0.0235, 0.095]],
  PrintHead: [[-0.012, 0.0315, 0.0], [0.012, 0.0315, 0.0]],
  Display: [[-0.055, -0.0245, 0], [0.055, -0.0245, 0]],
};

/** Axis travel of the finished printer (Station 4 drives these). */
export const PRINTER_AXES = {
  head: [-0.09, 0.09],
  bed: [-0.05, 0.07],
  /** Nozzle height above the bed surface at rest. */
  nozzleRest: GANTRY_Y - NOZZLE_BELOW_GANTRY - BED_TOP,
  bedTop: BED_TOP,
  nozzleBelowGantry: NOZZLE_BELOW_GANTRY,
  /** Bed probe offset from the nozzle along X. */
  probeOffset: -0.03,
};

/** Rear face of the mainboard enclosure (printer-space Z), where ST4's test connector docks. */
export const ELECTRONICS_REAR_Z = -0.11;
/** Mainboard enclosure dock port (printer space, on the rear face). */
export const DOCK_PORT = new THREE.Vector3(0.224, 0.032, ELECTRONICS_REAR_Z);

// ---- Cable harness ----------------------------------------------------------------------------

/** Mainboard sockets on the enclosure's top face, facing up (printer space). */
export const BOARD_SOCKETS = Array.from({ length: 7 }, (_, index) => [0.236, RAIL_TOP + 0.003, -0.1 + index * 0.02]);
export const DOWN = [0, -1, 0];

/*
 * `kind: 'loose'` cables come in the harness bag (connector on both ends: plug end A at the
 * device, then lay the cable through the clips and plug end B into the mainboard).
 * `kind: 'attached'` cables are part of their device (hotend, heated bed, PSU); only their free
 * end B is routed. Points are printer space; `{ part, at }` points follow a part (offset from its
 * current position), so cables stay attached while ST4 moves the axes.
 */
export const CABLES = [
  {
    name: 'Z motor', color: 'blue', kind: 'loose', coil: 0,
    a: { part: 'Motor_Z', at: [0, -0.012, 0.024], dir: [0, 0, -1] },
    clips: [[-0.16, RAIL_TOP + 0.004, 0.12], [-0.1, RAIL_TOP + 0.004, 0.19], [0.1, RAIL_TOP + 0.004, 0.19], [0.16, RAIL_TOP + 0.004, 0.12]],
    b: 0,
  },
  {
    name: 'Y motor', color: 'yellow', kind: 'loose', coil: 1,
    a: { part: 'Motor_Y', at: [0, 0.024, 0.01], dir: DOWN },
    clips: [[0.0, RAIL_TOP + 0.004, -0.19], [0.1, RAIL_TOP + 0.004, -0.19], [0.16, RAIL_TOP + 0.004, -0.15]],
    b: 1,
  },
  {
    name: 'X motor', color: 'black', kind: 'loose', coil: 2,
    a: { part: 'XGantry', at: [-0.2, 0.024, -0.012], dir: DOWN },
    clips: [{ part: 'Upright_L', at: [0, 0.1, -0.022] }, { part: 'Upright_L', at: [0, -0.05, -0.022] }, [-0.16, RAIL_TOP + 0.004, -0.15], [-0.1, RAIL_TOP + 0.004, -0.19], [0.1, RAIL_TOP + 0.004, -0.19]],
    b: 2,
  },
  {
    name: 'LCD', color: 'white', kind: 'loose', coil: 3,
    a: { part: 'Display', at: [0.03, 0.03, -0.006], dir: DOWN },
    clips: [[0.16, RAIL_TOP + 0.004, 0.12]],
    b: 6,
  },
  {
    name: 'Hotend', color: 'red', kind: 'attached',
    a: { part: 'PrintHead', at: [-0.02, 0.022, -0.012] },
    rest: { part: 'Bed', at: [0.06, 0.0225, 0.03] },
    clips: [{ part: 'XGantry', at: [-0.2, 0.03, -0.035] }, { part: 'Upright_L', at: [0, 0.1, -0.022] }, { part: 'Upright_L', at: [0, -0.05, -0.022] }, [-0.16, RAIL_TOP + 0.004, -0.15], [-0.1, RAIL_TOP + 0.004, -0.19], [0.1, RAIL_TOP + 0.004, -0.19]],
    b: 3,
  },
  {
    name: 'Heated bed', color: 'red', kind: 'attached',
    a: { part: 'Bed', at: [0, 0.012, -0.11] },
    rest: [0.06, 0.006, -0.25],
    clips: [[0.1, RAIL_TOP + 0.004, -0.19], [0.16, RAIL_TOP + 0.004, -0.15]],
    b: 4,
  },
  {
    name: 'Power', color: 'black', kind: 'attached',
    a: { part: 'PSU', at: [-0.026, 0.021, 0.07] },
    rest: [-0.25, 0.006, 0.16],
    clips: [[-0.16, RAIL_TOP + 0.004, 0.12], [-0.1, RAIL_TOP + 0.004, 0.19], [0.1, RAIL_TOP + 0.004, 0.19], [0.16, RAIL_TOP + 0.004, 0.12]],
    b: 5,
  },
];
export const CABLE_NAMES = CABLES.map((cable) => cable.name);

/**
 * Where a cable goes, from the static part poses (printer space, every part assembled, the harness
 * in its kit pose): socket A (loose cables, with plug direction), coil (harness bag, or rest place
 * of an attached cable), clips in routing order, mainboard socket B. Needs no built printer, so
 * station moves and their durations can be planned from it.
 */
export function cableRoute(index) {
  const definition = CABLES[index];
  const asm = (point) => {
    if (Array.isArray(point)) return new THREE.Vector3(...point);
    const pose = partPose(point.part, point.part === 'Harness' ? 'kit' : 'asm');
    return new THREE.Vector3(...point.at).applyQuaternion(rotationFor(pose.yaw, pose.swing)).add(pose.at);
  };
  const coil = definition.kind === 'loose'
    ? partPose('Harness', 'kit').at.add(new THREE.Vector3(0, definition.coil * 0.0065, 0)).add(new THREE.Vector3(0.012, 0.004, 0.016))
    : asm(definition.rest).add(new THREE.Vector3(0, 0.003, 0));
  const boxPose = partPose('ElectronicsBox', 'asm').at;
  const b = asm({ part: 'ElectronicsBox', at: new THREE.Vector3(...BOARD_SOCKETS[definition.b]).sub(boxPose).toArray() });
  return {
    kind: definition.kind,
    a: { point: asm(definition.a), dir: new THREE.Vector3(...(definition.a.dir || DOWN)) },
    coil,
    clips: definition.clips.map(asm),
    b: { point: b, dir: new THREE.Vector3(...DOWN), socket: definition.b + 1 },
  };
}
export const CABLE_SEGMENTS = 64;
export const CABLE_RADIAL = 6;

export function rotationFor(yaw = 0, swing = 0) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  return q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), swing));
}

/** Puts `object` so its local `grasp` point is at `point` (parent space) with the given rotation. */
export function placeByGrasp(object, grasp, point, yaw = 0, swing = 0) {
  const q = rotationFor(yaw, swing);
  object.quaternion.copy(q);
  object.position.copy(point).sub(grasp.clone().applyQuaternion(q));
}

// ---- Geometry helpers -------------------------------------------------------------------------

const geometryCache = new Map();
/** Geometry shared by every printer (marked so a unit's dispose() leaves it alone). */
export function cached(key, build) {
  if (!geometryCache.has(key)) {
    const geometry = build();
    geometry.userData.shared = true;
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

/** T-slot aluminium profile cross-section (w × h), a 6 mm slot in every 20 mm of each face. */
function profileShape(w, h) {
  const shape = new THREE.Shape();
  const slot = 0.003;
  const depth = 0.004;
  const edge = (x0, y0, x1, y1, nx, ny, count) => {
    for (let i = 0; i < count; i += 1) {
      const t = (i + 0.5) / count;
      const cx = x0 + (x1 - x0) * t;
      const cy = y0 + (y1 - y0) * t;
      const dx = (x1 - x0) / Math.hypot(x1 - x0, y1 - y0);
      const dy = (y1 - y0) / Math.hypot(x1 - x0, y1 - y0);
      shape.lineTo(cx - dx * slot, cy - dy * slot);
      shape.lineTo(cx - dx * slot + nx * depth, cy - dy * slot + ny * depth);
      shape.lineTo(cx + dx * slot + nx * depth, cy + dy * slot + ny * depth);
      shape.lineTo(cx + dx * slot, cy + dy * slot);
    }
    shape.lineTo(x1, y1);
  };
  shape.moveTo(-w / 2, -h / 2);
  edge(-w / 2, -h / 2, w / 2, -h / 2, 0, 1, Math.round(w / 0.02));
  edge(w / 2, -h / 2, w / 2, h / 2, -1, 0, Math.round(h / 0.02));
  edge(w / 2, h / 2, -w / 2, h / 2, 0, -1, Math.round(w / 0.02));
  edge(-w / 2, h / 2, -w / 2, -h / 2, 1, 0, Math.round(h / 0.02));
  // Centre bore.
  const bore = new THREE.Path();
  bore.absarc(0, 0, 0.0021, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  return shape;
}

/**
 * Extrusion along `axis`. Cross-section: for 'x' (width along Z, height along Y), for 'y'
 * (width along X, height along Z), for 'z' (width along X, height along Y).
 */
function extrusionGeometry(w, h, length, axis) {
  return cached(`ext:${w}:${h}:${length}:${axis}`, () => {
    const geometry = new THREE.ExtrudeGeometry(profileShape(w, h), { depth: length, bevelEnabled: false, curveSegments: 6 });
    geometry.translate(0, 0, -length / 2);
    if (axis === 'x') geometry.rotateY(HALF_PI);
    if (axis === 'y') geometry.rotateX(-HALF_PI);
    geometry.computeVertexNormals();
    return geometry;
  });
}

function extrusion(parent, m, [w, h], length, axis, position, name) {
  return addMesh(parent, extrusionGeometry(w, h, length, axis), m.extrusion, name, position);
}

function screwHead(parent, m, position) {
  const head = group(parent, 'Screw', position);
  addMesh(head, cached('screwHead', () => new THREE.CylinderGeometry(0.0035, 0.0035, 0.003, 12).translate(0, 0.0015, 0)), m.chrome, 'Cap screw head');
  addMesh(head, cached('screwSocket', () => new THREE.CylinderGeometry(0.0016, 0.0016, 0.0006, 6).translate(0, 0.0031, 0)), m.rubber, 'Hex socket');
  return head;
}

function socket(parent, m, position, name = 'Socket') {
  return addMesh(parent, cached('socket', () => new THREE.BoxGeometry(0.012, 0.004, 0.007)), m.guide, name, position);
}

function clip(parent, m, position) {
  return addMesh(parent, cached('clip', () => new THREE.BoxGeometry(0.008, 0.007, 0.012)), m.printedBlack, 'Cable clip', position);
}

/** NEMA 17 stepper. `shaft` is the shaft direction ('x', 'y', 'z'); socket on top. */
function buildStepper(parent, m, shaft = 'y', name = 'Stepper') {
  const motor = group(parent, name);
  const body = group(motor, 'Body');
  if (shaft === 'x') body.rotation.z = -HALF_PI;
  if (shaft === 'z') body.rotation.x = HALF_PI;
  addMesh(body, cached('stator', () => roundedBoxGeometry([0.042, 0.032, 0.042], 0.004)), m.motorBody, 'Stator');
  addMesh(body, cached('motorCap', () => roundedBoxGeometry([0.042, 0.005, 0.042], 0.004)), m.motorCap, 'Front cap', [0, 0.0185, 0]);
  addMesh(body, cached('motorCap', () => roundedBoxGeometry([0.042, 0.005, 0.042], 0.004)), m.motorCap, 'Rear cap', [0, -0.0185, 0]);
  cylinder(body, 0.011, 0.002, [0, 0.022, 0], m.motorCap, 'Pilot boss', { segments: 18 });
  cylinder(body, 0.0025, 0.022, [0, 0.032, 0], m.rod, 'Shaft', { segments: 10 });
  return motor;
}

// ---- Parts --------------------------------------------------------------------------------------

/** Builds a part group. Origin = the part's `asm.at` point; geometry offsets are printer offsets from it. */
export function buildPart(name, m) {
  const part = group(null, name);
  const at = new THREE.Vector3(...PART_POSES[name].asm.at);
  /** Adds at a printer-space position (converted to part local). */
  const P = (x, y, z) => [x - at.x, y - at.y, z - at.z];

  switch (name) {
    case 'BaseFrame': {
      [-1, 1].forEach((side) => {
        extrusion(part, m, [0.04, 0.04], 0.4, 'z', P(side * 0.16, 0.032, 0), `Side rail 4040 ${side}`);
        extrusion(part, m, [0.02, 0.04], 0.28, 'x', P(0, 0.032, side * 0.19), `Cross member 2040 ${side}`);
        [-1, 1].forEach((end) => {
          cylinder(part, 0.018, 0.012, P(side * 0.16, 0.006, end * 0.18), m.rubber, 'Rubber foot', { segments: 18 });
          // Corner gussets inside each rail / cross-member joint.
          box(part, [0.016, 0.03, 0.016], P(side * 0.132, 0.032, end * 0.172), m.frameDark, 'Corner gusset');
        });
      });
      extrusion(part, m, [0.04, 0.04], 0.36, 'z', P(0, 0.032, 0), 'Centre rail 4040');
      // Front Y idler (bracket on the centre rail end, pulley).
      box(part, [0.034, 0.036, 0.01], P(0, 0.07, 0.185), m.frameDark, 'Y idler bracket');
      cylinder(part, 0.0065, 0.008, P(0, 0.077, 0.177), m.rod, 'Y idler pulley', { axis: 'x', segments: 16 });
      // Y belt: tied off at the rear until the Y motor is fitted (ST2), then looped round its pulley.
      const belt = group(part, 'Y belt');
      const free = group(belt, 'Belt tied off');
      box(free, [0.006, 0.0015, 0.34], P(0, 0.083, 0.007), m.rubber, 'Belt top strand');
      box(free, [0.006, 0.0015, 0.34], P(0, 0.0705, 0.007), m.rubber, 'Belt bottom strand');
      box(free, [0.012, 0.018, 0.008], P(0, 0.077, -0.166), m.printedBlack, 'Belt tie-off clip');
      const engaged = group(belt, 'Belt engaged');
      box(engaged, [0.006, 0.0015, 0.367], P(0, 0.083, -0.0065), m.rubber, 'Belt top strand');
      box(engaged, [0.006, 0.0015, 0.367], P(0, 0.0705, -0.0065), m.rubber, 'Belt bottom strand');
      engaged.visible = false;
      // LCD bracket on the right rail's front end.
      box(part, [0.1, 0.05, 0.004], P(0.215, 0.037, 0.202), m.frameDark, 'LCD bracket plate');
      box(part, [0.12, 0.0035, 0.03], P(0.215, 0.01775, 0.218), m.frameDark, 'LCD bracket shelf');
      // Cable clips on the base (routing points of the harness).
      [[-0.16, 0.12], [-0.16, -0.15], [0.16, 0.12], [0.16, -0.15]].forEach(([x, z]) => clip(part, m, P(x, RAIL_TOP + 0.0035, z)));
      [[-0.1, -0.19], [0, -0.19], [0.1, -0.19], [-0.1, 0.19], [0.1, 0.19]].forEach(([x, z]) => clip(part, m, P(x, RAIL_TOP + 0.0035, z)));
      break;
    }
    case 'Motor_Z': {
      buildStepper(part, m, 'y');
      box(part, [0.066, 0.004, 0.05], [-0.012, -0.023, 0], m.aluminium, 'Motor bracket plate');
      cylinder(part, 0.0095, 0.016, [0, 0.029, 0], m.aluminium, 'Shaft coupler', { segments: 18 });
      [-1, 1].forEach((side) => cylinder(part, 0.0022, 0.003, [0.0095, 0.025 + side * 0.004, 0], m.frameDark, 'Coupler set screw', { axis: 'x', segments: 8 }));
      socket(part, m, [0, -0.012, 0.0225], 'Motor socket').rotation.x = HALF_PI;
      break;
    }
    case 'Motor_Y': {
      buildStepper(part, m, 'x');
      box(part, [0.08, 0.004, 0.03], [0.002, -0.023, 0], m.aluminium, 'Motor bracket plate');
      cylinder(part, 0.0065, 0.008, [0.045, 0, 0], m.rod, 'GT2 pulley', { axis: 'x', segments: 16 });
      socket(part, m, [0, 0.0225, 0.01], 'Motor socket');
      break;
    }
    case 'Upright_L':
    case 'Upright_R': {
      extrusion(part, m, [0.02, 0.04], 0.4, 'y', [0, 0, 0], 'Upright 2040');
      box(part, [0.04, 0.004, 0.08], [0, -0.202, 0], m.frameDark, 'Foot plate');
      box(part, [0.004, 0.03, 0.06], [name === 'Upright_L' ? 0.012 : -0.012, -0.185, 0], m.frameDark, 'Foot gusset');
      if (name === 'Upright_L') {
        clip(part, m, [0, 0.1, -0.0235]);
        clip(part, m, [0, -0.05, -0.0235]);
      }
      break;
    }
    case 'TopBar': {
      extrusion(part, m, [0.02, 0.02], 0.36, 'x', [0, 0, 0], 'Top bar 2020');
      box(part, [0.012, 0.06, 0.012], [0, 0.04, 0], m.printedBlack, 'Spool holder post');
      cylinder(part, 0.012, 0.09, [0, 0.07, 0.045], m.printedBlack, 'Spool spindle', { axis: 'z', segments: 18 });
      break;
    }
    case 'LeadScrew': {
      addMesh(part, cached('leadScrew', () => new THREE.CylinderGeometry(0.004, 0.004, 0.33, 10)), m.leadScrew, 'Lead screw T8');
      break;
    }
    case 'XGantry': {
      extrusion(part, m, [0.02, 0.03], 0.38, 'x', [0, 0, 0.0005], 'X rail 2020');
      [-1, 1].forEach((side) => {
        const x = side * 0.16;
        box(part, [0.05, 0.08, 0.006], [x, 0, -0.0125], m.aluminium, 'End plate front');
        box(part, [0.05, 0.08, 0.006], [x, 0, -0.059], m.aluminium, 'End plate rear');
        box(part, [0.004, 0.08, 0.0555], [side * 0.176, 0, -0.03575], m.aluminium, 'End plate side');
        [-0.025, 0.025].forEach((y) => cylinder(part, 0.012, 0.008, [x, y, -0.066], m.printedBlack, 'V-wheel', { axis: 'z', segments: 18 }));
      });
      // Brass lead-screw nut on an arm from the left end plate.
      box(part, [0.036, 0.012, 0.05], [-0.147, -0.03, 0.01], m.aluminium, 'Z nut arm');
      cylinder(part, 0.009, 0.016, [LEAD_X, -0.03, LEAD_Z - GANTRY_Z], m.brass, 'Lead screw nut', { segments: 16 });
      // X motor (shaft +Z) with pulley, X belt and right idler.
      const motor = buildStepper(part, m, 'z', 'X motor');
      motor.position.set(-0.2, 0, -0.012);
      socket(part, m, [-0.2, 0.0225, -0.012], 'X motor socket');
      clip(part, m, [-0.2, 0.0255, -0.035]);
      cylinder(part, 0.0065, 0.008, [-0.2, 0, 0.018], m.rod, 'X pulley', { axis: 'z', segments: 16 });
      box(part, [0.024, 0.03, 0.006], [0.19, 0, 0.0135], m.aluminium, 'X idler bracket');
      cylinder(part, 0.0065, 0.008, [0.19, 0, 0.018], m.rod, 'X idler pulley', { axis: 'z', segments: 16 });
      box(part, [0.39, 0.0015, 0.006], [-0.005, 0.0065, 0.0185], m.rubber, 'X belt top');
      box(part, [0.39, 0.0015, 0.006], [-0.005, -0.0065, 0.0185], m.rubber, 'X belt bottom');
      // Carriage (moves with the head): plate on V-wheels and the hotend shelf.
      const carriage = group(part, 'Carriage');
      box(carriage, [0.06, 0.06, 0.006], [0, 0, 0.0135], m.aluminium, 'Carriage plate');
      box(carriage, [0.06, 0.004, 0.04], [0, 0.032, 0.0305], m.aluminium, 'Hotend shelf');
      [-0.022, 0.022].forEach((x) => cylinder(carriage, 0.01, 0.008, [x, 0.022, 0.006], m.printedBlack, 'Carriage wheel', { axis: 'z', segments: 16 }));
      cylinder(carriage, 0.01, 0.008, [0, -0.022, 0.006], m.printedBlack, 'Carriage wheel', { axis: 'z', segments: 16 });
      break;
    }
    case 'Bed': {
      box(part, [0.22, 0.004, 0.22], [0, 0, 0], m.aluminium, 'Y carriage plate');
      box(part, [0.06, 0.004, 0.02], [0, 0, 0.12], m.aluminium, 'Belt clamp tab');
      box(part, [0.02, 0.016, 0.03], [0, -0.01, 0], m.printedBlack, 'Belt clamp');
      [-1, 1].forEach((sx) => [-0.06, 0.06].forEach((z) => {
        box(part, [0.006, 0.056, 0.012], [sx * 0.042, -0.03, z], m.aluminium, 'Wheel hanger');
        cylinder(part, 0.011, 0.01, [sx * 0.031, -0.058, z], m.printedBlack, 'V-wheel', { segments: 18 });
      }));
      [-1, 1].forEach((sx) => [-1, 1].forEach((sz) => {
        cylinder(part, 0.008, 0.01, [sx * 0.1, -0.007, sz * 0.1], m.printedBlack, 'Levelling knob', { segments: 16 });
        cylinder(part, 0.006, 0.013, [sx * 0.1, 0.0085, sz * 0.1], m.spring, 'Levelling spring', { segments: 12 });
      }));
      box(part, [0.235, 0.003, 0.235], [0, 0.0165, 0], m.aluminium, 'Heated bed');
      box(part, [0.23, 0.0015, 0.23], [0, 0.01875, 0], m.bedSheet.clone(), 'Build sheet');
      break;
    }
    case 'ElectronicsBox': {
      addMesh(part, cached('ebox', () => roundedBoxGeometry([0.08, 0.04, 0.16], 0.003)), m.darkPanel, 'Enclosure');
      [-0.06, 0.06].forEach((z) => box(part, [0.036, 0.003, 0.02], [-0.058, 0.0215, z], m.darkPanel, 'Mounting tab'));
      cylinder(part, 0.016, 0.003, [0.0405, 0.002, 0.03], m.motorCap, 'Fan grille', { axis: 'x', segments: 20 });
      for (let i = 0; i < 5; i += 1) box(part, [0.0015, 0.004, 0.05], [0.0405, -0.01 + i * 0.005, -0.04], m.rubber, 'Vent slot');
      BOARD_SOCKETS.forEach((point, index) => socket(part, m, P(...point), `Board socket ${index + 1}`));
      box(part, [0.03, 0.016, 0.003], [0, 0, -0.0805], m.guide, 'Dock port');
      box(part, [0.02, 0.008, 0.002], [0.025, 0.012, -0.0805], m.carrierTag, 'USB port');
      break;
    }
    case 'PSU': {
      addMesh(part, cached('psu', () => new THREE.BoxGeometry(0.1, 0.04, 0.2)), m.psu, 'Housing');
      [-0.085, 0.095].forEach((z) => box(part, [0.036, 0.003, 0.02], [0.068, 0.0215, z], m.motorCap, 'Mounting tab'));
      box(part, [0.06, 0.012, 0.012], [-0.01, 0.004, 0.1], m.printedBlack, 'Terminal block cover');
      box(part, [0.026, 0.02, 0.004], [-0.03, 0, 0.101], m.rubber, 'Mains inlet');
      socket(part, m, [-0.026, 0.0215, 0.07], 'DC output');
      break;
    }
    case 'PrintHead': {
      box(part, [0.045, 0.012, 0.035], [0, 0.0215, 0], m.printedBlack, 'Mount block');
      for (let i = 0; i < 6; i += 1) box(part, [0.03, 0.002, 0.025], [0, -0.008 + i * 0.004, -0.004], m.aluminium, 'Heatsink fin');
      // Heat break from the heatsink down into the heater block (the reference one stopped 10 mm
      // short, leaving heater block and nozzle unattached).
      cylinder(part, 0.004, 0.04, [0, -0.005, -0.004], m.aluminium, 'Heat break');
      box(part, [0.045, 0.03, 0.008], [0, 0.0, 0.0135], m.printedOrange, 'Fan shroud');
      cylinder(part, 0.012, 0.004, [0, 0.0, 0.0185], m.printedBlack, 'Hotend fan', { axis: 'z', segments: 20 });
      box(part, [0.018, 0.01, 0.014], [0, -0.03, -0.003], m.brass.clone(), 'Heater block');
      cylinder(part, 0.0045, 0.011, [0, -0.0405, -0.003], m.brass, 'Nozzle', { radiusBottom: 0.0012, segments: 12 });
      // Inductive / touch bed probe on the left; its pin deploys for mesh probing.
      box(part, [0.012, 0.024, 0.012], [-0.03, -0.012, 0], m.printedBlack, 'Bed probe');
      const pin = group(part, 'Probe pin');
      cylinder(pin, 0.0012, 0.012, [-0.03, -0.028, 0], m.rod, 'Probe pin rod', { segments: 8 });
      break;
    }
    case 'Display': {
      addMesh(part, cached('lcd', () => roundedBoxGeometry([0.1, 0.055, 0.022], 0.003)), m.displayBezel, 'LCD housing');
      addMesh(part, cached('lcdScreen', () => new THREE.PlaneGeometry(0.06, 0.038)), m.screenOff, 'Screen', [-0.012, 0.002, 0.0115], { castShadow: false });
      cylinder(part, 0.008, 0.01, [0.036, -0.004, 0.014], m.motorCap, 'Encoder knob', { axis: 'z', segments: 16 });
      [-1, 1].forEach((side) => box(part, [0.012, 0.003, 0.016], [side * 0.055, -0.026, 0], m.displayBezel, 'Mounting tab'));
      socket(part, m, [0.03, 0.0285, -0.006], 'LCD socket');
      break;
    }
    case 'Harness': {
      // Four coiled cables, each with its two connectors, stacked in the bag.
      ['blue', 'yellow', 'black', 'white'].forEach((color, index) => {
        const coil = group(part, `Harness coil ${index + 1}`, [0, index * 0.0065, 0]);
        const torus = addMesh(coil, cached('coil', () => new THREE.TorusGeometry(0.02, 0.003, 6, 24)), m.cable[color], 'Coiled cable');
        torus.rotation.x = HALF_PI;
        box(coil, [0.012, 0.004, 0.007], [0.012, 0.002, 0.016], m.guide, 'Connector');
        box(coil, [0.012, 0.004, 0.007], [-0.012, 0.002, 0.016], m.guide, 'Connector');
      });
      addMesh(part, cached('bag', () => new THREE.BoxGeometry(0.06, 0.03, 0.055)), m.bag, 'Harness bag', [0, 0.012, 0], { castShadow: false });
      break;
    }
    default:
      throw new Error(`Unknown printer part: ${name}`);
  }
  // Screws (hidden until driven), seated on their part.
  part.userData.screws = (PART_SCREWS[name] || []).map((local) => {
    const head = screwHead(part, m, local);
    head.visible = false;
    return head;
  });
  return part;
}

/** A free-standing copy of a part (ST1's bins and nests hold these). */
export function createPartCopy(name, materials) {
  const part = buildPart(name, materials);
  part.userData.grasp = partGrasp(name);
  return part;
}

export function partPose(name, mode) {
  const pose = PART_POSES[name][mode];
  return { at: new THREE.Vector3(...pose.at), yaw: pose.yaw || 0, swing: pose.swing || 0 };
}

export const partGrasp = (name) => new THREE.Vector3(...(PART_POSES[name].grasp || [0, 0, 0]));

/** Screw ids of a part, `${part}:${index}`. */
export const partScrews = (name) => (PART_SCREWS[name] || []).map((_, index) => `${name}:${index}`);

/** Printer-space seat of a screw in the part's assembled pose. */
export function screwPoint(id) {
  const [name, index] = id.split(':');
  return partPose(name, 'asm').at.add(new THREE.Vector3(...PART_SCREWS[name][Number(index)]));
}
