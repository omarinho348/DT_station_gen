# Lubricant line: compiled vs reference (visual comparison)

Written for Phase 5 step 9d. Numbers: [lubricant-line-visual.json](lubricant-line-visual.json) (from `node scripts/visual-compare.mjs --line lubricant-line`). Images: `tests/golden/lines/lubricant-line/<view>.png` (ours) and `<view>.reference.png`. Diff images (differing pixels in red): `visual/lubricant-line/<view>.diff.png`. Views and cameras: `scripts/visual-views.js`.

**How it is rendered.** Both play in the same twin page and viewer (same renderer, room environment, lights, 1600 × 900, SwiftShader). Ours is the compiled `generated/lubricant-line/line.js`. The reference is the hand-built `LubricantFactory` from the reference repo (read-only export in `reference/_src`; `app/dev/referenceLubricant.js`), with everything it builds: stations 1–3, the can and case transfers, the supply racks and signs, the IRB 6760 cell. Both are frozen at the same moment of the run and shot from the same camera. A pixel differs when any colour channel is off by more than 32 of 255.

Three things are set up so the two can be compared at all:
1. **One frame.** The reference factory must stay at its world origin: its station 3 mixes station-local and world coordinates. Moved by our layout's offset in a Node check, its robot never gripped and by 426.6 s it had 0 cases on the pallet instead of 10. So our line is moved instead (`?shift=-13.705,0,1.5`, minus our palletizing station's layout position, checked by the test). Our stations are station-local (rule 4), so nothing else changes. That doubles as a check of rule 4: the shifted line plays the same.
2. **One wrapper.** The reference loads its stretch wrapper from `Wrapping.STEP` through occt-import-js, which this project doesn't carry (owner's decision: procedural wrapper). In the reference render, `vite.config.js` points that import at `app/dev/referenceWrapStub.js`, which builds **our** wrapper from `lubricant-line.factory.json`, with the bay sizes the timing recording used. The wrapper itself is therefore not compared.
3. **The same stepping as the timing recording** for the reference: 0.02 s steps, with world matrices brought up to date after every update, as rendering does. Ours steps 0.05 s; its times are exact either way.

## Results (2026-11-23)

| View | t (s) | Camera | Differing pixels | Mean abs. diff |
|---|---:|---|---:|---:|
| line-wide-0 | 0 | whole line | 2.97 % | 2.11 |
| s1-8 | 8 | station 1, filling | 4.74 % | 4.01 |
| s1-41 | 41.5 | station 1, capping | 4.86 % | 4.08 |
| t1-55 | 55.5 | can transfer, pusher A | 6.37 % | 5.58 |
| t1-62 | 62.5 | can transfer, feeding station 2 | 6.24 % | 5.45 |
| s2-75 | 75 | station 2 | 8.28 % | 7.75 |
| line-100 | 100 | line | 4.50 % | 3.48 |
| s2-100 | 100 | station 2, the pick | 8.41 % | 7.96 |
| s3-426 | 426.6 | station 3, the 11th case | 38.56 % | 27.31 |
| line-wide-500 | 500 | whole line | 2.94 % | 2.10 |
| s1-500 | 500 | station 1 | 4.81 % | 4.14 |
| s2-500 | 500 | station 2 | 8.39 % | 7.91 |
| s3-944 | 944.2 | station 3, hauling the full pallet | 32.10 % | 23.11 |
| s3-959 | 959 | station 3, wrapping | 36.19 % | 25.71 |

**Checked by eye** (`s2-100`, `s3-426`, `s3-959` side by side; `s1-8`, `s2-100`, `t1-55` diff images): every station, machine, rack, sign, HMI, can and case stands in the same place, and the moving parts are in the same pose at the same moment:
- the filler head and jets at 8 s
- the gantry carrying four cans over the open case at 100 s
- the robot carrying the 11th case over a pallet of 10 at 426.6 s
- the worker and the full pallet at 944.2 s and 959 s

The red in the diffs is the list below.

**The station 3 numbers are high for known reasons, not misplacement:**
- our cell stands on a floor slab and the reference cell on the bare floor; the slab fills about a third of those views
- our worker is parked in its bay all the time (the reference creates it for the outbound)
- the station-3 belt is our catalog `beltConveyor` (grey frame, legs). The reference uses its own black conveyor with orange rollers.

## Known differences (deliberate, from earlier steps)

1. **Fence wire mesh** visible in ours, mip-mapped away in the reference (Phase 2 step 2): most of the red in the station 1, transfer and station 2 views.
2. **Station 3 slab** (step 9c), **worker always present** (9c part 2), **station 3 belt look** (9c part 1).
3. **Can labels:** the reference factory brands its can labels with its logo PNG; ours keep the jerry can's own label.
4. **Station 2 gantry frame** stands at x −0.054 (centred on its grippers); the reference frame stood at x 0 (9b part 1).
5. **Pusher stands, guide-rail posts, hood trim** fixed or completed in Phase 5 step 8 / 9b part 2.
6. **Robot home pose** (tool down, 9c part 1) and **paths between end points**; the pallet **turns with our wrapper deck** (in the reference render the stand-in deck turns under a still pallet).
7. **Outfeed belt gear motor** at the end of station 1 not drawn (step 2).
8. **Carton stock in the rack:** ours are closed cartons (our `carton` at stage `closed`); the reference drew plain boxes with a tape line.

## Limits of the test

- `npm test` checks the recorded run (`tests/spec/lubricant-line-visual.test.js`); it does not render. Re-render with `node scripts/visual-compare.mjs --line lubricant-line` after changing components or the line (about 3 min ours + 5 min reference).
- Limits (`benchmarks/expected/lubricant-line-visual-limits.js`) are about one percentage point above what was measured. In the station 3 views, where the known differences already cover a third of the picture, a real regression costs relatively less. Geometry there is also covered by the station 3 tests (positions to the millimetre).
- The reference renders are images of the reference repo's factory. They sit under `tests/golden/`, which is not git-ignored, so committing them is your call (as for the printer line).
