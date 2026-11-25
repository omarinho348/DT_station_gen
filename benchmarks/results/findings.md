# Benchmark findings (Phase 12)

**Setup:**
- 10 briefs from different industries (`benchmarks/briefs/`): 5 to tune on, 5 held out.
- Each brief went through the whole pipeline with every approval given automatically: the brief accepted with its own assumptions, every gate approved. These are the agents' **unaided** results.
- In the app a person approves, rejects and comments at every step; the benchmark measures what happens without them.
- Models: gpt-5.4-nano for every agent. One comparison round used gpt-5.4-mini for the Builder.

## Results

| | Tuning set (final round, mini Builder, 4 retries) | Held-out set (nano, 4 retries, run once) |
|---|---|---|
| Briefs and plans that passed every check | **5 / 5** | **5 / 5** |
| Follow-up questions asked by the Spec agent | 15 (3 per brief) | 15 (3 per brief) |
| Stations planned | 25 | 31 |
| Stations built (passed every check and played) | 2 | 4 |
| … of those, first time (no refusal) | 1 | 3 |
| Parts mix of built stations: named / composite / placeholder | 2 / 0 / 0 | 1 / 0 / 3 |
| Lines complete | 0 | 0 |
| Cost of the run | $0.170 | $0.079 (+ cached Spec answers) |

**Not measured,** because no line completed: edit success, the critique's verdicts, SimPy against the target, and a visual rating of screenshots. The standard edit and the critique were measured on hand-written lines in steps 10.5 and 11.5 (3 of 3 edits right first time; a critique that found every planted gap).

**Process coverage** (`benchmarks/coverage.md`): 11 of 20 DIN 8580 / DIN 8593 / VDI 2860 processes are covered by named parts, 5 by basic blocks only, 4 not at all (primary shaping, potting, soldering, textile joining).

## What worked

- **The Spec agent is reliable:**
  - all 10 briefs became valid briefs and plans, with at most a few refusals fixed by the model
  - three relevant follow-up questions per brief
  - takt-respecting station budgets
  - catalog-valid machine hints
  - about $0.004 per brief and plan
- **The deterministic layer caught everything:** no invalid line was ever produced. Every model mistake was refused with a path and a reason, before it could reach the twin.
- **Single stations, where they pass, are good:** catalog fillers, a blister former, a cooling buffer, each playing correctly in the twin.

## What failed, and why

Every stopped station failed in the **Builder**, almost always in its **process phase**, with the same few kinds of mistake:

1. **Op semantics:**
   - `grip` / `pickPlace` aimed at a machine that cannot grip (a clamp, a stop, a cradle)
   - placing onto product parts a parametric product doesn't have
   - `fill`'s supply pointed at the filler itself
   - an on/off op on a numeric motion

   The error messages name the problem exactly, yet the model often repeats it through 4 refusals.
2. **Goods continuity:** a station on pallet carriers followed by one taking loose units. This is now refused at the layout phase with the fix spelled out; the model still didn't switch.
3. **Composites:** mount points and part params of machines put together from basic blocks.
4. **Length:** detailed assembly processes (several screws, cables) sometimes exceed even 8000 output tokens.

**The stronger model was not the answer:** gpt-5.4-mini on the Builder (about 4x the price) built the same stations as nano on the tuning set.

## Tuning: what changed (generic, none brief-specific)

The five nano rounds and the mini round (`tuning-log.md`) led to 14 fixes, each with tests:

- **Op contract:** what an op needs (motions, an on/off motion, product parts / cables), so schemas offer an op only the machines and products that can serve it.
- **Builder schemas:** shells' geometry fixed, `item` args typed.
- **Builder code:**
  - conveyor and id repairs; title lengths
  - edge transports chosen by the goods passed, carrying the station's carriers
  - every listed op checked against the station's machines **at the layout phase**
  - goods continuity checked at layout
- **LLM layer:** a cut-off answer retried once with twice the output limit.

Each fix removed the failure it targeted, and several failures **moved earlier**, where they are cheaper (layout instead of process). But the number of complete lines did not rise.

## What this means, and what would help next

- **As built, the system works as designed: assisted, not autonomous.** A brief becomes approved documents reliably. The Builder needs the owner's corrections for most stations (the approval panel's reject-with-comment and the Editor exist for exactly this). The benchmark shows how much help it needs: most stations.
- The models are not short of knowledge. They are short of **the library's semantics in a usable form**. Promising next steps:
  - **Per-machine process templates:** each named component ships its standard process as data (a capper's cap cycle, a filler's fill cycle). The model then picks and parameterizes instead of composing ops, which turns the process phase into the machines-phase problem it already solves well.
  - **A per-machine op vocabulary in the prompt:** for each machine of the station, the ops it can drive with their exact args and motion values, generated from the registry, instead of the generic op detail.
  - **Deterministic process defaults:** for a station whose machines all have templates, write the process in code and let the model only adjust timing.
- The coverage gaps (soldering, textile joining, primary shaping, potting) explain the placeholders in the held-out set (blister sealing, bag sealing), and are the library work that would raise the named share.
