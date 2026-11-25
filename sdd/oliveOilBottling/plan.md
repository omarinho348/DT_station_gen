# Plan: Olive oil 500 ml: fill, cap, wrap label

5 stations in a straight line, joined by `beltConveyor` transfers. Takt 12 s (300/h); the slowest station is **Apply wrap label** at 10 s.

## Line graph
**ST1** Fill olive oil bottles → **ST2** Screw cap onto bottle → **ST3** Apply wrap label → **ST4** Validate fill + cap → **ST5** Discard rejected bottles

## Stations
| # | Code | Station | Does | Budget (s) | Covers |
|---|---|---|---|---|---|
| 1 | ST1 | Fill olive oil bottles (`filling`) | Fill each bottle with olive oil to the required fill level acceptance range (target corresponds to 220 ml). | 8 | Fill |
| 2 | ST2 | Screw cap onto bottle (`capping`) | Screw on the black cap to each filled bottle. | 9 | Cap |
| 3 | ST3 | Apply wrap label (`labeling`) | Apply a wrap-around label to the front of each capped bottle (label size 20×20 mm). | 10 | Label |
| 4 | ST4 | Validate fill + cap (`validating`) | Check bottle validity: ensure fill level is within the acceptance range (210–235 ml) and cap is present. Mark invalid units for removal from the belt. | 6 | BottleValidCheck |
| 5 | ST5 | Discard rejected bottles (`discarding`) | Remove rejected bottles from the belt so only valid bottles continue. | 5 | DiscardRejects |

### ST1 Fill olive oil bottles
1. Receive the next bottle in single-file at the fill station in fixed pitch.
2. Detect bottle presence with the station photo-eye.
3. Lower the filler head/nozzle into the bottle mouth/neck.
4. Open the fill valve and dispense oil until the controller reaches the target fill amount mapped to the acceptance window.
5. Close the fill valve.
6. Raise the filler head/nozzle clear of the bottle.
7. Advance the bottle to the next station.

Expected machines: `filler`, `photoEye`.

### ST2 Screw cap onto bottle
1. Receive the next filled bottle in single-file.
2. Confirm bottle presence; stop/skip if missing.
3. Pick and position the black cap over the bottle threaded opening.
4. Lower the capper head to engage the cap.
5. Drive the screw/threads with controlled rotation until the cap is fully tightened to the machine’s torque/end-stop setting.
6. Retract the capper head.
7. Advance the bottle to the next station.

Expected machines: `capper`, `photoEye`.

### ST3 Apply wrap label
1. Receive the next capped bottle in single-file.
2. Detect bottle position and synchronize label timing to belt pitch.
3. Dispense/position a 20×20 mm wrap-around label so the label front ends up on the front reference area of the bottle.
4. Apply the label around the bottle circumference with the label applicator (press/tamp to adhere).
5. Release pressure and retract applicator tooling.
6. Advance the bottle to the next station.

Expected machines: `labelApplicator`, `photoEye`.

### ST4 Validate fill + cap
1. Position the bottle under the inspection view at the fixed pitch dwell window.
2. Measure fill level (from top-of-liquid in image/estimation mapped to ml) and determine pass/fail against 210–235 ml.
3. Check cap presence using an image/vision feature or sensor at the top of the bottle.
4. Combine verdicts: pass only if fill level is within 210–235 ml AND cap-present is true.
5. If invalid, set a reject trigger/marker for downstream discharge.
6. Advance the bottle to the discard station.

Expected machines: `visionScanner`, `photoEye`.

### ST5 Discard rejected bottles
1. Receive the bottle at the single-file belt exit area.
2. Read the reject trigger/marker for the current position.
3. If the bottle is marked invalid, actuate an eject action (side push or diverter) to move the bottle off the main belt onto the rejection path/chute.
4. If valid, keep the bottle on the main belt with no diversion.
5. Allow the belt to carry the valid bottles forward and reject bins/chute to collect ejected bottles.

Expected machines: `sidePusher`, `gravityChute`.

## Takt budget
| Station | Budget (s) | Share of takt |
|---|---|---|
| Fill olive oil bottles | 8 | 67 % |
| Screw cap onto bottle | 9 | 75 % |
| Apply wrap label | 10 | 83 % |
| Validate fill + cap | 6 | 50 % |
| Discard rejected bottles | 5 | 42 % |

## Notes
- Takt is 12 s/unit (3600/300). All station time budgets are set to fit within the takt; if capping or labeling with a wrap-around label requires more than budgeted time, the line rate will need to be reduced or those steps redesigned (e.g., multi-heads or parallel indexing).
- The label applicator in the catalog is a tamp-pad style; if a true wrap-around application requires a different mechanism (wrap head), keep the station’s operation order but swap the machine type in the builder.
- The discard step ejects invalid bottles from the single-file belt (no rework loop). Ensure the diverter/pusher response time is compatible with belt pitch (0.25 m assumed).
