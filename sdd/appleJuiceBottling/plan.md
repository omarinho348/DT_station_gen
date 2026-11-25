# Plan: Cloudy apple juice 1L glass bottles (fill-cap-label)

5 stations in a straight line, joined by `beltConveyor` transfers. Takt 15 s (240/h); the slowest station is **Fill cloudy juice** at 6 s.

## Line graph
**ST1** Fill cloudy juice → **ST2** Screw cap red → **ST3** Apply paper label → **ST4** Camera inspect + decide divert → **ST5** Single-lane reject diverter

## Stations
| # | Code | Station | Does | Budget (s) | Covers |
|---|---|---|---|---|---|
| 1 | ST1 | Fill cloudy juice (`fill`) | Fill the sanitized empty glass bottle with cloudy apple juice through a nozzle. | 6 | Fill |
| 2 | ST2 | Screw cap red (`cap`) | Screw on the red cap to the filled bottle. | 3 | Cap |
| 3 | ST3 | Apply paper label (`label`) | Apply the paper label to the capped bottle. | 2 | Label |
| 4 | ST4 | Camera inspect + decide divert (`inspect`) | Use a camera to check fill level, cap presence/condition, and label placement. | 4 | Inspect |
| 5 | ST5 | Single-lane reject diverter (`divertRejects`) | Reject any bad bottles by diverting them off the line at the inspection station (single-lane divert). | 1 | DivertRejects |

### ST1 Fill cloudy juice
1. Fill

Expected machines: `filler`, `supplyTank`.

### ST2 Screw cap red
1. Cap

Expected machines: `capper`, `vibratoryFeeder`.

### ST3 Apply paper label
1. Label

Expected machines: `labelApplicator`.

### ST4 Camera inspect + decide divert
1. Inspect

Expected machines: `visionScanner`.

### ST5 Single-lane reject diverter
1. DivertRejects

Expected machines: `sidePusher`.

## Takt budget
| Station | Budget (s) | Share of takt |
|---|---|---|
| Fill cloudy juice | 6 | 40 % |
| Screw cap red | 3 | 20 % |
| Apply paper label | 2 | 13 % |
| Camera inspect + decide divert | 4 | 27 % |
| Single-lane reject diverter | 1 | 7 % |

## Notes
- Takt is 15 s/unit (240 units/hour). The station budgets (Fill 6 + Cap 3 + Label 2 + Inspect 4 + DivertRejects 1 = 16 s) must be adjusted to fit 15 s/unit.
- To satisfy the food-grade constraint, all direct food-contact parts at Fill should be CIP/sanitary designed; the line assumes owner-supplied sanitized bottles on entry (no wash station included).
- Inspect and reject must happen as a single-lane divert at ST4/ST5; set the vision decision latency so the diverter action occurs within the same bottle’s dwell time window.
