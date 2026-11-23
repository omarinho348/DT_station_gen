// The visual half of Phase 4's acceptance test. Rendering needs Chrome, so it runs outside Vitest
// (npm run visual, scripts/visual-compare.mjs); this test checks what that run recorded: every view
// was rendered from both lines, the stored images are what the numbers were computed from, and
// each view is within its limit. Limits are per view because the known, deliberate differences
// (benchmarks/results/printer-line-visual.md) cover more of the picture in some views than others.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, diffImages } from '../../scripts/png.js';
import { VIEW_LIMITS } from '../../benchmarks/expected/printer-line-visual-limits.js';

const results = JSON.parse(readFileSync('benchmarks/results/printer-line-visual.json', 'utf8'));
const dir = join('tests', 'golden', 'lines', 'printer-line');

describe('printer line looks like the reference (recorded by npm run visual)', () => {
  it('has a result for every view with a limit, rendered at 1600×900', () => {
    expect(Object.keys(results.views).sort()).toEqual(Object.keys(VIEW_LIMITS).sort());
    expect(results.size).toEqual({ width: 1600, height: 900 });
  });

  for (const [id, limit] of Object.entries(VIEW_LIMITS)) {
    it(`${id}: at most ${(limit * 100).toFixed(1)} % of pixels differ`, () => {
      const r = results.views[id];
      expect(r.differing).toBeLessThanOrEqual(limit);
      // The stored goldens are the ones these numbers came from.
      const ours = join(dir, `${id}.png`);
      const ref = join(dir, `${id}.reference.png`);
      expect(existsSync(ours) && existsSync(ref)).toBe(true);
      const d = diffImages(decodePng(readFileSync(ours)), decodePng(readFileSync(ref)), { tolerance: results.tolerance });
      expect(d.differing).toBeCloseTo(r.differing, 4);
    });
  }
});
