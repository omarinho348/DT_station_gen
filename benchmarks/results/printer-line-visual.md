# Printer line: compiled vs reference (visual acceptance test)

Written for Phase 4 step 8. Numbers: [printer-line-visual.json](printer-line-visual.json) (from `npm run visual`). Images: `tests/golden/lines/printer-line/<view>.png` (ours) and `<view>.reference.png`. Diff images (differing pixels in red): `visual/printer-line/<view>.diff.png`.

**How it is rendered.** Both lines play in the same twin page and viewer (same renderer, room environment, lights, 1600 × 900, SwiftShader). Ours is the compiled `generated/printer-line/line.js`; the reference is the hand-built `PrinterAssemblyLine` from the reference repo (read-only export in `reference/_src`). Both are frozen at the same moment of the run (stepped in 0.05 s steps from t = 0) and shot from the same camera. A pixel differs when any colour channel is off by more than 32 of 255.

## Results (2026-11-23)

| View | t (s) | Camera | Differing pixels | Mean abs. diff |
|---|---:|---|---:|---:|
| line-wide-0 | 0 | whole line | 0.74 % | 0.54 |
| st1-262 | 262.3 | ST1 close-up | 4.10 % | 3.55 |
| st2-262 | 262.3 | ST2 close-up | 3.97 % | 3.38 |
| st3-262 | 262.3 | ST3 close-up | 3.63 % | 3.11 |
| st4-262 | 262.3 | ST4 close-up | 3.54 % | 2.99 |
| st5-262 | 262.3 | ST5 close-up | 4.24 % | 3.72 |
| st6-262 | 262.3 | ST6 close-up | 4.29 % | 3.63 |
| line-262 | 262.3 | line | 1.93 % | 1.49 |
| st1-430 | 430 | ST1 close-up | 3.85 % | 3.33 |
| st2-430 | 430 | ST2 close-up | 3.95 % | 3.38 |
| st3-430 | 430 | ST3 close-up | 4.03 % | 3.48 |
| st4-430 | 430 | ST4 close-up | 3.88 % | 3.25 |
| st5-430 | 430 | ST5 close-up | 4.36 % | 3.79 |
| st6-430 | 430 | ST6 close-up | 3.97 % | 3.32 |
| line-wide-500 | 500 | whole line | 0.83 % | 0.60 |
| st6-760 | 760 | ST6 close-up (pallet) | 3.96 % | 3.34 |
| line-760 | 760 | line | 1.82 % | 1.43 |

Every station, machine, sign, HMI and unit is in the same place with the same pose in every view; the remaining differences are the ones below.

## Known differences (all deliberate, from earlier steps)

1. **Fence wire mesh** (most of the red in every close-up). The reference mesh has wires 6 mm apart; with mip-mapping and its alpha test they disappear at normal viewing distance, so its fences show only posts and rails. Ours uses a 50 mm grid that stays visible (Phase 2 step 2, fix 2).
2. **Carton height** (ST6, pallet). The reference carton (0.62 m) is too small for printer + foams + accessory box: the top foam and the box stick out through the closed flaps (clearly visible in `st6-760.reference.png`). Ours is 0.69 m, so the pallet's second layer stands higher (Phase 4 step 6, fix 1).
3. **ST5 label applicator column** at z 1.02 instead of 0.70. Same x (−0.15), same retracted pad position (z 0.42), same timing; our tamp cylinder holds the rod over its whole 0.45 m stroke, so the column stands further back (Phase 2 step 6e, fix 3).
4. **Lift carriage sleeves** on the line-end lift columns (black blocks). The reference lift frame is static; ours shows the lift travel (Phase 2 step 1).
5. **ST6 carton labeller** retracted to z −0.76 (reference −0.62), so its column clears the main conveyor; **ST6 foam magazine** without the three spare foams that floated in the reference (Phase 4 step 6, fixes 2 and 3).
6. **ST1 flow rack**: shelves and totes sit 1–2 cm off the reference (a few pixels in the close-ups). Not fixed; the component was approved in Phase 2 step 5.

## Limits

The test `tests/spec/printer-line-visual.test.js` holds each view to a limit (`benchmarks/expected/printer-line-visual-limits.js`): close-ups 5.5 %, line views 3 %, wide views 1.5 %. It also re-diffs the stored images to check they are the ones the numbers came from. Rendering needs Chrome, so `npm test` checks the recorded run; `npm run visual` re-renders and re-records (about 8 minutes).
