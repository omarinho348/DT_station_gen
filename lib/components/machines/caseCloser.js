// Top-flap case closer bridging a case conveyor. Port of the reference station-2 CaseCloser.js. The
// case stops under it (port `work`); then
//   - two tucker bars (on X slides with vertical cylinders) drop in behind the end flaps and push them in,
//   - the compression plate tamps the end flaps flat,
//   - two side-folder bars (horizontal cylinders on the columns) push the side flaps in,
//   - the compression plate presses the closed top.
// Every tool parks outside the open-flap envelope, so the next case passes underneath. Sized from
// the case it closes; centred on the case stop; heights follow the belt height.
//
// Motions are in metres measured from the case, as the reference: `tuckerOut` / `folderOut` beyond
// the end / side walls (negative = over the case), `tuckerUp` above the end-flap hinge, `plateUp`
// of the plate underside above the side-flap hinge (0 = pressing the closed top).
import { z } from 'zod';
import { defineComponent } from '../../registry.js';
import { group, box, cylinder, roundedBox } from '../../core/primitives.js';

export const CLOSER_BAR_RADIUS = 0.012; // tucker and folder bars; contact clearance = flap + this
const PARK = { out: 0.12, up: 0.27, fold: 0.15, plate: 0.3 }; // reference park / fold values

const sizes = (p, beltHeight) => {
  const top = beltHeight + p.caseHeight;
  const columnZ = Math.max(0.6, p.caseWidth / 2 + 0.39);
  return {
    top,
    minorHingeY: top - p.flap * 2,
    majorHingeY: top - p.flap,
    columnZ,
    beamY: top + 0.62,
    railY: top + 0.5,
    railZ: p.caseWidth / 2 + 0.025,
    beamHalfX: p.caseLength / 2 + 0.21,
    plate: { x: p.caseLength / 2 - 0.02, z: p.caseWidth / 2 - 0.03 },
    cylinderZ: columnZ - 0.13,
  };
};

defineComponent({
  type: 'caseCloser',
  category: 'machine',
  summary: 'Top-flap case closer over a case conveyor: tucker bars fold the end flaps, side folders the side flaps, a plate presses the top.',
  params: z.object({
    caseLength: z.number().min(0.25).max(1.0).default(0.62).describe('Case length along X (m)'),
    caseWidth: z.number().min(0.2).max(0.8).default(0.42).describe('Case width along Z (m)'),
    caseHeight: z.number().min(0.15).max(0.8).default(0.42).describe('Case height to the closed top (m)'),
    flap: z.number().min(0.002).max(0.02).default(0.005).describe('Flap board thickness (m)'),
  }),
  footprint: (p, ctx) => {
    const s = sizes(p, ctx.beltHeight);
    return { x: [-s.beamHalfX, s.beamHalfX], z: [-(s.columnZ + 0.11), s.columnZ + 0.11], height: s.top + 0.88 };
  },
  mount: 'overConveyor',
  ports: (p, ctx) => ({ work: { position: [0, ctx.beltHeight, 0], direction: 'work', carries: 'case' } }),
  motions: {
    tuckerOut: { range: [-0.1, 0.15], default: PARK.out },
    tuckerUp: { range: [0.1, 0.3], default: PARK.up },
    folderOut: { range: [-0.12, 0.15], default: PARK.out },
    plateUp: { range: [0, 0.35], default: PARK.plate },
  },
  ops: [],
  build({ params, materials, beltHeight }) {
    const { caseLength, caseWidth } = params;
    const s = sizes(params, beltHeight);
    const r = CLOSER_BAR_RADIUS;
    const root = group(null, 'caseCloser');

    // Frame: two columns, the top beam, tucker beams on hangers, the press cylinder.
    const frame = group(root, 'Closer frame');
    [-1, 1].forEach((side) => {
      roundedBox(frame, [0.08, s.beamY + 0.05, 0.08], [0, (s.beamY + 0.05) / 2, side * s.columnZ], materials.frame, 'Closer column', 0.012);
      roundedBox(frame, [0.22, 0.02, 0.22], [0, 0.01, side * s.columnZ], materials.brushed, 'Closer foot', 0.004);
      roundedBox(frame, [s.beamHalfX * 2, 0.06, 0.06], [0, s.railY, side * s.railZ], materials.frame, 'Tucker beam', 0.008);
      box(frame, [s.beamHalfX * 2 - 0.04, 0.012, 0.02], [0, s.railY - 0.036, side * s.railZ], materials.chrome, 'Tucker rail');
      roundedBox(frame, [0.1, 0.06, 0.06], [0, (s.railY + s.beamY) / 2, side * s.railZ], materials.frameDark, 'Beam hanger', 0.006);
    });
    roundedBox(frame, [0.12, 0.1, s.columnZ * 2 + 0.12], [0, s.beamY, 0], materials.frame, 'Closer beam', 0.012);
    cylinder(frame, 0.045, 0.47, [0, s.top + 0.615, 0], materials.aluminium, 'Press cylinder', { segments: 24 });
    cylinder(frame, 0.05, 0.03, [0, s.top + 0.865, 0], materials.safetyYellow, 'Press cylinder cap', { segments: 24 });

    // Compression plate on its rod.
    const plate = group(root, 'Compression plate');
    box(plate, [s.plate.x * 2 - 0.02, 0.008, s.plate.z * 2 - 0.02], [0, 0.004, 0], materials.rubber, 'Press pad');
    roundedBox(plate, [s.plate.x * 2, 0.02, s.plate.z * 2], [0, 0.018, 0], materials.stainless, 'Press plate', 0.004);
    roundedBox(plate, [0.16, 0.03, 0.16], [0, 0.043, 0], materials.brushed, 'Plate flange', 0.006);
    cylinder(plate, 0.025, 0.4, [0, 0.258, 0], materials.chrome, 'Press rod', { segments: 16 });

    // End-flap tuckers (trailing −X, leading +X) on slides under the tucker beams.
    const tuckers = [-1, 1].map((side) => {
      const carriage = group(root, side > 0 ? 'Tucker leading' : 'Tucker trailing');
      const bar = group(carriage, 'Tucker bar');
      cylinder(bar, r, s.railZ * 2 + 0.02, [0, 0, 0], materials.rubber, 'Tucker roller', { axis: 'z', segments: 16 });
      [-1, 1].forEach((zs) => {
        roundedBox(carriage, [0.1, 0.04, 0.08], [0, s.railY - 0.05, zs * s.railZ], materials.frameDark, 'Slide block', 0.006);
        cylinder(carriage, 0.02, 0.12, [0, s.railY - 0.13, zs * s.railZ], materials.aluminium, 'Tucker cylinder', { segments: 16 });
        cylinder(bar, 0.009, 0.26, [0, 0.13, zs * s.railZ], materials.chrome, 'Tucker rod', { segments: 12 });
      });
      return { side, carriage, bar };
    });

    // Side-flap folders (rear −Z, front +Z) on horizontal cylinders hung from the columns.
    const folderY = s.majorHingeY + PARK.fold;
    // Rod long enough to stay in its cylinder over the whole folder travel (reference length at the defaults).
    const rodEnd = (s.cylinderZ - 0.11) - (caseWidth / 2 - 0.12) + 0.01;
    const rodLength = rodEnd - 0.02;
    const folders = [-1, 1].map((side) => {
      cylinder(frame, 0.028, 0.22, [0, folderY, side * s.cylinderZ], materials.aluminium, 'Folder cylinder', { axis: 'z', segments: 20 });
      roundedBox(frame, [0.1, 0.1, 0.03], [0, folderY, side * (s.columnZ - 0.055)], materials.frameDark, 'Folder bracket', 0.006);
      const slide = group(root, side > 0 ? 'Side folder front' : 'Side folder rear', [0, folderY, 0]);
      cylinder(slide, r, s.plate.x * 2, [0, 0, 0], materials.rubber, 'Folder roller', { axis: 'x', segments: 16 });
      roundedBox(slide, [0.06, 0.04, 0.03], [0, 0, side * 0.02], materials.safetyYellow, 'Folder clevis', 0.006);
      cylinder(slide, 0.012, rodLength, [0, 0, side * (0.02 + rodLength / 2)], materials.chrome, 'Folder rod', { axis: 'z', segments: 12 });
      return { side, slide };
    });

    let tuckerOut = PARK.out;
    let tuckerUp = PARK.up;
    const placeTuckers = () => tuckers.forEach(({ side, carriage, bar }) => {
      carriage.position.x = side * (caseLength / 2 + tuckerOut);
      bar.position.y = s.minorHingeY + tuckerUp;
    });
    return {
      root,
      motions: {
        tuckerOut(v) { tuckerOut = v; placeTuckers(); },
        tuckerUp(v) { tuckerUp = v; placeTuckers(); },
        folderOut(v) { folders.forEach(({ side, slide }) => { slide.position.z = side * (caseWidth / 2 + v); }); },
        plateUp(v) { plate.position.y = s.majorHingeY + v; },
      },
    };
  },
});
