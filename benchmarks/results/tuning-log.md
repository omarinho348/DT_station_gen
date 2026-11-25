# Tuning log (Phase 12, tuning set)

Five live rounds of the tuning set (`water-bottles`, `lotion-pumps`, `pcb-assembly`, `battery-modules`, `door-subassembly`) on gpt-5.4-nano, each brief through Spec → Builder (2 retries per station) with every approval given automatically. After each round, the **generic** causes were fixed (nothing written for one brief). `benchmark.md` holds round 5's runs.

| Round | Cost | Where the five lines stopped | Fixed after it |
|---|---|---|---|
| 1 | $0.070 | all five at station 1 | the shell's conveyor id told and repaired in code; shell geometry params no longer set by agents (only labels); `item` args typed to the station's items; each op offered only machines that meet its `needs` (new `needs.motions`); cut-off answers retried with twice the output limit |
| 2 | $0.064 | station 1 built on 3 of 4; then station 2 (3) / station 1 (1); one brief cut off | the runner's stage label; edge transport chosen by the goods a station hands over (pallet carriers); ops needing product parts or cables only for products that have them (new `needs.product`); the conveyor repair also without a shell |
| 3 | $0.059 | station 1 built on 4 of 5; all stopped at station 2 | titles over 40 characters shortened in code (strict mode drops `maxLength`); a station with no conveyor gets the line's; pick-and-place needs x / y / z / yaw and `toolOn` an on/off motion (new `needs.valueMotion`) |
| 4 | $0.044 | station 1 built on 1 of 5 (fresh answers after the schema changes); new failure kinds | every op the layout lists checked at the **layout** phase against the station's machines, the refusal naming catalog types that can do it; the station id taken from the plan |
| 5 | $0.027 | station 1 built on 1 of 5 (door-subassembly, then stopped at station 2) | none: stopped here (see below) |

Plus two re-recordings of the Builder's replay fixture (schemas changed): $0.016.

## What the rounds show

- Every round's failures were real and generic (12 fixes to the library, the Builder and its schemas; tests cover each), but **gpt-5.4-nano with 2 retries keeps finding new ways to fail**: changed schemas give fresh answers, and the answers vary a lot from run to run.
- The weak spot is the **process phase**: op semantics (which machine an op drives, motion names and value types, a decision's branches, the product's features). Layout and machine params mostly pass.
- The **Spec agent** was reliable throughout: all briefs and plans passed their checks (with a few retries) and cost ≈ $0.004 per brief.
- **Per station** a Builder attempt costs ≈ $0.005–0.015; a 4–7-station line ≈ $0.04–0.10 when it completes.
- No line of the tuning set completed unaided (rounds 1–5; round 6 and the held-out run below).

## After round 5 (the owner chose: mini for the Builder, 4 retries)

| Round | Cost | Result | Fixed after it |
|---|---|---|---|
| 6: gpt-5.4-mini Builder, 4 retries | $0.170 | the same two first stations built as on nano; nothing more | the transfer carries the station's carriers (my 12.2 code gave a pallet transfer default params); goods continuity told to and checked at the layout phase |
| held-out set, nano, 4 retries, run once | $0.096 | 5 / 5 briefs and plans; 4 of 31 stations built; no line complete | none (held out) |

Conclusions in `findings.md`.
