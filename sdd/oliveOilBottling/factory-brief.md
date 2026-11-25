# Factory brief: Olive oil 500 ml: fill, cap, wrap label

Line id `oliveOilBottling`.

## Product
**500 ml dark olive oil bottle**: Dark glass 500 ml olive-oil bottle, about 70 mm across and 280 mm tall, with a black screw cap. Filled with olive oil, then capped, then a wrap-around label is applied to the front.

Shown in the twin as a parametric bottle, 70 × 70 × 280 mm.

## Throughput
- Target: **300 units per hour**, so a takt of **12 s** per unit.
- A simulated run: 8 units.

## Process
| # | Step | What happens |
|---|---|---|
| 1 | Fill | Fill each bottle with olive oil to the required fill level acceptance range (target corresponds to 220 ml). |
| 2 | Cap | Screw on the black cap to each filled bottle. |
| 3 | Label | Apply a wrap-around label to the front of each capped bottle (label size 20×20 mm). |
| 4 | BottleValidCheck | Check bottle validity: ensure fill level is within the acceptance range (210–235 ml) and cap is present. Mark invalid units for removal from the belt. |
| 5 | DiscardRejects | Remove rejected bottles from the belt so only valid bottles continue. |

## Quality
BottleValidCheck marks units invalid if fill volume is outside 210–235 ml and/or the cap is not present; DiscardRejects ejects marked units from the single-file belt.

## Constraints
- Single-file bottle flow on a belt at a fixed pitch (no accumulation requested).
- Rejections must be discarded from the belt (no rework loop requested).
- Label is wrap-around, nominal size 20×20 mm on the front of each bottle.

## Assumptions
- No shift length provided: assumed 8 hours/day for scheduling (takt derived from 300 bottles/hour).
- No pitch provided: assumed a recommended bottle pitch of 0.25 m center-to-center to set belt speed and station timing.
- “220 mm volume target yes” interpreted as 220 ml target fill volume; acceptance is exactly 210–235 ml as stated.
- BottleValidCheck includes only fill-level acceptance and cap-present validation (no additional cap torque/height validation and no label-position/readability validation requested).
- Label is applied to all bottles upstream; invalid-label handling is not included in validity since only fill level and cap present were specified.

## Checks
- ⚠ The brief says bad units are rejected, but product.model.params.rejectEvery is 0: no unit will ever fail, so the reject path never runs in the twin. Reject the brief with how often one should fail (e.g. "every 10th fails").
