# Plan: Tomato sauce jars: fill, cap, label, carton pack

4 stations in a straight line, joined by `beltConveyor` transfers. Takt 48 s (75/h); the slowest station is **Fill + weight check** at 40 s.

## Line graph
**ST1** Fill + weight check → **ST2** Twist metal cap → **ST3** Front side label → **ST4** Pack 4 jars + close carton

## Stations
| # | Code | Station | Does | Budget (s) | Covers |
|---|---|---|---|---|---|
| 1 | ST1 | Fill + weight check (`fillingAndWeightCheck`) | Fills each jar to 350 g with thick-sauce appropriate flow, then checks weight and diverts out-of-tolerance jars to reject. | 40 | Fill |
| 2 | ST2 | Twist metal cap (`twistCapping`) | Applies the metal twist lid and twists it closed onto the jar. | 10 | TwistCap |
| 3 | ST3 | Front side label (`sideLabeling`) | Sticks one 10×10 mm label on the front of each jar (no printed-variable codes). | 12 | ApplyLabel |
| 4 | ST4 | Pack 4 jars + close carton (`twoByTwoCartonPack`) | Packs jars upright in a fixed 2×2 arrangement into a slotted shipping carton and closes the carton immediately before discharge. | 20 | PackCarton |

### ST1 Fill + weight check
1. Receive one empty jar upright on the conveyor and align it under the filler head.
2. Start metered fill of thick tomato sauce into the jar using a food-grade filling method (e.g., timed volumetric with dwell to settle) until the jar reaches the 350 g target.
3. Wait a short settle time to reduce variability from sauce settling (no foaming assumption).
4. Stop filling and capture the jar’s filled mass on an integrated in-line scale (fast weigh).
5. Compare measured mass to acceptance tolerance of ±2 g around 350 g.
6. If in-tolerance, index the jar forward to capping; if out-of-tolerance, divert it to the reject stream before it reaches the cap station.

Expected machines: `filler`, `photoEye`, `genericMachine`.

### ST2 Twist metal cap
1. Receive an in-tolerance filled jar from ST1 upright under the capper.
2. Pick a metal twist lid from a cap supply location and present it to the jar mouth.
3. Lower the lid onto the jar neck until seated.
4. Engage torque/twist and apply a controlled twist to close the cap.
5. Release the lid and allow the jar to dwell for torque finish (if required by the drive profile).
6. Index the capped jar forward to the labeling station.

Expected machines: `capper`, `vibratoryFeeder`.

### ST3 Front side label
1. Receive a capped jar from ST2 and bring it under the label applicator.
2. Orient/register the jar front for consistent label placement (using the jar’s side/front datum from singulation/position sensors).
3. Actuate the tamp/pad label applicator to pick and place a 10×10 mm side label onto the jar front.
4. Press briefly to ensure adhesion and smooth contact (no rework handling).
5. Index the labeled jar forward to carton packing.

Expected machines: `labelApplicator`, `visionScanner`, `photoEye`.

### ST4 Pack 4 jars + close carton
1. Receive labeled jars and ensure singulation/spacing for carton filling.
2. Provide a slotted shipping carton and open it to an upright ready state at the packing position.
3. Place jars upright into the carton in a fixed 2×2 arrangement (4 total) with consistent orientation for the ‘front’ label side.
4. After the 4th jar is placed, immediately close the carton using carton closing tooling (fold and tamp end flaps as required).
5. Verify carton is closed before discharge (simple presence/closure sensing).
6. Dispatch the completed carton to downstream discharge.

Expected machines: `caseErector`, `caseCloser`, `photoEye`.

## Takt budget
| Station | Budget (s) | Share of takt |
|---|---|---|
| Fill + weight check | 40 | 83 % |
| Twist metal cap | 10 | 21 % |
| Front side label | 12 | 25 % |
| Pack 4 jars + close carton | 20 | 42 % |

## Notes
- Takt is 3600 / 75 = 48 s per finished unit; all stations are budgeted ≤48 s (fill is the bottleneck at 40 s).
- Weight acceptance is assumed ±2 g around 350 g; out-of-tolerance jars are diverted in ST1 before capping/labeling/packing to avoid downstream waste.
- Carton packing clearances and carton internal dimensions for the 75 mm × 110 mm jar in a 2×2 layout are assumed sufficient; confirm carton model/size to prevent interference or poor closure.
- PackCarton includes ‘close immediately before discharge’—the builder should ensure the carton closer is positioned at the end of ST4’s packing motion path.
