# Factory brief: Cloudy apple juice 1L glass bottles (fill-cap-label)

Line id `appleJuiceBottling`.

## Product
**1L cloudy apple juice bottle**: Cloudy apple juice bottled into 1 litre glass bottles with a red screw cap and a paper label. Bottle size is about 90 mm diameter and 260 mm tall (≈1L volume).

Shown in the twin as a parametric bottle, 90 × 90 × 260 mm.

## Throughput
- Target: **240 units per hour**, so a takt of **15 s** per unit.
- A simulated run: 8 units.

## Process
| # | Step | What happens |
|---|---|---|
| 1 | Fill | Fill the sanitized empty glass bottle with cloudy apple juice through a nozzle (~6 seconds filling). |
| 2 | Cap | Screw on the red cap to the filled bottle (~3 seconds). |
| 3 | Label | Apply the paper label to the capped bottle (~2 seconds). |
| 4 | Inspect | Use a camera to check fill level, cap presence/condition, and label placement. |
| 5 | DivertRejects | Reject any bad bottles by diverting them off the line at the inspection station (single-lane divert). |

## Quality
Camera inspection finds bad bottles (fill level, cap, or label issues); those units are diverted off-line at the inspection station.

## Constraints
- Food-grade process
- Stainless steel frames
- One bottle at a time on a belt
- Inspection + reject must happen as a single-lane divert at the inspection station
- Food-contact equipment kept sanitary (owner: bottles arrive sanitized and rinsed)

## Assumptions
- Bottles arrive already sanitized and rinsed, empty, with caps supplied separately to the line (no bottle-wash/sanitization on this line).
- Cap feed is available to the capping station (e.g., magazine/bowl feeder) and capping can apply the red screw cap reliably at the stated cycle time.
- Label application is a single label per bottle, applied consistently within the stated ~2 seconds.
- “About 6 seconds of filling” refers to the fill operation time budget only; pre/post nozzle movements are handled within each station’s takt budget.
- The target of 240 bottles/hour is achievable with one-bottle-per-indexing on the belt; line takt is 15.0 s per bottle (derived from 240/h).

## Checks
- ⚠ The brief says bad units are rejected, but product.model.params.rejectEvery is unset: no unit will ever fail, so the reject path never runs in the twin. Reject the brief with how often one should fail (e.g. "every 10th fails").
