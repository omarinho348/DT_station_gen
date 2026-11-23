// Views of the visual acceptance tests (scripts/visual-compare.mjs), per line: which pages render
// ours and the reference, and the camera / moment of each view. Cameras are
// [x, y, z, targetX, targetY, targetZ] in our line's world frame (lib/line/layout.js); the reference
// pages stand the reference line in the same frame. Views of a line must be in time order (one page
// load per source, moved forward view by view).

// ---- Printer line (Phase 4 step 8) -------------------------------------------------------------
// Station x along the line (the same pitch as the reference PrinterLineLayout).
const PRINTER_X = { st1: -14, st2: -8.4, st3: -2.8, st4: 2.8, st5: 8.4, st6: 14 };
const printerCloseUp = (x) => [x + 4.6, 3.3, 5.6, x, 1.0, -0.2];
const PRINTER_LINE_CAM = [0.5, 9.5, 15.5, 0, 0.9, -0.3];
const PRINTER_WIDE_CAM = [0, 15, 24, 0, 0.6, -0.3];

// ---- Lubricant line (Phase 5 step 9d) ----------------------------------------------------------
// The reference factory must stay at its origin (its station 3 mixes local and world coordinates),
// so both renders use ITS frame: our line is shifted to stand there (LUBRICANT_SHIFT = minus our
// palletizing station's layout position, checked by tests/spec/lubricant-line-visual.test.js).
// Station origins in that frame (reference FactoryLayout): station 1 −27.41 / 1.5, the can transfer
// belt −16.96 / 1.5, station 2 −11.21 / 0.75, station 3 0 / 0.
export const LUBRICANT_SHIFT = [-13.705, 0, 1.5];
const S1 = -27.41;
const T1 = -16.96;
const S2 = -11.21;
const S3 = 0;
const Z1 = 1.5;
const Z2 = 0.75;
const LUB = {
  wide: [-13.7, 20, 28.5, -13.7, 0.4, 0.9],
  line: [-13.7, 11, 18.5, -13.7, 0.8, 0.9],
  s1: [S1 + 1.2, 3.4, Z1 + 6.6, S1 - 0.3, 0.9, Z1 - 0.2],
  t1: [T1 + 2.6, 2.4, Z1 + 3.8, T1 + 0.2, 0.9, Z1 - 0.1],
  s2: [S2 + 3.6, 3.4, Z2 + 5.4, S2, 1.0, Z2],
  s3: [S3 + 1.6, 4.6, 8.6, S3 + 1.0, 1.0, 1.3],
  s3out: [S3 + 2.6, 5.0, 9.4, S3 + 2.4, 0.8, 1.7],
};

export const LINES = {
  'printer-line': {
    phase: 'Phase 4',
    ours: 'line=printer-line',
    reference: 'demo=reference',
    views: [
      { id: 'line-wide-0', t: 0, cam: PRINTER_WIDE_CAM, note: 'empty line before the first unit' },
      ...Object.entries(PRINTER_X).map(([st, x]) => ({ id: `${st}-262`, t: 262.3, cam: printerCloseUp(x) })),
      { id: 'line-262', t: 262.3, cam: PRINTER_LINE_CAM },
      ...Object.entries(PRINTER_X).map(([st, x]) => ({ id: `${st}-430`, t: 430, cam: printerCloseUp(x) })),
      { id: 'line-wide-500', t: 500, cam: PRINTER_WIDE_CAM },
      { id: 'st6-760', t: 760, cam: printerCloseUp(PRINTER_X.st6), note: 'six cartons on the dispatch pallet' },
      { id: 'line-760', t: 760, cam: PRINTER_LINE_CAM },
    ],
  },
  'lubricant-line': {
    phase: 'Phase 5',
    ours: `line=lubricant-line&shift=${LUBRICANT_SHIFT.join(',')}`,
    reference: 'demo=reference&line=lubricant-line',
    views: [
      { id: 'line-wide-0', t: 0, cam: LUB.wide, note: 'before the first index' },
      { id: 's1-8', t: 8, cam: LUB.s1, note: 'filling: jets into the first batch' },
      { id: 's1-41', t: 41.5, cam: LUB.s1, note: 'capping' },
      { id: 't1-55', t: 55.5, cam: LUB.t1, note: 'pusher forming the lanes' },
      { id: 't1-62', t: 62.5, cam: LUB.t1, note: 'lanes fed into station 2' },
      { id: 's2-75', t: 75, cam: LUB.s2, note: 'packing the first case' },
      { id: 'line-100', t: 100, cam: LUB.line },
      { id: 's2-100', t: 100, cam: LUB.s2 },
      { id: 's3-426', t: 426.6, cam: LUB.s3, note: 'the robot carrying the 11th case' },
      { id: 'line-wide-500', t: 500, cam: LUB.wide },
      { id: 's1-500', t: 500, cam: LUB.s1 },
      { id: 's2-500', t: 500, cam: LUB.s2 },
      { id: 's3-944', t: 944.2, cam: LUB.s3out, note: 'the worker hauling the full pallet' },
      { id: 's3-959', t: 959, cam: LUB.s3out, note: 'wrapping' },
    ],
  },
};
