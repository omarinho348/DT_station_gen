# Constitution

Fixed rules for every line this tool builds. They come from the project's conventions, not from the model; the brief and the plan work inside them.

## Units and axes
- Lengths in **metres**, times in **seconds**.
- Every station has its **own frame**; placing it in the line is a transform. Nothing in a station depends on world coordinates.
- Units flow along **+X**. The station conveyor runs along X through the station origin, belt top at **0.85 m**.
- Operator walkway on **+Z**; equipment and fencing on **-Z**.

## Ports and flow
- A station takes a unit in at its **input** port (x = -1.6), works on it at the **work** place (x = 0) and hands it out at its **output** port (x = 1.6).
- Ports carry one kind of goods: **unit, batch, case or pallet**. Two stations connect only where the goods match.
- Neighbouring stations are joined by a **1.2 m** transfer conveyor; a station slab is 4.7 m long.
- The line is laid out by a program from the line graph; nobody writes station positions.

## Naming
- Ids are camelCase (`capping`, `rejectLane`); every station has a short code (ST1, ST2, …) shown on its HMI.
- Every machine and every part is named; nothing floats (each part rests on something).

## Determinism
- No randomness in behaviour or geometry. The same factory.json always gives the same line and the same run.
- Quality decisions (pass / reject) are a fixed function of the unit's serial number.
- Simulation speeds: 1×, 2×, 10×.

## How the line is made
- The agents write only JSON and markdown. All code comes from fixed templates and a hand-built component library.
- factory.json is the single source of truth: every change is a change to it, validated and recompiled.
- Deterministic checks run before any model review.
