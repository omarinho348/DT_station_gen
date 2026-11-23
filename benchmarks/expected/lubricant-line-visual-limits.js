// Limits for Phase 5's visual comparison (tests/spec/lubricant-line-visual.test.js): the largest
// share of pixels (tolerance 32 per colour channel) that may differ between our compiled lubricant
// line and the reference lubricant factory in each view of scripts/visual-views.js.
//
// First measured run (2026-11-23), about one percentage point of headroom on each:
//   wide views 2.9–3.0 %, line view 4.5 %, station 1 4.7–4.9 %, can transfer 6.2–6.4 %,
//   station 2 8.3–8.4 %, station 3 32–39 %.
// Station 3 is high on purpose, not by error: our cell stands on a floor slab (the reference cell
// stands on the bare floor) that fills a third of those views, our worker is parked in its bay all
// the time, and our station-3 belt is the catalog belt conveyor. Geometry and motion match there as
// elsewhere; see benchmarks/results/lubricant-line-visual.md.
const WIDE = 0.04;
const LINE = 0.055;
const S1 = 0.06;
const T1 = 0.075;
const S2 = 0.095;

export const VIEW_LIMITS = {
  'line-wide-0': WIDE,
  's1-8': S1,
  's1-41': S1,
  't1-55': T1,
  't1-62': T1,
  's2-75': S2,
  'line-100': LINE,
  's2-100': S2,
  's3-426': 0.40,
  'line-wide-500': WIDE,
  's1-500': S1,
  's2-500': S2,
  's3-944': 0.335,
  's3-959': 0.375,
};
