// Limits for Phase 4's visual acceptance test (tests/spec/printer-line-visual.test.js): the
// largest share of pixels (tolerance 32 per colour channel) that may differ between our compiled
// printer line and the reference line in each view of scripts/visual-compare.mjs.
//
// First measured run (2026-11-23): close-ups 3.5–4.4 %, line views 1.8–1.9 %, wide views 0.7–0.8 %.
// Nearly all of that is the known, deliberate differences listed in
// benchmarks/results/printer-line-visual.md, the visible fence wire mesh above all. The limits leave
// about one percentage point (close-ups) of headroom; a real regression (a machine missing or moved,
// a unit in the wrong place) costs more than that.
const CLOSE_UP = 0.055;
const LINE = 0.03;
const WIDE = 0.015;

export const VIEW_LIMITS = {
  'line-wide-0': WIDE,
  'st1-262': CLOSE_UP,
  'st2-262': CLOSE_UP,
  'st3-262': CLOSE_UP,
  'st4-262': CLOSE_UP,
  'st5-262': CLOSE_UP,
  'st6-262': CLOSE_UP,
  'line-262': LINE,
  'st1-430': CLOSE_UP,
  'st2-430': CLOSE_UP,
  'st3-430': CLOSE_UP,
  'st4-430': CLOSE_UP,
  'st5-430': CLOSE_UP,
  'st6-430': CLOSE_UP,
  'line-wide-500': WIDE,
  'st6-760': CLOSE_UP,
  'line-760': LINE,
};
