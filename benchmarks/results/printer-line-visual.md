# Printer line: compiled vs reference (visual acceptance test)

Written for Phase 4 step 8. Numbers: [printer-line-visual.json](printer-line-visual.json) (from `npm run visual`). Images: `tests/golden/lines/printer-line/<view>.png` (ours) and `<view>.reference.png`. Diff images (differing pixels in red): `visual/printer-line/<view>.diff.png`.

**How it is rendered.** Both lines play in the same twin page and viewer (same renderer, room environment, lights, 1600 × 900, SwiftShader). Ours is the compiled `generated/printer-line/line.js`; the reference is the hand-built `PrinterAssemblyLine` from the reference repo (read-only export in `reference/_src`). Both are frozen at the same moment of the run (stepped in 0.05 s steps from t = 0) and shot from the same camera. A pixel differs when any colour channel is off by more than 32 of 255.

## Results (2026-11-24, after the step-7.3 clash fixes)

| View | t (s) | Camera | Differing pixels | Mean abs. diff |
|---|---:|---|---:|---:|
| line-wide-0 | 0 | whole line | 2.33 % | 1.96 |
| st1-262 | 262.3 | ST1 close-up | 6.64 % | 6.13 |
| st2-262 | 262.3 | ST2 close-up | 6.88 % | 6.34 |
| st3-262 | 262.3 | ST3 close-up | 5.16 % | 4.74 |
| st4-262 | 262.3 | ST4 close-up | 7.16 % | 6.48 |
| st5-262 | 262.3 | ST5 close-up | 7.34 % | 6.59 |
| st6-262 | 262.3 | ST6 close-up | 8.46 % | 7.50 |
| line-262 | 262.3 | line | 3.73 % | 3.22 |
| st1-430 | 430 | ST1 close-up | 6.39 % | 5.91 |
| st2-430 | 430 | ST2 close-up | 6.92 % | 6.43 |
| st3-430 | 430 | ST3 close-up | 5.51 % | 5.04 |
| st4-430 | 430 | ST4 close-up | 7.49 % | 6.73 |
| st5-430 | 430 | ST5 close-up | 7.43 % | 6.63 |
| st6-430 | 430 | ST6 close-up | 8.56 % | 7.56 |
| line-wide-500 | 500 | whole line | 2.29 % | 1.93 |
| st6-760 | 760 | ST6 close-up (pallet) | 8.56 % | 7.55 |
| line-760 | 760 | line | 3.65 % | 3.18 |

The first run (2026-11-23) gave close-ups 3.5–4.4 %, line views 1.8–1.9 %, wide views 0.7–0.8 %. The rise since then is difference 7 below. Every machine, sign, HMI and unit is where it was then, except the pieces difference 7 lists, and all have the same poses and timing.

## Known differences (all deliberate, from earlier steps)

1. **Fence wire mesh** (most of the red in every close-up). The reference mesh has wires 6 mm apart; with mip-mapping and its alpha test they disappear at normal viewing distance, so its fences show only posts and rails. Ours uses a 50 mm grid that stays visible (Phase 2 step 2, fix 2).
2. **Carton height** (ST6, pallet). The reference carton (0.62 m) is too small for printer + foams + accessory box: the top foam and the box stick out through the closed flaps (clearly visible in `st6-760.reference.png`). Ours is 0.69 m, so the pallet's second layer stands higher (Phase 4 step 6, fix 1).
3. **ST5 label applicator column** at z 1.02 instead of 0.70. Same x (−0.15), same retracted pad position (z 0.42), same timing; our tamp cylinder holds the rod over its whole 0.45 m stroke, so the column stands further back (Phase 2 step 6e, fix 3).
4. **Lift carriage sleeves** on the line-end lift columns (black blocks). The reference lift frame is static; ours shows the lift travel (Phase 2 step 1).
5. **ST6 carton labeller** retracted to z −0.76 (reference −0.62), so its column clears the main conveyor; **ST6 foam magazine** without the three spare foams that floated in the reference (Phase 4 step 6, fixes 2 and 3).
6. **ST1 flow rack**: shelves and totes sit 1–2 cm off the reference (a few pixels in the close-ups). Not fixed; the component was approved in Phase 2 step 5.
7. **Clash fixes** (Phase 7 step 7.3, asked for by the owner). The reviewer's geometry check found 17 places in the reference where parts go through each other: sign posts through tables and racks, fence posts through the flow rack and the reject lane, the ST3 gantry post inside the tester cabinet, and others. Ours fixes them:
   - deeper slabs, so the shell's fence and sign stand behind the rear equipment: `minZ` ST1 −2.7, ST2 −1.8, ST5 −2.5, ST6 −3.5 (reference −2.35, −1.5, −2.35, −3)
   - ST1: frame nest 4 cm back, part cradle 6 cm left
   - ST2: presenter table 42 cm deep instead of 50 (the feeders stay in place)
   - ST3: tester cabinet beside the gantry post (x −1.37 instead of −1.2)
   - ST4: docking unit behind the enclosure's rear panel, with a longer stroke and the same contact point on the unit; equipment rack beside the dock's cable
   - ST5: HMI at x −1.8 (clear of the scanner post)
   - ST6: gantry 8 cm along +X and 20 cm longer in Z; foam table shorter and further along X; pallet and dispatch bay 12 cm back
   The timing tables still match the reference step for step, and the run of 8 ends at the same time. Most of the new red in the close-ups is the fence and sign at their new places.

## Limits

The test `tests/spec/printer-line-visual.test.js` holds each view to a limit (`benchmarks/expected/printer-line-visual-limits.js`): close-ups 9.5 %, line views 4.5 %, wide views 3 % (5.5 %, 3 % and 1.5 % before difference 7). It also re-diffs the stored images to check they are the ones the numbers came from. Rendering needs Chrome, so `npm test` checks the recorded run; `npm run visual` re-renders and re-records (about 8 minutes).
