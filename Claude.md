# Master Prompt: Agentic Digital Twin Line Builder

You are working with me on a new project: an **agentic, generic system that builds 3D digital twins of factory production lines** from natural language or from a spec-driven workflow (SDD). Read all of this before doing anything. It is the source of truth for requirements, architecture, rules and the implementation order. When something here conflicts with your defaults, this file wins. When something is unclear, ask me; don't guess.

---

## 1. Context

- This is my part of a team graduation project (finishing around 2027). The full pipeline is: Smart Factory Super Agent → PLC Controller Agent, **Station Agent (mine, this project)**, VSIAiAssist; SimPy code and event traces → visualisation and KPI dashboards.
- An earlier, **hand-built** project already exists and is the quality benchmark:
  `C:\Users\ok\Desktop\3D-Digital-Twin-Visualization-Tool` (branch `station-agent`).
  It has two hand-coded lines: a **lubricant line** (`src/station/station-1..3`, `src/station/factory/`) and a **6-station 3D-printer assembly line** (`src/station/printer-line/`). Treat that repo as **read-only reference and source material**. Never edit it.
- The goal of this project: the same visual and motion quality as that repo, but **generic**. A user describes a factory, and agents produce the full line, its files and its simulation, and can edit the twin later.

## 2. Deliverables

1. **Component library** (`lib/`): procedural Three.js components (conveyors, robots, machines, fixtures, station furniture), basic building blocks, process ops and products, each with a schema. Most of it is ported from the reference repo.
2. **Factory spec (IR)**: `factory.json`, the single source of truth for a line, validated by a schema.
3. **Compiler**: deterministic templates that turn `factory.json` into **readable Three.js code files** (one folder per line, one file per station plus a line file), plus a **SimPy model** from the same IR.
4. **Agents**: Spec agent, Builder agent, Reviewer (deterministic checks + LLM critique) and Editor agent, coordinated by a small state machine.
5. **App**: Vite web app with the 3D view full screen, a chat drawer, step-by-step approval with diffs, a component gallery, a KPI overlay, and a zip download of the generated files.
6. **Evidence of genericity**: a set of test factory briefs, coverage metrics and golden screenshots (see §10).

## 3. Rules that always apply

1. **The LLM never writes Three.js or Python code.** Agents only produce or edit JSON (spec, IR, JSON Patch) and markdown (SDD documents). All code comes from deterministic templates and the hand-built library.
2. **`factory.json` is the single source of truth.** Generated files are throwaway output. Every edit is a change to the IR, followed by validation and recompiling.
3. **The deterministic reviewer runs before any LLM review.** If a check can be done in code, do it in code.
4. **Station-local coordinates.** Every station has its own frame; placing it is a transform. Nothing in a station may depend on world coordinates (this was the lubricant line's Station 3 problem).
5. **Deterministic behaviour:** no `Math.random` in logic or geometry (seeded only, textures only). Quality pass/reject decisions are a deterministic function of the serial number (like `qualityFor` in the reference repo).
6. **Generic code:** the compiler, runtime and agents must never mention a catalog component by name. Adding a component touches only `lib/components/**` and the registry.
7. **Budget:** I have about **$5 of OpenAI credit in total**. Every LLM call goes through a budget guard and a cache (§7.4). No vision/screenshot calls to the model. Never send code to the model.
8. **Secrets:** the OpenAI key lives only in `.env` (git-ignored). Never log it, print it or send it anywhere else.

## 4. How we work together

- **One small step at a time.** Each step: implement → run tests (`npm test`) → run the app and check it in the browser (headless Chrome screenshot is fine) → report → **stop and wait for my OK** before the next step.
- **Never commit, push, branch or tag.** I commit by hand at the end.
- **Track progress in `PROGRESS.md`** in the repo: step number, what changed, test results, what I approved, what's next. Update it at the end of every step.
- **Report honestly.** If tests fail, say so and show the output. If something was skipped or only partly done, say that. Never claim a fix that isn't in the code.
- Ask me before adding dependencies beyond those in §5, and before any action that is hard to undo.
- Screenshots without new dependencies (Windows):
  `chrome.exe --headless=new --use-angle=swiftshader --screenshot=<out.png> --window-size=1600,900 <url>`

## 5. Tech stack

- Vite 7, `three` ^0.186, Vitest 3, `zod` 4 (schemas, and `z.toJSONSchema` for OpenAI Structured Outputs), `openai` Node SDK, `lucide` (icons), `fflate` (zip download).
- Server side: a Vite dev-server plugin (Node) exposes `/api/*` for the agents, file writes and the compiler. No separate backend unless I agree to one.
- Python 3 + `simpy` for the generated simulation (run on demand).
- Model names and prices come from `.env`/config, never hard-coded. Default to the cheapest small model that supports Structured Outputs; a stronger model only for `plan.md`, and only if I enable it.

## 6. Architecture

```
User NL / guided questions / templates / .md upload
        │
  SDD documents (markdown, I approve each):
    constitution.md   fixed rules (units, axes, flow, ports, naming, determinism)
    factory-brief.md  product, throughput/takt, stations, constraints
    plan.md           station list, process steps, line graph, takt budget
        │
  factory.json (IR, zod-validated)  ◄── Editor applies JSON Patch here
        │
  Deterministic reviewer ──► LLM critique (only if the checks pass)
        │
  Compiler (templates) ──► generated/<line>/*.js  +  simpy/<line>.py
        │
  Runtime library (lib/) ──► 3D twin in the browser + KPI overlay
```

### 6.1 Folder structure

```
lib/
  core/        primitives.js, materials.js, textures.js, StepSequencer.js,
               environment.js, motion.js (trapezoid, smoother)
  basics/      frames/, axes/, tools/, transport/, buffers/      ← basic building blocks
  components/  conveyors/, robots/, machines/, fixtures/, station/  ← tuned named components
  products/    jerryCan.js, carton.js, printer.js, parametric.js
  ops/         basic ops (move, rotate, grip, release, toolOn, transform,
               transfer, wait, decide) + named ops (fill, cap, pickPlace,
               installPart, driveScrew, inspect, palletize, …)
  station/     StationShell.js, StationCycle.js (from AssemblyCycle, ports)
  line/        layout.js (graph placement), Line.js (transfers, port wiring)
  registry.js  defineComponent / defineOp / defineProduct
  catalog.js   registry → catalog.json (what the agents see)
spec/          schemas: factory.schema.js, sdd templates
compiler/      templates, emit JS, emit SimPy, timing.js
agents/        spec.js, builder.js, reviewer/, editor.js, orchestrator.js,
               llm.js (client + budget guard + cache), prompts/
server/        vite plugin, /api routes, file writer, zip
app/           UI: viewer, chat drawer, approval/diff panel, gallery, KPI overlay
generated/     compiled lines (generated/_draft/<line>/ for previews)
benchmarks/    briefs/, expected/, results/
tests/
```

### 6.2 Component contract

Every component is registered with `defineComponent`:

```js
defineComponent({
  type: 'filler', category: 'machine',
  summary: 'Volumetric multi-head filler in a portal frame over a belt conveyor.',
  params: z.object({ heads: z.number().int().min(1).max(8).default(4), /* … */ }),
  footprint: (p) => ({ x: [xMin, xMax], z: [zMin, zMax], height }),   // station-local metres
  mount: 'overConveyor',            // overConveyor | besideConveyor | floor
  ports: { /* optional: typed in/out points */ },
  motions: { headTravel: { range: [0, 1] }, valves: { values: ['open', 'closed'] } },
  ops: ['fill'],
  build({ params, materials, beltHeight, product }) { return { root, motions: { … } }; },
});
```

Rules: station-local coordinates; parameters have ranges and defaults; motions take normalised values only (ops decide timing); every mesh is named and rests on something (nothing floats); no randomness.

### 6.3 Op contract

```js
defineOp({
  op: 'fill', summary: '…',
  args: z.object({ machine: z.string(), seconds: z.number().min(1).max(30).default(6) }),
  needs: { machineOp: 'fill' },
  duration: (args) => /* seconds */,            // used for takt checks and SimPy
  expand(cycle, args) { /* queue StepSequencer steps that drive motions */ },
});
```

Named ops are shortcuts built from basic ops. Durations always add up from the basic steps.

### 6.4 Product contract

`refs` (named points: grasp, top, neckTop, capSeat…), `stages` with `setStage()`, dimensions, and for assembled products `parts` with `kit`/`asm` poses (as in the reference `PrinterModel.js`). Product kinds: catalog, parametric shape, imported GLB with grasp points marked by the user.

### 6.5 IR (`factory.json`)

- `line`: name, units, flow direction, run size, speeds.
- `product`: catalog ref, parametric definition, or GLB.
- `stations[]`: id, title, shell options, `equipment[]` (catalog `type` **or** `composite` built from basic parts **or** `genericMachine` placeholder), `process[]` (ops).
- `graph`: nodes (stations, buffers, merges, splits, parallel copies) and edges typed by what flows (`unit | batch | case | pallet`), each with a transport (`conveyor | agv | robot | worker`).
- **Layout comes from `lib/line/layout.js`, never from the LLM** (LLMs are bad at coordinates). The agent may only give relative hints (e.g. "reject branch to the left").

### 6.6 Making it generic

1. **Basic building blocks** below the named components: frames (portal, column, enclosure, turntable, table, cantilever), axes (linear, rotary), tools (gripper, vacuum, nozzle, spindle, press ram, camera, laser, labeller, screwdriver), transport, buffers. A machine missing from the catalog is put together as a `composite` from these.
2. **Basic ops:** `move, rotate, grip, release, toolOn, transform, transfer, wait, decide`. Any process can be written with them.
3. **Generic products** (parametric shapes, stages as visual changes, GLB import).
4. **Line as a graph** (branches, merges, rejects, parallel stations, buffers) with typed ports.
5. **`genericMachine` fallback:** an enclosure with the right footprint, ports, timing, sign and stack light. The line still runs; the reviewer reports it. Nothing fails outright.
6. **Scope:** discrete manufacturing, assembly and packaging lines where units flow. Continuous process plants are out of scope (or shown abstractly).

## 7. Agents

### 7.1 Spec agent
Turns chat, guided questions, templates or an uploaded `.md` into `constitution.md`, `factory-brief.md` and `plan.md`. Asks follow-up questions when the brief is missing something (product, throughput, steps). I approve each document.

### 7.2 Builder agent
Turns `plan.md` + `catalog.json` into `factory.json`, **one station at a time**, in three phases per station: **layout → machines → motions/process**. Each phase is written as a draft (`generated/_draft/<line>/`), loaded in the app by dynamic import, and shown to me with a change diff to approve or reject with a comment. Uses Structured Outputs against the IR schema.

### 7.3 Reviewer
1. **Deterministic checks (free, always first):**
   - schema valid; every `type` and `op` exists in the catalog
   - each op's machine supports that op
   - no footprint overlaps (`Box3` in Node)
   - ports and flow types match along each edge
   - reach checks for robots and gantries
   - cycle time from `duration()` sums is within the takt target
   - compiled files import and build headless (Vitest)
2. **LLM critique**, only when the checks pass, given a short text summary of the line (never code), checked against the brief. Failures go back to the Builder with at most 2 retries, then to me.

### 7.4 Editor agent
Turns NL edits ("make ST3 faster", "add a reject lane after inspection") into **JSON Patch (RFC 6902)** on `factory.json` → review → recompile only the affected files → Vite reload → show the diff for approval. Keep a version history of `factory.json` for undo.

### 7.5 LLM layer (`agents/llm.js`)
- **Budget guard:** reads `usage` from every response, records cost in `.agent-cache/usage.json`, enforces a per-session cap (default $0.50) and a total cap (default $4.50), and refuses calls once a cap is reached. Show the remaining budget in the UI.
- **Response cache:** key = hash(model + messages + schema), stored in `.agent-cache/responses/`. Replaying a demo or running tests costs $0.
- **Prompt caching:** stable start of every prompt (constitution + catalog), variable part last; never change the catalog during a session. Keep `catalog.json` under about 4k tokens.
- **Mock mode** (`LLM_MODE=mock`): recorded responses for tests, CI and demo rehearsal. All tests run in mock mode.

## 8. Reference repo: what to port

Port (rename, add schemas, keep the quality):
- `src/station/station-1/OilGeometry.js` → `lib/core/primitives.js`; `OilMaterials.js` (lamps, belt texture); `StationBase.js`; `ControlPanel.js`
- `src/station/common/StationEnvironment.js`, `StepSequencer.js`
- `src/station/printer-line/common/*`: `AssemblyStation` (shell), `AssemblyCycle` (ports, trapezoid motion), `Robots` (SCARA, gantry, screwdriver), `PickPlace`, `LineEquipment`, `PrinterMaterials`, `PrinterModel` (becomes the `printer` product)
- The six `printer-line/st*/…Equipment.js` files → catalog components
- `printer-line/line/PrinterLineLayout.js` → layout logic
- Lubricant machines as components: `FillingMachine`, `CappingMachine`, `OilTank`, `OilHoses`, `OilSensors`, `OilConveyor`, `JerryCan`, `PickAndPlaceRobot`, `CaseCloser`, `CardboardCase`, `ProceduralPallet`, `ProceduralBox`, `ProceduralConveyor`, `ProceduralWorker`, `factory/SupplyRack.js`, `factory/TransferLines.js`
- `factory/FactoryOverlay.js` and `frameFactoryOverview` (from `BuiltInScenes.js`), changed to read from the IR
- Optional (ABB robot): `motion/InverseKinematics.js` + its test, `motion/Rig.js`, `rigs/abbIrb6760.js`, `rigs/abbRobotStudio.js`, `loaders/ModelLoader.js`, `assets/robot.glb`

Adapt: the lubricant stations' own cycles are **not** ported. Their machines join through adapters that expose motions to the generic `StationCycle`.

Leave behind: `studio/`, `app/`, the scene editor, floor plan/DXF, program runner, `LubricantFactory.js` (only a reference for back-pressure and passing the same objects downstream), large GLBs not in the catalog, `rapier3d`, `occt-import-js` (convert `Wrapping.STEP` to GLB once if needed), FactoryHall.

Conventions to carry into `constitution.md` (from `PrinterLineDefinition.js` and `PrinterModel.js`): metres and seconds; product flows +X; conveyor at z = 0, belt height 0.85; walkway on +Z, equipment and fencing on −Z; ports at input −1.6 / work 0 / output +1.6; transfer length 1.2; slab half-length 2.35; speeds 1×/2×/10×; deterministic quality by serial; nothing floats; meshes named.

## 9. Quality checks

For every component: a headless Vitest test (build at min/default/max parameters, no NaN, bounding box inside footprint, every motion runs 0→1, nothing below the floor); a **gallery page** entry with parameter sliders and motion buttons; a golden screenshot at default parameters.

For the system: the **printer line written by hand as `factory.json` must compile to a line that matches the reference repo** (compare golden screenshots and the timing table). This is the key acceptance test. The lubricant line is the second regression test.

## 10. Showing it's generic

- Map the catalog to **DIN 8580** (manufacturing processes), **VDI 2860** (handling) and **DIN 8593** (joining) and keep a coverage table in `benchmarks/coverage.md`.
- `benchmarks/briefs/`: 10–15 briefs from different industries (bottling, bakery, pharma blister, PCB assembly, car door sub-assembly, panel cutting, battery modules, cosmetics filling, textile folding…). Build the library using 5; test on the other 5 without tuning for them.
- Measure: share of stations built from named / composite / placeholder parts, first-pass reviewer success, edit success, cost and time per line, and a visual rating of screenshots.

## 11. Implementation phases

Each phase is several small steps; stop after each step (§4).

**Phase 0: Set-up.** Vite app, Vitest, zod, `.env.example`, `PROGRESS.md`, an empty viewer (renderer, camera, lights, environment), the headless screenshot script.
*Done when:* app runs, one test passes, screenshot works.

**Phase 1: Library core.** `lib/core`, `registry.js` (`defineComponent/Op/Product`), the gallery page, first component `stackLight` with test and screenshot.
*Done when:* the stack light shows in the gallery with working motions; its test passes.

**Phase 2: Printer-line components.** In order: `palletConveyor`, `lift`, station furniture (`slab`, `sign`, `hmi`, `stackLight`), `gantry` + `fingerGripper` + `screwdriver`, `scara`, `table`/`tote`/`flowRack`, the remaining ST1–ST6 equipment, the `printer` product.
*Done when:* every component passes its test and looks right in the gallery next to a reference screenshot.

**Phase 3: Ops, station and line runtime.** Basic ops, named ops (`pickPlace`, `installPart`, `driveScrew`, …), `StationCycle` with typed ports, `line/layout.js` (graph), `Line.js`, `compiler/timing.js`.

**Phase 4: IR and compiler.** `factory.schema.js`, the hand-written `printer-line.factory.json`, templates that emit readable JS, loading compiled lines in the app.
*Done when:* the compiled printer line matches the reference (screenshots and timings). **Key acceptance test.**

**Phase 5: Lubricant components and adapters.** Filler, capper, tank/hoses/sensors, belt conveyor, case packer, taper, pallet, `jerryCan`/`carton` products; `lubricant-line.factory.json` compiles and runs.

**Phase 6: Generic level.** Basic frames/axes/tools/transport/buffers, `composite` support in the IR and compiler, `genericMachine`, graph shapes (reject branch, merge, parallel station, buffer), parametric and GLB products.

**Phase 7: Deterministic reviewer.** All §7.3 checks, run from a CLI and the API, with clear messages.

**Phase 8: LLM layer and Builder.** `llm.js` (budget guard, cache, mock mode, usage display), `catalog.js`, Builder with Structured Outputs, phase drafts, approval with diffs in the UI.

**Phase 9: Spec agent and SDD flow.** Chat drawer, guided questions, templates, `.md` upload, the three documents with approval.

**Phase 10: Editor agent.** JSON Patch edits, partial recompile, hot reload, version history and undo.

**Phase 11: LLM critique, SimPy and KPIs.** Critique pass; SimPy emitter using `timing.js`; run SimPy and feed event traces into the KPI overlay; zip download.

**Phase 12: Benchmarks.** Briefs, coverage table, metrics, results write-up.

## 12. Definition of done

- From a written brief, the system produces approved SDD documents, a valid `factory.json`, readable Three.js files, a running 3D twin with KPIs, and a SimPy model, inside the budget guard.
- NL edits change the twin through validated patches, with undo.
- The printer and lubricant lines rebuild from JSON at reference quality.
- Benchmarks and coverage are measured and documented.
- All tests pass in mock mode; `PROGRESS.md` is up to date.

## 13. Decisions to ask me about when we reach them

- Which OpenAI model(s) to set in `.env`, and the budget caps.
- Whether to include the ABB robot (IK port) or only procedural robots.
- Whether the STEP wrapper is converted to GLB or dropped.
- How the SimPy event traces and KPIs connect to my teammates' parts (format, interface).

**Start with Phase 0, step 1. Propose the step, do it, test it, report, and wait for my OK.**
