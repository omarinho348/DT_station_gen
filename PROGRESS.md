# Progress

Source of truth for requirements: [Claude.md](Claude.md). One step at a time; each step waits for approval.

## Decisions so far

- Language: plain JavaScript (ES modules), zod for schemas.
- Reference repo (`3D-Digital-Twin-Visualization-Tool`) is private: the owner sends the files when they're needed.
- Extra dependencies from §5 (`openai`, `lucide`, `fflate`) are installed in the phase that first needs them.
- `three` pinned to `^0.186.1` (stays in r186).
- **Vitest 5.1** instead of the spec's Vitest 3 (the owner's choice, to clear the dev-dependency audit warnings). Works with Vite 7.
- `.env` holds the OpenAI key (git-ignored, confirmed with `git check-ignore`). The owner removed `.env.example`.
- **UI/UX** (agreed 2026-11-16):
  - **Setup page**, light theme: a stepper with 1 Meet the crew (Spec, Builder, Reviewer, Editor, each with a model picker; Orchestrator is "direct", no model; per-agent spend and remaining budget), 2 Brief (chat / guided questions / template / `.md` upload), 3 Review the docs (constitution, brief, plan, each approved), then **Build**, which opens the twin page.
  - **Twin page**, dark theme: full-screen 3D, station-by-station Builder approval with diffs, chat drawer, KPI overlay, zip download.
  - Siemens petrol `#009999` for text accents (project sponsor). OpenAI only, plus mock mode; the UI shows "key found / missing" and never asks for the key. No login or roles.

- **Palletizing robot** (Claude.md §13, asked 2026-11-23): **both**. A procedural 4-axis palletizer (`palletizerRobot`) is the default component; the ABB IRB 6760 (reference `robot.glb`, `InverseKinematics.js`, `Rig.js`, IRB 6760 rig, copied read-only) comes as an optional component for a reference-quality station 3.
- **Stretch wrapper** (Claude.md §13, asked 2026-11-23): **procedural**. `Wrapping.STEP` is neither converted nor loaded; `occt-import-js` stays out.

- **Lubricant line** (asked 2026-11-23, Phase 5 step 9):
  - station 1 as a generic **indexing station** (positions on one conveyor, one synchronous index per cycle, then the work at each occupied position), so the timing matches the reference
  - station 3 uses the **ABB IRB 6760**; the procedural palletizer stays the default for agent-built lines
  - fidelity as for the printer line: **recorded reference timing + screenshot comparison**

## Phase 0: Set-up

### Step 1: Project scaffold (approved)

- `package.json`, `vite.config.js`, `.gitignore`, `.env.example` (later removed by the owner), placeholder page, folder skeleton from §6.1, `tests/smoke.test.js`.
- Results: install OK, 2 tests passed, dev server served the page.

### Step 2: Empty viewer, twin page base (approved)

**Changed**
- `app/viewer/stage.js` (headless-safe, testable in Node): dark background with matching fog, hemisphere + shadow-casting key + rim lights, a 300 m floor at y = 0, a 100 m grid with 1 m cells, a +X flow arrow in petrol at the origin, and an empty `content` group for future lines and components. Every object is named.
- `app/viewer/Viewer.js` (browser): WebGL renderer (sRGB, Neutral tone mapping, soft shadows), RoomEnvironment light from the scene around it (PMREM), 42° camera, OrbitControls (damping, target at belt height 0.85, can't go below the floor), ResizeObserver, `onFrame()` hooks, `dispose()`, and `window.__viewerReady` after the first frame (for step 3).
- `app/main.js`: twin page with the viewer, a brand chip and a controls hint. `app/style.css`: design tokens (light default, `.theme-dark`), Siemens petrol accent.
- `tests/viewer/stage.test.js`: floor flat at y = 0 and receiving shadows, lights set up, content root empty, every object named, no NaN, nothing below the floor.

**Issues found and fixed during the step**
- The arrowhead dipped below the floor: arrow raised by the cone radius.
- The key light's target had no name (caught by the new test).
- Grid lines vanished near the camera in headless Chrome. Cause: SwiftShader drops long line segments that cross the camera's near plane. Fix: the grid is built from 1 m segments (`createGrid`). This matters for every golden screenshot: **avoid long single line segments in the scene.**
- Grid contrast: the lit floor renders lighter than its base colour, so the grid uses dark seam lines.
- The floor edge showed as a hard horizon: the floor is now 300 m, and the grid edge sits inside the fog.

**Results**
- `npm test`: 2 files, 6 tests passed.
- Headless Chrome screenshot (1600×900, SwiftShader): dark stage, full grid, petrol flow arrow, brand chip, hint pill.
- Screenshot note for step 3: `--virtual-time-budget` never finishes once a render loop is running; `--timeout=6000` with a separate `--user-data-dir` works.

### Step 3: Headless screenshot script (approved)

**Changed**
- `scripts/screenshot.js` (no new dependencies): starts Vite on a free port (or uses `--url`), launches headless Chrome with SwiftShader, drives it through the DevTools Protocol (Node's built-in `fetch` + `WebSocket`), waits for a ready condition (default `window.__viewerReady === true`), waits a few more frames, calls the page's optional `window.__screenshotPrepare()`, then saves a PNG. Reports page errors and console warnings. Options: `[path]`, `--url`, `--out`, `--size WxH`, `--ready`, `--settle`, `--timeout`, `--verbose`; `CHROME_PATH` env override. Cleans up Chrome, Vite and the temp profile.
- `package.json`: `npm run screenshot`.
- `Viewer.pause()` / `resume()`; `app/main.js` defines `window.__screenshotPrepare` to pause rendering before capture.
- `Viewer.js`: `PCFSoftShadowMap` → `PCFShadowMap`. The script surfaced three r186's warning that `PCFSoftShadowMap` was removed (PCF is soft now).
- `tests/scripts/screenshot-args.test.js`: defaults, option parsing, output naming, clear errors.

**Results**
- `npm test`: 3 files, 10 tests passed.
- `npm run screenshot` → `screenshots/twin.png` (1600×900), same image as step 2, no warnings.
- Speed: the first version took 106 s (the capture alone took 47 s because the render loop starved it). After pausing rendering before capture and settling 3 frames instead of 10: **32 s**. About 15 s of that is SwiftShader's first frame (software shader compile) and can't be avoided.
- Failure path: an unmet ready condition exits with code 1 and a clear message, writes no file, and leaves no Chrome processes or temp folders behind.

**Phase 0 done-criteria:** app runs ✓, tests pass ✓, screenshot works ✓.

### Step 4: Two-page shell + setup page mock-up (approved)

**Changed**
- Dependency: `lucide` 1.73 (approved in §5; first needed here). 0 audit issues.
- `app/router.js`: hash router, `#/setup[/crew|brief|docs|build]` and `#/twin`. One page app, so setup state survives the move to the twin. Keeps the page instance while only the step changes; unmounts (and disposes the viewer) when switching pages. Resets `window.__appReady` on each page change.
- `app/pages/setup/SetupPage.js` (light theme): top bar (brand, pill stepper, key/budget chips), 4 steps:
  1. **Crew**: table with Build crew (Spec, Builder, Reviewer, Editor: "Runs on" OpenAI/Mock, model picker, spend) and Oversight (Orchestrator, Deterministic checks: "direct", free).
  2. **Brief**: Chat / Guided questions / Template / Upload .md cards + composer.
  3. **Documents**: constitution.md, factory-brief.md, plan.md cards with status + Review.
  4. **Build**: the three Builder phases + "Open the twin".
  Footer with Back / Next. Step enter animation (respects reduced motion). Responsive down to phone width.
  Static mock-up: values marked `data-placeholder` (budget, key status, models, spend) get connected in Phase 8; Spec agent in Phase 9.
- `app/pages/twin/TwinPage.js`: the step 2 viewer moved into a page, plus a back button to setup. `Viewer` takes `onFirstFrame`, and the page sets `__appReady` from it.
- `app/data/crew.js`: crew + steps as zod-validated data (only Spec may use the strong model).
- `app/ui/icon.js`: lucide → inline SVG helper.
- Styles split into `app/styles/{tokens,base,setup,twin}.css`; petrol `#007a7a` for small text on white (AA contrast), `#009999` for marks and buttons.
- `scripts/screenshot.js`: default ready flag is now `window.__appReady` (both pages set it); hash routes supported (`npm run screenshot -- "#/setup/brief"` → `screenshots/setup-brief.png`).
- Tests: `tests/app/router-crew.test.js` (routing, crew rules, step order); screenshot arg tests updated.

**Results**
- `npm test`: 4 files, 17 tests passed.
- Screenshots checked: all 4 setup steps at 1600×900, crew step at 390×844 (phone), twin page. Fixed after first look: model dropdown misaligned by its hint (moved "from .env" to the column header), header font, table now fits a 900 px screen, spend label on phones.

### Step 4b: Rename + theme toggle (approved)

Requested by the owner on 2026-11-16.
- **Name: TwinGen** (was "DT Line Builder"). Lives in `app/brand.js` only; pages and titles read it from there. Favicon added.
- **Light/dark toggle** on the setup pages (top right, sun/moon). Saved in `localStorage` (`twingen.theme`), light by default; `?theme=dark` in the URL forces a theme without saving (used for screenshots). The twin page stays dark. Fixed light colours in `setup.css` became theme tokens in `tokens.css`.
- Router: routes now carry `query` (`#/twin?demo=core`, `#/setup/crew?theme=dark`).
- Checked in screenshots: crew and brief steps in dark, crew in light.

## Phase 1: Library core

### Step 1: `lib/core` (approved)

Ported from the reference files the owner sent (`OilGeometry.js`, `OilMaterials.js`, `StationEnvironment.js`, `StepSequencer.js`, and the trapezoid functions from `AssemblyCycle.js`).

**Changed**
- `lib/core/primitives.js`: `group, addMesh, box, roundedBox(+Geometry), cylinder(+Geometry), cylinderBetween, pipeRun, flange`. Same behaviour as the reference.
- `lib/core/motion.js`: `smoother` (quintic), `clamp01`, `lerp`, `trapezoidDuration`, `trapezoidTravel`. Speed and ramp are now arguments (the reference read them from the printer line's constants; ours will come from the IR).
- `lib/core/StepSequencer.js`: ported unchanged.
- `lib/core/textures.js`: `canvasTexture`, `beltTexture`, `wireMeshTexture`, `seededRandom`.
- `lib/core/materials.js`: `createMaterials()` (23 shared materials, each named), `disposeMaterials`, `createLampMaterial`, `setLamp`.
- `lib/core/environment.js`: `roomEnvironment`, `applyEnvironment` (returns a restore function), `disposeEnvironment`. The viewer now uses it, at the reference intensity 0.55 (was 0.45).
- `app/dev/coreDemo.js`: dev-only check scene at `#/twin?demo=core` (material swatches, bench with belt, pipework, fence and guards, lamps, a carriage moved by `StepSequencer` + trapezoid). The gallery replaces it next step.

**Differences from the reference (deliberate)**
1. **No `Math.random`** (rule 5): the belt speckle uses a seeded generator, so the texture is identical on every load. A new test fails if `Math.random` appears anywhere in `lib/`, `compiler/`, `agents/`, `app/` or `spec/`.
2. **Headless-safe textures**: without a DOM (Vitest in Node), `canvasTexture` returns a 1×1 colour texture, so components can be built and measured in tests.
3. **Product-specific materials left out of core**: `hdpe`, `hdpeSolid`, `label` (+ `brandLabel`), `oil`, `oilStream`, `cap`. They move in with the `jerryCan` product in Phase 5.
4. **Short trapezoid moves**: when a move is too short to reach cruise speed (distance / speed < ramp), the reference formula arrives early and stops abruptly. Ours eases over the same duration. Durations and normal moves are unchanged, so reference timings still match.
5. Lamps start dimmed (`setLamp(false)` at creation); the reference started them at full colour until first set.

**Issues found and fixed during the step**
- Screenshot script: lazily loaded code never arrived when a dev server was already running, because both Vite servers shared one dependency cache. The script's server now has its own cache (`node_modules/.vite-screenshot`). It also reports browser-level errors (failed requests) now.

**Results**
- `npm test`: 7 files, 46 tests passed (motion profiles, sequencer, primitives, materials, textures, rule check).
- Screenshot `#/twin?demo=core`: metals, paints, belt texture, fence, glass, lamps, pipework and shadows all render.

### Step 2: Registry, gallery, first component (approved)

Reference files received: `LineEquipment.js`, `PrinterMaterials.js`, `PrinterLineDefinition.js`. Saved, together with `AssemblyCycle.js`, under the git-ignored `reference/printer-line/common/` so they need not be resent.

**Changed**
- `lib/registry.js`: `createRegistry()` with `defineComponent / defineOp / defineProduct`, each validated by zod with clear errors (camelCase ids, known categories and mounts, motion specs `{range}` or `{values}`, typed ports, duplicates rejected). `buildComponent(type, params, ctx)` validates params and fills defaults, checks the footprint shape, checks that `build()` returns exactly the declared motions, and returns an instance with `set(name, value)` (range/value checked), `state` and `dispose()` (frees own materials, keeps shared ones). Also `paramFields()` (sliders / catalog / tests, from `z.toJSONSchema`) and `paramSamples()` (default / min / max sets).
- `lib/components/index.js`: loads every file under `lib/components/**` with `import.meta.glob`, so adding a component means adding one file.
- `lib/components/station/stackLight.js`: ported from `createStackLight`. Params `height` (1.2–3.0, default 2.1) and `buzzer`. Motion `mode`: off / run / wait / alarm. Footprint 0.12 × 0.12 × (height + 0.012) m, mount `floor`.
  - **Fix vs the reference:** the reference had a 3 cm gap above the buzzer and 5 mm between lamps, so the lamp tiers floated. A thin core tube now joins pole, buzzer, lamps and cap. A test removes the core and confirms the lamps are then flagged as floating.
- `app/pages/gallery/GalleryPage.js` (`#/gallery/<type>`): component list by category, live parameter sliders (generated from the schema), motion controls (segmented buttons for values; slider + play 0→1→0 for ranges), facts (mount, footprint, ops), footprint box toggle, auto camera framing. `?golden=1` hides the UI; `?<motion>=<value>` sets a motion state. Reads only the registry. Linked from the setup top bar (grid icon).
- `scripts/golden.js` (`npm run golden [types…]`): one golden PNG per registered component at default params → `tests/golden/components/<type>.png` (1200×900). Gets the component list from the registry through Vite.
- Tests:
  - `tests/components/all-components.test.js` runs the §9 checks for **every** registered component at default / min / max params: all objects named, no NaN, inside footprint, nothing below the floor, **nothing floating** (meshes must connect to the floor through touching boxes), every motion through its whole range, clean dispose.
  - `tests/registry.test.js`: definitions, errors, building, motion checks, dispose, param introspection, the checks themselves, stack light lamp logic and reference geometry.
  - `tests/rules/project-rules.test.js`: new **rule 6 guard**: fails if any file outside `lib/components/**` mentions a registered component type by name. It caught two example mentions in my own comments, now fixed.

**Kept as in the reference (deliberate):** unlit lamps are dimmed to 35 % colour, so they stay fairly visible. Kept so Phase 4 screenshots match the reference; easy to change in `setLamp`.

**Results**
- `npm test`: 9 files, 80 tests passed.
- `npm run golden`: 1/1 written (`tests/golden/components/stackLight.png`, 15 s).
- Screenshots: gallery with off / run / wait, golden mode.

**Phase 1 done-criteria:** stack light shows in the gallery with working motions ✓, its test passes ✓.

## Phase 2: Printer-line components

### Step 1: Conventions, `palletConveyor`, `liftUnit` (approved)

**Changed**
- `lib/core/conventions.js`: line conventions from `PrinterLineDefinition.js` (units, +X flow, walkway +Z, belt height 0.85, ports −1.6 / 0 / +1.6, conveyor −2.2…2.2 at 0.45 m/s with 0.35 s ramp, lift drop 0.5 m / 0.9 s, transfer 1.2 m, slab half-length 2.35, speeds 1/2/10). These become constitution.md defaults. Product-specific values (carrier, tray, printer sizes, run size, QA limit) stay with the product.
- Registry: every build gets the line context (`DEFAULT_BUILD_CONTEXT`, i.e. `beltHeight`), overridable per line; `footprint(params, ctx)`; `ports` may be a function of params and context; port directions are `in | out | work`.
- `lib/components/conveyors/palletConveyor.js`: centred on the origin (placement is a transform). Params: length, strandZ, strandWidth, workStop, carrierLength, returnLine, drive; rule: carrier ≥ 0.12 m shorter than the conveyor when there is a stop. Motions: `belt` (phase within one 0.5 m texture tile; the pulleys turn whole turns per tile so the phase can wrap), `stop`, `locate`. Ports input / work / output at belt height. Each conveyor has its own belt material, so belts scroll independently.
- `lib/components/conveyors/liftUnit.js`: the reference frame plus carriage sleeves on the columns. Motion `level` (0 = return line, 1 = belt). Ports top / bottom. Named `liftUnit` because "lift" is a common word (conventions, "lift and locate") and the rule-6 guard flagged the clash.
- Gallery: shows ports (coloured markers with the footprint toggle, listed in the facts box); a rejected parameter combination shows a message and keeps the last valid build; `?footprint=1` in the URL.
- Component checks now use exact vertex bounds (rough boxes grew when pulleys rotated).
- Tests: `tests/components/conveyors.test.js` (conventions = reference, default geometry, ports, belt height from context, belt and pulley motion, independent belts, stop 60 mm / plate 30 mm travel, stop position, length rule, leg count, lift frame and travel).

**Reference geometry problems found by the generic checks, and fixed** (I ported the reference exactly first, then fixed what the checks flagged):
1. The whole frame floated 18 mm above its feet (legs started at 30 mm, feet are 12 mm tall). Added threaded levelling stems.
2. The drive motor hung 4 cm off the frame. Added a motor bracket to the strand profile.
3. The stop and lift cylinders had no mounts (they only touched a cross tie by chance at some lengths). Added cross brackets under the profiles; lift cylinder 2 cm longer to reach its bracket.
4. The raised stop pin and the lifted plate detached from their cylinders. Added piston rods.
5. The index pins (±0.55 m) stood outside the 0.6 m locate plate. The plate now spans the carrier length minus 4 cm.
None of these change the look from normal viewing distance; they are all below the belts.

**Results**
- `npm test`: 10 files, 122 tests passed.
- `npm run golden`: 3/3 written (stackLight, palletConveyor, liftUnit).
- Screenshots: conveyor with footprint and ports, stop and locate raised; lift carriage at 40 %.

### Step 2: Station furniture (approved)

Reference files received: `station-1/StationBase.js`, `station-1/ControlPanel.js` (saved in `reference/station-1/`).

**Changed**
- Registry contract:
  - `displays`: live data shown on a component (screens), `{ name: { schema, sample } }`. `build()` must provide exactly the declared displays; `instance.show(name, data)` validates against the schema; each display starts with its sample.
  - `sinks`: how far a component may reach below y = 0 (max 5 cm), for floor coatings.
  - `paramFields` supports text fields (`kind: 'string'`).
- `textures.js`: `liveCanvasTexture()` for redrawable screens (no-op headless).
- New components (all in `lib/components/`):
  - `floorSlab`: the floor part of `StationBase`: 2 cm epoxy coating flush with the floor, 4 boundary lines, walkway line. Walkway given as a position across the depth (0.55–0.9) so every allowed value stays inside the boundary lines.
  - `guardFence`: the fence part of `StationBase` as its own reusable component; same panel count as the reference.
  - `stationSign`: code, title, colour, width, height; the single-box double-sided panel from the reference.
  - `hmi`: `ControlPanel` with a **generic** screen (title, state, step, ≤ 6 rows, optional bar) instead of a drawing function per station; state colours for the generic cycle states, accent colour for work states. Height parameter.
  - `workTable`: `createTable`, with a top-finish choice and a `top` work port.
- Gallery: text inputs for string parameters (applied on Enter / leaving the field).
- Tests: `tests/components/furniture.test.js` (slab size, sinking and walkway, fence panel count and feet, per-panel textures, sign posts and validation, HMI orientation and screen data validation, column meets enclosure at all heights, table top, port and finish; registry displays and sinks).

**Fixes vs the reference**
1. Fence feet started 20 mm above the floor (placed on a slab thickness, but the slab top is flush with the floor), so the whole fence floated. Feet now on the floor, posts on the feet.
2. Fence wire mesh: the reference's 5 cm texture tile put wires 6 mm apart, which blurred to invisible at normal distance. Now a 50 mm grid (0.4 m tile).
3. HMI column now always reaches the enclosure when the height changes (the reference had one fixed height).

**Renames from the rule-6 guard:** "slab" and "table" are ordinary words used elsewhere (conventions, materials, the setup page's table role), so the components are `floorSlab` and `workTable`.

**Problem found and fixed:** a PowerShell rename read a file in the wrong encoding and turned "…" into "â€¦" in the slab's gallery label (and in comment rulers in `setup.css`). Both repaired; no other files affected (checked by search). Scripted file edits now go through Node.

**Results**
- `npm test`: 11 files, 236 tests passed.
- `npm run golden`: 8/8 written.
- Screenshots checked: HMI with live screen, sign, fence (before and after the mesh fix), slab, table.

### Step 3: `cartesianGantry`, `fingerGripper`, `screwdriver` (approved)

Reference files received: `Robots.js`, `PickPlace.js` (saved in `reference/printer-line/common/`; `PickPlace.js` is for the Phase 3 ops).

**Changed**
- Registry contract:
  - `motions` may be a function of params (a gantry's travel depends on its size). Motion ranges are in the motion's own unit: here metres and radians in the component frame, so ops aim the tool straight at a point and the Phase 7 reach check can read the ranges.
  - New mount `tool` (carried on a robot flange); footprint `bottom` (≤ 0) for parts that hang below the origin.
  - Component checks: tools must connect to their topmost part (not the floor); **nothing-floating is now also checked at every motion position**, not only at rest.
- `materials.js`: machine finishes from `PrinterMaterials.js` (machineBlue, machineGrey, machineWhite, gantryOrange, darkPanel), now 28 shared materials.
- `motion.js`: `lerpPose` (from `lerpTool`) and `angleDelta`.
- `lib/components/tools/fingerGripper.js`: reusable builder `buildFingerGripper()` + gallery component. Origin = tool point (fingertip centre). Motions `grip` (0…maxGap, m) and `holding` (LED).
- `lib/components/tools/screwdriver.js`: builder `buildScrewdriver()` + component. Motions `driver` (slide 0–1), `driverSpin` (one hex flat), `screw` (hidden / fed). Shared `SCREWDRIVER_MOTIONS` so every robot that carries it exposes the same motions.
- `lib/components/robots/cartesianGantry.js`: centred on the origin; params spanX, spanZ, beamY, minToolY (≥ 0.6 m below the beam), maxGap, fingerLength, frameColor, screwdriver. Motions `x, y, z` (tool point, m), `yaw`, `grip`, `holding` (+ screwdriver motions when fitted).
- Tests: `tests/components/robots-tools.test.js`: gripper opens to exactly the commanded gap, tool point at the fingertips, LED; screwdriver stroke 50 mm and spin; **gantry puts the tool point exactly at (x, y, z) at any wrist angle**; ram stays in the carriage at the lowest point; ranges follow the frame size; screwdriver motions only when fitted; screwdriver turns with the wrist; frame colour; pose interpolation turns the short way.

**Fixes vs the reference**
1. Screw feed tube stood 4 mm clear of the spindle motor (unattached). Now against it.
2. The screwdriver bit came off its slide cylinder when extended; with longer fingers it never reached the slide at all (the reference only ever used one finger length). Added a bit shaft sized from the finger length.
3. Gantry tool travel limited to [minToolY, beamY − 0.1]: the reference allowed y down to 0.2 m, which pulls the ram out of the carriage below minToolY.

**Results**
- `npm test`: 12 files, 303 tests passed.
- `npm run golden`: 11 components total, all written.
- Screenshots: gantry at two tool positions (ram, wrist and gripper hanging correctly), screwdriver.

### Step 4: `scara` (approved)

Ported from `createScaraRobot` in `Robots.js` (no new reference files needed).

**Changed**
- `lib/components/robots/scara.js`: column on the origin, J1 shoulder link, J2 elbow link, J3 quill (ball-screw spline), J4 tool roll, finger gripper, optional screwdriver. Same tool interface as the gantry: motions `x, y, z` (tool point, m), `yaw` (tool heading, absolute), `grip`, `holding`, plus `driver / driverSpin / screw` when the screwdriver is fitted. Joint angles come from analytic two-link IK (elbow right-handed, as in the reference).
  - Params: `link1` (0.3–0.8, default 0.55), `link2` (0.25–0.7, 0.5), `armHeight` (1–2, 1.45), `stroke` (0.15–0.5, 0.4), `maxGap` (0.26), `fingerLength` (0.1), `screwdriver`. Defaults = the reference robot; at the default stroke the quill is the reference's 0.7 m.
  - The `y` range comes from the quill stroke (0.87–1.27 m at defaults; the reference start height 1.1 is inside). Fully raised, the flange meets the quill head: the ST1 definition (received 2026-11-17, `armHeight` 1.3, home `y` 1.12) needs exactly that, and a test checks it. At `armHeight` 1.3 the range is 0.72–1.12 m. Whether the lower end reaches ST1's tote picks can only be checked once ST1's equipment/cycle is ported. The default `x` is the reference start pose (l1 + l2/2).
  - Exported `scaraReach(params)` → `{ min, max }`: the real workspace is an annulus. The `x`/`z` motion ranges are only its bounding square. A target outside the annulus is clamped to the nearest reachable point on the same heading (no NaN, no jumps).
- Gallery: `?p.<param>=<value>` in the URL sets start parameters (e.g. `#/gallery/scara?p.screwdriver=true&x=0.36`), for screenshots of parameter variants.
- Tests (`tests/components/robots-tools.test.js`, 7 new): tool point exactly at (x, y, z) across the reach and wrist angles; tool heading holds whatever the arm pose; out-of-reach and inside-the-column targets clamp along the same heading; tool clears the column at the inner limit, J2 folds right-handed and under 150°; spline stays in the quill head over the whole stroke (3 param sets); ranges follow links / arm height / stroke; screwdriver motions and offset turn with the tool. The generic §9 checks also cover it at default / min / max params and at every motion position.

**Changes vs the reference (deliberate)**
1. **Inner reach limit:** the reference allowed down to |l1 − l2| = 5 cm from the column axis, which drives the gripper into the column (radius 12 cm). Now the limit is column radius + 5 cm clearance + the tool's radius (0.325 m at defaults, J2 ≈ 144°, like a real SCARA's J2 limit).
2. **Vertical travel limited to the quill stroke:** the reference took any `y`, so the spline could leave the quill head or push the flange into it. Clamping is now done by the registry's range check.
3. `stroke` is a parameter (the reference had a fixed 0.7 m quill).

**Notes**
- Running `npm test` from Git Bash fails every suite with `Cannot read properties of undefined (reading 'config')`, even on clean code: Vitest loads twice when the drive letter's case differs (`C:` vs `c:`). It runs fine from PowerShell. Same for npm scripts with flags: PowerShell drops the `--` before `npm run … -- --out`, so call `node scripts/screenshot.js …` directly.
- For Phase 7: the reach check must not rely on the box ranges for this robot. A generic `workspace` field in the component contract (instead of the `scaraReach` export) is the clean way; to be added when the reviewer needs it.
- The golden image crops the top of the spline (it sticks up above the arm when the quill is low). The generic camera framing has the 4:3 golden aspect; fine for now.

**Results**
- `npm test`: 12 files, 328 tests passed.
- `npm run golden scara`: written (`tests/golden/components/scara.png`, 17 s); 12 components in total.
- Screenshots checked: `screenshots/scara-pose.png` (reach pose with footprint), `screenshots/scara-fold.png` (folded near the column, screwdriver extended with a fed screw).

### Step 5: `tote`, `flowRack` (approved)

Reference files received: `st1/KittingDefinition.js`, `st1/KittingEquipment.js` (saved in `reference/printer-line/st1/`). "table" from the §11 list is the existing `workTable` (= `createTable`), so nothing new for it.

**Changed**
- Registry: new mount `surface` (rests on another component's top, e.g. on a bench or shelf; y = 0 is that surface).
- `materials.js`: `toteBlue`, `binYellow`, `binRed`, `binGreen` (reference colours), now 32 shared materials.
- `lib/components/fixtures/tote.js` (category fixture, mount surface): params inside `width`, `depth`, wall `height`, `color`. Origin at the centre of the underside (the reference put it on the inside floor, which would sit 6 mm below the surface it rests on). Port `inside` (work, unit) on the inside floor, where parts are placed.
- `lib/components/fixtures/flowRack.js` (category buffer, mount floor): params `length` (1.7), `depth` (0.7), `levels` (3), `bins` per level (5), `slope` (0.12 rad). Defaults = reference (1.9 m tall). Bin colours cycle in the reference order, using shared materials (the reference made a new material per bin: 15 per rack).
- Tests: `tests/components/fixtures.test.js` (7): tote inside size and height exact, rests on its underside, port on the inside floor, colour; rack height / level / bin counts, slope towards the pick face, bins against the front stop and clear of the uprights, colour order. The generic §9 checks run on both.

**Fixes vs the reference**
1. **Flow rack slope reversed:** the reference tilted the shelves with `rotation.x = −0.12`, which lifts +Z: the bins would roll to the back, away from the cell. Now the shelves slope down to the pick face (+Z, towards the line).
2. Added a front stop on each shelf, with the bins resting against it (gravity flow); the reference bins floated mid-shelf with nothing to stop them.
3. The end bins overlapped the uprights by 5 mm; bins now fill only the space between the uprights.

**Problem found and fixed:** the rule-6 guard flagged my own registry comment ("a tote on a table"); reworded.

**Results**
- `npm test`: 13 files, 371 tests passed.
- `npm run golden tote flowRack`: 2 written; 14 components in total.
- Screenshots checked: flow rack (golden + with footprint), tote at 0.24 × 0.24.

### Step 6a: ST1 equipment (approved)

Steps 4 and 5 approved by the owner on 2026-11-17. Step 6 ("the remaining ST1–ST6 equipment") is split per station; this is ST1, from `reference/printer-line/st1/KittingEquipment.js`.

**Changed**
- New components (generic names, so the agents can reuse them beyond kitting):
  - `pickToLight` (fixture, mount surface): housing + lamp facing +Z, motion `lamp` off / on, colour green / amber / red / blue. Own lamp material per module (lamps switch one at a time, as in the reference).
  - `partCradle` (fixture): stand + two V-saddle bars, one lane per long part between a pair of lips. `lanes` is a **list of X positions** (default = the reference ST1 lanes, relative to the cradle centre), `laneWidth`, `saddleSpacing`, stand size. One `out` port per lane (`lane1…`) on top of the bars. Rejects a lane off the bars, naming it.
  - `partNest` (fixture): stand + guides, `guides: cornerPosts` (the reference bed nest: 4 yellow posts, a stack between them; default) or `locators` (the reference base-frame nest: 4 flat blocks). Guide offsets, post height and stand size as params; `seat` port where the lowest part rests.
  - `keepOutRing` (station): floor marking around a robot base, `radius` and `band` (band = radius gives the reference's full disc).
- `workTable.js` exports `buildTable()`; the cradle and nest stands reuse it. `workTable` itself renders exactly as before (golden file unchanged).
- Registry `paramFields`: number-list params (`kind: 'numberList'`), kept at their default in the min / max test samples. Gallery: a text field for them ("-0.17, -0.08, 0"), also settable from the URL (`?p.lanes=…`).
- Gallery camera: minimum framing radius 0.3 → 0.05 m. Small parts (the 5 cm pick-to-light, tote, gripper, screwdriver) filled only a speck of the golden image; their goldens were regenerated.
- Tests: `tests/components/fixtures.test.js` +10 (lamp independence and placement; cradle ports, lips per lane, lane validation; nest posts vs locators, seat height, guide validation; ring vs disc, flat on the floor; number-list fields).

**Changes vs the reference (deliberate)**
1. **Keep-out ring:** the reference used a 2 cm tall yellow cylinder, which the robot's 3 cm base plate cut through. It is now paint on the floor (floor-line material, depth-offset like the slab markings), and it can be a ring as wide as the robot's reach.
2. Frame locators use `plasticBlack` instead of `printedBlack`: that colour is a printer-product material, which moves in with the `printer` product.
3. `partCradle` length is at least 0.5 m, so the default (reference) lanes always fit.

**Left for later (needs other files)**
- The supermarket contents: part copies in each location, part-number labels (`PrinterModel.js`, `textLabel` from `PrinterMaterials.js`). They come with the `printer` product.
- Arranging the locations (totes on the tote table, cradle, nests, rack, robot, ring) is station layout from `KittingDefinition.js`: that is the IR / station in Phase 3–4, not a component.

**Results**
- `npm test`: 13 files, 453 tests passed.
- `npm run golden`: 5 new (pickToLight, partCradle, partNest, keepOutRing) + workTable (unchanged), and 3 small parts re-framed; 18 components in total.
- Golden images checked by eye: cradle with 5 lanes, bed nest posts, pick-to-light, keep-out disc.

### Step 6b: ST2 equipment (approved)

Step 6a approved by the owner on 2026-11-17. Reference files received: `st2/FrameAssemblyEquipment.js`, `st2/FrameAssemblyDefinition.js` (saved in `reference/printer-line/st2/`).

ST2 has little equipment of its own: an overhead gantry with gripper + screwdriver (already `cartesianGantry` with `screwdriver: true`) and a screw presenter (a bench with three bowl feeders, M3 / M4 / M5).

**Changed**
- `lib/components/machines/vibratoryFeeder.js` (machine, mount surface): drive, stainless bowl, escapement, optional feed hose. Params `bowlDiameter` (0.26 = reference; everything scales with it) and `hoseLength` (1.2 = reference, 0 = no hose). Port `outlet` (out, unit) at the hose end, or at the escapement tip without a hose. Generic name: bowl feeders feed screws, caps, clips, pills on many lines. The screw presenter itself is layout (a `workTable` 1.2 × 0.5 × 0.8 with three feeders at x = −0.38 / 0 / 0.38), for the IR in Phase 4.
- Tests: feeder geometry = reference at defaults (bowl top, hose 0.1–1.3 m above the bench), outlet with and without hose, scaling; **ST2's gantry built from `FRAME_DEFINITION`** (spans, beam, gap, screwdriver) reaches its home pose (0, 1.75, 0) exactly.

**Kept as in the reference (worth knowing):** the feed hose is a straight 1.2 m tube standing up from the feeder, ending in the air below the gantry beam. A real hose would bend over to the moving screwdriver; that needs a hose that follows the gantry (a Phase 3 runtime concern, not this component).

**Results**
- `npm test`: 13 files, 475 tests passed.
- `npm run golden vibratoryFeeder`: written; 19 components in total. Checked by eye.

### Step 6c: ST3 equipment (approved)

Step 6b approved by the owner on 2026-11-17. Reference files received: `st3/WiringEquipment.js`, `st3/WiringDefinition.js` (saved in `reference/printer-line/st3/`).

ST3's gantry is `cartesianGantry` (`frameColor: machineBlue`, `maxGap: 0.22`, screwdriver). New: the harness board and the continuity tester.

**Changed**
- `materials.js`: cable colours `cableBlack / cableRed / cableBlue / cableYellow / cableWhite` (reference `cable.*`, flattened so every material is named after its key), now 37 shared materials.
- `lib/components/fixtures/harnessBoard.js` (fixture): two posts and a board leaning back, wires laid between connectors. Params `width` (1.3), `boardHeight` (0.8), `topHeight` (1.5), `tilt` (0.15 rad), `wires` (5, colours in the reference order). Defaults = reference.
- `lib/components/machines/testCabinet.js` (machine): cabinet, display panel and status lamps; motion `status`: idle / testing / pass / fail. Port `testLead` (front face at 0.9 m, where the reference lead starts). Generic name: continuity, leak or function testers all look like this.
- Tests: board defaults, lean direction, wire colours; every wire held by a fork; board between the posts at full tilt; too many wires rejected; one lamp per status; reference layout (lead port, display height, lamp positions); **ST3's gantry built from `WIRING_DEFINITION`** reaches its home pose.

**Fixes vs the reference**
1. **Wires floated 2.5 cm in front of the board.** Added harness forks (pegs, as on real harness boards) that hold them off the face.
2. **The posts cut through the board's edges:** the board spanned the post centres and leaned back, so its upper half passed behind the posts and its lower half in front (visible as a step in the edge). The board now fits between the posts (1.25 m instead of 1.3 m wide).
3. The tilted panel's top corner stood up to 3 mm above the posts; the board height now accounts for its thickness.
4. **Fail lamp added** (red, between pass and testing; the reference tester only had pass and testing). Quality decisions are per serial (rule 5), so the twin needs to show a failed test.

**Left for Phase 3:** the test lead. The reference draws it as a tube from the tester to the mainboard's dock port, rebuilt each time the target moves; ST3's harness cables are the same kind of thing (a cable between moving points, laid through clips). Both belong to a runtime cable helper with the ops, not to a component.

**Results**
- `npm test`: 13 files, 517 tests passed.
- `npm run golden harnessBoard testCabinet`: written; 21 components in total. Checked by eye (the first board render showed the post clash, fixed above).

### Step 6d: ST4 equipment (approved)

Reference files received: `st4/CalibrationEquipment.js`, `st4/CalibrationDefinition.js` (saved in `reference/printer-line/st4/`). The owner sent them without a word on 6c, so 6c is still marked awaiting approval.

**Changed** (four components, generic names: end-of-line test cells all have these):
- `shutterEnclosure` (station, mount overConveyor): aluminium posts and roof rails, acrylic back / front / roof, kick panels below the belt, optional extraction hood + duct, and a lifting shutter at each end. Motions `entryShutter`, `exitShutter` (0 closed … 1 raised by `shutterRise`). Params `length` 1.64, `width` 1.12, `height` 2.05, `shutterRise` 0.82 (= reference), `extraction`. Shutter bottom and kick-panel height follow the line's `beltHeight`.
- `dockingUnit` (machine): floor stand, pneumatic cylinder, piston rod and connector head; motion `plug` (0…`stroke` m along +Z). Port `connector` at the retracted connector face. Params `axisHeight` (1.0), `stroke` (0.3). In the reference the dock height came from the printer's dock port; here it is a param the IR sets.
- `statusMonitor` (station): `createStatusMonitor` (base, column, bezel, screen) with a **generic dashboard display**: title, step, up to 4 gauge bars (value / target / unit / colour), an optional heat-map grid (≤ 5 columns, value range), footer. The reference ST4 screen (hotend / bed temperatures, 3 × 3 bed mesh, flatness / cube error) is exactly its sample, so no station needs its own drawing code (rule 6).
- `equipmentRack` (station): dark cabinet with rack units on the front; reference 5 units 0.25 m apart from 0.5 m, packed closer when more fit a shorter rack.
- Tests: `tests/components/test-cell.test.js` (10): enclosure frame = reference, shutters close just above any belt height, lift by `shutterRise` independently and stay in their guides; plug moves exactly, rod stays in the body over the whole stroke, connector height; dashboard validation (bad grid range, too many gauges); monitor column reaches a small screen's bezel; rack unit positions and no overlap.

**Fixes vs the reference**
1. **Shutters had no guides:** they floated 1 cm from the posts, and raised they went up through the roof rail. They now run in guide channels on the end posts, which reach above the roof by the lift (guillotine-door style).
2. **Docking cylinder:** the 0.34 m piston rod stuck 26 cm out of the back of the 0.2 m cylinder when retracted, and the plug cable ran through the cylinder and out through the enclosure's back wall. Now the body length follows the stroke (rod always inside), and the supply cable leaves the back of the cylinder and drops to the floor. The connector head is visible at the cylinder face when retracted (the reference hid it inside the cylinder).
3. **Monitor column** stopped 0.2 m below the screen centre, short of the bezel on small screens; it now always reaches the bezel.
4. Dashboard text no longer runs into the heat-map grid on the default 0.7 m screen (seen in the first golden render).

**Left for later:** placing the dock in line with the unit's dock port is IR / layout work once the `printer` product exists (`DOCK_PORT` is in `PrinterModel.js`).

**Results**
- `npm test`: 14 files, 599 tests passed.
- `npm run golden`: 4 new; 25 components in total. Checked by eye, plus screenshots `screenshots/shutterEnclosure-open.png` (entry shutter raised) and `screenshots/dockingUnit-plugged.png`.

### Step 6e: ST5 equipment (done)

Steps 6c and 6d approved by the owner on 2026-11-17. **New working rule from the owner (2026-11-17): when the owner says nothing about a step, it counts as approved; continue without waiting** (stop only when blocked, e.g. on reference files). Reference files received: `st5/InspectionEquipment.js`, `st5/InspectionDefinition.js` (saved in `reference/printer-line/st5/`).

**Changed**
- New components:
  - `visionScanner` (machine, overConveyor): four posts, rails, travelling arch with two side and two top cameras, side and top LED light bars, laser emitter and laser sheet down to the belt. Motions `x` (arch position, m; parked at the entry end) and `scan` (off / on: lights + laser). Params rail length 2.7, post spacing 1.44, rail height 2.05, arch width 1.0, arch bottom 1.0 (= reference).
  - `labelApplicator` (machine): column, label printer and roll, tamp cylinder, rod and pad; motion `tamp` (0…`stroke` m along −Z); port `pad`. Params `applyHeight` (1.25), `stroke` (0.3).
  - `rollerConveyor` (conveyor): side frames, rollers at 0.1 m pitch with their tops at belt height, legs, optional end stop and floor marking; motion `rollers` (turn phase); ports `input` / `output`. Flow along +X (the reference reject lane ran along −Z; placing it is a transform). Defaults = reference reject lane (1.82 m, red frames, bay marking).
  - `crossTransfer` (conveyor, overConveyor): pop-up wheel row between conveyor strands; motions `raise` (0…1 → `rise` m) and `spin`; port `transfer`.
- `stationSign`: new `scale` param (0.4–1). The reference reject-bay sign is the 2.2 m sign at half size.
- `statusMonitor` dashboard: `checks` (≤ 8 lines: label, value, pending / pass / fail) and `verdict` (PASS / REJECT banner). The reference ST5 vision screen fits it, so again no station-specific drawing code.
- `materials.js`: `rejectRed`, now 38 shared materials.
- Tests: `tests/components/inspection.test.js` (12): arch travel and parking, independent lights / laser, laser sheet follows the belt height, top light bar on the beam, arch-width rule; tamp moves exactly and its rod stays in the cylinder; reject-lane rollers (18, tops at belt height), ports, extras off, roller spin; transfer wheels below / above the belt, lift rod in its cylinder; scaled sign; checklist / verdict validation.

**Fixes vs the reference**
1. **Scanner lights were shared materials:** switching one scanner lit every light bar (and laser) in the whole line. Each scanner now has its own.
2. The top light bar hung 1 cm under the arch beam (unattached); the laser sheet started in the air. Bar moved against the beam; a laser emitter added under the beam, the sheet starts at it.
3. **Labeller tamp rod** hung from the column alone; extended, it left the column and floated. Added a tamp cylinder on the column face; the rod stays inside it over the whole stroke.
4. **Cross-transfer wheels** floated between the strands with nothing under them. Added a wheel frame with bearings on a pneumatic lift cylinder standing on a floor plate.
5. Reject-lane end stop was a small post resting on a roller; now a bar across both frames.
6. Note: the reference definition says the pop-up rise is 0.022 m, but its code lifts 0.03 m; the component default follows the code (0.03), the IR can set 0.022.

**Results**
- `npm test`: 15 files, 683 tests passed.
- `npm run golden`: 4 new + stationSign and statusMonitor re-rendered (unchanged look at default params); 29 components in total. Checked by eye, plus screenshots `screenshots/visionScanner-scan.png` (scan on, arch mid-way) and `screenshots/crossTransfer-raised.png`.

### Step 6f: ST6 equipment (done)

Reference files received: `st6/PackagingEquipment.js`, `st6/PackagingDefinition.js` (saved in `reference/printer-line/st6/`).

Much of ST6 is existing components with ST6's values; only three are new.

**Changed**
- Existing components extended so ST6 fits:
  - `cartesianGantry`: `spanZ` up to 3 m (ST6 travels 2.55 m in Z) and `maxGap` up to 0.7 m (ST6 opens 0.64 m to take a carton); `fingerGripper` `maxGap` up to 0.7 m too. ST6's z range [−2.45, 0.1] is not centred: the IR places the (centred) gantry at z = −1.175.
  - `rollerConveyor`: `rollerPitch` param (the carton line uses 0.11 m). The carton line runs at its own 0.55 m belt height: the line context (`beltHeight`) is per build, so the IR / compiler passes 0.55 for that one component (no extra param needed).
  - `labelApplicator`: `padWidth` param (the carton labeller's pad is 0.16 × 0.1 m).
- New components:
  - `caseErector` (machine): housing on legs, window, and a magazine of flat blanks beside it (`blanks`, `blankLength`, `blankWidth`); port `output` (case) through the +X face at belt height.
  - `caseTaper` (machine, overConveyor): posts and beam behind the line, a carriage with an arm reaching over it, a tape head on a vertical slide (tape roll, wipe roller). Motions `x` (head position; parks at +0.68 m like the reference) and `lower` (0…1, wipe roller onto the carton top). Params `span`, `topHeight` (carton top, 1.17 = 0.55 + 0.62), `reach`, `stroke`.
  - `bayMarking` (station): translucent coloured floor rectangle (green / red / yellow / blue), default = the reference dispatch bay (pallet + 0.3 m).
- `materials.js`: `cardboard` (flat blanks), now 39 shared materials. Colour is my choice: the reference took it from `station-2/CardboardCase.js`, which I don't have.
- Tests: `tests/components/packaging.test.js` (9): **ST6 gantry, carton line and labeller built from `PACKAGING_DEFINITION`** (home pose reached, 25 rollers with tops at 0.55 m, pad size); erector legs, magazine beside the housing, output port; taper wipe roller exactly on the carton top when lowered / a stroke above when raised, head on its slide and arm on the beam at all positions, raised head under the arm for any stroke; bay size and colour.

**Fixes vs the reference**
1. **Case erector housing floated 0.25 m above the floor**; it now stands on legs. Its blank stack ran through the housing and hovered 5 cm up; the blanks now lie on a magazine beside it.
2. **Taper:** lowering moved the whole arm, which then left the beam and hung in the air. The carriage and arm stay on the beam; only the head runs down a vertical slide. The beam height follows the stroke so the raised head always tucks under the arm.

**Left for later (needs files from the lubricant line, Phase 5)**
- Cartons (`station-2/CardboardCase.js`), the pallet (`station-3/ProceduralPallet.js`), top / bottom foam and the dust bag: these are products (the `carton` product and a pallet), listed in Claude.md §8 under the lubricant machines.
- The foam magazine itself is a `workTable` (0.62 × 0.34 × 0.75) with a foam stack, so only the foam is missing.

**Noted:** with the tool raised, the ST6 gantry's ram stands ~1.4 m above the beam (it must reach down to 0.62 m). The reference does the same. A telescopic Z axis would fix it; not done.

**Results**
- `npm test`: 16 files, 746 tests passed.
- `npm run golden`: 3 new; gantry, gripper, roller conveyor and labeller re-rendered (look unchanged at defaults); 32 components in total. Checked by eye, plus `screenshots/caseTaper-lowered.png` and `screenshots/gantry-st6.png` (ST6 gantry at its home pose).

### Step 7: `printer` product (done)

Reference file received: `common/PrinterModel.js` (saved in `reference/printer-line/common/`). It builds on `PrinterLineDefinition.js` and `PrinterMaterials.js`, already here.

**Changed**
- Registry, product contract: `defineProduct` now takes `parts` (separately handled parts of an assembled product) as well as `stages` and `refs`. New `buildProduct(type, params, ctx)` validates params, checks that `build()` provides exactly the declared refs, and returns `{ type, params, stages, parts, stage, root, setStage(stage), ref(name), api, dispose() }`, starting at the first stage. Unknown stages and refs are rejected with clear errors.
- `lib/products/index.js`: loads every `lib/products/<name>/index.js` (adding a product = adding a folder).
- `lib/core/textures.js`: `textLabel()` (from `PrinterMaterials.js`), generic for stickers, plates and shipping labels.
- `lib/products/printer/` (port of `PrinterModel.js`, split up; geometry and data kept as in the reference so Phase 4 can compare):
  - `definition.js`: carrier, kit tray, size, the 6 stages, QA limit, `qualityFor` / `verdictFor` (deterministic per serial, rule 5), `serialLabel`.
  - `materials.js`: the printer's own finishes (extrusion, motor, brass, bed sheet, PSU perforation, thread texture…) on top of the shared library, made once per shared library; cables use the shared `cable*` colours.
  - `parts.js`: the 14 parts' kit / assembled poses, grasp points, screws, axes, dock port, cable routes, and every part's geometry (T-slot extrusions, NEMA 17 steppers, bed, hotend, mainboard box, PSU, LCD, harness).
  - `printer.js`: the assembled printer (part modes hidden / kit / asm / carried, fasteners, Y belt, printer axes with the T8 lead screw, live cable routing through the clips, test print, purge line, heat glow, LCD, QC sticker, stage application).
  - `carrier.js`: work carrier and kit tray with the foam cut-out insert.
  - `index.js`: `defineProduct('printer')`. Param `serial`; refs `printerOrigin`, `trayCentre`, `dockPort`; `api` = the printer (for the Phase 3 ops), kit tray, `quality()`, `verdict()`, `partCopy(name)` (free-standing parts for supermarket locations).
- Gallery: products are listed under "Products" and shown like components. Build stages appear as a `stage` motion (one button each, `?stage=wired` in the URL), and the footprint and camera framing use the visible meshes only. Segmented buttons wrap when there are many.
- `npm run golden`: also writes one image per product stage, `tests/golden/products/<type>-<stage>.png`.
- Tests: `tests/products/printer.test.js` (13): stages, refs and parts registered; every stage named, no NaN, **nothing floating, nothing below the belt**; parts kitted / installed per stage, screw counts (12 framed, 20 wired), test print / QC sticker by stage, no stray cable plugs; quality = reference `qualityFor`, deterministic and only once tested, some serials rejected; refs (dock port ref = the mesh); printer axes (bed, gantry, one lead-screw turn per 8 mm); a cable through every routing state; part copies; identical geometry on every build; dispose leaves shared geometry alone.

**Fixes vs the reference** (found by the generic checks on the product)
1. **Hidden cables left their plugs and rest coils visible** at the printer origin (on the carrier) until first routed: `refreshCables` skipped hidden cables. Now hidden means all of it is hidden.
2. **The bed hovered 6 mm above the foam in the kit tray:** its kit height assumed the V-wheels reach 69 mm below the plate; they reach 63 mm.
3. **The hotend's heat break stopped 10 mm short of the heater block,** leaving heater block and nozzle unattached. Now it reaches into the block.
4. The kit-foam speckle used an unseeded random (different every load): now seeded (rule 5).
5. Small cleanups: one shared kit-foam material instead of one per tray; the LCD uses the headless-safe live texture (the reference needed a DOM).

**Notes**
- The rule-6 guard checks component names only, not product names: the word "printer" is the line's name in many comments (conventions, definitions). Products can be added to the guard when the line runtime is written (Phase 3).
- The printer's own materials are cached per shared library and not freed when the gallery closes (`disposePrinterMaterials` exists, but the gallery can't call it by name without breaking rule 6). Small leak per gallery visit. A generic "product materials dispose" hook in the registry would fix it; left for later.
- Now unblocked, for the IR / layout in Phases 3–4: the ST4 dock height is belt 0.85 + carrier 0.03 + 0.008 + dock port 0.032 = **0.92 m** (`dockingUnit.axisHeight`), and ST1's supermarket locations can hold `partCopy()` parts.

**Results**
- `npm test`: 17 files, 759 tests passed.
- `npm run golden printer`: 6 stage images. Checked by eye (kitted: frame on the carrier and all parts in their foam cut-outs; wired: assembled with cables in the clips; inspected: test cube, green QC sticker, LCD on), plus `screenshots/printer-gallery.png`.

**Phase 2 done-criteria:** every component passes its tests ✓ (32 components + the printer product, generic §9 checks on all of them); looks right in the gallery ✓ (golden images checked by eye). Side-by-side comparison with reference screenshots: I have no reference screenshots, only the code, so the visual check was against the reference geometry. The owner can compare the gallery with the old repo.

## Phase 3: Ops, station and line runtime

### Step 1: Basic ops (done)

Phase 2 approved by silence (owner rule). No new reference files needed: `AssemblyCycle.js` and `PickPlace.js` were already here.

**Changed**
- Registry contract:
  - Range motions may declare `wrap` (the range is one period: yaw, belt / roller / wheel phase, bit spin; moves take the short way and relative moves may go round many times) and `travel` (metres of surface per full range, so a conveyor op scrolls any belt or roller without knowing the component).
  - Components may declare `anchors` (fixed list or a function of params): named Object3D frames that move with the motions and can carry things. `build()` returns them, the registry checks declared = provided, `instance.anchor(name)`.
  - `componentSpec(type, params, ctx)`: motions, ports, anchors, footprint **without building geometry** (for dry runs / timing); `buildComponent` now uses it.
  - Op `duration` is optional: when absent, an op's duration is the sum of the steps its `expand()` queues. No basic op defines one, so durations always add up from the steps (Claude.md §6.3).
- Components updated for the contract: `cartesianGantry` and `scara` (`yaw` wraps; anchor `tool` at the tool point), `palletConveyor` (`belt` wraps, travel 0.5 m; anchor `carrier` = locating plate when there is a work stop), `rollerConveyor` / `crossTransfer` (roller / wheel phase wraps, travel = circumference), `screwdriver` (`driverSpin` wraps). No geometry changes; goldens unaffected.
- `lib/ops/OpCycle.js`: what ops expand into. **Run** mode queues steps on a `StepSequencer` and drives real instances; **dry** mode only records steps (timing, takt, SimPy later). Same expansion code for both. Keeps the *planned* state (each motion's value and each item's location once the queued steps have run) for distances and durations; at run time each step still starts from the actual state. Carrying: an item attached to an anchor keeps its exact pose relative to it whenever that machine's motions change. Errors name the op and its position, nested through decisions (`op #3 (decide) › case "fail" › op #1 (move): machine "robot".x must stay in [-0.6, 0.6], got 7`). `dryRun(registry, ops, { equipment: { id: { type, params } } })` gives durations from the catalog alone.
- `lib/ops/basic/` (one file per op, loaded by `lib/ops/index.js`), all with zod args and common `label` / `state` / `status`:
  - `move`: several axes of one machine together; `to` (absolute) and/or `by` (relative) in one step (e.g. a bit running down while it turns); `seconds` or `speed`; profiles smooth (quintic, as `queueToolMove`), linear, trapezoid.
  - `rotate`: one axis `to` a value (short way) or `by` an amount (many turns on periodic axes).
  - `grip`: attach an item to a machine anchor, close the grip motion, switch `holding` on if the machine has it. A locating plate is a grip too (`motion: locate, anchor: carrier`): the carrier rises onto the pins with the plate.
  - `release`: open, `holding` off, let go; the item stays where it is. `onto`: put it onto another item (part on a carrier) and it moves with it from then on. Released by the same machine that picked it from a port (a locating plate), the item is back at that port.
  - `toolOn`: switch a value motion, optionally hold it and switch to `then`.
  - `transform`: product stage change at the start or end of a timed step.
  - `transfer`: convey an item between two ports of a conveyor with the line trapezoid (same durations as the reference `queueTravel`); every `travel` motion scrolls with it; the start port defaults to where the item is.
  - `wait`.
  - `decide`: branch on a fact (e.g. `quality`, deterministic per serial). Decided when the cycle is planned; **every branch is validated whatever the fact**, so an error never depends on the serial. Dry runs take the longest branch and mark motions the branches disagree on as UNKNOWN (a later speed-based move from there is planned at its worst case, the whole range).
- Dev check scene `#/twin?demo=ops` (`?t=<s>` freezes it at a moment for screenshots): `app/dev/opsDemo.json` (equipment by catalog type, box items, a process written only with basic ops; a small preview of factory.json) played by the generic `app/dev/opsDemo.js` in a loop. Infeed, locate, pick from a bench, carry with a 90° wrist turn, place onto the carrier, a quality decision (every 3rd unit takes the reject branch), release, outfeed. The HUD caption shows unit, state and step. The JS knows no component by name (rule 6), the names are in the JSON.
- Tests: `tests/ops/basic-ops.test.js` (27): quintic / speed / trapezoid / linear timing and positions; short-way yaw; many-turn wrap; combined to + by; 12 bad-input cases with located messages; carried part stays exactly on the tool point and turns with the wrist, stays put after release; locate rises 30 mm and returns; `onto` carries the part out with the carrier; toolOn / wait / transform (with the printer product); transfer duration = reference trapezoid, ends exactly on the port in a rotated and offset cell, belt phase advanced by distance / tile; decide picks by fact, validates all branches, `otherwise`, dry longest-branch and UNKNOWN merging; **dry run steps = played steps** for an 11-op program; dry runs check names without geometry; anchors contract; `componentSpec` = built instance for every component; robot tool anchors exactly at the commanded tool point; demo JSON dry-runs.

**Design notes**
- Ops are sequential (like the reference cycles). Two machines moving at the same time (robot works while the conveyor indexes) is not covered yet; a `parallel` op can come with `StationCycle` if the printer stations need it.
- The reference pick-and-place "swing" (part turned about the finger axis during transfer) is part-specific and goes into the named `pickPlace` / `installPart` ops (next step), not the basic ops.
- `decide` is taken at planning time. That is enough for facts that are deterministic per serial (rule 5). A fact only known mid-cycle would need lazy expansion; none is needed so far.

**Problem found and fixed:** the first demo JSON gave the bench a 0.3 m width (minimum 0.4); the registry refused it in the browser. A test now dry-runs the demo data, so this kind of slip fails `npm test`.

**Results**
- `npm test`: 18 files, 786 tests passed.
- Screenshots checked: `screenshots/ops-carry.png` (part in the gripper mid-transfer, turned with the wrist), `screenshots/ops-outfeed.png` (part riding out on the carrier), `screenshots/ops-placed.png` (part set down on the located carrier).

### Step 2: Named ops (done)

Step 1 approved by the owner on 2026-11-17. Ported from `PickPlace.js` (already here).

**Changed**
- Registry contract:
  - Periodic motions may declare `angle` (radians per full range), so an op can ask for whole turns without knowing a component's units. Set on the bit spin (60° per range), roller and wheel phases (360°).
  - **Assembly interface for products with parts** (`ASSEMBLY_API`, checked by `buildProduct`): `origin()`, `grip(part, mode)` → tool point and heading, `pose(part, mode)` → Matrix4, `object(part)`, `setPart(part, mode)` (incl. `carried`), `screws(part)`, `screwSeat(id)`, `setScrew(id, driven)`, all in the product frame. The assembly ops use only this, so they work for any assembled product. Product instances also expose `refs` and `assembly`.
- Components: robots with the screwdriver fitted (and the screwdriver component) have a `bit` anchor at the extended bit tip, the seat of a driven screw. No geometry changes.
- `printer` product: implements the assembly interface (thin adapter over its existing part poses, screws and grasp points).
- `OpCycle`:
  - targets given as functions are resolved when their step starts (positions on the located product); their planned value is UNKNOWN in both modes, so dry = run still holds; such steps need a fixed time.
  - per-motion easing; attachment offsets that can change while carried (`setAttachmentOffset`); frame helpers (`machineFrom`, `toMachine`, `directionToMachine`, `yawToMachine`, `anchorInMachine`); `assembly(part)` checks part names (dry too).
  - `dryRun(…, { product: type })` checks stages / refs / parts from the product definition without building it.
  - Out of reach at run time stops with `step "Moving to Motor_Z": machine "gantry" cannot reach x = … (range […])`.
- `lib/ops/sequences.js`: the reference pick-and-place sequence (clear up → approach → descend → grip → lift → transfer → place or lower + slide in → release) with the reference labels, statuses and ST2 default times, shared by both pick ops. A part's way of sitting in the gripper blends during the transfer, so it arrives exactly in its target pose (this replaces the reference's per-part `swing`/`carry` and works for any re-orientation).
- Named ops (`lib/ops/named/`), no `duration` of their own (sum of their steps):
  - `installPart`: part from its kit pose into its assembled pose; `clearance`, `clearAbove` (above the assembly origin), `insert` (product-frame slide-in vector), `spinTurns` (threading), gripper gap / open gap / timing.
  - `pickPlace`: any item between places; a place is a machine port or a product ref, plus offset and heading; `clearance` or `clearY`; `onto`.
  - `driveScrew`: screw id `Part:index`; feed + travel (rising first, never dipping), driver down, drive (slide + bit turns), torque OK; wrist turned round beyond `centerX`; bit geometry from the `tool` / `bit` anchors; motion names are arguments (defaults = the screwdriver's).
- Basic `rotate` takes `turns` too.
- Dev scenes: `#/twin?demo=ops&scene=assembly`, the ST2 frame build on the real printer (8 parts, 10 screws, reference ST2 values), next to `scene=basic` (step 1). Scenes moved to `app/dev/ops-scenes/*.json`; each can set its camera.
- Tests: `tests/ops/named-ops.test.js` (19): assembly contract; printer adapter = its parts; reference labels / times; part exactly in its kit pose when gripped and **exactly in its assembled pose before release** (plain, re-oriented upright, threaded lead screw, slid in along `insert`); **the whole ST2 part list in order**; bad parts / gaps / no parts; out of reach at run time; driveScrew bit tip exactly on the seat, screw head shown, reference times, wrist turned beyond `centerX`, never dips, bad ids, no screwdriver; pickPlace port → product ref with `onto`, ref / port checks; **dry = run** for a mixed program (from the catalog alone); dry name checks; worst case after a named op; rotate by turns. The demo test now plays every scene for two full units headless (so a reach error in scene data fails `npm test`).

**Changes vs the reference (deliberate)**
1. During the approach the gripper opens with the move (eased) instead of jumping open on the first frame.
2. The driveScrew wrist turn takes the short way (the reference lerped the angle; for 0 ↔ π it is the same move).
3. Status key `driver` instead of `screwdriver` on the step status (the rule-6 guard flags component names in generic code; the HMI text "Screwdriver down" is unchanged).

**Limitations (noted for later steps)**
- After a named op, the robot's planned pose is UNKNOWN: a following relative move (`by`) is refused, and a speed-based move is planned at its worst case (identically in dry and run, so timings still match). Use fixed times, as the reference does.
- `driveScrew` drives screws of the product only; a screw into a fixture would need a seat given another way.
- Not ported yet: `inspect`, `palletize`, the ST3 cable routing, the ST4 test steps. They need the station cycle files (see below); `fill` / `cap` come with the lubricant line (Phase 5).

**Results**
- `npm test`: 19 files, 805 tests passed.
- Screenshots checked: `screenshots/named-upright.png` (left upright mid-transfer, turning from lying to upright), `screenshots/named-screw.png` (upright placed, vertical in the gripper), `screenshots/named-framed.png` (frame complete, last top-bar screw being driven).

Step 2 approved by silence (owner rule).

### Step 3: `StationCycle` with typed ports (done)

**Reference files:** the reference repo is on this machine (`C:\Users\ok\Desktop\3D-Digital-Twin-Visualization-Tool`). I read the `station-agent` branch with `git show` (read-only: no checkout, nothing changed there) and copied into the git-ignored `reference/printer-line/`: the six station cycles (`st*/…Cycle.js`), the six `…Station.js` files, `common/AssemblyStation.js` and `line/` (`PrinterAssemblyLine.js`, `PrinterLineLayout.js`, `PrinterLineOverlay.js`, `PrinterLine.test.js`). So the files for the rest of Phase 3 are here, and the owner doesn't have to send them.

**Changed**
- `lib/station/stationSpec.js`: a station as data (zod): `id, code, title, workState, inputStage, conveyor, ports, intake?, process, output?, home, status, signals { beacon, display }, feed`. Errors name the station and the field.
  - **Typed ports:** `input / work / output` default to the conveyor's ports of the same names. Any extra port (e.g. `reject`) names a port of any station machine. Each port takes over what the component port `carries` (`unit | batch | case | pallet`). `portMismatch` only lets output → input ports carrying the same thing connect.
  - **Default intake / output** made from the conveyor's spec and the line conventions (no component names): stop raised 0.3 s → transfer input → work → lift & locate 0.4 s; release (plate **and** stop pin down together) 0.35 s → transfer work → output. These are the reference steps, labels and times. Without a work stop, units are conveyed straight through. A station can replace either list (e.g. ST4's shutters around the infeed) with its own ops.
- `lib/station/StationCycle.js`: generic port of `AssemblyCycle`. Same ports interface (`input.take()`, `output.ready()`, `output.put()`), same lifecycle (`start / stop / reset / setSpeed / update`).
  - Per unit: intake → process → `Process complete` → hold `Holding · downstream busy` while the output isn't ready → output → hand-over. All three phases are op lists expanded on **one OpCycle per unit**, so the planned state (where the carrier is, robot poses) carries from phase to phase.
  - Stand-alone ports as in the reference: a new unit at `inputStage` rises from the return line at the input port (lift drop / time from the conventions); the output lowers it away and disposes it. Extra output ports keep the last 3 units (a reject lane).
  - **Exit through another port:** when the process leaves the unit at another output port of the station (ST5's reject lane), the unit is handed over there and the output phase is skipped.
  - Checked before anything plays: building a station runs its dry plan, so a bad op fails with `station "demo" › process › op #1 (move): machine "robot".x must stay in […]`. Run-time errors (out of reach, unknown fact) stop the station in **ALARM** with the reason on the HMI and the stack light red; it won't restart until reset.
  - Signals as roles, not component names: `beacon` = any motion with values `off | run | wait | alarm` (off / run / amber while waiting or holding / red on alarm); `display` = any machine display, filled with title `ST2 · FRAME ASSEMBLY`, state, step, rows `[label, statusKey]` and an optional bar with `{key}` text (all cut to the screen's limits). Refreshed every 0.1 s, as in the reference.
  - Facts for `decide`: `serial` always, plus the product's `facts` and a `facts(unit)` option.
  - Reset puts every motion back to its default, then applies `home`; it disposes the units and zeroes the counters and serials.
  - `planStation(registry, station, { equipment, product })`: dry plan from the catalog alone. Returns `intake / process / output` (duration + steps) and `cycleTime`. Stand-alone lift moves and holds are not counted, since a line replaces them with transfers. This is the input for `compiler/timing.js`.
  - `connectPorts(out, in)`: checks the types, then wires a one-place hand-over (back-pressure through `ready()`). `Line.js` will add the transfer conveyors on top of this.
- Contract changes:
  - `palletConveyor` ports are now **carrier-centre positions**: ±(length − carrierLength)/2 = **±1.6 m**, the reference station ports. Before, they were at the belt ends (±2.2), so transfers were 0.6 m too long and the ops demo carrier (placed at −1.6) jumped. No geometry change, goldens unaffected.
  - `grip` / `release` take `also: { motion: value }`: other range motions of the same machine in the same step.
  - Line conventions: `workStop` (motion / anchor names and the reference step times) and `holdSeconds` 0.25.
- Dev scene `#/twin?demo=station` (`?station=<name>`, `?t=<s>` frozen): `app/dev/stationDemo.js` plays `app/dev/stations/frame.json` stand-alone. The file has the shell (slab, fence, conveyor, lifts, sign, HMI, stack light) plus the gantry as catalog types, and the ST2 frame-build ops from the assembly scene; intake and output are the defaults. No component names in the JS.
- Tests `tests/station/station-cycle.test.js` (21):
  - spec defaults and errors; typed port resolution and mismatch messages
  - default intake / output = the reference labels, states and times; dry plan from types = from instances; bad ops located by station › phase › op; explicit intake replaces the default; pass-through conveyor
  - stand-alone unit in a moved and turned station frame: rises, located on the plate at the work port, worked, released, lowered and disposed
  - **dry plan = played steps**; 10× = 1× step for step
  - beacon and HMI screen content; long text cut; WAITING amber; ALARM on a run-time error (refuses to start until reset); reset
  - reject: the failed unit handed over at the reject port with no output phase
  - two connected stations: hand-over, **HOLDING** amber while downstream is busy, released when it takes the unit; mismatched port types refused
  - real printer: installPart + driveScrew through the station cycle, dry = run
  - every dev station file plays one unit headless

**Reference logic left for later steps (on purpose)**
- Station-specific work that isn't plain ops yet: ST1 pick lights and supermarket restock, ST3 cable routing and continuity test, ST4 printer test sequence (dock, probe mesh, heat, print), ST5 vision scan, labeller and pop-up reject, ST6 carton flow and pallet stacking. They need ops such as `inspect`, `routeCable`, `palletize` and product-driven steps; these come with the IR/compiler work in Phase 4, when each station is written as data.
- Lift-carriage motion: the reference lifts don't move. Ours have a `level` motion, but the stand-alone feed only animates the carrier, as the reference does.

**Results**
- `npm test`: 20 files, 826 tests passed.
- Screenshots checked: `screenshots/station-intake.png` (t = 3 s: carrier P1-0001 on its way to the work position, HMI INFEED, stack light green) and `screenshots/station-work.png` (t = 20 s: gantry placing the bed on the located printer, HMI FRAME_ASSEMBLY).

Step 3 approved by the owner moving on (2026-11-22).

### Step 4: `layout.js` and `Line.js` (done)

Ported from `line/PrinterLineLayout.js` and `line/PrinterAssemblyLine.js` (copied in step 3).

**Changed**
- `lib/line/layout.js`: line layout from the graph and the stations' own conveyor extents, never from the LLM.
  - `flowOrder(ids, edges)` follows the edges (`'a.output' → 'b.input'`) from the only station with no input, so the list order doesn't matter.
  - `layoutLine({ stations: [{ id, extent }], edges, transferLength })` places each station so the gap between one conveyor end and the next conveyor start is exactly the transfer length. The row is centred (first and last origins symmetric), and placing a station is a pure X offset (station-local frames, rule 4). Returns the order, positions and transfers (`start, end, length, centre`).
  - Stations of different lengths keep the exact gap.
  - Only **chains** for now. Branches, merges, loops, separate parts, unknown stations and self-feeds fail with a clear message instead of a wrong layout (graph shapes are Phase 6).
- `lib/line/lineSpec.js`: a line as data (zod), a preview of the line part of factory.json:
  - `id, title, runSize (8), product, transferLength?`
  - `stations[]`: a station spec plus `equipment[] { id, type, params, position, rotationY }`
  - `edges[] { from, to, carries?, transport { kind: conveyor, type, params } }`
  - Stations have no positions; layout gives them.
- `lib/line/Line.js`: generic port of `PrinterAssemblyLine`. Stations are the same `StationCycle`s as stand-alone, unchanged; the line only replaces their ports.
  - **First input** releases `runSize` units from the return line (status "Run complete · all carriers released" afterwards). **Each edge** gets a transfer conveyor of the edge's catalog type, sized to the gap (its `length` param is set from the layout when the component has one and the edge doesn't give it). **Last output** and unconnected extra outputs (a reject lane) keep their stand-alone behaviour.
  - Each transfer holds one unit and carries it from the upstream output port to the downstream input port (2.4 m, as in the reference) with the line trapezoid. Belt motions that declare `travel` scroll with it.
  - Back-pressure: the upstream output isn't ready while the transfer is occupied, so that station shows HOLDING and the stack light goes amber; downstream shows "Waiting for ST1" until the unit has arrived. The units are the same objects from the first station to the last.
  - Checks, each naming the edge or station: port types per edge (`edge b.output → c.input: "output" carries pallet but "input" takes unit`), `carries` on the edge, unknown ports and transport types, the transport's own port types, duplicate station or equipment ids, and a station conveyor that doesn't run along station +X.
  - Equipment that only serves a port stand-alone is hidden once the port is connected. For this, station ports got `standalone: [machineIds]`, and a port's `port` name now defaults to the station port name.
  - `start / stop / reset / setSpeed / update / dispose`. **FINISHED** once the whole run has left the line and every station is back waiting; stations then stop.
  - `status` (released, in process, exited, transfers, one line per station) and `timing` (each station's dry cycle, each transfer's travel, the bottleneck).
- Dev scene `#/twin?demo=line` (`?line=`, `?t=`, `?speed=`): `app/dev/lineDemo.js` plays `app/dev/lines/printer.json`, three stations with full shells: ST1 and ST3 are short stand-ins, ST2 is the real frame build. Run of 3. No component names in the JS.
- Tests `tests/line/line.test.js` (12):
  - layout of six reference stations = the reference `PrinterLineLayout` (station X = (i − 2.5) × 5.6, transfer ends, 1.2 m gaps); order from edges, uneven lengths, centring; layout refusals
  - line placement, transfer size, distance 2.4 m and trapezoid time; lifts only at the line ends
  - a whole run (the same 3 units through all stations in serial order, FINISHED, stations stopped)
  - transfer ends exactly at the next input port, belts scroll, the next station adopts the unit
  - back-pressure HOLDING / amber / "Waiting for B2"; 10× = 1×; reset mid-transfer; dry timing and bottleneck
  - 8 build refusals
  - the dev line file runs its first unit into the second station headless

**Not yet (on purpose)**
- Lines that aren't chains: reject branches to another station, merges, parallel stations, buffers, and AGV / robot / worker transports (Phase 6).
- `FactoryOverlay` / line HUD from the IR: the dev scene only shows a status line.
- Run complete is counted from the output ports; ST6's own counters (dispatched, pallets) come when ST6 is written as data.

**Results**
- `npm test`: 21 files, 838 tests passed.
- Screenshots checked: `screenshots/line-transfer.png` (t = 16 s: P1-0001 on the first transfer into ST2, the second carrier entering ST1, ST2 and ST3 waiting) and `screenshots/line-running.png` (t = 60 s: ST1 HOLDING with downstream busy, ST2 fastening the top bar, ST3 waiting for ST2; transfers fill the gaps, lifts only at the ends).
- Note: the first headless screenshot of the line timed out at the default 60 s (cold SwiftShader start plus building three stations). The retry with `--timeout 150000` worked.

Step 4 approved by the owner moving on (2026-11-22).

### Step 5: `compiler/timing.js` and the reference timing recording (done)

**Reference timing, recorded rather than copied.** The reference printer-line code only exists on the reference repo's `station-agent` branch; its working tree is on `main`. I exported that branch's `src/station` and `src/motion` with `git archive` into the git-ignored `reference/_src/`. This is read-only: no checkout, nothing in that repo changed (its one untracked file, `NEW_PROJECT_MASTER_PROMPT.md`, was already there). From there the real reference cycles run headless.
- `scripts/reference-timing.mjs` (`npm run reference:timing`): stubs only the canvas, then runs each of the six reference stations stand-alone for a whole run of 8 units and the whole reference line for one run. It records every step played (state, label, duration).
  - Units are split where the unit label changes, because ST4 opens its entry shutter before the carrier rises.
  - It runs 3 s past the end so the last unit's closing steps are recorded too.
- Output: `benchmarks/expected/printer-line-reference-timing.json`, the timing Phase 4's acceptance test compares against.

| Reference station | Unit (stand-alone) | Steps | Notes |
|---|---:|---:|---|
| ST1 Kitting | 51.19 s | 138 | identical for all 8 units |
| ST2 Frame | 53.66 s | 126 | identical |
| ST3 Wiring | 76.61 s | 288 | identical, **bottleneck** (74.81 s without the stand-alone lift moves) |
| ST4 Calibration | 35.15 s | 50 | identical |
| ST5 Inspection | 16.26 s | 15 | rejects (serials 5, 8): 14.39 / 15.83 s (different reject-bay slots) |
| ST6 Packaging | 31.22 s | 44 | unit 8: 32.82 s (pallet dispatched) |
| Line, run of 8 | finished at 771.1 s | | exits 277.6, 352.2, 427.0, 501.8, 545.5 (reject), 651.4, 726.5, 771.1 (reject); transfer 5.683 s |

**Changed**
- `compiler/timing.js` (reads only data, no geometry):
  - `lineTiming(registry, lineData)`: for each station in flow order, intake / process / output / cycle time and every step as a row (start time, phase, state, label, duration). Transfers come with distance and time (from the layout and the port positions, no build). Also takt, bottleneck (a station, or a transfer if that is slower), lead time for one unit, and estimated run time.
  - Line model, as in the reference: takt = slowest station cycle or transfer; lead = lift + Σ cycles + Σ transfers + lift; run ≈ lead + (N − 1) × takt. Waiting stations re-check every 0.25 s, so a played run can be up to one hold per hand-over longer.
  - `compareStation` / `compareTiming`: our steps against a recorded reference unit (stand-alone lift steps left out), **aligned by label** (longest common subsequence). One missing step is reported once as `missing step` instead of shifting everything after it; also `extra step`, `state` and `duration` differences, plus totals and Δ. Transfers are compared as well.
  - `referenceTakt`, `formatTimingTable` (markdown, optionally with the reference column).
- `tests/helpers/lineFixtures.js`: the small test line, shared by the line and timing tests.
- `npm run reference:timing` added to `package.json` (no new dependency).
- Tests `tests/compiler/timing.test.js` (10):
  - timing from data = timing of the built `Line`; step rows (phases, labels, start times add up)
  - takt / bottleneck / lead / run formulas, including a transfer bottleneck; a played run finishes between the estimate and the estimate + one hold per hand-over; the markdown table
  - the alignment (missing once, extra, state, duration); the recording covers six stations, 8 units each, and the line run
  - **our default intake and output are step-for-step the reference ones** in all five stations without shutters; **transfers take exactly the reference 5.683 s**
  - **the takt model holds on the reference line itself**: dispatched units leave one ST3 cycle apart (median gap within 0.3 s of 74.81 s)

**What the comparison shows already (dev preview line, not the final stations)**

| Station | Intake s | Process s | Output s | Cycle s | Reference s | Δ s | Steps match |
|---|---:|---:|---:|---:|---:|---:|:---:|
| ST2 Frame Assembly (dev scene) | 4.61 | 38.60 | 4.26 | 47.46 | 51.86 | −4.40 | no |
| Transfers | | | | 5.68 | 5.68 | 0.00 | yes |

- ST2 in the dev scene is an approximation from the named-ops step. Its part names differ from the reference HMI texts ("Z motor" vs "Z motor assy", screw "M4 1" vs "1/2"), and it lacks the adjust steps (Y belt tension, V-wheel eccentrics, Z coupler, squareness check). Durations of the matching steps are equal. Phase 4 writes ST2 with the reference names and steps, and this comparison will show what is still missing.

**Not done (on purpose)**
- No CLI for the timing table yet: our library loads components through Vite's `import.meta.glob`, so a CLI needs a Vite server like `npm run golden`. It comes with the reviewer CLI (Phase 7), which also runs the takt check.
- No browser change in this step: the timing is not visual yet (the KPI overlay is Phase 11). App files are unchanged since step 4's screenshots.

**Results**
- `npm test`: 22 files, 848 tests passed.
- `npm run reference:timing`: six stations and the line recorded in about 1 minute.

**Phase 3 done:** basic and named ops, `StationCycle` with typed ports, `layout.js`, `Line.js` and `compiler/timing.js` are in, each with tests and (where visual) screenshots.

**Next:** Phase 4.

## Phase 4: IR and compiler

### Step 1: `factory.schema.js` (the IR), shell presets, `expand.js` (done)

Phase 3 step 5 approved by the owner moving on (2026-11-22).

**Changed**
- `spec/factory.schema.js`: `factory.json` as zod, built from the Phase 3 station and line specs.
  - `version: 1`.
  - `line { id, title, units 'm', flow '+X', runSize (8), speeds [1, 2, 10], conventions? }`: convention overrides are belt height, conveyor speed / ramp, lift drop / time, transfer length and hold time.
  - `product`: discriminated by `kind`; only `catalog { type, params }` for now (parametric and GLB come in Phase 6).
  - `stations[] { id, code, title, shell?, equipment[], conveyor?, workState, inputStage, ports, intake?, process, output?, home, status, signals, feed }`: equipment by catalog type with station-local position / rotationY. **No station positions**: layout gives them.
  - `graph { edges[] { from 'station.port', to, carries?, transport { kind: conveyor, type, params } } }`.
  - File-internal checks with paths: duplicate station / equipment ids, edges to unknown stations, a station with neither shell nor conveyor, `station.port` format. `parseFactory` throws a `FactoryError` listing every issue as `stations[1].equipment[1].id: …`. Zod runs the reference checks only once the shape is valid, so the shape is reported first.
  - `factoryJsonSchema()` and the generated **`spec/factory.schema.json`** (`npm run schema`, plain Node). A test fails when the file is out of date.
- **Shell presets** (registry): `defineShell({ type, summary, params, build })`. `expandShell(type, params)` validates params, checks every piece of equipment is a known component type and that the station conveyor is among it. Shells keep the compiler free of component names (rule 6) and keep station JSON short: a stand-in station is about 0.9 kB.
- `lib/components/station/shells.js`: the **`assemblyCell`** shell, the reference `createStationShell` + `StationBase` as data:
  - slab ±2.35 × [minZ, maxZ] with the walkway at z 1.05; fence at minZ + 0.25, length 4.1
  - pallet conveyor 4.4 m with work stop; lifts at the ports ±1.6; sign at minZ + 0.45
  - HMI at (−1.55, 0, 0.95) turned 0.3 rad; stack light at (1.95, 0, −0.55)
  - ports with the lifts as stand-alone equipment; beacon and display signals
  - Params: code, title, colour, minZ / maxZ, walkway, HMI x, conveyor and carrier length.
- `compiler/expand.js`:
  - `expandFactory(registry, data)` → `{ factory, conventions, ctx, line }`: shells expanded, and the station's own ports and signals merged field by field over the shell's. An equipment id clashing with the shell's is refused, and so is an unknown catalog product. Conventions are merged group by group (`mergeConventions`); `ctx` carries the belt height to components.
  - `checkFactory(registry, data)` → `{ ok, errors: [{ path, message }], expanded, timing }`: schema, references, catalog types, a dry plan of every op of every station, ports, edges and layout, all without geometry. It never throws. The deterministic reviewer (Phase 7) builds on this.
- Dev line `app/dev/lines/printer.json` is now a **factory.json** (under `"factory"`); `lineDemo.js` loads it through `expandFactory`.
- Tests `tests/spec/factory.test.js` (11): defaults; issue paths; JSON Schema file up to date; `assemblyCell` placements = the reference shell; shell refusals; expansion and merging (and the clash refusal); convention merging; `checkFactory` ok / catalog errors with paths or located messages; overrides reaching layout, timing and built components (belt height 0.9 on the conveyor ports); an expanded factory.json running as a line to FINISHED with the middle lifts hidden.

**Notes**
- Ops in `process` are checked against the registry when planned (`checkFactory`), not by the JSON Schema: their args live in each op's own zod schema. The Phase 8 catalog can turn them into a per-op union for Structured Outputs. OpenAI strict mode also needs every field required and no defaults, so a strict variant of the schema will be derived then.
- The `graph` has only edges for now; Phase 6 adds nodes (buffers, merges, splits, parallel copies) and layout hints.

**Results**
- `npm test`: 23 files, 859 tests passed.
- Screenshot `screenshots/factory-line.png` (t = 60 s): the dev line loaded from factory.json matches step 4's hand-written line at the same moment (ST1 HOLDING, ST2 fastening the top bar, ST3 waiting). The fence now sits at the reference z.

### Step 2: `printer-line.factory.json`, ST1 and ST2 (done)

Step 1 approved by the owner moving on (2026-11-22).

**Result first:** ST1 (kitting) and ST2 (frame) written as data in `spec/examples/printer-line.factory.json` **match the reference recording step for step**: ST1 136 steps and ST2 124 steps, every label, state and duration (Δ 0.00 s), and the transfer between them too. Cycles 49.39 s and 51.86 s are the reference unit times minus the stand-alone lift moves. Two units play headless through both stations to FINISHED with no error, in 161.6 s (estimate 160.6 s plus waiting re-checks).

**Changed**
- `spec/examples/printer-line.factory.json` (ST1, ST2, transfer; run of 8). Values come from the reference `KittingDefinition` / `FrameAssemblyDefinition` / `…Equipment.js` / `…Station.js` (HMI rows and bars). The part tables come from our printer product. I typed it through a one-off generator so no number was copied by hand; the JSON file is the source from now on.
  - **ST1:** assemblyCell shell (minZ −2.35, blue sign) plus SCARA (links 0.55 / 0.5, arm 1.3), keep-out ring, tote table with 7 totes, long-part cradle, bed nest, frame nest, flow rack and 14 pick-to-lights at the reference spots. Stock is 22 part copies: 2 per tote, 1 per cradle lane, 2 beds stacked, the base frame on its locators. The process: RFID read → per part, pick light on, `installPart` from stock into the kit pose (base frame: assembled, onto the locators), light off as it is let go → kit complete → robot home → kanban replenish.
  - **ST2:** shell (orange sign) plus gantry (1.5 × 0.9, beam 2.3, screwdriver) and the screw presenter (bench + M3 / M4 / M5 bowl feeders). The process: RFID read → 8 × `installPart` from the kit (reference clearances, grips, lead screw threaded with 5 turns) with their 20 screws (`driveScrew`, "Z motor assy 1/2"…) → the adjust steps (Y belt tensioned, V-wheel eccentrics, Z coupler, squareness check) → gantry home.
- Contract additions (all generic; the printer specifics live in the product folder):
  - **Product features** (registry): a product may declare single visual details an op can switch without a stage change, `features: { name: { values } }`, with `setFeature(name, value)` and `featureState` (reset by a stage change). The printer has `yBelt` (loose / engaged) and `bedCable`, `powerCable`, `hotendCable` (hidden / stowed).
  - **Part copies** (registry `partCopy(type, part, mode)`; the product's optional static `copy()`): a free-standing copy of a part for a stock location. It rests on its origin as in the kit tray (or as assembled), with its grasp point and part frame. The printer implements it.
  - **Station stock** (station spec + factory schema): `stock: { id: { part, mode, at: { machine, port, offset } } }`. The station builds the copies at their ports and refills them on reset; dry plans check machine, port and part.
  - `transform` takes `set: { feature: value }` (instead of `stage`), checked in the dry plan.
  - `installPart` takes `from` (a stock item), `mode: asm | kit`, and `onPlaced` (machine value motions or product features switched as the part is let go, with no step of its own: the reference does the same). A stock item holding the wrong part stops the station in ALARM.
  - New named op **`replenish`**: a timed step that puts the stock items (all or some) back at their places.
  - The pick-and-place travel height is **capped at the robot's y reach**. The reference let the ST1 SCARA quill rise past its travel (up to about 4 cm for the bed, hotend and X gantry); our component enforces its range. The steps have fixed times, so no duration changes.
- Line demo: also plays `spec/examples/*.factory.json` (`#/twin?demo=line&line=printer-line`), and the twin page takes `?cam=x,y,z,tx,ty,tz` for screenshot framing.
- Tests `tests/spec/printer-line.test.js` (10):
  - the factory checks clean; **ST1 / ST2 / transfer match the reference with no mismatch**; cycle times = reference
  - two units played: after ST1 the base frame is assembled and 13 parts are in kit pose, with the stock refilled; after ST2 the 8 frame parts are assembled with belt engaged and bed cable stowed; all 14 pick lights off; run time within the estimate + holds
  - stock copies rest exactly on their ports, and a placed copy coincides with the product's own part
  - features, part copies, `transform set`, `installPart` from stock (wrong copy → ALARM; kit mode needs `from`), stock errors, travel height cap

**Known differences / notes**
- The HMI `picked` / `installed` counters update when a part's pick starts; the reference updated them when the part was placed. Status changes are tied to step starts in our runtime. Timing is unaffected.
- The product's stage label stays `empty` after ST1 and `kitted` after ST2. The reference has no stage change inside the line either (stages only seed stand-alone stations); what is shown is set per part. ST4 / ST5 need `quality` / `verdict`, which read the stage, so those stations will set it (an ending `transform` the reference recording allows, or a feature).
- Stock copy geometry is not freed on dispose (printer part geometry is cached and shared); removing them from the scene is enough for now.

**Results**
- `npm test`: 24 files, 869 tests passed.
- Screenshots checked:
  - `screenshots/printer-st1-supermarket.png` (t = 9 s): the cradle with the long parts, totes with the small parts, two beds in the nest, the base frame already on the carrier's locators, SCARA moving to the left upright
  - `screenshots/printer-st1.png` (t = 18 s): SCARA gripping the lead screw from the cradle, the first parts in the kit tray
  - `screenshots/printer-st2.png` (t = 85 s): gantry descending to the right upright; motors and bed fitted, the rest waiting in the tray; HMI FRAME ASSEMBLY; feeders behind; ST1 kitting the second unit

### Step 3: ST3 (wiring) in `printer-line.factory.json` (done)

Step 2 approved by the owner moving on (2026-11-22).

**Result first:** ST3 written as data **matches the reference step for step: 286 steps, Δ 0.00 s**. That includes the clip-to-clip cable moves (their times come from the route distances) and the 50 zero-length clip marks the reference records. ST1–ST3 and both transfers now match; the line takt is ST3's 74.81 s, the reference bottleneck. One unit plays through all three stations to FINISHED in 189.5 s (estimate 189.23 s); two units in the test, with no error.

**Changed**
- `spec/examples/printer-line.factory.json`: ST3 and the ST2 → ST3 transfer (drive alternating as in the reference). ST1 / ST2 regenerate byte-identical.
  - Equipment: assemblyCell shell (minZ −1.6, green sign), blue gantry (maxGap 0.22, screwdriver), harness board at (0.9, −1.1), tester at (−1.2, −0.75).
  - Process: RFID read → 4 modules with `installPart` (reference clearances and grips; the hotend slides 6 cm in under its shelf; the PSU and hotend cables are stowed as the part is placed) and their screws → 7 × `routeCable` in the reference order → gantry home → test lead in → continuity test (tester testing → pass) → lead out.
  - HMI rows and bar as the reference `WiringStation`.
- **Product cables** (registry contract): a product may declare `cables`, a static `cableRoute(name)` in the product frame (socket A with plug direction, coil, clips, socket B), and `harness.setCable(name, { mode, grip, passed })`, with modes hidden / stowed / carryA / pluggedA / routing / done. Instances expose `cables`, `cableRoute`, `setCable` (names and modes checked); dry plans get the routes from the product definition.
  - Printer: the route code moved from the built printer into `parts.js` as a static `cableRoute(index)`; the printer's own method now delegates to it (same result, tested), so routes are known without building a printer.
- New named op **`routeCable`**: generic port of the reference `planCable`.
  - Loose cables: end A out of the harness bag → carried, aligned and plugged at the device socket → latch.
  - Every cable: end B taken → laid to the first clip → clip by clip (over each clip, pressed in; a zero-length mark after each) → board socket entry → plugged → seated.
  - All times fixed (reference cable timing as defaults) except the clip-to-clip moves: distance × 1.8 s/m, at least 0.18 s, from the static route, so dry = run.
  - The cable follows the tool point while held; the travel height is a `safeHeight` above the product's assembly origin; `doneStatus` is set on the seated step.
- New named op **`connectLead`**: a flexible lead (test lead, hose) plugged from a machine port into a product ref or another port at the end of a timed step, or unplugged. Drawn as a sagging tube with a plug, as the reference test lead. While plugged into the product it hangs from the product, so clearing a unit (reset, retire) takes it away too. This replaces the "runtime cable helper" I deferred in Phase 2 step 6c.
- Tests (`tests/spec/printer-line.test.js`, now 15):
  - **ST3 matches with no mismatch**; 50 zero-length clip marks as recorded; ST3 is the bottleneck; ST3 cycle = reference
  - the 3-station run: modules fitted, all 7 cables `done`, power / hotend cables stowed, the lead present during the test and gone after, tester on pass
  - static routes = the built printer's own (+ carrier origin); cable name / mode errors
  - `routeCable` dry errors, a loose cable through a station (dry = played, ends done, done status); `connectLead` in / out timing and errors

**Results**
- `npm test`: 24 files, 874 tests passed.
- Screenshots checked (moments taken from the timing table):
  - `screenshots/printer-st3-cable.png` (t = 159.3 s, laying the X-motor cable): modules fitted, the blue Z-motor cable laid along the base clips, the bed cable coiled behind, the hotend cable coiled on the bed until routed
  - `screenshots/printer-st3-test.png` (t = 183.2 s): HMI CONTINUITY TEST (modules 4 / 4, harness 7/7 cables, TESTING), the yellow test lead from the tester to the printer's rear dock port, the next carrier waiting at ST3's input

### Step 4: ST4 (calibration and testing) in `printer-line.factory.json` (done)

Step 3 approved by the owner moving on (2026-11-22).

**Result first:** ST4 written as data **matches the reference step for step: 48 steps (the 50 recorded minus the two stand-alone lift moves), Δ 0.00 s**. That includes the shutters around intake and output and the reference quirk of showing "Opening exit shutter" under the INFEED state. ST1–ST4 and all three transfers match. One unit plays through four stations in 228.6 s (estimate 228.26 s); two units in the test. The recorded results for serial 1 are the reference's: flatness 0.08 mm, cube error 0.08 mm, a 3 × 3 mesh whose peak-to-valley is the flatness, belts 92 / 88 Hz, resonance 47.2 / 38.6 Hz, IN SPEC.

**Changed**
- `spec/examples/printer-line.factory.json`: ST4 and the ST3 → ST4 transfer. ST1–ST3 regenerate byte-identical.
  - Equipment: assemblyCell shell (minZ −1.7, purple sign), `shutterEnclosure` (reference size), `dockingUnit` in line with the dock port of a located carrier (axis 0.92 m, x −0.086; retracted tip at the reference z −0.48; stroke 0.37 m, plugging 0.366 m to the mainboard enclosure's rear face), `statusMonitor` (0.8 × 0.45 at the reference spot) and `equipmentRack`.
  - `intake` / `output` written out: the default steps with the entry / exit shutter opening before and closing after.
  - Process: dock (clears the previous unit's results) → power-on self test → fan test → homing X / Y / Z → Z clear → belt test → resonance test → probe deploy → 9 × (move over the point, dip) → probe stowed (flatness reported) → purge start → heat → purge line → cube start → print the cube → cool → park → record results → undock (LCD "READY / Test print OK").
  - HMI rows / bar as the reference `CalibrationStation`; the test monitor shows the reference `drawTestMonitor` content through the generic dashboard: title, hotend / bed gauges, bed-mesh heat map, flatness / cube error / print footer.
- **Product routines** (registry contract): things a product does by itself while a station drives it, i.e. a test printer's firmware. Declared as `routines: { name: { summary, args } }`; a unit returns a handler per run (`start`, `update(progress, previous)`, `end`); `update` / `end` may return status values. Args are checked in the dry plan.
  - Printer (`lib/products/printer/routines.js`): `display` (LCD lines with `{label}` / `{serial}` / `{flatness}`), `resetTest`, `axes`, `fanSpin`, `beltTest`, `resonanceTest`, `probe`, `probeDip` (records the mesh point), `heat`, `purge`, `printCube`, `cool`, `record` (marks the unit tested, so `quality()` answers without a stage change). The curves and constants are the reference `CalibrationCycle`'s (pluck, rising-frequency shake, probe dip, heat-up and cool-down curves, square perimeter per layer, `meshFor`).
- New named op **`runRoutine`**: one routine for a fixed time; its status values go to the HMI live. `before` / `after`: instant routine calls at the start / end of the step. `move` takes `before` / `after` too (the dock clears the previous results as it docks; the LCD changes as it undocks).
- **Live status**: an OpCycle passes routine status values to its station (`setStatus`). Status values may be lists at run time (the mesh).
- **Dashboard signal** (station spec + factory schema): `signals.dashboard { machine, screen, title, gauges [{ label, value: key, target, unit, color }], grid { label, cols, values: key, range }, footer }`. Text fields take `{statusKey}`; refreshed with the HMI.
- **Hand-over when the unit reaches the output port**: the station hands a unit on as soon as an output op leaves it at the output port, and steps after that (ST4's exit shutter closing) still play. This is what the reference does; before, ours waited for the whole output phase, which would have delayed the next station by 0.5 s behind ST4.
- Tests (`tests/spec/printer-line.test.js`, now 21):
  - **ST4 matches with no mismatch**; three transfers; ST4 cycle = reference
  - the 4-station run: ST4 docked (0.366 m), probed 9 points, printed, results recorded per serial, undocked, shutters closed
  - routine checks (unknown routine / bad args / unknown `after` routine fail in the dry plan); heat feeding the HMI live with rising temperatures to 215 °C; `move` before / after; dashboard data (gauges, grid list, footer templates) and display check; hand-over during "Transport to output" with a trailing step still played

**Results**
- `npm test`: 24 files, 880 tests passed.
- Screenshots checked:
  - `screenshots/printer-st4-print.png` (t = 216.5 s, printing the cube): the orange cube half-printed on the glowing bed, purge line along the front edge, dock rod plugged into the mainboard enclosure's rear, shutters closed
  - `screenshots/printer-st4-heat.png` (t = 210.8 s, heating): test monitor "ST4 TEST BENCH · P1-0001" with gauges at 181 / 215 °C and 54 / 60 °C, the bed-mesh heat map with values, the flatness footer; HMI TESTING

### Step 5: ST5 (inspection, reject branch) in `printer-line.factory.json` (done)

Step 4 approved by the owner moving on (2026-11-23).

**Result first:** ST5 written as data **matches the reference step for step on all three paths**: a passing unit (P1-0001, 13 steps), a reject to the first bay place (P1-0005, 13 steps, divert 2.683 s) and a reject to the second place (P1-0008, 13 steps, divert 4.128 s), each Δ 0.00 s. ST1–ST5 and all four transfers match. **A whole run of 8 plays through the five stations**: units 5 and 8 fail inspection (deterministic per serial) and wait in the reject bay at the reference places (station z −1.05 / −1.7), the other 6 pass. The run finishes at 771.6 s; the reference run of 8 also ends with unit 8 rejected at ST5, at 771.1 s.

**Changed**
- Reference recording: the recorder now keeps every unit's steps (needed for the reject units). Re-recorded; everything else is identical to before (checked).
- `spec/examples/printer-line.factory.json`: ST5 and the ST4 → ST5 transfer. ST1–ST4 regenerate byte-identical.
  - Equipment: assemblyCell shell (minZ −2.35, red sign); vision scanner (reference size, arch parked at −1.15); label applicator in line with the printer's right upright (pad retracted at z 0.42, tamping 0.425 m); pop-up cross transfer at the work position (lift 0.022 m as in the reference definition); reject lane (roller conveyor 1.82 m along −Z from z −0.38, turned 90°); half-size "Reject bay" sign; vision monitor.
  - Process: RFID read (test record) → forward scan (lights + laser on) → return scan → analyse (lights off, arch parked) → **decide on the verdict**: PASS → QC PASS label, retract, "Released to packaging"; REJECT → REJECT tag, retract, **decide on the next bay place** → cross transfer rising (the locating plate and stop pin go down in the same step) → diverting onto the lane → cross transfer lowering. A rejected unit leaves through the station's `reject` port (2 places); a passing one runs the normal output.
  - HMI rows / bar as the reference `InspectionStation` (passed and rejected on two rows); the vision monitor shows the reference's seven checks and the PASS / REJECT banner through the dashboard.
- **Product facts** (registry contract): what is known about a unit that a station decides on, `facts: { name: { values } }`, `unit.facts.name()`. The printer has `verdict` (PASS / REJECT, deterministic per serial: 5 and 8 fail in a run of 8). Stations pass product facts to `decide`.
- **Bay ports**: an extra output port may have `slots` (places filled in turn; the oldest is cleared when full, as the reference reject bay). The station offers the fact `<port>Slot`, the place the next unit goes to.
- **`decide` with a known fact plans its branch** step by step in dry plans too (an unknown fact still gives one summary step of the longest branch). `planStation` / `lineTiming` take `facts` (per station), so the pass and reject paths can each be planned and compared with the matching recorded unit. A dry plan whose process leaves the unit at an extra output port has no output phase, as when it plays.
- **`transfer` between machines**: the start and end may be ports of any machine with an offset (cross transfer → a place on the reject lane); distances run along the floor (so a 22 mm step down onto the lane does not lengthen the move: exactly the reference times). Dry plans place machines by their IR position / rotation (`placement`), so dry = played still holds.
- **Several machines in one step**: `queueMotions` takes `alongside` (absolute moves of other machines, same ease); `grip` / `release` expose it (the carrier goes onto the rising transfer wheels as the locating plate lowers). `crossTransfer` got a `carrier` anchor on its lifting frame.
- `move` takes `switches` (value motions of the same machine switched as the move starts: the scanner's lights).
- Printer routines `readRecord` (test record → flatness / cube error on the HMI) and `qcLabel` (PASS sticker / REJECT tag).
- Dashboard: `checks` (label, value, state with `{statusKey}` fields) and `verdict` (a status key holding PASS / REJECT).
- The station clears an alarm raised for the previous unit (a reject) when the next unit comes in.
- **Bug found by the browser, not the tests:** my patch imported `UNKNOWN` twice in `decide.js`; Vitest's transform accepted it, the browser refused the module. Fixed, and a new rule test fails on any module that imports the same binding twice.
- Tests (`tests/spec/printer-line.test.js`, now 28; rules +1):
  - **ST5 pass / reject 1 / reject 2 match with no mismatch**; ST5 pass cycle = reference
  - **a whole run of 8**: passed 6, rejected 2 (labels PASS / REJECT per serial), rejects resting at the reference bay places, finish within 1.5 s of the reference run
  - the printer's verdicts for serials 1–8; known vs unknown facts in dry plans; reject exit (no output phase, floor distance), bay places in turn with the oldest cleared; `alongside` and `switches`; dashboard checks / verdict

**Results**
- `npm test`: 24 files, 888 tests passed.
- Screenshots checked:
  - `screenshots/printer-st5-scan.png` (t = 239 s): the arch travelling over P1-0001 with lights and laser on; vision monitor with the seven checks pending; HMI INSPECTING
  - `screenshots/printer-st5-reject.png` (t = 544.6 s): P1-0005's carrier moving sideways onto the red reject lane towards the "Reject bay" sign; monitor REJECT banner; HMI REJECT; stack light red

### Step 6: ST6 (packaging and dispatch): the printer line complete as data (done)

Step 5 approved by the owner moving on (2026-11-23).

**Result first:** ST6 written as data matches the reference on both its paths: an ordinary unit (42 steps) and the unit that fills and ships the pallet (P1-0008 of a stand-alone run, 43 steps), Δ 0.00 s. **All six stations and all five transfers of `printer-line.factory.json` now match the reference recording step for step** (ST5 / ST6 on every recorded path). The whole line plays a run of 8 to FINISHED at **771.4 s; the reference run of 8 finished at 771.14 s.**
- Units 5 and 8 wait in the reject bay; the other six are packed, closed, taped, labelled and stacked on the pallet in the reference pattern (4 below, 2 above).
- The pallet is not full in the line run, so it is not shipped, as in the reference.
- Stand-alone, ST6 fills the pallet with 8 cartons, ships it once, and frees everything it made.

| Station | Cycle s | Reference s | Steps match |
|---|---:|---:|:---:|
| ST1 Component Kitting | 49.39 | 49.39 | yes |
| ST2 Frame Assembly | 51.86 | 51.86 | yes |
| ST3 Electronics Wiring | 74.81 | 74.81 | yes (bottleneck) |
| ST4 Calibration & Testing | 33.35 | 33.35 | yes |
| ST5 Quality Inspection (pass / reject 1 / reject 2) | 14.46 | 14.46 | yes, all three |
| ST6 Packaging & Dispatch (ordinary / ships) | 29.42 | 29.42 | yes, both |
| 5 transfers | 5.68 | 5.68 | yes |

The units leave ST6 about 5.1 s after the reference's "dispatched" counter only because that counter counted when the carton was put on the pallet; ours counts when the empty carrier leaves. The gaps between units are the same.

**Changed**
- `spec/examples/printer-line.factory.json`: ST6 and the ST5 → ST6 transfer. ST1–ST5 regenerate byte-identical.
  - Equipment: assemblyCell shell (minZ −3.0); gantry (1.4 × 2.55 m, beam 2.7, 0.64 m gripper), centred at z −1.175 as Phase 2 noted; carton line (roller conveyor 2.8 m at its own 0.55 m belt height); case erector; foam magazine table; case taper; carton labeller; block pallet in the dispatch bay.
  - Process: infeed (carton made at the erector end and conveyed to the packing spot; top foam made on the magazine) → printer lifted off its carrier into the carton → dust bag → top foam → gantry clear → minor / major flaps → tape head down → taping (the tape is laid as the head runs) → head back → print and apply the shipping label → **palletize** onto the next spot → gantry home → **if this carton fills the pallet: dispatch** (wrapped and shipped).
- **New products** (Claude.md lists `carton` as a product):
  - **`carton`**, a port of the reference `CardboardCase` (same hinge lines, open angle and tape logic) plus bottom foam, dust bag and shipping label (title and code lines, e.g. the unit's serial). Refs `bottom` and `grasp`; features `bag` and `label`; routines `foldMinor`, `foldMajor`, `tape`.
  - **`packingFoam`**: top foam with an optional accessory box; ref `grasp`.
- **New component `blockPallet`**, from the reference `ProceduralPallet`. There the top deck floated 3 mm above the blocks; here the deck boards rest on stringers that rest on the blocks (the generic "nothing floats" check caught a first attempt without stringers). Port `top` carries `case`. It's named `blockPallet` because `pallet` is already a flow type (what conveyors carry), which the rule-6 guard flagged. Shared materials: `wood`, `woodDark`, `woodEnd` (now 42).
- **Items made during the process**, new named op **`spawn`**: catalog products made at machine places in the step they belong to, optionally conveyed during it (surfaces scroll). Params take unit facts (`{label}` → "P1-0001"); before it plays they are checked with placeholders of the right kind. The station keeps what it makes; ops refer to these items by name (pick, place onto, features, routines, refs).
- **Payloads** (product contract): parts of a unit that can be taken off it as items of their own. The printer is lifted off its carrier into the carton; the empty carrier goes on. Ownership follows parenthood: the carrier no longer frees a printer packed in a carton; the carton's holder does.
- **Stacks** (station spec + factory schema): `stacks: { name: { machine, port, columns, rows, layers, layerHeight, gap } }`, built across units.
  - The station offers the facts `<stack>Slot` and `<stack>Fills` (yes when the next item fills it), and keeps `<stack>Count / Capacity / Shipped` in the status for the HMI.
  - New named op **`palletize`**: pick an item and set it on the next free spot (column, then row, then layer); a full stack stops the station with a clear message.
  - New named op **`dispatch`**: at the end of a timed step everything on the stack is freed (with the printers packed in the cartons).
  - A station reset frees everything it made.
- Smaller additions:
  - `pickPlace` takes refs on any product item (the carton's `bottom`)
  - instant calls (`before` / `after`) may switch features (`set`)
  - `move` takes a `routine` driven by its own progress (the tape laid as the taper head runs)
  - equipment may set its own `beltHeight` (the lower carton line)
  - `workTable` minimum width 0.3 m (the reference foam magazine is 0.34 m)
  - HMI bar text templates up to 100 characters (the shown text is still cut to the screen)
- Tests: `tests/products/packaging.test.js` (10, new); `tests/spec/printer-line.test.js` (now 30):
  - ST6 ordinary / ships match; **the whole line matches station by station**
  - the run of 8 with six packed cartons at the reference pallet spots, closed, taped and labelled
  - carton and foam products; block pallet; spawn (label filled in, carried on the lower line, rollers turning, checks before it plays); the printer packed in the carton; the pallet filled spot by spot and shipped by the unit that fills it; the shipping branch planned only when told; a full stack refusing a ninth carton; reset freeing cartons and packed printers
- Golden images: `blockPallet`, `carton-erected`, `packingFoam-ready`.

**Fixes / differences vs the reference (deliberate)**
1. **The reference carton was too small for its contents.** Printer 0.548 m + bottom foam + top foam + accessory box need about 0.68 m; the reference carton is 0.62 m, so the top foam and accessory box stuck through the closed flaps (the first stacked-pallet screenshot showed open-looking cartons). Ours is 0.69 m, so everything sits under the flaps. As a result the second pallet layer is higher (1.53 m), so cartons travel at 2.2 m instead of 2.1 m to clear it. Every step has a fixed time, so the timings are unaffected.
2. **Carton labeller:** our label applicator is deeper than the reference's (its tamp cylinder holds the whole stroke), so with the reference's retracted pad (z −0.62) its column stood on the main conveyor. It retracts to z −0.76 with a 0.12 m stroke instead; same labelling spot, same time.
3. The reference foam magazine showed a stack of three spare foams under the one picked. They are left out, so the picked foam rests on the table rather than floating 16 cm above it.

**Results**
- `npm test`: 25 files, 918 tests passed.
- `npm run golden blockPallet carton packingFoam`: 3 written.
- Screenshots checked:
  - `screenshots/printer-st6-pack.png` (t = 262.3 s): the gantry carrying the printer off its carrier to the open carton on the carton line; top foam with the accessory box on the magazine; erector, taper, labeller, pallet
  - `screenshots/printer-st6-pallet.png` (t = 760 s): six closed, taped and labelled cartons on the pallet, four below and two above

**Phase 4 status:** the IR, the expander and the hand-written printer line are done, and **its timing matches the reference completely** (the timing half of the key acceptance test). Still to do for Phase 4: (1) the compiler templates that emit readable Three.js files per station plus a line file (`generated/printer-line/…`), loaded by the app; (2) the screenshot comparison with the reference repo (golden views of each station and the line, rendered from the reference app and from ours).

**Next:** Phase 4 step 7: the compiler (`compiler/emit.js` + templates) writing `generated/printer-line/` (one readable JS file per station and a line file, built only from the IR and the catalog), loaded by dynamic import in the twin page, with a test that the compiled line plays exactly like the expanded IR.

### Step 7: The compiler, `generated/printer-line/` (done)

Step 6 approved by the owner moving on (2026-11-23).

**Result first:** `npm run compile` turns `printer-line.factory.json` into **7 readable files** in `generated/printer-line/` (st1–st6 plus `line.js`, about 3,200 lines in total), written by fixed templates from the IR and the catalog only. **The compiled line plays exactly like the IR it came from.** A run of 8 was played update by update, side by side with the expanded IR: the line status was identical at every one of about 15,400 updates, the scene (every object's name, visibility and world position) was identical at checkpoints and at the end, and both lines finished. The twin page loads the compiled line by dynamic import (`#/twin?line=printer-line`). Its screenshot at t = 262.3 s is **byte-identical** to the IR demo's at the same moment.

**Changed**
- `compiler/emit.js`: `compileFactory(registry, data, { source, libPath })` → `{ line, folder, files, timing }`. It checks first (expand + dry timing; a bad factory.json throws `FactoryError` with paths). Deterministic, and it mentions no component by name: types are copied from the IR into the emitted calls.
  - **`<station>.js`:**
    - Header: title, source, cycle time (intake / process / output), step count, and an equipment table (id, type, from shell or station, position, turn).
    - `export const station`: the expanded station data, with the shell's ports and signals already merged, so the files need no shells at run time.
    - `export function build({ registry, ctx })`: one block per machine, with a comment from the catalog summary, then `registry.buildComponent('type', {params}, ctx)`, `position.set(…)` (only when not 0), `rotation.y` (exact multiples of π are written as `Math.PI / n`) and `root.add`. A machine with its own belt height gets `{ ...ctx, beltHeight }`.
  - **`line.js`:**
    - Header: stations in flow order with cycle, steps and layout x, the transfers, takt, lead time and run estimate.
    - Exports: `id`, `title`, `runSize`, the merged `conventions`, `product`, `edges`, the dry `timing` and `stations`.
    - `createLine({ materials, registry?, facts?, onUpdate? })`.
    - Layout is still computed by `lib/line/layout.js` when the line is built (§6.5); the file only lists the positions as a comment.
  - Folder = kebab-case line id (`printerLine` → `printer-line`). Station modules whose id is a reserved word or one of `line.js`'s own names are imported as `<id>Station`.
- `compiler/jsLiteral.js`: `toJs(value, { indent, col, width })`, a deterministic JSON → JS literal printer. Unquoted keys where possible, single-quoted strings with escapes, short values on one line, long ones one entry per line within 100 columns. It refuses non-JSON values (NaN, functions, class instances, `__proto__`).
- `compiler/write.js`: `writeCompiled(compiled, outRoot)` writes only files whose content changed (so Vite reloads only those, which Phase 10 will need). It removes stale generated `.js` files (those carrying the generator mark) and never touches files without the mark.
- `scripts/compile.mjs` (`npm run compile [files…] [--draft]`): runs the compiler in a Vite SSR module graph, because the catalog loads through `import.meta.glob`; nothing is served. Default: every `spec/examples/*.factory.json`. `--draft` writes to `generated/_draft/<line>/` with the right `lib/` import path.
- `lib/line/Line.js` / `lineSpec.js`: a line station may bring `build({ registry, ctx }) → { root, equipment }` instead of an equipment list (one or the other is required). Everything after building is unchanged. `lineTiming` now also returns the `layout`, and gives a clear message for a station that has no equipment list.
- App:
  - `app/pages/twin/compiledLines.js` loads `generated/*/line.js` lazily (`#/twin?line=<folder>`, with `?t`, `?speed`, `?cam` as for the demos). An unknown name shows the message in the HUD.
  - `app/pages/twin/linePlayer.js`: the HUD status / skip / dispose code, now shared with `app/dev/lineDemo.js`.
  - The twin page no longer reports itself ready before a compiled line is drawn.
- Rules test: `generated/` is included in the no-`Math.random` and no-double-import checks. It is not in the rule-6 check, because compiled output names components by design.
- Tests `tests/compiler/emit.test.js` (14):
  - jsLiteral round trips (quotes, backslashes, control characters, U+2028, odd keys), line breaking, refusals, `angle()`
  - deterministic output and file list; imports limited to three / lib / sibling stations; readable line lengths; shell origin noted; belt-height override emitted
  - **`generated/printer-line/` on disk = what the compiler writes now** (otherwise: run `npm run compile`)
  - each compiled station = the expanded station (data deep-equal; machines with the same ids, types, params, positions and turns)
  - `line.js` conventions / product / edges / timing = expanded ones
  - **run of 8 side by side, update by update** (status every update, scene at checkpoints and at the end, both FINISHED, 6 cartons on the pallet)
  - a bad factory.json refused; `Line` refusing a station with neither equipment nor build, or a build with no machines
  - `writeCompiled` (unchanged files left alone, stale generated files removed, foreign files kept)

**Notes**
- Shell-derived numbers keep their exact floating-point values (e.g. sign z `-1.9000000000000001`, fence length `4.1000000000000005`). Rounding them would make the compiled line differ from the IR, and exact equality is what the tests prove. The ST5 reject lane turn is `1.5708` because that is what factory.json says; it is not exactly π/2.
- The timing in the line file times a decision on a fact that is only known as a unit plays (ST5's verdict) by its longest branch: ST5 shows 19.19 s / 11 steps and the run estimate is 813.5 s. The headers say so. The per-path reference comparison stays in `tests/spec/printer-line.test.js`.
- `generated/printer-line/` is not git-ignored (only `_draft/` is). It is committed output, kept honest by the "on disk = compiler output" test, like `spec/factory.schema.json`.

**Results**
- `npm run compile`: `spec/examples/printer-line.factory.json → generated/printer-line/`: 7 files; takt 74.81 s.
- `npm test`: 26 files, 932 tests passed.
- Screenshots: `screenshots/compiled-line.png` (`#/twin?line=printer-line&t=262.3`) and `screenshots/ir-line.png` (`#/twin?demo=line&line=printer-line&t=262.3`) are byte-identical (same SHA-256). ST2 holding, ST3 handing over, ST6 packing.

**Phase 4 status:** IR, expander, the hand-written printer line (timing = reference) and the compiler (compiled = IR, exactly) are done. Left for Phase 4: the **screenshot comparison with the reference repo**, i.e. golden views of each station and of the line rendered from the reference app and from ours.

**Next:** Phase 4 step 8: the visual half of the acceptance test. Render fixed camera views (each station and the whole line, at set moments) from the reference app and from our compiled line, store them as goldens, and compare. This needs the reference app's scene entry for the printer line, beyond the `src/station` / `src/motion` export in `reference/_src`. If those files aren't there, I'll ask the owner for them.

### Step 8: Visual comparison with the reference (done)

Step 7 approved by the owner moving on (2026-11-23).

**Result first:** the compiled printer line and the hand-built reference line, rendered in the same viewer from the same cameras at the same moments, match: every station, machine, sign, HMI and unit is in the same place and pose in all 17 views (t = 0, 262.3, 430, 500, 760 s; every station close-up twice, line and wide views). Differing pixels: **close-ups 3.5–4.4 %, line views 1.8–1.9 %, wide views 0.7–0.8 %**, and nearly all of it is known, deliberate differences from earlier steps (the visible fence mesh above all). With the timing match from step 6, **both halves of the Phase 4 key acceptance test are met.** Full table and the list of differences: `benchmarks/results/printer-line-visual.md`.

**No files were needed from the owner.** The reference repo is on disk (its `main` and `station-agent` are the same commit), and the existing read-only export in `reference/_src` already holds `PrinterAssemblyLine.js`. The reference app has no URL to open a scene at a set moment, so instead of driving that app, its line is played inside our twin page.

**Changed**
- `app/dev/referenceLine.js` (dev only): loads the reference `PrinterAssemblyLine` from `reference/_src` through `import.meta.glob` (the app still builds without the export and shows a message), builds it, plays it, and skips with the same 0.05 s steps as ours. Its own `StationEnvironment` is not applied: our viewer applies the same room environment (`lib/core/environment.js` is its port), so both renders use one set of lights. Open with `#/twin?demo=reference` (`?t`, `?speed`, `?cam` as for compiled lines).
- `app/pages/twin/TwinPage.js`:
  - `?golden=1` hides the HUD (only the 3D view)
  - frozen pages (`?t`) expose `window.__twinView({ t, cam })`, which jumps forward (never back), sets the camera and draws one frame, so a script can take many views from one page load
- `scripts/screenshot.js`: `shots: [{ expr, out }]` option (several captures per page load).
- `scripts/png.js`: dependency-free PNG decode (Chrome's 8-bit RGB / RGBA, every scanline filter), encode, and `diffImages` (share of differing pixels, mean difference, red diff image).
- `scripts/visual-compare.mjs` (`npm run visual [views…]`): renders both lines (about 3 + 4.5 min), writes goldens `tests/golden/lines/printer-line/<view>.png` / `<view>.reference.png`, diff images `benchmarks/results/visual/printer-line/`, numbers `benchmarks/results/printer-line-visual.json`.
- `benchmarks/expected/printer-line-visual-limits.js`: per-view limits (close-ups 5.5 %, line 3 %, wide 1.5 %), about one point above what was measured.
- `vite.config.js`: `optimizeDeps.include` for the two `three/examples/jsm/…` add-ons the reference imports (we use `three/addons/…`). Without it Vite found them mid-load, re-optimised and cancelled the page load.
- Tests:
  - `tests/scripts/png.test.js` (4): round trip, RGB with all five filters, refusal, diff numbers and image
  - `tests/spec/printer-line-visual.test.js` (18): a result for every view; each view within its limit; the stored images re-diff to the recorded numbers

**Known differences (deliberate, from earlier steps):**
1. fence wire mesh visible in ours, mip-mapped away in the reference (Phase 2 step 2)
2. taller carton; the reference's foam and accessory box stick out of the closed flaps (Phase 4 step 6)
3. ST5 label applicator column at z 1.02 instead of 0.70; same x, pad spot and timing (Phase 2 step 6e)
4. lift carriage sleeves on the line-end lifts (Phase 2 step 1)
5. ST6 carton labeller retract and foam magazine spares (Phase 4 step 6)

**Not fixed:** the ST1 flow rack's shelves and totes sit 1–2 cm off the reference (a few pixels in the close-ups). The component was approved in Phase 2 step 5, so I left it alone.

**Limits of the test**
- `npm test` checks the recorded run; it does not render (that needs Chrome). Re-render with `npm run visual` after changing components or the line.
- How sensitive the limits are was reasoned, not measured: I did not render a deliberately broken line to confirm that a moved machine goes over 5.5 %.
- The reference renders (`*.reference.png`) are images of the reference repo's line. They sit under `tests/golden/`, which is not git-ignored, so committing them is your call.

**Results**
- `npm run visual`: 17 views × 2 lines rendered and compared (ours 183 s, reference 263 s).
- `npm test`: 28 files, 954 tests passed.
- Checked by eye: `st5-430`, `st6-760` and `st1-262` side by side with their diff images. The red areas are the differences above.

**Phase 4 status:** done. IR, expander, hand-written printer line (timing = reference), compiler (compiled = IR, exactly) and the visual comparison (compiled ≈ reference, differences explained).

**Next:** Phase 5 step 1: lubricant components. First the belt conveyor and the `jerryCan` product, from the reference `OilConveyor` / `ProceduralConveyor` and `JerryCan`. The lubricant files that aren't in `reference/_src` yet (`station-2`, `station-3` and `factory/` are there; I'll check what's missing first) can be exported from the local reference repo the same read-only way.

## Phase 5: Lubricant components and adapters

### Step 1: `beltConveyor` component and `jerryCan` product (done)

Phase 4 step 8 approved by the owner (2026-11-23: "start phase 5 step 1").

**No files were needed from the owner.** Every lubricant source Phase 5 needs is already in the read-only export `reference/_src` (station-1 filler, capper, tank, hoses, sensors, conveyor, can; station-2 case packer, robot, carton; station-3 pallet, box, conveyor, worker; factory supply rack, transfer lines).

**Changed**
- **`beltConveyor`** (`lib/components/conveyors/beltConveyor.js`), from the reference `OilConveyor.js` (`createBeltConveyor`):
  - side frames, carry and return belt, head / tail drums with bearing housings, return rollers, legs with levelling feet and bracing, optional side guides, optional gear motor at the discharge end
  - params `length` (0.8–12 m, default 4), `beltWidth` (0.34), `guides`, `guideGap` (clear width between the rails, 0.22; refused if wider than the belt + 2 cm), `drive`, `carries` (`unit | batch | case`, sets the port type)
  - ports `input` / `output` at the belt ends, at belt height
  - motion `belt`: phase within the 0.5 m texture tile (`wrap`, `travel` 0.5 m), like `palletConveyor`; drums and return rollers make whole turns per tile, so the phase can wrap 1 → 0 without a jump
  - same counts as the reference: the 8.4 m main conveyor has 7 leg pairs and 9 return rollers
- **`jerryCan`** product (`lib/products/jerryCan/`), from the reference `JerryCan.js` and the `OilMaterials` finishes and label:
  - stages `empty → filled → capped`; routine `fill { to? }` raises the oil from its current level (default: `fillLevel`, 0.9); feature `cap` (`off | on`), so a capper can hand its cap over by switching it on
  - refs `neckTop` (0.075, 0.398, 0), `capSeat` (0.075, 0.388, 0) and `grasp` (the handle grip, −0.054, 0.412, 0): the reference values. `api.level()` and `api.surfaceY()` give the oil surface for a filling stream.
  - params: body size, corner radius, neck position / size, cap size, `fillLevel`, `look` (`natural`: translucent HDPE and blue cap, as the reference "classic"; `yellow`: opaque, the colours of the reference "branded" can, without its picture label), and the label's `grade` / `volume` text
  - checks that refuse shapes that cannot be made: a cap smaller than the neck, a neck off the flat top or into the handle grip, oversized corners
  - handle and label scale with the can length, so smaller cans keep a handle on their body
  - finishes and the label texture: one set per shared material library and look / label (as the printer's materials); geometry cached per size. Many cans on a line share one label canvas instead of one each. `disposeJerryCanMaterials(shared)` frees them.
- `lib/core/screwCap.js`: the reference ribbed screw cap (shell with grip ribs, top, tamper ring), shared so that next step's capper draws the same cap as the can.
- Tests `tests/products/lubricant.test.js` (11): belt top and ports, reference leg / roller counts, guide gap and refusal, belt motion wrap, station-local build; can refs = reference, stages, fill routine and refusal, min / max sizes (no NaN, resting on its base, nothing floating), shape refusals, shared finishes and their disposal. The generic checks in `all-components.test.js` cover `beltConveyor` (18 more).
- Golden images: `beltConveyor`, `jerryCan-empty`, `jerryCan-filled`, `jerryCan-capped`.

**Fixes / differences vs the reference (deliberate)**
1. **Drums had nothing holding them.** Their hubs sat beside the frames with no shaft, and the gear motor stood 1.25 cm off the bearing housing. The generic "nothing floats" check would refuse that. Drums now turn on shafts through the bearing housings, and the head shaft reaches the gearbox.
2. Return rollers span the frames (the reference's stopped 2.5 mm short of them on each side).
3. Drums turn 2 and return rollers 3 whole turns per 0.5 m of belt (true values 1.77 and 3.18), so the belt phase wraps without a visible jump. The slip can't be seen.
4. The reference's "branded" look used a picture asset (`can-label.png`) and swapped materials globally at run time. It's left out; the `yellow` look gives the opaque colours with the drawn label.

**Results**
- `npm test`: 29 files, 983 tests passed.
- `npm run golden beltConveyor jerryCan`: 4 written. Checked by eye: the conveyor with guides, drums and motor; the can empty, filled (oil visible through the body) and capped (blue cap on the neck).

**Next:** Phase 5 step 2: the filling machine and the capping machine (from `FillingMachine.js` / `CappingMachine.js`), with the conveyor tunnel (`createConveyorTunnel`, in the same reference file as the conveyor). The capper uses `lib/core/screwCap.js`.

### Step 2: `filler`, `capper`, `conveyorTunnel` (done)

Step 1 approved by the owner (2026-11-23: "start phase 5 step 2").

**Changed**
- `lib/components/machines/portalCommon.js` (helpers, not a component): the reference `buildPortalFrame` (posts, base plates, rails, polycarbonate guards), the control cabinet, the roof stack light, and `headXs` (head positions, rounded so ports and compiled files carry no `0.6000000000000001`).
- **`filler`** (`lib/components/machines/filler.js`), from the reference `FillingMachine.js`:
  - params `heads` (1–8, default 4), `pitch` (0.4 m), `tipHeight` (lowered nozzle tips above the belt, 0.353 m = the can's neck rim − 45 mm insertion), `stroke` (0.25 m)
  - ports `work` (batch) and `head1…headN` (the nozzle axes at belt height, where a container's neck goes)
  - motions `headTravel` (0 raised … 1 lowered), `jetStart` / `jetEnd` (top and bottom of the oil streams below the tips, in m: the oil surface while dispensing, the falling tail after the valves close), `beacon` (`off | run | wait | alarm`, the roof stack light; stations can use it as their signal tower)
  - anchors for next step's hoses: `productInlet` / `airInlet` (on the moving manifold), `productBulkhead` / `airBulkhead` (cabinet underside), `rearInlet`
  - the manifold, guide shafts and frame width follow the head count; at the defaults every number is the reference's (tips 1.463 / 1.213 m, cabinet at 2.05 m, posts at ±0.95 m, nozzles at ±0.2 / ±0.6 m)
- **`capper`** (`lib/components/machines/capper.js`), from the reference `CappingMachine.js`:
  - params `heads`, `pitch`, `seatHeight` (cap centre above the belt when screwed on, 0.388 m = the can's `capSeat`), `stroke` (0.26 m), `capRadius` / `capHeight`, `capColor` (`blue | yellow`, the can's two looks)
  - motions `headTravel`, `spin` (chuck turn phase, `wrap`, one turn per range), `caps` (`loaded | empty`: handed over to the containers), `capFeed` (0 = fresh caps up in the sleeves, 1 = seated in the jaws), `beacon`
  - elevated vibratory cap feeder with 18 caps in the bowl (a fixed spiral) and a gravity chute into the back of the cabinet; the bowl height follows the cabinet
  - chuck caps are the same cap as the can's own (`lib/core/screwCap.js`). A test puts a can's neck under `head2` and checks that the lowered chuck cap is exactly on its `capSeat`.
- **`conveyorTunnel`** (`lib/components/conveyors/conveyorTunnel.js`), from the reference `createConveyorTunnel`: params `length`, `beltWidth`, `clearHeight` (0.58 m), `open` (`+X | -X`, the end with the product opening). Port `opening` (`out` at +X, `in` at −X).
- Tests `tests/components/lubricant.test.js` (14):
  - filler: reference numbers; nozzles 45 mm into the neck of a can under a head port; jets and splash; beacon lamps; a long stroke; hose anchors moving with the head or not; 1 and 8 heads
  - capper: reference numbers; caps exactly on the can's cap seat, same size as the can's cap; spin / hand-over / feed; feeder and chute; lift cylinders with 1 and 2 spindles
  - tunnel: open and closed ends; over the tail of a belt conveyor of the same width with no part touching it, a capped can passing under the roof
- The generic checks cover all three at default / min / max (54 more).
- Golden images: `filler`, `capper`, `conveyorTunnel`.

**Fixes / differences vs the reference (deliberate)**
1. **Capper chucks floated.** The spindle shaft stopped 8 mm above the chuck sleeve; it now reaches into it.
2. **Roof stack lights floated.** The lamps stood 5 mm apart and the cap 3 cm above the top lamp; a core tube joins them (as the station `stackLight` in Phase 2).
3. **Tunnel**:
   - It hung beside the conveyor frames touching nothing; it now has four stands on the outer faces of its walls, clear of the conveyor's legs and feet.
   - Its walls cut 1 cm into the conveyor's drum bearing housings where it covers a conveyor end (as the reference infeed does). It's 2 cm wider per side, so it clears them by 5 mm.
4. **Capper with one or two spindles**: the reference put both lift cylinders on the centre line (two spindles) or at a fixed ±0.62 m. They now go 0.2 m outside the spindles. This doesn't change four spindles.
5. **Long strokes**: the cabinet stays at the reference 1.19 m above the belt unless a long stroke needs more room for the raised head. Then it rises instead of the params being refused.
6. Oil-stream splash: the reference pulsed it with a clock. Motions take no time, so it's a steady ring; a pulse can come from the fill op later if it's wanted.

**Known, not changed:** the cap chute's two rails are offset along z (as in the reference), so with this chute direction one rail enters the cabinet and the other stops 3 cm behind it. Both hang from the bowl, so nothing floats.

**Note for the line step:** in the reference the outfeed tunnel covers the outfeed conveyor's discharge end, where its gear motor is, so the motor pokes through the tunnel wall. When the lubricant line is written as data, that conveyor should drive from its other end or have no motor drawn.

**Results**
- `npm test`: 30 files, 1051 tests passed. The rule-6 guard first caught "filler" / "capper" in a comment of the can product (now catalog names); I reworded the comment.
- `npm run golden filler capper conveyorTunnel`: 3 written and checked by eye. I didn't screenshot the machines in action over a belt with cans; the head, jets, spin and feed are checked numerically.

**Next:** Phase 5 step 3: oil tank, transfer pump, hoses and sensors (`OilTank.js`, `OilHoses.js`, `OilSensors.js`), connected to the filler's anchors.

### Step 3: `supplyTank`, `photoEye`, filler hoses (done)

Step 2 approved by the owner (2026-11-23: "start phase 5 step 3").

**Changed**
- **`supplyTank`** (`lib/components/machines/supplyTank.js`): the supply side of the reference oil station as one unit. It's built from `OilTank.js` (tank, transfer pump), the supply piping of `OilFillingStation.js` and the tank level transmitter of `OilSensors.js`:
  - tank on legs (dished head, manway with lid bolts, vent, stiffening rings, outlet cone, level sight glass, name plate), ultrasonic level transmitter on the head
  - transfer pump on its skid `pumpOffset` towards +X (default 0.975 m: in the reference station the pump stands under the filler's rear inlet)
  - suction line from the outlet cone to the pump, with its ball valve; discharge stub up to 1.5 m with the discharge valve (0.95 m) and pressure gauge (1.45 m), where the reference riser had them
  - params `radius`, `height`, `legHeight`, `pumpOffset`, name plate `tag` / `contents`
  - motion `level` (sight glass, default 0.85); anchor `discharge` (top of the stub, where the line on to the filler starts)
- **`photoEye`** (`lib/components/fixtures/photoEye.js`), from the reference `createPhotoEye`:
  - emitter / receiver with status LED and cable on the front rod, reflector on the rear rod
  - mount `surface`: it stands on the conveyor's side frames (y = 0 is the frame top), rods `span` apart; the beam is 0.2 m above the belt on a belt conveyor
  - motion `beam` (`clear | blocked`): LED amber / green
- **`filler`**: the reference flexible **product hose** and **pneumatic line**, from the cabinet bulkheads to the manifold inlets, same spline shapes. They're rebuilt whenever `headTravel` moves the head, so they follow it.
- Tests (in `tests/components/lubricant.test.js`, now 20):
  - hoses end at their anchors raised and lowered, and drop with the head
  - supply tank reference numbers, discharge anchor at (0.975, 1.5, 0), sight-glass level, the transmitter sitting on the dished head (ray-cast onto the head), pump-inside-tank refused
  - a photo-eye standing on both side frames of a real `beltConveyor`, beam 0.2 m above the belt and across a jerry can
  - the LED states
- The generic checks cover the two new components at default / min / max.
- Golden images: `supplyTank`, `photoEye`, `filler` (re-rendered with its hoses).

**Fixes / differences vs the reference (deliberate)**
1. Several parts of the supply side floated (found by the generic "nothing floats" check):
   - **Sight glass:** its valves stood 5 mm off the tube ends; they now overlap them.
   - **Pump motor:** it hung 1 cm off the bearing frame with nothing under it. The bearing frame now reaches it and it stands on motor feet on the skid.
   - **Suction valve lever:** for a valve on a pipe along z, the handle stayed long in x and missed its stem. It now turns with the valve.
2. **Level transmitter:** it was set at the dome's apex height, 1.8 cm above the head where it stood. It now stands on the head.
3. **Photo-eye:**
   - In the reference its rods stood 1 cm outside the conveyor frames and touched nothing. As a component it stands on the frames.
   - Its cable hung 2.5 cm below the housing; it now leaves the housing's underside.
   - The two LED materials are now one material, recoloured, so nothing is left undisposed.
4. **Discharge valve and gauge:** they're on the tank unit's own discharge stub rather than on the riser.
5. **Name plate:** it reads "LIQUID SUPPLY" instead of "LUBE OIL SUPPLY"; the tag and contents lines are params.

**Not in this step: the riser from the pump to the filler.** It joins two machines (tank unit `discharge` → filler `rearInlet`), so no single component can own it. The generic way is station-level **connections** between machine anchors in the IR. For example, `{ from: 'supply.discharge', to: 'filler.rearInlet', kind: 'pipe', radius: 0.026 }`, drawn by the station runtime as a rigid run (up, then across), or as a flexible hose that follows moving anchors. I propose that as the next step.

**Results**
- `npm test`: 30 files, 1093 tests passed.
- `npm run golden supplyTank photoEye filler`: 3 written and checked by eye.

**Next (proposed):** Phase 5 step 4: station-level connections (pipes and hoses between machine anchors) in the factory schema, the station runtime and the compiler, used for the pump → filler riser.

### Step 4: Station connections (pipes and hoses between machines) (done)

Step 3 approved by the owner (2026-11-23: "start phase 5 step 4").

**Result first:** a station can now join two machines with a pipe or hose, written as data in factory.json:

```json
"connections": [{ "id": "riser", "from": "supply.discharge", "to": "filler.rearInlet" }]
```

The reference oil station's product riser is drawn exactly where the reference had it: up from the pump discharge to the inlet height, one elbow, then along Z to the filler's rear inlet, flanged at both ends. It's checked before anything is built, played in the station frame, and compiled into the station file.

**Changed**
- `lib/station/connectionSpec.js` (data only, no three.js):
  - the `Connection` schema: `id`, `from` / `to` (`"machine.anchor"`), `kind` (`pipe | hose`), `radius` (default 0.026 / 0.018 m), `material` (one of the shared library's: stainless, brushed, aluminium, hose, airLine, frame, cableBlack)
  - pipe options: `route` (`up` rises to the end height first, then X, then Z; `across` runs first, then rises) and `flanges`
  - hose options: `sag`, `startTangent`, `endTangent`
  - repeated ids are refused; `connectionProblems(connections, machines)` checks unknown machines and missing anchors, naming the anchors the machine has
- `lib/station/connections.js`:
  - `pipeRoute(a, b, route)` (corners only: repeated points and straight-through corners dropped)
  - `buildConnections({ connections, equipment, root, materials })` draws them under a `Connections` group in the station frame. Each is redrawn only when one of its ends moved, so a hose to an anchor on a moving head follows it. Materials are shared; only geometry is freed.
- `lib/station/stationSpec.js` and `spec/factory.schema.js`: `connections` on a station (default none); `spec/factory.schema.json` regenerated.
- `lib/station/StationCycle.js`:
  - `planStation` (the dry plan, so `checkFactory` too) refuses bad connection ends before anything is built
  - a playing station builds its connections, updates them on every refresh and frees them on dispose
- `compiler/expand.js`: passes `connections` through only when a station has any, so stations without them expand and compile exactly as before. **`generated/printer-line/` is byte-identical** (the on-disk test passes).
- `app/dev/lines/oil-supply.json`: dev check line (`#/twin?demo=line&line=oil-supply`) with belt, filler, supply unit and the riser connection. The process is a stand-in wait until the lubricant station is written.
- Tests `tests/station/connections.test.js` (11):
  - routes: up / across, corners dropped, the reference riser = 3 points
  - schema: defaults; bad end, repeated id and unknown material refused with paths
  - dry check: unknown anchor (with the anchors the machine does have) and unknown machine
  - stations without connections expand without the field
  - runtime: the reference riser's two segments, elbow at (−0.325, 2.21, −1.5) and flanges; same inside a moved station root; a hose to the filler's moving inlet following the head; a station refusing an anchor its machine lacks
  - compiler: the station file carries the connection, and the compiled line, written to `generated/_draft/` and imported, draws it

**Results**
- `npm test`: 31 files, 1104 tests passed. The rule-6 guard caught "filler" in a comment of the new module; I reworded it.
- Screenshots:
  - `screenshots/oil-supply.png`: the dev line running, beacon green, can on the belt
  - `screenshots/oil-supply-rear.png`: from behind, the riser from the pump up past the discharge valve, elbow, into the back of the filler cabinet

**Not changed:** the filler's own two hoses stay inside the component (both their ends are on the filler). Connections are for things that join two machines.

**Next:** Phase 5 step 5: the case-packing side, from station-2: `PickAndPlaceRobot` (gantry with four handle grippers), `CaseCloser`, `PackingLineEquipment`, and the `CardboardCase` mapped onto our `carton` product.

### Step 5: `packingGantry`, `caseCloser` (done)

Step 4 approved by the owner (2026-11-23: "start phase 5 step 5").

**Correction to step 4:** I ran step 4's full test suite *before* adding the dev line `app/dev/lines/oil-supply.json`. That file then broke `tests/line/line.test.js` ("every dev line moves its first unit into the second station"), because it has one station. Step 4's "1104 passed" didn't cover it. Fixed here: the test now also accepts one-station dev lines, which must take their first unit through the station without errors. `oil-supply` does.

**Changed**
- **`packingGantry`** (`lib/components/robots/packingGantry.js`), from the reference `PickAndPlaceRobot.js`:
  - two-axis Cartesian gantry: carriage along Z on twin beams, vertical mast, gripper head with a grid of pneumatic handle grippers on pitch-change rails
  - params `columnZ` (1.65), `beamY` (2.45), `columns` (2) × `columnPitch` (0.28), `rows` (1–2)
  - motions in metres, like `cartesianGantry`: `z`, `y` (gripper origin height), `pitch` (row spacing), `grip` (finger gap), plus `beacon` (`off | run | wait | alarm`, one lamp recoloured)
  - anchors `grip1…gripN` (rear row first, each along +X), each at the point it holds, so ops can carry items on them
  - a grid of handle grippers rather than a single tool, so the existing `pickPlace` (which needs x / yaw and one `tool` anchor) doesn't drive it. A multi-item pick op comes with the station step.
- **`caseCloser`** (`lib/components/machines/caseCloser.js`), from the reference `CaseCloser.js`:
  - sized from the case it closes: params `caseLength` / `caseWidth` / `caseHeight` / `flap`, reference 0.62 × 0.42 × 0.42; heights follow the belt
  - port `work` (`case`)
  - motions in metres measured from the case, as the reference: `tuckerOut`, `tuckerUp`, `folderOut`, `plateUp`. Defaults are the reference park positions; ranges cover what the reference cycle uses.
- **The reference case = our `carton`** (ported in Phase 4 step 6) with `{ length: 0.62, width: 0.42, height: 0.42, foam: 0 }`; no new product.
- Tests `tests/components/packing.test.js` (8):
  - gantry: reference frame and gripper positions; pitch to the case layout (z ±0.1); reach of both conveyors (z ±0.75) and both reference heights (pick 1.242 m, travel 1.942 m)
  - **closed fingers hook under a jerry can's handle** (plates clear of the grip faces, lips under its underside; open, the lips clear it); one row of four; beacon
  - closer: reference beam, columns, folder cylinders, plate size; **parked, an erected case with open flaps passes underneath touching no tool**; tools moving to the reference positions, the pad landing on the closed top
  - carton: four 0.33 m cans in the reference 2 × 2 layout inside the walls and under the flaps
- The generic checks cover both at default / min / max.
- Golden images: `packingGantry`, `caseCloser`.

**Fixes / differences vs the reference (deliberate)**
1. **Grippers floated.**
   - The reference's two pitch rails sat 6 cm beside the grippers and 5 mm above their carriages. There's now one rail per gripper column, and the carriages reach it.
   - The carriage servos hovered 2 cm above the carriage plate, touching only the raised mast. They now stand on the plate, 2 cm further out so they clear the mast.
2. **End stops:** they stood between the beams on nothing. They now span both beams.
3. **Gantry beacon:** the reference swapped two lamp materials (running green / idle amber). It's now one material, recoloured for the four standard modes.
4. **Case closer:** the folder rod length and the cylinder and column positions follow the case width. They equal the reference at 0.42 m, and the rods stay in their cylinders over the whole travel at other widths.

**Results**
- `npm test`: 32 files, 1148 tests passed (including the fixed dev-line test).
- `npm run golden packingGantry caseCloser`: 2 written and checked by eye.

**Next:** Phase 5 step 6: the input and case-line fixtures from `PackingLineEquipment.js`:
- the two-lane **lane divider** with its bridges and the **can end stop**, on a belt conveyor's frames
- the **swing-arm case stop**
- whether our `caseTaper` and `caseErector` (Phase 4 step 6) cover the reference's top taper and erector tunnel, or need params

### Step 6: case-packing conveyor fixtures, `inlineTaper` (done)

Step 5 approved by the owner (2026-11-23: "start phase 5 step 6").

**Changed**
- **`laneDivider`** (`lib/components/fixtures/laneDivider.js`): the blade that splits a belt into two lanes, hung from bridges standing on the conveyor's side frames. From the reference `createInputConveyor` (LaneDivider).
  - params `length` (2.66 m), `span` (frame spacing, 0.58 m for a 0.52 m belt)
  - bridges spread along the blade; with two they stand at 30 % / 70 % of it, within 3 cm of the reference's (−1.58 / −0.52 m against −1.6 / −0.55 m)
- **`beltEndStop`** (`lib/components/fixtures/beltEndStop.js`): a yellow bar with a rubber bumper on posts on the frames, where units accumulate. Origin at the stop face; port `stop` at belt height.
- **`swingStop`** (`lib/components/fixtures/swingStop.js`): a bracket on one side frame, a rotary actuator, and a blade swinging across the belt (`open` 0 → 1 swings it clear along the frame). The bumper face is the stop face, x = 0; param `reach`; port `stop` (`case`).
- The three stand on a conveyor's frames like `photoEye` (mount `surface`, y = 0 = frame top, 1 cm above a `beltConveyor`'s belt).
- **`inlineTaper`** (`lib/components/machines/inlineTaper.js`), from the reference station-2 top taper:
  - a bridge over the case conveyor with a fixed taping head (cover, tape roll with index mark, web, wipe rollers) at the case-top height; the case is taped as it is conveyed under it
  - params `caseHeight`, `beltWidth`; port `work` (`case`)
  - motion `feed` (`wrap`, one tape-roll turn = 2π · 0.09 m of tape, `travel` set so conveyor ops can scroll it with the case); the wipe rollers turn with it
- **Reused, not new:**
  - the reference erector tunnel is a `conveyorTunnel` with `clearHeight: 0.7`
  - our `caseTaper` (Phase 4 step 6) is a different machine (its head travels over a standing carton), so it stays as it is next to `inlineTaper`
- Tests (in `tests/components/packing.test.js`, now 12), all on a real 0.52 m `beltConveyor`:
  - divider bridges standing on both frames, blade clear of the belt, two cans in the reference lanes (z ±0.13) clear of the blade and of the conveyor's guides (`guideGap` 0.46)
  - a can's leading face resting on the end-stop bumper, the stop port at belt height
  - the swing stop's blade crossing the case path closed and lying along the frame open
  - a closed reference case passing between the taper columns, wipe rollers 2 mm above its top; `feed` turning roll and rollers
- The generic checks cover all four at default / min / max (72).
- Golden images: `laneDivider`, `beltEndStop`, `swingStop`, `inlineTaper`.

**Fixes / differences vs the reference (deliberate)**
1. **End stop:** the bar stopped 2 cm short of its posts (on nothing). It now reaches them.
2. **Divider bridges and end-stop posts:** they hung 2.5 cm outside the conveyor frames. As components they stand on the frames.
3. **Swing-stop bracket:** it hung beside the frame, reaching 15 cm below the belt, attached to nothing. It now stands on the frame top.
4. **Taping head:** the cover, wipe rollers and web touched neither each other nor the hanger; only the tape roll did. A side plate and a top bar now carry them all, and the roll has an axle.

**Results**
- `npm test`: 32 files, 1224 tests passed.
- `npm run golden laneDivider beltEndStop swingStop inlineTaper`: 4 written and checked by eye.

**Phase 5 components so far:**
- station-1 (filling): `beltConveyor`, `conveyorTunnel`, `filler`, `capper`, `supplyTank`, `photoEye`, products `jerryCan`; station connections (riser)
- station-2 (case packing): `packingGantry`, `caseCloser`, `laneDivider`, `beltEndStop`, `swingStop`, `inlineTaper`; the case is our `carton`

**Next:** Phase 5 step 7: station-3 (palletizing). From `station-3/` (`ProceduralConveyor`, `ProceduralPallet`, `ProceduralBox`, `ProceduralBoxSourceMachine`, `AssetWrapMachine`, `ProceduralWorker`), first mapping what we already have (`blockPallet`, `carton`, `beltConveyor`) and what is new (box source, stretch wrapper, worker). Then the factory pieces (`SupplyRack`, `TransferLines`).

### Step 7a: `palletizerRobot` (done)

Step 6 approved by the owner (2026-11-23: "start phase 5 step 7").

**Decisions asked and answered** (Claude.md §13), now in the decision list at the top:
- palletizing robot: **both** (procedural default plus the ABB as an optional component)
- stretch wrapper: **procedural**

Step 7 is split accordingly:
- **7a** palletizer robot (this step)
- **7b** procedural stretch wrapper with the reference spiral film
- **7c** case source machine and the pallet-moving worker
- **7d** the ABB IRB 6760 port

**Mapped, no new component needed:**
- the station-3 pallet = `blockPallet` (Phase 4 step 6, from the same `ProceduralPallet.js`)
- the case = `carton` (0.62 × 0.42 × 0.42)
- the station-3 wide belt (1.05 m) is close to `beltConveyor`, whose `beltWidth` stops at 1.0 m today; I'll widen that range when station 3 is written, if needed

**Changed**
- **`palletizerRobot`** (`lib/components/robots/palletizerRobot.js`), procedural, not a port:
  - pedestal, turret (axis 1), lower arm (axis 2), upper arm (axis 3) with a parallelogram crank and rod that keep the wrist level, wrist turn (axis 6), vacuum pad gripper (6 cups, vacuum lamp)
  - params `shoulderHeight` (1.05), `lowerArm` (1.2), `upperArm` (1.35): reach 3.0 m, like an IRB 660; `padLength` / `padWidth`; `color`
  - **driven like the gantries**: motions `x` / `y` / `z` / `yaw` are the tool point (centre of the cup faces) and the tool's turn in the robot frame, solved by closed-form IK (elbow up) inside the component, plus `grip` (vacuum 0 off / 1 on) and anchor `tool`. That is the tool interface `pickPlace` checks, so the generic pick-and-place ops can drive it.
  - a target out of reach is clamped to the limit (no crash mid-cycle); `palletizerReach(params, point)` reports reach for tests and, later, the Phase 7 reviewer. `palletizerIK` is exported as well.
- Tests `tests/components/palletizing.test.js` (5):
  - the tool point lands exactly on reachable targets with the commanded yaw, and stays level
  - link lengths held, parallelogram rod ∥ lower arm, crank ∥ upper arm
  - out of reach clamped and reported
  - **every cell of a reference 3 × 3 × 3 pattern** of 0.62 × 0.42 × 0.42 cases on a 0.144 m pallet beside the robot (stack centre 2 m away), the clearance over the full stack, and a pick from a 0.82 m conveyor are all reachable
  - the pick-and-place tool interface; turning the tool moves only the flange
- The generic checks cover it at default / min / max, every motion through its range (18).
- Golden image: `palletizerRobot`.

**Results**
- `npm test`: 33 files, 1247 tests passed.
- `npm run golden palletizerRobot`: written and checked by eye: pedestal, turret, arm with its parallelogram rod, level wrist, vacuum pad.

**Not yet:** `pickPlace` actually driving the palletizer in a station (dry plan and run). I checked the interface, not a full pick. That comes with the station-3 data.

**Next:** Phase 5 step 7b: procedural turntable stretch wrapper (turntable, mast, film carriage) with the reference spiral film (`createSpiralFilm` / `rectPerimeterLoop` from `AssetWrapMachine.js`).

### Step 7b: `stretchWrapper` (done)

Step 7a approved by the owner (2026-11-23: "next 7b continue").

**Changed**
- **`stretchWrapper`** (`lib/components/machines/stretchWrapper.js`), procedural (owner's decision: no `Wrapping.STEP`, no `occt-import-js`):
  - turntable base and turning deck (index stripes), a floor arm to the mast, the mast with its cap, a control box with a stack light (`beacon` motion), and a film carriage (plate, film roll on its spindle, pre-stretch rollers) riding the mast
  - the **spiral film is a port of the reference** `createSpiralFilm` / `rectPerimeterLoop` (`AssetWrapMachine.js`): a ribbon around the load's rectangle, corners exact, 1.5 base turns, a constant-pitch rise with overlapping passes (pitch = 0.55 × band), top turns, a little growth per layer, revealed by draw range with the head vertex moved to the exact wrap point
  - params: `deckRadius` (0.9), `deckHeight` (0.44, the reference deck top), load size (`loadLength` / `loadWidth` / `loadHeight`, reference stack 1.9 × 1.3 × 1.26), `loadBottom` (film starts at the pallet top, 0.144, as the reference), pallet size for the sweep clearance (2.06 × 1.46)
  - port and anchor `deck` (`pallet`): what is attached to it turns with it
  - motion `wrap` 0 → 1 plays a whole wrap: the deck turns, the carriage follows the film band, the roll pays out, the film grows to its head, and a film web runs from the roll to the head
- `blockPallet`: `length` range up to 2.2 m (the reference station-3 pallet is 2.06 m: stack + 8 cm overhang per side).
- `tests/helpers/componentChecks.js`: meshes marked `userData.restsOnLoad` are left out of the "nothing floats" check. Film lies on the load the machine holds, not on the machine; with no load it really is in the air. Only the film and the web are marked.
- Tests (in `tests/components/palletizing.test.js`, now 10):
  - spiral: whole turns, last band at the top, no gaps between passes
  - a wrap: deck back to its start orientation after more than one turn, carriage at the bottom band and then the top band, film complete, web cut at the end
  - the film around a **reference 3 × 3 × 3 stack**: 12 mm off the case faces (plus layer growth), from the pallet top to the stack top
  - a 2.06 × 1.46 pallet with the stack, attached to the deck and turned through a whole wrap, never comes within 5 cm of the roll, rollers, carriage or mast
  - the film web always spans from the mast side
- The generic checks cover it at default / min / max (18).
- Golden images: `stretchWrapper`, `blockPallet` (re-rendered; its default size is unchanged).

**Differences vs the reference (deliberate)**
1. **Procedural frame** instead of the STEP model (owner's decision). It doesn't look like the reference CAD wrapper (no inbound ramp).
2. **Whole turns:** the turn count is rounded up to a whole number (extra top turns), so a wrapped load stops facing the way it came. Ops placing or picking it then need no correction.
3. **The load turns with the deck.** In the reference only the turntable turned under a standing stack, and the film was static. Here the film lives in the deck frame and anything attached to the `deck` anchor turns with it, so the film's contact point stays on the mast side, as on a real wrapper.
4. **Mast position:** it follows the load and pallet sweep, so the film roll is 6 cm outside the circle the load's corners sweep. My first version had the roll 1 cm inside it; I worked that out before testing, moved the mast, and the sweep test covers it now.

**Open, for the station step:** a wrapped load leaves the deck, but the film is the wrapper's. Moving a whole stacked pallet between machines (palletizer → wrapper → outbound) is a station-level question, and so is handing the film over with it. Those come when station 3 is written as data.

**Results**
- `npm test`: 33 files, 1270 tests passed.
- Screenshots:
  - `screenshots/wrapper-mid.png` (`#/gallery/stretchWrapper?wrap=0.62`): overlapping film bands turned with the deck, the web from the roll, the carriage partway up
  - `screenshots/palletizer-low.png`: the palletizer reaching low and turned, vacuum on
- `npm run golden stretchWrapper blockPallet`: 2 written.

**Next:** Phase 5 step 7c: the case source machine (`ProceduralBoxSourceMachine.js`) and the pallet-moving worker with pallet jack (`ProceduralWorker.js`).

### Step 7c: `caseSource`, `palletJackWorker` (done)

Step 7b approved by the owner (2026-11-23: "next").

**Changed**
- **`caseSource`** (`lib/components/machines/caseSource.js`), from the reference `ProceduralBoxSourceMachine.js`, on the shared material library:
  - cabinet body, front plates around the exit opening, exit chute lined dark, trim frame, lip and hazard stripes, frame rails and rear posts, side window, control cabinet with panel and status lamp (`beacon` motion), roof motor housing and vent
  - params `depth` / `width` / `height`, `openingWidth` / `openingHeight`, `caseHeight` (the opening is centred on it at belt height); port `output` (`case`) at the belt
- **`palletJackWorker`** (`lib/components/robots/palletJackWorker.js`), from the reference `ProceduralWorker.js`:
  - a worker (hard hat, vest band) walking behind a high-lift pallet truck (body, steer wheel, tiller, pump lever, lift mast, fork carriage, forks with tip wheels)
  - it moves, so its travel is motions in its own placement frame: `x` / `z` (within `travel`, default ±6 m), `heading`, `forks` (0.045 → 0.6 m: the reference lifts 0.55 m to clear the 0.44 m wrapper deck), `stride` (one walking cycle)
  - anchor `cargo`: the pallet centre over the forks (0.55 m ahead of the fork roots, as the reference), where ops attach the load
- Tests (in `tests/components/palletizing.test.js`, now 14):
  - **lowered forks slide under a reference 2.06 × 1.46 block pallet** centred on the cargo point touching nothing: between its blocks, 1.6 mm under its stringers
  - raised 10 cm the forks are above the stringer undersides, so they lift it; carried at full height the pallet clears a 0.44 m deck and touches no part of the truck or worker
  - driving and turning carry the cargo anchor along; the legs swing
  - a reference case leaves the source's chute onto a 0.82 m belt touching nothing
- The generic checks cover both at default / min / max.
- Golden images: `caseSource`, `palletJackWorker`.

**Fixes / differences vs the reference (deliberate)**
1. **The source's "exit trim" was a solid plate across the exit opening**, so cases would have had to pass through it. It's now a frame of bars around the opening.
2. **Worker figure floated:**
   - Its legs ended 22 cm above the boots and its torso stood 3 cm above the hips. The legs now reach the boots and the torso reaches the hips.
   - Its head sat 6 cm above the shoulders. A neck now joins them.
3. **Walking:** a stiff swinging leg reaches lower than a standing one, so a toe dipped 1.3 cm into the floor. The figure now rises by exactly that much as it strides.
4. **The truck:**
   - In the reference the forks rose on nothing (no lift mechanism). There's now a lift mast with a fork carriage, as on a high-lift truck.
   - The truck body stood 1 cm into a pallet centred on the cargo point. The body, mast and carriage now all stand behind the pallet's back end, and the forks run back to the carriage between the pallet blocks (no crossbar under the pallet).
5. **Case source on small sizes:** the roof parts and side window now fit a shallow cabinet (the reference sizes were fixed).

**My own mistakes found by tests this step:** two footprints were too small. They missed the swinging boots, the worker's turning radius, the status lamp, and the roof parts on a small cabinet. One test measured a lifted pallet without updating transforms. All are fixed; the numbers above are after the fixes.

**Results**
- `npm test`: 33 files, 1310 tests passed.
- `npm run golden caseSource palletJackWorker`: 2 written. `screenshots/worker-lifted.png`: forks at full height, mid-stride, hands on the tiller. All checked by eye.

**Next:** Phase 5 step 7d: the optional ABB IRB 6760 (owner's decision "both"). Copy read-only from the local reference repo: `src/assets/robot.glb` (4.3 MB), `src/motion/InverseKinematics.js` + test, `src/motion/Rig.js`, `src/rigs/abbIrb6760.js` (+ `abbRobotStudio.js` if the rig needs it), `src/loaders/ModelLoader.js`. Then wrap them as a catalog component with the same tool interface as `palletizerRobot` (x / y / z / yaw / grip, anchor `tool`), loaded asynchronously.

### Step 7d: the optional ABB IRB 6760 (done)

Step 7c approved by the owner (2026-11-23: "ok next").

**Copied read-only from the local reference repo** (`git archive station-agent`; its working tree untouched):
- `src/motion/Rig.js` → `lib/motion/Rig.js` and `src/motion/InverseKinematics.js` (+ test) → `lib/motion/` and `tests/motion/`, unchanged apart from a header line. The generic rig engine and the damped-least-squares IK (its retries use its own seeded generator, so it's deterministic).
- `src/rigs/abbRobotStudio.js` and `abbIrb6760.js` → `lib/components/robots/abb/` (`abbIrb6760Rig.js`)
- `src/assets/robot.glb` → **`lib/assets/abbIrb6760.glb`** (4.3 MB; plain glTF, no compression extensions)
- Not ported: `ModelLoader.js`, because only one GLB is needed and three's `GLTFLoader` parses it directly (also in Node, so the tests use the real model). The other rigs and models aren't needed either.

**Changed**
- **`lib/core/assets.js`**: model assets for the few components built from a file:
  - `loadAsset(name)` caches the parsed glTF (fetch in the browser, file read in Node), names unnamed glTF nodes after their parent, and marks geometry and materials `userData.shared`
  - `instantiate(name)` gives a clone
  - `preloadComponentAssets(registry, types?)` loads what components need
- **Registry**:
  - components may declare `assets: ['x.glb']`; building one before its model is loaded fails with a clear message (what to call)
  - the generic dispose leaves `userData.shared` geometry and materials alone, so disposing one robot never frees the cached model the others use
- **Preloading added where components are built**: the gallery (before its first build), compiled lines, the IR line demo, and the two test files that build every component.
- **`vacuumPad`** (`lib/components/tools/vacuumPad.js`): the palletizer's pad as a tool component and builder (`buildVacuumPad`). `palletizerRobot` uses it, with the same geometry as before; pad width now at least 0.18 m (the tool changer is 0.16 m).
- **`abbIrb6760`** (`lib/components/robots/abb/abbIrb6760.js`):
  - the reference model, rigged with the reference rig (six axes with the reference limits; the balancer cylinder and rod follow axis 2)
  - a vacuum pad seated on the flange as the reference `mountOnFlange` does
  - **the same interface as `palletizerRobot`**: motions `x` / `y` / `z` / `yaw` (tool point, tool pointing down) solved by the ported IK, axis 6 setting the yaw, `grip` (vacuum), anchor `tool`. So the same ops and station data can use either robot.
  - out of reach: the closest pose found, and `root.userData.lastSolve.reached` is false
  - live solves are capped at 60 iterations; a nearby target converges in a few
- `vite.config.js`: `three` and `GLTFLoader` added to `optimizeDeps.include`. Without it Vite pre-bundled the loader separately with its own copy of three ("Multiple instances of Three.js being imported" in the browser).
- Tests:
  - `tests/motion/InverseKinematics.test.js` (18, ported, pass unchanged)
  - `tests/components/abb.test.js` (6):
    - reference limits and links
    - **the pad on reachable targets within 2 mm, pointing down within 1°, yaw within 1°**
    - **all 27 cells of a reference 3 × 3 × 3 pallet pattern** reachable
    - out of reach finite and reported
    - two robots sharing the cached model, disposing one freeing nothing of the other's
    - a component with an unloaded model refusing to build
  - the generic checks cover `abbIrb6760` and `vacuumPad` at default / min / max, every motion through its range
- Golden images: `abbIrb6760`, `vacuumPad`.

**Notes**
- The generic "every motion through its range" check now has a 20 s time limit. For the ABB it runs about 50 real IK solves and took about 2.3 s alone, but over Vitest's 5 s default under full-suite load.
- The rule-6 guard caught the component's name in a comment in `lib/core/assets.js`; I reworded it.
- **`lib/assets/abbIrb6760.glb` (4.3 MB) is a binary in the repo.** It's yours to commit; it's needed for the ABB component and its tests.
- `npm run build` works and emits the GLB (`dist/assets/abbIrb6760-…glb`).

**Results**
- `npm test`: 35 files, 1370 tests passed.
- Golden `abbIrb6760` and `screenshots/abb-pallet-reach.png` (turned, reaching down and back to a pallet spot, vacuum on): checked by eye. No browser warnings after the dedupe fix.

**Phase 5 station-3 components are complete:**
- `palletizerRobot` (default) / `abbIrb6760` (optional)
- `stretchWrapper`, `caseSource`, `palletJackWorker`, `vacuumPad`
- with `blockPallet`, `carton`, `beltConveyor`

**Next:** Phase 5 step 8: the factory pieces from `factory/`: `SupplyRack.js` and `TransferLines.js` (the conveyors and transfers that join the three lubricant stations), then the lubricant line as data.

### Step 8: factory pieces from `SupplyRack.js` and `TransferLines.js` (done)

Step 7d approved by the owner (2026-11-23: "ok").

**Changed**
- **`palletRack`** (`lib/components/fixtures/palletRack.js`), from `createRackFrame`:
  - uprights with base plates and frame braces, step beams and wire decks, in bays, on the shared materials
  - evenly spaced decks (`levels`, `firstDeck`, `deckSpacing`), uprights `topClearance` above the top deck. That way no combination of params is invalid; my first version with a free deck list failed the generic min-size build.
  - default = the reference can rack (decks 0.14 / 0.74 / 1.34 m, uprights 1.95 m); the carton rack is noted in the code
  - ports `deck1…deckN` at the deck tops
- **`lib/core/instancedStock.js`**: `createInstancedStock`, a port of the reference supply stock. Identical items (a built product) drawn as one InstancedMesh per template mesh, `take()` / `refill()` / `remaining`, plus `dispose()`, and it refuses a template with no visible meshes.
- **`signBoard`** (`lib/components/station/signBoard.js`), from `createSign`: an area sign on a tall post (title, subtitle, accent bar). Two faces back to back instead of one double-sided plane, which reads mirrored from behind.
- **`sidePusher`** (`lib/components/fixtures/sidePusher.js`), from the can transfer's row former: a pneumatic pusher on a floor stand beside a belt. Motion `face` is where the rubber pad's surface is, measured from the belt centre line (−0.04 … 0.3; retracted 0.25 as the reference).
- **`guideRails`** (`lib/components/fixtures/guideRails.js`), from the single-file guides: rail pairs at a clear gap (default 0.20 m = the reference can + 5 mm each side), on posts standing on the conveyor frames (mount `surface`).
- **`caseSource`**: option `rearPort`, the reference infeed port on the back of the station-3 cabinet (dark opening, trim, strip curtain) and an `input` port, where the case transfer feeds it.
- **Reused:** the transfer belts are `beltConveyor` (0.52 m), the can transfer's divider is `laneDivider`, the pallet-jack bay is `bayMarking`.
- Tests `tests/components/factory.test.js` (6):
  - the reference can rack, decks and ports
  - **108 reference cans (6 × 6 per deck) as instanced stock** inside the rack and under each next deck, under 20 draw calls, take / refill
  - a can passing 5 mm clear between the guide rails, posts on the frames
  - the pusher on a 0.52 m belt: retracted clear of the belt guides; pushed, its pad exactly where it shifts a centred can into the reference lane (z −0.13); the rod still in its cylinder
  - the sign facing both ways
  - a case entering the rear port
- The generic checks cover the four new components and `caseSource` with the port.
- Golden images: `palletRack`, `signBoard`, `sidePusher`, `guideRails`, `caseSource`.

**Fixes / differences vs the reference (deliberate)**
1. **Guide rails:** they hung on arms reaching past the conveyor frames to nothing, and the lower rail had no arms at all. There are now posts on the frames with an arm to each rail.
2. **Pusher:**
   - its stand stopped 1 cm under the cylinder barrel; it now reaches the cylinder axis
   - its pad stood 3 mm in front of the plate's face value; the pad surface is now exactly at `face`
3. **Sign:**
   - one double-sided plane, mirrored from behind, 5 mm off its post; now two faces, 2 mm off the post
   - at the first try the faces sat exactly on the post faces and z-fought (a line through the board in the golden image); fixed

**Not in this step, for the line step:** showing rack stock being used up as a line releases units (a station-level "supply" built on `createInstancedStock`). The can transfer's row-forming sequence (pairs pushed into two lanes) is the line's work too.

**Results**
- `npm test`: 36 files, 1448 tests passed.
- Golden images for the five components written and checked by eye.

**Next:** Phase 5 step 9: the lubricant line as data. `lubricant-line.factory.json`: station 1 (filling and capping), station 2 (case packing), station 3 (palletizing and wrapping), the can and case transfers, written as IR. It will need the station-level pieces this phase left open:
- ops for the filler, capper, multi-item pick, row forming and wrapping
- batches of units on one station
- the supply stock
- moving a stacked pallet to the wrapper

I'll propose how to split that work before starting it.

### Step 9: plan for the lubricant line as data (agreed 2026-11-23)

Owner's choices (decision list at the top): indexing station for station 1, the ABB in station 3, timing + screenshots as for the printer line.

How the reference differs from our runtime (one unit per station: intake → process → output):
1. **Station 1 is an indexing line.** Up to 5 batches of 4 cans on one belt (staging, filling, buffer, capping, outfeed). Each machine cycle: one shared index, then output, filling and capping on the batches present.
2. **Station 2 merges units.** 4 cans arrive in two lanes (formed by the transfer's pushers) and are packed into a case; from there the case flows on.
3. **Station 3 builds a pallet** (fixed-time robot moves), then a worker carries the stacked pallet to the wrapper.

Sub-steps:
- **9a**
  - record the reference lubricant timing (`scripts/reference-timing.mjs` extended; the STEP wrapper stubbed, its wrap is a constant 12 s)
  - the indexing station in the runtime
  - station 1 as data: fill / cap ops on the filler / capper motions and the can's fill routine and cap feature, batches of 4, photo-eyes
- **9b**
  - the can transfer (single-file guides, row-forming pushers, lane divider)
  - station 2: gather 4 cans, multi-can pick with `packingGantry`, case erected, packed, closed, taped
  - the case becomes the unit that flows on
- **9c**
  - station 3: case source with rear port, conveyor, ABB pick and place onto the pallet stack
  - outbound: worker carries the pallet to the wrapper, wrap
- **9d**
  - `lubricant-line.factory.json` complete and compiled
  - timing compared station by station with the reference
  - screenshots compared with the reference rendered in our viewer

### Step 9a (part 1): the reference lubricant timing, recorded (done)

Step 9 plan approved by the owner (2026-11-23: "ok").

**Result first:** the reference lubricant line now has a recorded timing target, as the printer line has. It's reproducible: two runs give identical files.

| Run | Finished | Notes |
|---|---:|---|
| Station 1 stand-alone (factory can), 8 batches of 4 out | 199.76 s | 11 machine cycles |
| Station 2 stand-alone, 6 cases | 189.10 s | about 31.5 s per case |
| **Whole factory to a 27-case pallet** | **1010.52 s** | first case packed at 140.76 s, then one every about 31.5 s; each case on the pallet 19.4 s after packing |

Station 1 is the indexing line we agreed on:
- each machine cycle runs these phases in turn, skipping empty positions: index (3.05 s) → output (3.1 s) → filling (9.9 s) → capping (5.3 s)
- batches move staging → filling → buffer → capping → outfeed, one position per index
- steady state 21.35 s per batch of 4; the first cycles are `index fill`, `index fill`, `index fill cap`, then `index output fill cap`

**Changed**
- **`scripts/reference-timing-lubricant.mjs`** (`npm run reference:timing:lubricant`) → `benchmarks/expected/lubricant-line-reference-timing.json` (183 kB). It records:
  - station 1 and station 2 stand-alone, and the whole `LubricantFactory` to a finished pallet
  - every step's start time, state, label and duration, per station, plus the can transfer's steps and the "case packed / on the pallet" events
  - re-check steps of a waiting station (0.1 s, thousands of them) folded into one entry with a total and a `repeats` count
- How it runs:
  - in a Vite SSR module graph (as `npm run compile`), because the factory imports images by `?url` and station 3 loads assets
  - a small plugin stands in for what isn't exported or can't load in Node:
    - **the stretch wrapper**: a stub with the same interface and the reference's nominal bay. Its wrap is a fixed 12 s step and the outbound moves are fixed times, so timing is unaffected; only worker positions at the wrapper are nominal.
    - **the label and logo PNGs**: dummy URLs
  - **station 3 runs the real reference cycle** with the same IRB 6760 model (our `lib/assets/abbIrb6760.glb` = its `robot.glb`), placed as the reference `AssetManager` does (bounding box centred, resting on the floor) and rigged with the reference rig and IK. Its own placement checks passed for all 27 cases (it logs them; the script now keeps that quiet).
- Tests `tests/spec/lubricant-reference.test.js` (2): the runs are present and complete (27 cases); station 1's first five machine cycles and steady-state phase times show the indexing pattern.

**My mistakes this part (fixed before the results above):**
- my first test expected 1010.5 s (the rounded console value) and 9.7 s for filling; the data says 1010.52 s and 9.9 s
- the first recording held 1.1 MB of 0.1 s re-checks, before folding

**Results**
- `npm test`: 37 files, 1450 tests passed.
- The reference repo untouched; only `reference/_src` (git-ignored) is read.

**Next:** step 9a part 2: the **indexing station** in the runtime:
- positions along one conveyor, a batch of units per position, one synchronous index per machine cycle
- then each phase's ops on the batch at its position, skipping phases with nothing there
- batches enter at the first position (stand-alone spawn, or from upstream) and leave from the last

Then 9a part 3: station 1 as data on it (fill / cap ops, photo-eyes, the supply tank and riser), compared with the station 1 recording.

### Step 9a (part 2): the indexing station in the runtime (done)

Part 1 approved by the owner (2026-11-23: "next"). The work was interrupted by the owner's usage limit and resumed after the reset ("continue working on the step").

**Result first:** an indexing station reproduces the reference filling line's machine cycles exactly. Given the reference step times (fill and cap as stand-in waits, until part 3), the playing station:
- matches all **196 steps** of the recorded reference station 1 (same state, label and duration, in order)
- starts every step within 0.05 s of the recording (its 0.02 s quantisation)
- puts **8 batches out at 199.76 s**, as recorded

The dry plan gives the steady machine cycle: index 3.05 + exit 3.1 + filling 9.9 + capping 5.3 = **21.35 s**.

**Changed**
- **`lib/station/indexing.js`** (data and planning, no `StationCycle` import):
  - the `indexing` block of a station: `members` per batch and `pitch`; evenly spaced named `positions` in flow order; `enter` and `exit`; the `index` ops; the `exitOps`; `work` ops per position; optional phase `order`; `preload` positions (the reference starts with a batch waiting at staging)
  - validation: known positions, flow order, even spacing (one index moves every batch the same distance), known phases
  - `planIndexing`: a dry plan shaped like `planStation`'s (intake = index phase, process = work phases, output = exit phase, `cycleTime` = one full machine cycle), so timing tables and takt checks read it unchanged
  - **`createBatch`**: a batch is N units at a pitch that ops treat as THE product. Stages, features and routines act on every member (a `fill` fills all four cans); refs are the first member's, in the batch frame. So the ordinary ops work on batches as they are.
- `lib/station/indexingSpec.js`: the schema alone (zod only), used by the factory schema without loading three.js.
- **`lib/station/IndexingCycle.js`** (extends `StationCycle`; ports, signals, HMI status, stock and connections are reused). Each machine cycle runs the phases in turn and skips a phase with nothing to do:
  - **index**: takes a new batch in at `enter` if that place is free, then runs the index ops. It's skipped when there is no batch at all, and held while the last position is still occupied.
  - **exit**: the batch at `exit` runs the exit ops and leaves through the output port; held and re-checked while downstream is busy
  - **work**: the batch at that position runs that position's ops
  - stand-alone, it makes batches and discharged ones leave the cell; in a line, batches come and go through its ports
- **Ops `indexBatches` / `dischargeBatch`** (`lib/ops/named/indexBatches.js`): move every batch one position, or carry the exit batch away, with smooth motion over a fixed time, scrolling the belts of the conveyors named. They reach the station through a new optional `indexer` hook on `OpCycle` (like `stacks` and `restock`). Outside an indexing station the dry plan accepts them (durations only), but playing one stops the station in ALARM: "indexBatches only works in an indexing station".
- **Wired in:**
  - `planStation` hands indexing stations to `planIndexing`
  - `Line` plays a station with `indexing` with an `IndexingCycle`
  - the station specs (runtime and `factory.json`) accept `indexing`, and `process` defaults to empty; `spec/factory.schema.json` regenerated
  - `compiler/expand.js` passes `indexing` through (left out for single-unit stations, so `generated/printer-line/` is unchanged; the on-disk test passes)
- `app/dev/lines/indexing.json`: dev check line (`#/twin?demo=line&line=indexing`), an indexing station with the reference positions and times and stand-in fill / cap waits.
- Tests `tests/station/indexing.test.js` (11):
  - data validation
  - the 21.35 s plan
  - the batch ops refused outside an indexing station
  - a `factory.json` with an indexing station passing the full check (station time 21.35 s in the timing table) and compiling (the station file carries the block)
  - **the reference station 1, step for step and at 199.76 s**
  - batches moving one position per index (four cans at 0.4 m), the discharged batch leaving
  - holding while downstream is busy and not indexing past an occupied last position
  - fill / cap feature on a batch acting on all four cans
  - `Line` choosing `IndexingCycle`
- `tests/line/line.test.js`: the dev-line check allows an indexing station one machine cycle per position a batch travels (the first version assumed one cycle per station).

**My mistakes this part (fixed before the results above):**
- My first run missed the reference's preloaded batch at staging. The first difference was at step 3, which led to `preload`.
- One test checked a dry plan "not throwing", which proved nothing. It now tests the ALARM when the op is played in the wrong kind of station.

**Results**
- `npm test`: 38 files, 1461 tests passed.
- `screenshots/indexing-station.png` (dev line at t = 72 s): batches of four cans at staging, filling, buffer and capping under the filler and capper; "released 5/12 · done 2 · FILLING". The cans aren't filled or capped yet; that's part 3.

**Next:** step 9a part 3: station 1 as data on the indexing station:
- **fill**: filler head down, jets to the oil surface, the cans' `fill` routine, head up
- **cap**: capper down and spin, caps handed to the cans, cap feed
- the photo-eyes following the batches
- the supply tank and riser connection
- the timing again equal to the recording

### Step 9a (part 3): station 1 as data, real filling and capping (approved)

Part 2 approved by the owner (2026-11-23: "next"). The owner also asked for a plain-language summary of Phase 5 so far; it was given in the chat.

**Result first:** `spec/examples/lubricant-line.factory.json` now holds **station 1, filling & capping**, written as data on the indexing station with the real `fill` and `cap` ops, and it matches the recorded reference station 1:
- **all 196 steps** (state, label, duration, in order)
- start times within 0.05 s
- **8 batches out at 199.76 s**
- the compiled files (`generated/lubricant-line/`, takt 21.35 s) play the same as the IR

While it plays:
- the filler's tips go 45 mm into the necks; the jets fall from the tips and land on the oil surface as it rises; all four cans fill alike to 0.9 (the reference two-stage curve); the head goes up
- the capper's chucks screw the caps down by the thread lead while turning 3 turns; at torque the cans carry their own caps; fresh caps are fed into the chucks
- the photo-eyes go blocked when a batch stands at them
- the tank level drops 0.04 per fill

**Changed**
- **Named op `fill`** (`lib/ops/named/fill.js`), from the reference `planFilling`:
  - in position → head down → nozzles engaged → valves open (the jet front falls with gravity) → dispense (two-stage curve) → valves close (the jet tail drops away) → drip → head up → complete (stage `filled`, the supply's level drawn down)
  - step times and texts default to the reference (texts from `units` / `liquid`: "Cans in position", "Dispensing oil")
  - generic by roles: the machine's `headTravel` / `jetStart` / `jetEnd` and anchor `tip`; the product's `fill` routine, ref `liquidSurface`, stage `filled`; optional `supply` (machine and level)
- **Named op `cap`** (`lib/ops/named/cap.js`), from the reference `planCapping`:
  - in position → head down to the threads (`engageAt`) → caps engaging → tighten (head to the seat and the chucks `turns` turns, both easing out) → torque reached (chucks empty, the product shows its cap, stage `capped`) → head up → fresh caps fed
  - generic by roles: `headTravel` / `spin` / `caps` / `capFeed`; the product's feature `cap` and stage `capped`
- **Presence sensors** (`lib/station/sensorSpec.js`; station field `sensors`, runtime and factory schema): a machine motion set to `blocked` while a unit's body spans the sensor along X (within `across` m), `clear` otherwise, updated on every refresh. Checked in the dry plan (known machine, a switch motion with both values).
- Small additions:
  - `filler`: anchor `tip` (the nozzle tips); `ops: ['fill']`
  - `capper`: `ops: ['cap']`
  - `jerryCan`: ref `liquidSurface` (live)
- **Station 1 data**, on the reference geometry:
  - slab (reference bounds, walkway at z 0.9) and rear fence
  - main belt (8.4 m) and outfeed belt (4.74 m), with guide gap 0.20 m (the can + 5 mm each side)
  - infeed and outfeed tunnels; filler (tips 0.323 m above the belt) and capper (seat 0.358 m) centred on the can necks
  - supply tank with the riser **connection** to the filler
  - four photo-eyes at the lead can of staging, filling, capping and outfeed, as sensors
  - operator panel (HMI) with the batch, batches out, machine cycles and batches on the line
  - beacon on the filler
  - indexing: 6 positions 1.6 m apart, batches of 4 at 0.4 m, preload at staging
- Tests:
  - `tests/spec/lubricant-line.test.js` (6): valid file and the 21.35 s plan; **step for step against the recording**; filling (tips in the necks, jets on the surface, levels, head up); capping (head at the seat, hand-over, cap feed); photo-eyes and the tank level; compiled = IR
  - `tests/station/connections.test.js`: the expected anchor list now includes `tip`

**Differences vs the reference (deliberate)**
1. **Tank refill:** the reference refills the tank gradually over time once it drops below 0.35. Here it refills at once at the end of a fill (to 0.88). Its level is visual only and doesn't affect timing.
2. **Outfeed belt:** drawn without its gear motor, because the outfeed tunnel covers its discharge end (noted in step 2).
3. **Jet width:** the reference narrows the jet during the top-off (`widthScale`). The filler's jets keep one width.

**Results**
- `npm test`: 39 files, 1467 tests passed.
- `npm run compile`: `generated/lubricant-line/` written (2 files); `generated/printer-line/` unchanged.
- Screenshots:
  - `screenshots/s1-filling.png` (t = 8 s): head down, golden jets into the four cans, oil rising, hose, tank, gauge, photo-eyes
  - `screenshots/s1-capping.png` (t = 41.5 s): the capper tightening, the filled batches behind, the panel live

**Phase 5 status:** step 9a is done (station 1 matches the reference). Next is **9b**: the can transfer (single-file guides, row-forming pushers, lane divider) and station 2 (case packing: gather 4 cans in 2 lanes, multi-can pick with the packing gantry, case erected, packed, closed and taped; the case becomes the unit that flows on).

### Step 9b (part 1): station 2 as data, case packing (approved)

Step 9a approved by the owner (2026-11-23: "continue working off from the next step phase 5 step 9b"). 9b is split like 9a: **part 1** = station 2 stand-alone; **part 2** = the can transfer (row former) and the S1 → S2 line geometry.

**Result first:** `spec/examples/lubricant-line.factory.json` now holds **station 2, case packing**, written as data, and it matches the recorded reference station 2:
- **all 143 timed steps** (state, label, duration, in order)
- start times within 0.05 s
- **6 cases out at 189.10 s**, as recorded
- dry plan 31.55 s per case (the recording's 31.54 is its 0.02 s quantisation)

While it plays:
- the case is erected in the tunnel; four filled, capped cans and the case ride in together; the cans accumulate in two lanes against the end stop (touching, 0.28 m), the case stops at the swing stop, which swings back across the belt in the first 0.5 s
- the gantry lowers to the handles, each can hangs in its own gripper, the rows close from lane spacing (0.26) to case spacing (0.20) on the way, the cans are set into the case at their slots, and the gantry returns
- the case then becomes the unit: the stop opens, the case indexes to the closer, the tuckers fold the end flaps (as far as the bar lets them), the plate tamps them, the folders fold the side flaps, the plate presses the top shut
- the case is taped from the leading edge back as it passes the fixed head (the tape roll turns) and leaves through the output port with the four cans in it
- photo-eyes: cans in position, case in position, case at the taper

**Changed**
- **Batches in rows** (`lib/station/batchSpec.js`; station field `batch`): a batch's members stand in rows across the flow (2 × 2 cans), rear row first, each along +X. `createBatch` takes `rows` / `rowPitch` and offers single members as items `member1 … memberN`. A batch frees only the members still in it.
- **Station port `offset`**: a station port may sit at an offset from its machine port (the infeed place inside the tunnel, the hand-over place inside the output tunnel). Runtime spec, factory schema and the timing table use it.
- **StationCycle:**
  - stand-alone feed of batches for a station with `batch`
  - `feed.fromLift: false`: stand-alone output just lets the unit go (no return-line lift steps)
  - a unit that holds things (a case with its cans) is freed with what it holds
  - presence sensors also see items the station made (the case on its own belt)
  - the dry plan of a batch station knows the members and where they stand
- **OpCycle:** `plannedPoint(item)` (where the plan has an item, batch members included, the same in dry and run), `swapUnit` / `swapUnitNow`; the old unit's members stay reachable after a swap.
- **Ops:**
  - `accumulate` (named): accumulating conveyors. Several items on several belts ride until each rests at its own stop place (eased in over `blend`), then a stopping step; `alongside` moves during the first seconds (the swing stop). From the reference `planArrival`.
  - `groupPickPlace` (named): a multi-gripper head picks a group at once (one item per gripper anchor), re-spaces the rows on the way, sets them into a container at its slots, returns. Nine fixed-time steps. At run time it checks every item really stands under its gripper (1 cm). From `planPick` / `planPlace` / `planCompletion`.
  - `closeCase` (named): the closer's seven steps, by roles (`tuckerOut`, `tuckerUp`, `folderOut`, `plateUp`); the case folds its own flaps from where the tools are. From `planClosing`.
  - `swapUnit` (named): from now on the station's unit is an item it made (the case); only made items qualify.
  - `transfer`: `also` (other belts that run with it) and `passes` (a fixed machine the item passes: an item routine driven by how far its visible body has crossed the machine's port, and the machine's surfaces turning). The start of a transfer now keeps a planned offset.
  - `spawn` records the offset of the place it made the item at.
- **Carton:** routines `foldUnder` (flaps folded by a bar or a plate, never back open: the reference `flapAngleUnderBar` / `flapAngleUnderPlate`, now in the product) and `tapeAlong`.
- `lib/core/motion.js`: `rampedTravel`, `rampedDuration`, `stoppingTravel`, `smoothMin`.
- **Layout:** a station's run now goes from its conveyor's start (or the input machine's) to its conveyor's end (or the output machine's). Station 1 leaves on its outfeed belt and station 2 on its output belt, so the gap to the next station is measured from there (`runExtent`, used by `Line` and the timing table). Printer line unchanged.
- **Station 2 data**, on the reference geometry (station frame = the reference definition frame: can line at z +0.75, case line at z −0.75): slab and fence, can belt (0.52 m) with infeed tunnel, lane divider and end stop, case infeed belt with erector tunnel and swing stop, output belt with closer, inline taper and output tunnel, packing gantry, three photo-eyes, HMI (conveyors, robot, gripper, cans in case, case-fill bar), beacon on the gantry.
- Line conventions: belt speed 0.6 m/s, ramp 0.5 s, hold re-check 0.1 s (the reference values); station 1's belts carry `batch`.
- **Edge S1 → S2** with a plain belt transfer for now, so the file is one line and compiles (`generated/lubricant-line/`: 3 files, takt 31.55 s).
- Dev: `#/twin?demo=line&line=<name>&station=<id>` plays one station of a line stand-alone.
- Tests:
  - `tests/spec/lubricant-station2.test.js` (6): valid, 31.55 s; **step for step against the recording, 6 cases at 189.10 s**; accumulation (positions, stop, photo-eyes); the pick (every can in its gripper by the handle, pitch 0.26 → 0.20, cans at their slots, gantry back); closing, taping and the case leaving as the unit with 4 cans
  - `tests/ops/packing-ops.test.js` (14): batch layout and members, port offset, run extent, belt helpers, accumulate / groupPickPlace / closeCase / swapUnit durations and errors, carton routines, transfer `passes`
  - `tests/spec/lubricant-line.test.js`: station 1 is compared **stand-alone** (the recording is stand-alone; in the line it now holds for the slower station 2); the compiled = IR check covers the whole line (both stations, 150 s)
  - `tests/line/line.test.js`: the dev-line check allows an indexing first station its machine cycles before the second station gets a unit

**Differences vs the reference (deliberate)**
1. **Gantry frame position:** our gantry is centred on its grippers, so its frame stands at x −0.054 (over the can handles); the reference frame stood at x 0 with the grippers offset.
2. **Zero-time steps:** ours has three per case that the recording doesn't ("Case erected", "Packed case flows on", "Process complete"); the comparison leaves out zero-time steps.
3. **Sensor span of the case:** measured once from its body with the flaps open (the reference used the case length).

**My mistakes this part (fixed before the results above):**
- the batch spec's member count overwrote the member list (`...spec`)
- the planned input place and `spawn`'s recorded place dropped their offsets (dry plan 33.32 s, then 33.22 s, instead of 31.55 s)
- swapping the unit at plan time hid the batch members from the pick, which plays before the swap
- the taping head measured the case with hidden meshes (the unlaid 1 m tape strip), so taping started early; now only visible meshes count
- several test sample times fell inside a step instead of after it
- a shell slip of mine (`cat >` waiting on input) hung one command; nothing was written by it

**Results**
- `npm test`: 41 files, **1487 tests passed** (run alone; one earlier run alongside a SwiftShader screenshot hit test timeouts, and the whole-line compiled check now has a 30 s timeout)
- `npm run compile`: `generated/lubricant-line/` 3 files (takt 31.55 s); `generated/printer-line/` unchanged
- `npm run schema`: `spec/factory.schema.json` regenerated
- Screenshots (`#/twin?demo=line&line=lubricant-line&station=packing`):
  - `screenshots/s2-transfer.png` (t = 10.6 s): four cans in the grippers on their way to the open case
  - `screenshots/s2-closing.png` (t = 22.3 s): end flaps pressed under the plate, side flaps still open, tuckers parked
  - `screenshots/s2-taping.png` (t = 26.9 s): the closed case under the taping head, tape laid from the leading edge
  - `screenshots/lubricant-s1-s2.png` (whole line, t = 75 s): runs, station 2 packing S1's batches. **Not right yet:** station 2 stands on station 1's centre line, so the plain transfer meets it between its two lines, and the batch slides sideways into the lanes. That is part 2.

**Next:** step 9b part 2: the **can transfer** and the S1 → S2 geometry:
- the row former as data (single-file guides, two side pushers forming the lanes, lane divider), its steps compared with the recorded `canTransfer` steps (4.83 / 0.7 / 0.45 / 1.83 / 0.7 / 0.45 / 0.2 / 4.18 / 0.5 s)
- layout aligning ports across the flow (station 2 shifted so its can line meets station 1's centre line, as in the reference factory)
- note: the reference's first single-file transfer takes 50.5 s (a one-off in its recording, probably a stale world matrix on the first hand-over); I'll check that before deciding whether to match it

### Step 9b (part 2): the can transfer and the line from station 1 to station 2 (approved)

Part 1 approved by the owner (2026-11-23: "continue").

**Result first:** station 1 → can transfer → station 2 now plays as the recorded reference factory:
- **the transfer** (row former), all 27 batches step for step: 243 steps, start times within 0.05 s
- **stations 1 and 2 in the line**, step for step too (waits and holds left out: the reference names them differently): over 300 steps each, start times within 0.05 s
- **every case of the 27-case run packed when the reference packed it** (within 0.05 s; the first at 95.06 s)
- the layout is the reference factory's: the transfer belt centre 10.45 m after station 1, station 2 16.2 m after it and 0.75 m towards −Z, so its can infeed is on station 1's centre line

**The reference recording, corrected first.** Its first can transfer took 50.5 s, the later ones 4.83 s. I checked why: the first hand-over moved the cans 2.6 m + 27.41 m, and 27.41 m is exactly station 1's world offset. The headless recording never rendered, so the factory's world matrices were stale on the first hand-over (in a browser every frame renders and updates them). The script now updates them once before the start and after every update, as rendering does. Re-recorded:
- whole factory: **964.82 s** (was 1010.52 s); first case packed at 95.06 s (was 140.76 s)
- every single-file move 4.83 s; stations 1 and 2 stand-alone unchanged (199.76 s, 189.10 s)
- the reference repo untouched; only the recording script changed

**Changed**
- **Row former as data**: station `canTransfer` (role `transfer`), in its own frame (the reference station-1 frame moved to the transfer belt's centre):
  - transfer belt (3.0 m), single-file guide rails (1.6 m), side pushers A (on +Z) and B (turned, on −Z), lane divider
  - intake: single-file transfer to the row former; process: pusher A forms lane 1, index the second pair, pusher B forms lane 2, two lanes formed; output: feed station 2's infeed, belt stopping, each step as the reference
  - stand-alone it feeds itself batches of 4 over a short stand-alone infeed belt (hidden in the line)
- **Direct edges** (`transport.kind: 'direct'`, runtime and factory schema): the two ports meet and the unit is handed over where it stands (no transfer conveyor). The line refuses a direct edge whose ports don't meet.
- **Layout**: a direct edge stands the next station so the ports meet; across the flow every station is shifted so the ports an edge joins are in line (station 2's can line on station 1's centre line); transfer conveyors run at the ports' common z. The printer line is unchanged (all its ports at z 0).
- **Ops:**
  - `push` (named): a side pusher pushes items across a conveyor with its face (they ride the face once it reaches them), then retracts. With `rest`, the plan knows where the pushed members stand, and playing sets them exactly there at the end (within 1 cm: the can labels stand 1.5 mm proud of the body).
  - `stopConveyors` (basic): running belts decelerate to a stop.
  - `accumulate`: `stopping: false` (a stopConveyors op follows, so the station can hand over as soon as the items rest) and `unitTo` (where the unit counts as standing then).
  - `transfer` now records the offset of the place it ends at (an index by a fixed distance needed it).
- **Stations:**
  - `prepare`: ops played at the start of each cycle once a unit is waiting, before it is taken in (station 2's "Line empty", as the reference takes the cans only after it); input ports offer `available()` to look without taking
  - `role: 'transfer'`: a station that carries units between two others; a line updates it after the other stations, with its transfer conveyors (as both reference lines update their transfers after the stations)
  - a batch taken in is re-centred on the input place and records where its members really stand (`rebase`), so the plan starts from there (the row former's 2 × 2 at pitch 0.4, not the original single file)
  - port `connected`: machines that only exist when the port is connected (an open-ended hood where stand-alone a closed tunnel stands); hidden stand-alone
- **Indexing:** `startWhen: 'downstreamEmpty'`: a machine cycle only starts while the next station holds no unit (the reference factory holds station 1 while the transfer has a batch). The line offers it on output ports.
- **Batches:** `rowsFrom: 'front'` (member numbers start in the front row): the row former pushes the leading pair (members 3, 4) to the rear lane, so station 2's batch is numbered that way.
- **Components:** `conveyorTunnel` `open: 'both'` (a hood: no end wall, no lining, trim and a port at each end); `sidePusher` anchor `face`.
- **Data:**
  - station 1: hands over where the discharge leaves the batch (output port offset −0.9 m), closed outfeed tunnel stand-alone / hood in the line, `startWhen: downstreamEmpty`
  - station 2: batches of 2 × 2 at pitch 0.4 (as the transfer leaves them, inside the hood; stand-alone timing unchanged), input place 1.3 m into the belt, closed tunnel stand-alone / hood in the line, "Line empty" as its prepare op, members and grippers in the row former's order
  - edges S1 → transfer → S2 both direct
- **Bug fixed in `Line.reset`:** it reset the stations before zeroing the released count, so station 1's preloaded batch was not counted and the line let 28 batches in instead of 27 (the reference's 108 cans).
- Tests:
  - `tests/spec/lubricant-transfer.test.js` (5): the plan (13.85 s transfer cycle, no transfer conveyors) and the reference layout; stand-alone transfer = the recorded cycle; pushed lanes (leading pair rear, trailing pair front, pitch kept, pushers back); hoods, hidden stand-alone parts and meeting ports in the line; **27 batches: the transfer, station 1 and station 2 step for step and every case on time**
  - `tests/spec/lubricant-reference.test.js`: the new total (964.82 s) and the transfer cycle in the recording (27 moves, all 4.83 s)
  - `tests/ops/packing-ops.test.js` (+7): rows from the front, rebase, direct edges and ports in line, the hood, connected-only machines, push (durations, planned rest, errors), pushed members following their batch, accumulate without its stop + stopConveyors
  - `tests/spec/lubricant-station2.test.js`: the new member order

**Differences vs the reference (deliberate)**
1. **Hold labels**: ours say "Waiting for T1" / "Holding · downstream busy" where the reference says "Waiting for jerry cans from Station 1" / "Holding · transfer to Station 2 busy"; the comparisons leave waits out.
2. **Station 2 stand-alone spawn**: the cans now appear 0.4 m apart in the tunnel (the reference stand-alone: 0.6 m). Hidden in the tunnel, and the case's longer way sets the time, so the recording still matches.
3. **Belts of the neighbour stations**: the reference scrolls station 1's outfeed belt during the single-file move when station 1 is idle; ours scrolls only the transfer's own belt.

**My mistakes this part (fixed before the results above):**
- I first wrote 964.8 s from the rounded console line; the file says 964.82 s
- I wrote the reference-test update and forgot to apply it until the suite caught it
- the push first checked its rest to 1 mm and stopped on the label thickness
- one lane test expected the two rows side by side; before the feed the rear pair is one index (0.8 m) ahead, as in the reference
- the station-step comparison was empty at first (station 1 finishes long before the run ends); it now asserts how many steps it compared
- several test sample times fell inside steps

**Results**
- `npm test`: 42 files, **1500 tests passed**
- `npm run compile`: `generated/lubricant-line/` 4 files (filling, canTransfer, packing, line; takt 31.55 s); `generated/printer-line/` unchanged
- `npm run reference:timing:lubricant` re-recorded; `npm run schema` regenerated
- Screenshots:
  - `screenshots/t1-pushing.png` (t = 55.5 s): pusher A shifting the leading pair across, the trailing pair in the single-file guides
  - `screenshots/t1-feeding.png` (t = 62.5 s): the formed lanes fed into station 2's open hood
  - `screenshots/lubricant-s1-s2.png` (t = 100 s): the whole line, station 1's centre line through the transfer into station 2's can line, station 2 shifted back

**Next:** step 9c: station 3 (case source with rear port, conveyor, the ABB IRB 6760 picking the cases onto the pallet stack), the outbound (worker takes the pallet to the wrapper, wrap) and the case transfer S2 → S3.

### Step 9c (part 1): station 3 palletizing with the ABB, and the case transfer (approved)

Step 9b part 2 approved by the owner (2026-11-23: "next"). 9c is split like 9a and 9b: **part 1** = the case transfer S2 → S3 and station 3 stacking the 27 cases (this step); **part 2** = the outbound (the worker takes the full pallet to the wrapper, the wrap) and the whole line to its end at 964.82 s.

**Result first:** station 3 is in `lubricant-line.factory.json`, and in the whole line:
- **all 27 cases are set on the pallet when the reference set them** (within 0.1 s, see below)
- **the robot's steps match the recording step for step**: 323 steps (12 per case, the reference states and durations), start times within 0.1 s
- the layout is the reference factory's: station 3 stands 11.21 m after station 2 and 0.75 m towards −Z; the case transfer is 3.21 m (5.85 s) from station 2's exit to the buffer in the source cabinet
- every case lands exactly on its spot of the 3 × 3 × 3 pattern, square, on the 2.06 × 1.46 pallet

**Why 0.1 s, not 0.05 s as for the other stations:** the reference station 3 runs its own loop, and each step there ends on a whole frame. Its 0.45 s grip is recorded as 0.46 s, its conveyor run ends on the next frame, and so on. Ours keeps the exact times. The difference stays bounded (no drift: over the 27 cases it wanders between −0.04 and +0.06 s, measured), so I compare station 3 to 0.1 s. Stations 1, 2 and the transfer stay at 0.05 s.

**Changed**
- **Op `armPalletize`** (named): an articulated robot with a vacuum tool takes an item off a conveyor by its top and sets it on the next spot of a station stack, then returns home. Port of the reference station-3 cycle:
  - steps: approach 1.8 s, lower 1.0, vacuum on 0.45, lift 1.1, move to the stack 2.0, lower 0.9, vacuum off 0.45, settle 0.16, retract 0.8, home 2.2 (reference)
  - heights from the reference: hover 0.3 m over the top, lift at least 0.52 m and over the stack, carried case 0.12 m over its spot, tool 1 mm over the top at contact
  - **swings turn about the robot's base** (radius, angle and height eased together); lowering and lifting are straight
  - checks when played: the tool within 3.5 cm of the top at the grip (reference tolerance); the case is then set exactly on its spot
- **A unit left on a stack is done there** (StationCycle and the dry plan): no output phase, it counts as completed, and the stack owns it.
- **Station field `unit`**: the station's own unit type when it isn't the line product (cartons at station 3), used for the stand-alone feed and the dry plan.
- **Carton:** stage `closed` (flaps folded, seam taped) and ref `top` (the middle of the closed top, on the tape).
- `trapezoidTravel` with no ramp is a constant-speed move. The reference station-3 belt runs at 0.7 m/s with no ramp; the formula gave NaN at ramp 0.
- `beltConveyor`: width up to 1.1 m (the station-3 belt is 1.05 m).
- **Station 3 data**, reference geometry (station frame = the reference station-3 frame):
  - belt 4.8 × 1.05 m at 0.82 m; case source cabinet (1.55 × 1.45 × 1.85, rear infeed port) at its input
  - ABB IRB 6760 placed as the reference places it (bounding box centred at the base point, facing the conveyor), so axis 1 is at (0.901, 0, 1.408)
  - block pallet 2.06 × 1.46 at (0.14, 2.84); stack 3 columns × 3 rows × 3 layers, 2 cm apart; slab
  - intake: case into the cell from the buffer (1.83 s), conveyed to the pick point at 0.7 m/s (3.70 s), 0.25 s at the pick point; process: `armPalletize`, then "ready for the next case" (0.2 s), or, when the pallet fills, a placeholder dispatch that part 2 replaces with the outbound
- **Case transfer S2 → S3**: a conveyor edge (0.52 m belt) from station 2's exit inside its output tunnel to the buffer in the cabinet, at station 2's belt height; the case steps down to station 3's belt inside the cabinet. Line transfer length 1.62 m (station 2's output belt end to the cabinet's rear trim), which gives the reference 11.21 m.
- Tests:
  - `tests/spec/lubricant-station3.test.js` (3): valid, the layout and the transfer, the plan; stand-alone, the tool on the case top within 3 mm at the grip, the case carried and set exactly on the first spot, the robot home; **in the line, 27 cases on time and the robot step for step**
  - `tests/ops/packing-ops.test.js` (+5): constant-speed move, `armPalletize` (10.86 s, a stacked unit has no output phase, errors), the carton's closed stage and top
  - the whole-line tests (`lubricant-line`, `lubricant-transfer`, the dev-line check) load station 3's robot model first; the transfer test now expects the one transfer conveyor S2 → S3

**Differences vs the reference (deliberate)**
1. **Robot home:** at its rest pose the reference tool points 30° below horizontal. Our robot interface always holds the tool straight down, so home is a nearby tool-down point (2.2 m out, 2.0 m up). Same step times; the arm's first and last poses look slightly different.
2. **Robot paths:** the reference interpolates joint poses solved along its paths; ours swings the tool about the base and moves straight up and down, solved by the same IK each frame. The end points are the same; the path in between differs a little.
3. **Tool:** ours is the rectangular vacuum pad of step 7d; the reference used a round suction cup.
4. **The case rests on the belt** (0.82 m). The reference held it 12 mm above the belt surface.
5. **Robot steps' frame rounding** (above): ours keep exact times.
6. **The case transfer** is one 3.21 m move to the buffer. The reference has three queue places; with station 3 faster than station 2, only the first is ever used, so the timing is the same.

**My mistakes this part (fixed before the results above):**
- station 3 needed an explicit empty output phase (its units end on the stack); the default output refused two machines
- the transfer length first used the cabinet's back face; its rear-port trim stands 4 cm proud (3.25 m instead of 3.21 m)
- several test sample times were inside steps (the release, the carry), one assertion assumed a held item is re-parented (ours follows the tool anchor), and the step comparison first stopped before the last case's last steps

**Results**
- `npm test`: 43 files, **1507 tests passed**
- `npm run compile`: `generated/lubricant-line/` 5 files (takt 31.55 s); `generated/printer-line/` unchanged
- `npm run schema` regenerated
- `screenshots/s3-palletizing.png` (t = 426.6 s, whole line): the robot carrying the 11th case to the stack, 10 taped cases on the pallet, the case transfer into the source cabinet

**Next:** step 9c part 2: the outbound after the 27th case:
- the worker with the pallet jack drives to the pallet, lifts it with its stack, carries it to the stretch wrapper and sets it on the deck, then withdraws
- the 12 s wrap
- all with the reference step times (approach 2.4, insert 0.72, lift 1.0, transport 4.2, place 1.8, lower 0.9, release 0.5, withdraw 2.4, stow 0.6, wrap 12)
- the whole line finishing at the recorded 964.82 s

### Step 9c (part 2): station 3's outbound, the wrap, and the whole line to its end (approved)

Part 1 approved by the owner (2026-11-23: "next").

**Result first:** the lubricant line now plays from the first empty can to a wrapped pallet, as the reference factory:
- after the 27th case, **the outbound matches the recording step for step**:
  - ready 0.35 s, drive under the pallet 2.4 s, settle 0.72 s, lift 1.0 s, take it to the wrapper 4.2 s
  - roll in 1.8 s, lower onto the deck 0.9 s, release 0.5 s, back out 2.4 s, forks down 0.6 s, wrap 12 s
  - start times within 0.1 s (station 3's frame rounding, as in part 1)
- **the wrap ends at 964.70 s** (reference 964.78 s); **the line reports finished at 964.72 s** (reference 964.82 s)
- at the end: the pallet with all 27 cases on the wrapper deck (exactly on its anchor), wrapped, the worker backed out with its forks down

**Changed**
- **Op `haulStack`** (named): a pallet truck takes a station stack (its pallet with everything on it) to a machine anchor (the wrapper deck), sets it down there and backs out. Port of the reference outbound, ten fixed-time steps (14.87 s). Roles: the truck's `x` travel, `forks`, `stride` (the legs walk one cycle per 1.2 m), anchor `cargo`. Positions and fork heights are station data (from the reference layout), checked against the truck's ranges. The pallet rests exactly on the destination anchor and moves with it afterwards, so it turns with the wrapper deck.
- **Stacks travel:** the stack API's `gather` puts everything on a stack onto its machine (the pallet), so the cases ride with it.
- **Reset fixed:**
  - units left on a stack are now freed with it. Before, a reset emptied the stack's list but left the cases in the scene; this didn't show until station 3 left units on a stack.
  - machines an op carried away (the pallet) go back to where they stood
- **`decide` `planAs`**: names the branch a dry plan takes (cycle time, takt) when the fact isn't known. Without it the longest branch counts, as before. Station 3 plans the usual "next case" branch: the outbound comes once per 27 cases and would otherwise have made station 3 the bottleneck (43.5 s instead of 16.85 s). The takt stays 31.55 s (station 2).
- **Station 3 data:**
  - the worker with its pallet truck parked in a floor bay (reference: 2.4 m before the pallet centre)
  - the stretch wrapper 4.2 m beyond the pallet (deck 0.44 m)
  - the slab enlarged to hold them
  - when the pallet fills: `haulStack` to the wrapper deck, then the 12 s wrap
- Tests:
  - `tests/spec/lubricant-station3.test.js` (4): the line test now runs to the end. The outbound is checked step for step, plus the wrap end, the line's finish, and the pallet with 27 cases on the deck, wrapped, worker out. New: a reset puts the pallet back and frees its cases.
  - `tests/ops/packing-ops.test.js` (+2): `haulStack` (14.87 s, range checks, unknown anchor), `decide` `planAs`

**Differences vs the reference (deliberate)**
1. **The worker is always there**, parked in its bay; the reference creates it when the outbound starts. Same moves and times.
2. **Backing out:** the truck stops when its fork tips are 0.6 m clear of the pallet (the reference rule), using our truck's fork length. The step time is the reference's 2.4 s either way.
3. **The wrap** is the procedural wrapper of step 7b (owner's decision); the pallet turns with its deck.
4. The line counts the 27th case done after the wrap, so its HMI says "done 26" during the outbound.

**My mistakes this part (fixed before the results above):**
- the dry plan first took the outbound branch for station 3's cycle time (43.5 s), which would have made it the bottleneck; hence `planAs`

**Results**
- `npm test`: 43 files, **1510 tests passed**
- `npm run compile`: `generated/lubricant-line/` 5 files, takt 31.55 s; `generated/printer-line/` unchanged
- `npm run schema` regenerated
- Screenshots (whole line):
  - `screenshots/s3-outbound.png` (t = 944.2 s): the worker carrying the full pallet (27 cases) to the wrapper
  - `screenshots/s3-wrapping.png` (t = 959 s): the pallet turning on the wrapper deck, film part way up, the worker backed out

**Phase 5 status:** the lubricant line is complete as data (stations 1–3, the can transfer, the case transfer), and its timing is checked against the reference station by station:
- stations 1 and 2 and the transfer: step for step within 0.05 s
- station 3: step for step within 0.1 s (its frame rounding)
- the line's end: within 0.1 s

**Next:** step 9d:
- screenshot comparison with the reference lubricant factory rendered in our viewer, as Phase 4 step 8 did for the printer line (`npm run visual`, golden images)
- a look at the compiled files
- the Phase 5 wrap-up

### Step 9d: the lubricant line compared with the reference by eye and by pixel, supply racks, Phase 5 wrap-up (approved)

Step 9c part 2 approved by the owner (2026-11-23: "continue with phase 5 step 9d").

**Result first:** the compiled lubricant line and the hand-built reference factory, rendered in the same viewer from the same cameras at the same moments, match. In all 14 views (t = 0 to 959 s; every station close-up, the can transfer, line and wide views) every station, machine, rack, sign, HMI, can and case is in the same place and the moving parts are in the same pose:
- filler jets at 8 s
- the gantry over the open case at 100 s
- the robot with the 11th case over a pallet of 10 at 426.6 s
- the worker and the full pallet at 944 s, the wrap at 959 s

Differing pixels:

| Views | Differing pixels |
|---|---:|
| wide | 2.9–3.0 % |
| line | 4.5 % |
| station 1 | 4.7–4.9 % |
| can transfer | 6.2–6.4 % |
| station 2 | 8.3–8.4 % |
| **station 3** | **32–39 %** |

Station 3 is high for known reasons, not misplacement:
- our cell stands on a floor slab; the reference cell stands on the bare floor (about a third of those views)
- our worker is parked in its bay all the time
- our station-3 belt is the catalog belt conveyor

Full table and the list of differences: `benchmarks/results/lubricant-line-visual.md`.

With the timing match of 9a–9c, **the lubricant line rebuilds from JSON at reference quality (Claude.md §9's second regression test).**

**Found on the way:** the reference station 3 really does need the world origin (its own layout note says so). In a Node check, the reference factory moved by our layout's offset never gripped a case (0 instead of 10 on the pallet at 426.6 s). So our line is moved to the reference frame, not the reference to ours. That this is allowed is now a test of rule 4: shifted, our line plays exactly the same.

**Changed**
- **Supply stock** (`lib/station/supplySpec.js`; station field `supplies`, runtime and factory schema, passed through by `compiler/expand.js`). The reference factory's jerry-can and carton racks, drawn down as the line runs:
  - identical items on a machine's deck ports, in a grid (columns, rows, layers, a turn)
  - drawn as instanced stock (`lib/core/instancedStock.js`, step 8): 108 cans in a few draw calls
  - `draws: 'units'` takes one item per unit or batch member the station brings in (the line's released batches); `draws: { made: item }` takes one each time an op makes that item (`spawn`; `OpCycle.onSpawn` now gets the item name)
  - refilled on reset; checked in the dry plan (known machine and deck ports)
  - visual only: an empty supply doesn't hold the line (the run size decides)
- **`lubricant-line.factory.json`**, reference geometry:
  - station 1: can rack (`palletRack` defaults = the reference can rack) at x −6.0 with **108 empty cans** (3 decks × 6 × 6), sign "RAW MATERIALS"
  - station 2: carton rack at (−5.85, −0.75) with **32 closed cartons** (2 decks × 2 layers × 2 × 4, turned 90°), sign "CARTON SUPPLY"
  - over a run the cans run out exactly (27 batches of 4) and 5 cartons are left, as in the reference
- **The reference factory in our viewer** (dev only): `app/dev/referenceLubricant.js`, `#/twin?demo=reference&line=lubricant-line`:
  - loads `LubricantFactory` from the read-only export
  - builds station 3 with the same IRB 6760 model and rig
  - steps it like the timing recording (0.02 s, world matrices updated after every update)
- **Wrapper stand-in:** `app/dev/referenceWrapStub.js`. `vite.config.js` points the reference's `AssetWrapMachine.js` import at it (browser only; the SSR timing script keeps its own stub). It builds **our** wrapper from the factory.json, so the wrapper itself is not compared.
- **Assets:** the reference's two label PNGs copied read-only into the git-ignored `reference/_src/src/assets`.
- **Twin page:** `?shift=x,y,z` moves the whole line; the reference demo picks the lubricant factory with `&line=lubricant-line`.
- **Visual script per line:** views and pages moved to `scripts/visual-views.js`. `scripts/visual-compare.mjs --line lubricant-line [views]` (default the printer line, unchanged). Writes goldens to `tests/golden/lines/lubricant-line/`, diffs to `benchmarks/results/visual/lubricant-line/`, numbers to `benchmarks/results/lubricant-line-visual.json`. From PowerShell, call `node` directly (npm drops the options).
- **Compiled headers:** they said a decision is "timed by its longest branch". Since 9c, station 3 is planned by its `planAs` branch, so the text now says "planAs branch, else the longest", and the line header notes that one-off branches (the full pallet leaving) are not in the run estimate. Only comments changed in `generated/printer-line/`.
- **Tests:**
  - `tests/station/supplies.test.js` (5): slot order; problems (unknown machine / deck, also through `checkFactory`); the two racks (capacity, on the decks, instanced); drawn as batches are released and cases made, 0 cans / 5 cartons left after the run, refilled on reset; compiled files carry the supplies
  - `tests/spec/lubricant-line-visual.test.js` (17):
    - the shift equals our palletizing station's layout position
    - **rule 4**: the shifted line plays the same as the unshifted one (status and every unit's position in the line frame, every 10 s for 140 s)
    - a result for every view, views in time order
    - each view within its limit (`benchmarks/expected/lubricant-line-visual-limits.js`, about one point above what was measured); the stored images re-diff to the recorded numbers

**The compiled files, looked at** (`generated/lubricant-line/`, 5 files, 1,231 lines): headers list the stations with cycle times, steps and placement, the transfer (3.21 m, 5.85 s), takt 31.55 s, and each station's equipment table. Code lines stay within 100 columns (only header comments with long catalog summaries are longer, as in the printer line).
- **Run estimate:** the header says about 911.55 s. The real run takes 964.72 s, because the estimate leaves out station 3's once-per-pallet outbound (14.87 s + 12 s wrap) and station 1's start-up cycles. The header now says the estimate leaves out one-off branches.

**Differences vs the reference (deliberate):** in `benchmarks/results/lubricant-line-visual.md`. New in this step: the cartons in the rack are our closed `carton`; the reference drew plain boxes with a tape line.

**My mistakes this step (fixed before the results above):**
- I first moved the reference factory to our frame, which jams its station 3 (a stray case in my first screenshot gave it away)
- two schema descriptions with an unescaped apostrophe broke 14 test files until fixed
- the reference loader named the robot model file and the rig file, which trips rule 6; both are now found through our data or a pattern
- my first supply test treated `checkFactory` errors as strings

**Results**
- `npm test`: 45 files, **1532 tests passed**
- `npm run compile`: `generated/lubricant-line/` 5 files, takt 31.55 s; `generated/printer-line/` header comments only
- `npm run schema` regenerated
- `node scripts/visual-compare.mjs --line lubricant-line`: 14 views × 2 renders (ours 186 s, reference about 5 min)

**Open question for the owner:** keep station 3's floor slab (every station on a slab, as the printer line) or remove it to match the reference cell? Removing it is one equipment entry; the station 3 views would then drop to roughly the station 2 level.

## Phase 5 status: done

Lubricant components and adapters (steps 1–8) and the lubricant line as data (step 9) are done:
- `lubricant-line.factory.json` compiles and runs from the first empty can to a wrapped pallet
- timing matches the recorded reference station by station (stations 1, 2 and the transfer within 0.05 s, station 3 and the line's end within 0.1 s)
- the screenshots match the reference factory in place and pose, with the differences listed

**Next:** Phase 6 (generic level): basic frames / axes / tools / transport / buffers, `composite` equipment in the IR and compiler, `genericMachine`, graph shapes (reject branch, merge, parallel station, buffer), parametric and GLB products. I'll propose how to split it before starting.

## Phase 6: Generic level

Step 9d approved by the owner moving on (2026-11-23: "continue with phase 6"). No answer on the station 3 slab question, so the slab stays (it can be removed later as one equipment entry).

**Split** (proposed 2026-11-23; work started on 6.1 under the "don't wait" rule):

| Step | Content |
|---|---|
| 6.1 | Basic **frames**: portal, column, cantilever, table, turntable, enclosure, with mount points (anchors) for the parts hung on them |
| 6.2 | Basic **axes** (linear, rotary) and **tools** (gripper, vacuum, nozzle, spindle, press ram, camera, laser, labeller, screwdriver), with tool anchors |
| 6.3 | Basic **transport and buffers** (accumulation table, gravity chute, buffer lane, turntable transfer) |
| 6.4 | **`composite`** equipment in the IR and compiler: a machine assembled from basics (frame + axes + tool, mounted by anchor), its motions and ops under one id |
| 6.5 | **`genericMachine`** fallback: enclosure with the right footprint, ports, timing, sign and stack light; flagged for the reviewer |
| 6.6 | **Graph shapes**: reject branch, merge, parallel copies, buffers in `layout.js` and `Line.js` |
| 6.7 | **Products**: parametric shapes with stages; GLB import with marked grasp points |
| 6.8 | A test line built only from basics and composites, compiled and played |

### Step 6.1: basic frames (approved)

**Result first:** six basic frames are in the catalog (category `frame`), each with mount points (anchors) where step 6.4's composites will hang axes and tools. All six pass the generic component checks at min / default / max params:
- every mesh named, no NaN
- inside the footprint, nothing floating
- motions run through their whole range

Golden images written and checked by eye.

| Frame | What it is | Mount points | Ports / motions |
|---|---|---|---|
| `portalFrame` | two posts and a cross beam across the flow | `beam` (under the middle), `beamTop` | |
| `columnFrame` | a column on a base plate | `top`, `side` (on +Z at `mountHeight`) | |
| `cantileverFrame` | column on the equipment side (−Z), arm reaching across the flow | `tip` (under the arm end, at the origin), `armTop` | |
| `tableFrame` | top on four braced legs | `top` | port `surface` |
| `turntableFrame` | drum base, turning plate with N nests | `plate`, `nest1…N` (turn with the plate; nest 1 on +X, counter-clockwise) | motion `angle` (wraps), port `load` |
| `enclosureFrame` | corner posts, roof, guard-glass sides, end walls with a pass-through opening down to the floor | `roof` (inside) | ports `input` / `output` at belt height |

**Changed**
- `lib/basics/frames/*.js` (six frames) and `lib/basics/frames/common.js` (colour choice, foot plates, `mountPoint`)
- `lib/components/index.js` also loads `lib/basics/**`, so basic blocks register like components; gallery, goldens and the generic checks pick them up with no other change
- **Rule 6 test:** component names may appear in `lib/basics/**` as well as `lib/components/**` (Claude.md §6.1 puts the basic blocks there). Claude.md §3 rule 6 still says only `lib/components/**`; I haven't edited Claude.md, so please confirm or adjust its wording.
- Parameter checks that keep every combination valid: column side mount at or below the top; turntable nests at least 10 cm inside the plate edge; enclosure opening at least 2.5 cm of wall each side and 10 cm below the roof
- Tests `tests/components/frames.test.js` (7): the six frames registered as `frame`; portal posts outside the clear width and its mounts; column mounts; cantilever tip `reach` in front of the column under the arm; table port and mount on the surface; turntable nests evenly spaced, turning with the plate (a quarter turn brings nest 4 to the load place); enclosure ports at belt height with nothing standing in the pass-through, roof mount

**My mistakes this step (fixed before the results above):**
- my first frame test used `inst.anchors.x`; instances expose anchors through `anchor(name)`

**Results**
- `npm test`: 46 files, **1647 tests passed** (the generic checks add about 110 for the six frames)
- `npm run golden -- portalFrame columnFrame cantileverFrame tableFrame turntableFrame enclosureFrame`: 6 images in `tests/golden/components/`

**Next:** step 6.2: basic axes (linear, rotary) and tools (gripper, vacuum, nozzle, spindle, press ram, camera, laser, labeller, screwdriver). Existing tools (`fingerGripper`, `screwdriver` under `lib/components/tools/`) will be reused where they fit.

### Step 6.2: basic axes and tools (approved)

Step 6.1 approved by the owner (2026-11-24: "next"). The rule-6 wording question (Claude.md still names only `lib/components/**`) is still open.

**Result first:** the catalog has three basic axes and six new basic tools. With the existing finger gripper, vacuum pad and screwdriver, that covers all nine tools of Claude.md §6.6. All nine new parts pass the generic component checks at min / default / max params, and their golden images were checked by eye.

**Mounting conventions** (step 6.4's composites will rely on them; tested):
- **frames:** origin on the floor
- **axes:** origin at the **mounting face**. Standing ones rise from it; hung ones (`hang: true`) hang below it.
- **tools** (`mount: 'tool'`): origin at the **tool point**; mounting face on top, at the footprint height (checked for the new tools and the gripper and vacuum pad)
- **mount points (anchors):** Y always up, also on hung parts; positive rotation is counter-clockwise seen from above

| Part | What it is | Motions | Mount point |
|---|---|---|---|
| `linearAxis` | profile, rail, carriage, drive motor; along X (turn about Y for Z); standing or hung | `travel` (m) | `carriage` |
| `verticalAxis` | slide body hanging from its face, ram coming down | `extend` (m) | `ram` |
| `rotaryAxis` | housing and turning flange; standing or hung | `angle` (rad, wraps) | `flange` |
| `dispenseNozzle` | valve body and needle; stream colour by liquid (oil, water, glue, sealant) | `flow` 0–1 (stream to `jetLength`) | |
| `machiningSpindle` | motor, nose, collet, drill or end mill | `spin` (rad, wraps) | |
| `pressRam` | cylinder body, rod, pressing head | `extend` (m) | `face` |
| `visionCamera` | body, lens, ring light; sight line to the working distance while lit | `light` off / on | |
| `laserHead` | source, focusing optic, nozzle; beam converging to the focus | `beam` 0–1 | |
| `labelHead` | label roll, peel plate, tamp pad with a label | `tamp` (m), `label` none / loaded | `pad` |

Reused as basic tools: `fingerGripper`, `vacuumPad`, `screwdriver` (`lib/components/tools/`).

**Changed**
- `lib/basics/axes/*.js` (3), `lib/basics/tools/*.js` (6)
- **Gallery:** a part whose footprint reaches below its origin (tools, hung axes) is lifted onto the floor with its footprint overlay. Before, the vertical axis rendered under the floor. Golden images re-rendered for the 7 such parts at default params, including the existing `screwdriver` (now shown lifted).
- Tests `tests/components/axes-tools.test.js` (18):
  - linear axis: carriage on top following `travel`; hung, underneath, Y up, motor still on +X, everything below the mounting face
  - vertical axis: ram mount down by `extend`; stroke refused when the ram would leave its guide
  - rotary axis: counter-clockwise standing and hung
  - every new tool and the gripper and vacuum pad: mounting face at the footprint height
  - nozzle stream length, press face, label head pad and label, camera sight line and laser beam reaching their distances, spindle turning only the cutter side

**My mistakes this step (fixed before the results above):**
- the rotary axis turned the other way when hung; its index mark and connector block stood outside the footprint
- the linear axis's end caps were wider than its footprint at the largest section; the vertical axis motor stuck out on +Z
- the label head's pad missed its rods with a narrow label, and with a long stroke the rods left the body; the label lay 0.5 mm below the declared bottom
- `spindle` as a type name collided with the plain word "spindle" in three files (rule 6 check); renamed `machiningSpindle`
- one test read a stale world matrix (the stream's parent had just been scaled)

**Results**
- `npm test`: 47 files, **1827 tests passed**
- golden images: the 9 new parts, plus `screwdriver` re-rendered

**Next:** step 6.3: basic transport and buffers (accumulation table, gravity chute, buffer lane, turntable transfer).

### Step 6.3: basic transport and buffers (approved)

Step 6.2 approved by the owner (2026-11-24: "ok"). The rule-6 wording in Claude.md is still open.

**Result first:** five basic transport and buffer blocks are in the catalog. All pass the generic component checks at min / default / max params, and their golden images were checked by eye. Each has typed ports at belt height and a roller or turning motion with `travel`, so **the existing `transfer` op drives them unchanged** (tested: a unit conveyed from a buffer lane's input to slot 2 takes exactly the trapezoid time for 0.75 m; one rolls down a chute).

| Part | Category | What it is | Ports | Motions |
|---|---|---|---|---|
| `gravityChute` | transport | roller chute sloping down along +X, side guides, no drive | `input` (belt height + `drop`), `output` | `rollers` |
| `turntableTransfer` | transport | roller section on a turning base: straight on, or 90° to a branch | `input`, `output`, `toRear` (−Z), `toFront` (+Z) | `turn` (±π/2), `rollers` |
| `agvCart` | transport | driverless cart, roller deck at belt height on a lift column, status light strip, safety scanner | `input`, `output`, `deck` | `rollers`, `light` (off / run / wait) |
| `accumulationTable` | buffer | turning disc in a guard rail, fixed centre cone, rail openings at both ports | `input` (−X edge), `output` (+X edge) | `spin` (travel on the ring at ¾ radius) |
| `bufferLane` | buffer | accumulating roller lane, pop-up stop at the end of each slot | `input`, `output`, `slot1…N` (work) | `rollers`, `stop1…N` (down / up) |

`flowRack` (Phase 2) was already in the `buffer` category and stays there.

**Changed**
- `lib/basics/transport/` (`rollerBed.js` shared roller bed and cross bar; `gravityChute`, `turntableTransfer`, `agvCart`), `lib/basics/buffers/` (`accumulationTable`, `bufferLane`)
- Parameter checks: chute drop at most 40 % of its length (about 22°); table openings no wider than the radius
- Tests `tests/components/transport-buffers.test.js` (7):
  - categories
  - chute ports, and every roller top on the line from input to output
  - turntable: a quarter turn brings the section's outfeed exactly to `toRear`, minus a quarter to `toFront`
  - AGV deck at belt height; light colours
  - table disc at belt height, nothing of the rail in either opening, ring travel
  - lane slot ports; each stop rising 4 cm above the rollers or 3 cm below, between its slot and the next
  - the `transfer` op on the lane and the chute

**My mistakes this step (fixed before the results above):**
- the table's centre cone stood above the footprint height; rail posts could land in an opening when the openings were wide; the rail ends reached 2 mm into the openings
- two AGV strips stood 1 mm proud of the footprint
- my category test forgot `flowRack`

**Results**
- `npm test`: 48 files, **1924 tests passed**
- golden images for the 5 parts

**Basic level so far:** 6 frames, 3 axes, 9 tools (6 new + 3 reused), 3 transport, 3 buffers (2 new + `flowRack`).

**Next:** step 6.4: **`composite`** equipment in the IR and compiler. A machine put together from basic blocks: a frame, axes and a tool, each mounted on a named mount point of the one before. Its motions come out under one id (e.g. `head.travel`, `head.extend`), so ops drive a composite like any catalog machine. Checked like a component (footprint from its parts, nothing floating), compiled into readable `build()` code.

### Step 6.4: composite equipment (approved)

Step 6.3 approved by the owner (2026-11-24: "ok").

**Result first:** a machine the catalog doesn't have can now be written in `factory.json` as a **composite**: a list of parts (basic frames, axes, tools, or any catalog component), each mounted on a mount point of an earlier part. A one-station dosing line with a composite doser (portal frame, hung linear axis across the belt, vertical slide, dispensing nozzle), driven by plain `move` ops:
- passes the full check, with the timing table counting the composite's moves
- compiles to a readable `registry.buildComponent('composite', { parts: [...] })`
- plays: the nozzle comes down 0.2 m over each can, doses and goes back up, three cans through

`screenshots/composite-doser.png` (`#/twin?demo=line&line=composite-doser`) shows it in the twin.

**How it works:** `composite` is registered as one more component (`lib/basics/composite.js`) whose params are the parts list. So the line, the dry plans, the timing table, the compiler and the gallery handle it with **no change**; the IR is just `{ "type": "composite", "params": { "parts": [...] } }`.
- **Mounting** (the basic-block conventions of 6.1–6.2): `on: "part.anchor"` hangs a part from that mount point; a tool goes there by its mounting face, anything else by its origin; `position` / `rotationY` offset and turn it. A part without `on` stands on the composite's floor.
- **Names** offered:
  - motions `<part><Motion>` (`lift` + `extend` → `liftExtend`)
  - ports `<part><Port>`
  - mount points `<part><Anchor>`, plus each part's own origin under the part's name (a tool's tool point)
  - short aliases the composite declares: `motions: { lower: "lift.extend" }`, `anchors: { tool: "nozzle" }`, `ports: { input: "bed.input" }`
  - **a motion's short name replaces its part name**, so every motion has one name and one state (ops planning one motion under two names would lose track of it)
- **Footprint and port places are measured**, not typed in: the composite is built once headless (cached per params and belt height) and its bounds taken at the default pose and with every motion at each end of its range.
- **Checks**, each message naming the part:
  - unknown type
  - `on` pointing at a later or missing part, or at a mount point the host doesn't have (the message lists the ones it has)
  - a part id used twice; a composite inside a composite
  - an alias to a missing motion / port / mount point; a motion with two short names; a name offered twice
  - a part's own params out of range

**Changed**
- `lib/basics/composite.js`. The gallery example is a dosing head on a portal.
- `spec/factory.schema.js`: the equipment `type` description explains `composite` (for the agents' Structured Outputs later); `spec/factory.schema.json` regenerated
- **Rule 6 test:** `composite` and `genericMachine` are allowed by name everywhere. They are IR keywords (Claude.md §6.5), registered as components so everything plays them; catalog components stay confined to `lib/components/**` and `lib/basics/**`.
- **Golden script fix:** a gallery page that shows a build error instead of the component now fails its shot. The gallery logs the error, `scripts/golden.js` checks for it. Before, the first composite golden (taken while the example was still broken) was written and reported as fine.
- `app/dev/lines/composite-doser.json`: the dev line (portal raised to 2.1 m so the nozzle clears a 0.33 m can)
- Tests `tests/components/composite.test.js` (7):
  - names and the alias replacing the part name
  - mounting: the nozzle's mounting face on the ram's mount point, tool point height worked out by hand
  - lowering and the turned axis moving the tool along −Z; an alias driving the stream
  - the footprint holding the parts at motion extremes
  - eight refusals with their messages
  - the factory: check and timing (4.6 s process), compile, play

**My mistakes this step (fixed before the results above):**
- the "unknown type" check called `registry.getComponent`, which throws its own message, so the part was never named
- zod 4 doesn't parse default values: the gallery example's parts lacked `position` / `rotationY` and failed to build (caught by the registry spec test and the broken golden)
- my first composite test expected an alias and its part name to share one state; that wart led to the alias replacing the name
- the dev line's first portal height put the nozzle's home point inside the can

**Results**
- `npm test`: 49 files, **1949 tests passed**
- `npm run schema`, `npm run compile` (both example lines unchanged)
- golden image `composite` (re-rendered after the fix); `screenshots/composite-doser.png`

**Next:** step 6.5: **`genericMachine`**, the fallback for a machine nobody can build yet. An enclosure with the right footprint, ports and timing, a sign with its name and a stack light, so the line still runs, and a flag for the reviewer (Phase 7).

### Step 6.5: `genericMachine`, the placeholder (approved)

Step 6.4 approved by the owner (2026-11-24: "ok").

**Result first:** a machine nobody can build yet is written as a **`genericMachine`**, and the line still runs. In a one-station marking line, a placeholder "Laser marker":
- passes the full check, and `checkFactory` lists it as a **warning** (new): `station "mark": "marker" is a placeholder for "Laser marker" (genericMachine); replace it with a catalog machine or a composite`
- its 6 s (op `operate`) is in the timing table
- it compiles and plays: three cans pass through it, it shows "run" for 3 × 6 s with its progress bar filling, then goes idle

`screenshots/generic-marker.png` (`#/twin?demo=line&line=generic-marker`): the conveyor through the enclosure, a can inside, sign "LASER MARKER · PLACEHOLDER · fiber laser, 20 W", hazard trim, green lamp, progress bar.

**Changed**
- **`lib/basics/genericMachine.js`** (category `machine`):
  - params: `name` and `note` (on its sign), `length` / `depth` / `height`, `passThrough`, `carries`
  - pass-through: the basic `enclosureFrame` as housing, with ports `input` / `work` / `output` at belt height
  - cabinet beside the line: one `work` port on its front face
  - looks unmistakably like a stand-in: a roof sign with the name over PLACEHOLDER (both sides), a hazard-stripe band, a three-lamp tower on the roof, a progress bar on the front
  - motions `state` (idle / run / wait / alarm) and `progress` (0–1)
- **Op `operate`** (`lib/ops/named/operate.js`): a machine works for a fixed time. State run, progress filling, then idle. Generic: any machine with `state` (run, idle) and `progress`. Refused otherwise: `machine "belt" has no motion "state"`.
- **`checkFactory` returns `warnings`** (`factoryWarnings` in `compiler/expand.js`): every placeholder with its path and what it stands for. Empty when there are none or the check failed. The Phase 7 reviewer will read it.
- `spec/factory.schema.json` regenerated; `app/dev/lines/generic-marker.json` (dev line)
- Tests `tests/components/generic-machine.test.js` (6):
  - pass-through ports, and nothing standing in a 0.5 × 0.4 m passage through the machine
  - the cabinet's front port
  - lamps per state, the progress bar's width, the sign
  - `operate`: exact duration, refusal
  - the line: warning, timing, compile, play (18 s running, progress to the end, idle at the end)

**My mistakes this step (fixed before testing):**
- the hazard bands and progress panel first stood a few millimetres off the glass and cabinet faces (they would have floated); they now sit on the outer faces

**Results**
- `npm test`: 50 files, **1973 tests passed**
- golden image `genericMachine`; `screenshots/generic-marker.png`; `npm run schema`, `npm run compile` (example lines unchanged)

**How a machine gets into a line now**, best first:
1. a **catalog** component (named, tuned)
2. a **composite** of basic blocks (6.4)
3. a **genericMachine** placeholder, reported as a warning (6.5)

So nothing fails outright for lack of a machine (Claude.md §6.6.5).

**Next:** step 6.6: **graph shapes** in `layout.js` and `Line.js`. Today a line must be a chain (layout refuses branches). To add:
- a **reject branch** (an extra output to a side lane)
- a **merge** (two stations feeding one)
- **parallel** copies of a slow station
- **buffers** between stations

I'll propose the IR and layout rules first, as it touches the line runtime both example lines depend on.

### Step 6.6: graph shapes (approved)

Step 6.5 approved by the owner (2026-11-24: "ok"). I had said I'd propose the rules first because this touches the runtime both reference lines run on. Under the "don't wait" rule I went ahead, holding to one constraint: **a plain chain must behave exactly as before**. It does:
- every step-for-step reference timing test of the printer and lubricant lines passes unchanged
- both compiled lines are byte-for-byte the same

**Result first:** a line is no longer only a chain. One dev line (`#/twin?demo=line&line=graph-shapes`, `screenshots/graph-shapes.png`) has:
- two loading belts merging into one place, the second as a feeder in a side lane
- a buffered transfer (3 units)
- a slow composite doser as two parallel copies
- the placeholder laser marker at the end

It is checked, compiled (6 files, one per copy) and played: 8 cans released through both loaders, shared between the two copies, all 8 out.

**Rules** (in `lib/line/layout.js` and `lib/line/Line.js`):

| Shape | Written as | Plays as | Laid out as |
|---|---|---|---|
| parallel copies | station `parallel: n` → `<id>1 … <id>n` (`copyOf`), every edge to or from it repeated per copy | each unit to the first copy with room, taking turns | side by side across Z, centred where one station would stand |
| fan-out | several edges from one output port | first edge with room, taking turns | (edges) |
| merge (fan-in) | several edges into one input port | the unit that has waited longest goes first | (edges) |
| reject branch | an edge from a side output port (a reject lane) to a station | the station holds if that port is busy (new: before, a connected extra port was never checked) | side lane on the port's side, the two ports at the same X |
| feeder | a second station nothing feeds, into a station's input | a second source: the run is released through all sources together | side lane, its output one transfer length upstream |
| buffer | edge `transport.capacity: n` | up to n units queued along the transfer a pitch apart, each moving with the trapezoid to its place | (the transfer) |

- **Main path:** starts at the first station nothing feeds and follows `output` ports. It is laid out as before; side lanes go to the equipment side (−Z) unless the joined port is on +Z, further out if a lane is taken.
- **Transfers between ports not in line** run straight from port to port, at an angle.
- **Loops** (rework back upstream) are refused: they can block the line.
- **Dry timing:**
  - the takt comes from the main path, where parallel copies divide their station's time (bottleneck shows `copies`)
  - stations off the main path (feeders, rework) see only part of the flow and don't set the takt
  - lead time: one copy per place, one transfer per join

**Changed**
- `lib/line/layout.js`: graph checks (unknown stations, self-feed, loops, separate parts); main path; copies; side lanes with clash avoidance; per-edge transfers (`edge`, `angle`, `inLine`)
- `lib/line/Line.js`: transfers for every edge (angled conveyors); fan-out / fan-in wiring; buffers (`capacity`, queue, retargeting as the head leaves); several sources sharing the run; station depth and group passed to the layout; a line clock for "waited longest"
- `lib/station/StationCycle.js`: holds (`Holding · <port> busy`) when a connected extra output has no room
- `compiler/timing.js`: station depths and groups, edge-indexed transfers, the takt rules above
- `compiler/expand.js`: `parallel` expanded into copies with their edges; a copy id that clashes with a station id is refused
- `compiler/emit.js`: a copy is compiled from its written station (bug found by the new test)
- `spec/factory.schema.js`: station `parallel` (2–6), edge `transport.capacity` (1–20, not with `direct`); `spec/factory.schema.json` regenerated
- `lib/line/lineSpec.js`: transport `capacity`
- `app/dev/lines/graph-shapes.json` (dev line)
- **Tests** (`tests/line/graph.test.js`, 10):
  - layout: copies across Z with angled transfers; reject branch in a side lane at the port's X; feeder upstream and a second side station in the next lane; a chain exactly as before
  - playing:
    - copies share the work (3 + 3 units) and cut the run by more than 30 %
    - a reject branch (verdict by serial) sends units 2 and 4 to rework and 1 and 3 on
    - a merge of two sources releases the run through both
    - a buffer fills to 3, units rest a pitch apart, and the fast station upstream is done well earlier
  - timing: copies divide the takt; a slow feeder off the main path doesn't set it
  - factory.json: `parallel` and `capacity` checked, expanded, compiled, played; clashing copy id refused
- `tests/line/line.test.js`: the old "branches are refused" test now checks what is still refused (loops, including a rework loop)

**Limits (honest):**
- **Transfers can cross:** in the dev line, the feeder's transfer to the far copy crosses the main loader's transfer to the near copy. Crossing or overlapping transfers aren't detected yet; that belongs to the Phase 7 overlap checks.
- **Buffer motion:** queued units retarget when the head leaves (a fresh trapezoid from where each one is), not a continuous accumulation conveyor.
- **Merges of different unit types** (a station assembling a unit from two kinds of input) are not supported: a merge feeds one input port with one unit type.

**My mistakes this step (fixed before the results above):**
- my first graph tests used an 8 s "slow" station that wasn't slow next to the fixtures' station overheads, and a buffer the rates never filled
- the reject transfer in my test had no `from`; the port type check then caught my roller lane carrying `unit` on a pallet line (a good refusal)
- the first feeder rule put the feeder level with the input, so its transfer ran through the station's infeed (seen in the screenshot)
- one test expected the doser copies to be the bottleneck; with the doser's time shared, the marker is slower

**Results**
- `npm test`: 51 files, **1983 tests passed**
- `npm run compile`: both example lines unchanged; `npm run schema` regenerated
- `screenshots/graph-shapes.png`

**Next:** step 6.7: products. A **parametric** product (box, cylinder, bottle or tray shapes with dimensions, stages as visual changes: filled, capped, labelled), and a **GLB** product (the owner's model with grasp points marked as refs), so a line can carry products that aren't in the catalog.

### Step 6.7: products not in the catalog, parametric and GLB (approved)

Step 6.6 approved by the owner (2026-11-24: "ok").

**Result first:** a line can carry a product the catalog doesn't have.
- **Parametric:** `product: { kind: "parametric", params: { shape: "bottle", … } }`. A box, cylinder, bottle or tray of any size, finish and colour, with stages raw → processed → filled → capped → labelled.
- **GLB:** `product: { kind: "glb", file: "…glb", params: { grasp: [x, y, z] } }`. The owner's own model, rested on its base, with the grasp point they mark.

`screenshots/bottle-doser.png` (`#/twin?demo=line&line=bottle-doser`) shows a parametric glass bottle on the composite doser of 6.4: the nozzle's stream in its neck, the juice rising (its `fill` routine), then its label laid round it.

**Changed**
- **`lib/products/parametric/index.js`** (type `parametric`):
  - params: shape, length / width / height, finish (plastic, glass, metal, cardboard), colour, an optional processed colour (none: processing leaves the colour), liquid colour, fill level, cap colour, label text, serial (shown on the label)
  - stages each include the ones before
  - refs: `grasp`, `top` (on the cap once capped), `base`, `neckTop`, `capSeat`, `liquidSurface` (live), `labelSpot`
  - features: `cap`, `label`
  - routines: `fill`, `process` (colour blending), `label` (laid on from one edge)
  - so the existing ops' product roles work on it unchanged (`fill`, `cap`, `runRoutine`, picks by grasp / top)
  - a round product's label is **wrapped** (a band of the cylinder, drawn segment by segment as it is laid on); a box's or tray's is flat
- **`lib/products/model/index.js`** (type `model`):
  - the owner's GLB with `scale` and `turn`, rested on its base and centred
  - `grasp` as marked (default: the middle of its top); `top`, `base`, `labelSpot` from its bounds
  - stages raw → processed (its **own copies** of the model's materials tinted; the cached model and other units keep theirs) → labelled
  - routines `process`, `label`; feature `label`
- **Sample model:** `lib/assets/sampleCrate.glb` (6 KB crate with a lid and grip slots), written by `scripts/make-sample-glb.mjs`. No dependency: three.js geometry, glTF 2.0 binary written by hand. It exercises the import path without a user's file.
- **Product assets:**
  - registry products may declare `assets` (a list, or a function of their params); `buildProduct` refuses an unloaded file and says how to load it
  - `preloadComponentAssets(registry, types, products)` also loads every product's assets at its defaults and those of the products given
  - the twin page and compiled lines preload the line's product
- **IR:** `product.kind` `parametric` / `glb`; `compiler/expand.js` maps them to the two product types and **checks the product's params at expand** (errors at `product.params.<field>`); `spec/factory.schema.json` regenerated
- **Tests:**
  - **new generic product checks** `tests/products/all-products.test.js` (33), for every product, as for components: every stage builds with every object named and no NaN, of a sensible size; every ref finite; every feature value; dispose. Products ride at belt height, so parts may reach below their origin (the printer's carrier skirt does, which my first version of the check flagged wrongly).
  - `tests/products/generic-products.test.js` (8):
    - the four shapes to size, standing on their base
    - stages cumulative, no recolour unless asked
    - the fill routine raising the live liquid surface; cap / label features; the wrapped label drawn half / whole
    - the GLB rested and centred; grasp default and marked; turn and scale
    - processed tint on its own materials only; refused before its file is loaded
    - a parametric bottle in a line, filled and labelled by routine steps
    - a GLB product checked; a bad param at `product.params.scale`; its missing `fill` routine reported by the dry plan
- Golden images: `parametric-*` (5 stages), `model-*` (3 stages); dev line `app/dev/lines/bottle-doser.json`

**My mistakes this step (fixed before the results above):**
- the bottle's first label was a flat card standing out from the round body, and the default processed colour turned every glass bottle blue at "filled" (both seen in the golden images)
- my GLB test looked for the mesh by its glTF name; the loader sanitises names ("Crate_body")
- the generic product check first demanded nothing below the origin

**Results**
- `npm test`: 53 files, **2024 tests passed**
- `npm run schema`; `npm run compile` (both example lines unchanged)
- golden images (8); `screenshots/bottle-doser.png`

**Next:** step 6.8, the last of Phase 6: a **test line built only from the generic level**:
- basic blocks, composites, a placeholder where nothing fits
- graph shapes (a reject branch or parallel copies, a buffer)
- a parametric or GLB product

Written as `factory.json`, checked, compiled, played and screenshot, to show the level holds together beyond the two reference lines. Then the Phase 6 wrap-up.

### Step 6.8: a test line from the generic level only (approved)

Step 6.7 approved by the owner (2026-11-24: "ok").

**Result first:** `spec/examples/bottling-line.factory.json` is a juice bottling line whose machines all come from the generic level. Its conveyors are the catalog belt, its reject lane the catalog roller lane.

| Station | Built from |
|---|---|
| Filling ×2 (`parallel: 2`) | composite doser: portal frame + hung linear axis + vertical slide + dispensing nozzle; the bottle's `fill` routine |
| *buffer* | edge capacity 3 (each copy's) |
| Capping | composite capper: cantilever frame + vertical slide + hung rotary wrist + finger chuck; cap set on, wrist turns 3 times |
| Inspection | composite vision: cantilever frame + vision camera; `decide` on the bottle's quality (`planAs: pass`); rejects over a roller lane |
| Rework (reject branch, side lane) | placeholder "Rework bench" |
| Case packing | placeholder "Case packer" |

The product is a parametric glass bottle (0.09 × 0.26 m) whose quality fails for every 4th serial: deterministic, never random.

It runs end to end:
- checked, with both placeholders listed as warnings
- compiled to `generated/bottling-line/` (7 files, takt 10.48 s: the two fillers share the slowest work)
- a run of 10: each filler takes 5; every bottle reaches its end filled (0.85) and capped; serials 4 and 8 go to rework, the other 8 to packing
- screenshots: `screenshots/bottling-line.png` (the whole line at 60 s) and `screenshots/bottling-inspect.png` (capping, inspection, the reject lane to the rework bench)

**Found and fixed on the way (both real bugs):**
1. **Serials repeated with two sources:** each source station numbered its own units, so both fillers made 1–5 (rework received serial 4 twice). A line now gives all its sources one numbering (`serialSource`). With one source the serials are as before (all reference tests unchanged). Pinned in the merge test.
2. **A composite inherited the gallery example's short names:** a camera composite without `anchors` got `tool: nozzle` from the gallery example and was refused. Only `parts` defaults to the example now; short names default to none.

**Changed**
- `spec/examples/bottling-line.factory.json` (written by `scripts/make-bottling-line.mjs`); `generated/bottling-line/` (`npm run compile` compiles every example)
- parametric product: fact `quality` (pass / reject), param `rejectEvery` (every Nth serial fails; 0: none)
- `lib/station/StationCycle.js` `nextSerial` / `serialSource`; `lib/line/Line.js` shared numbering for sources
- `lib/basics/composite.js`: example aliases removed from the defaults
- Tests `tests/spec/bottling-line.test.js` (4):
  - no tuned catalog machine, and every composite part a basic block
  - the check: warnings, main path and side lane, takt from the shared filling
  - the compiled files on disk = the compiler's output
  - the run of 10 (fillers 5 + 5, filled and capped, 4 and 8 to rework)
- `tests/line/graph.test.js`: serials unique across two sources

**My mistakes this step (fixed before the results above):**
- the inspection's camera first stood 0.5 m upstream of the work place (I moved it to clear the reject lane, which never needed it)
- I first left the inspection's verdict unplanned, so the dry plan couldn't place the bottle for the output; `planAs: 'pass'` plans the usual path, as station 3 of the lubricant line does

**Results**
- `npm test`: 54 files, **2028 tests passed**
- `npm run compile`: three example lines (bottling new; lubricant and printer unchanged)

## Phase 6 status: done

The generic level of Claude.md §6.6 is in place and holds together in a line that uses nothing tuned:

| Piece | What |
|---|---|
| basic building blocks | 6 frames, 3 axes, 9 tools (6 new + gripper, vacuum pad, screwdriver), 3 transport, 3 buffers (2 new + `flowRack`), each with mount points for the next |
| `composite` | machines put together from them in factory.json, measured footprint, motions / ports / mount points by part, short names |
| `genericMachine` + `operate` | the placeholder, reported as a warning by `checkFactory` |
| graph shapes | parallel copies, fan-out / fan-in, merges of sources, reject branches to a station, buffers; side-lane layout; takt rules |
| products | parametric (shape, size, finish, stages, deterministic quality) and GLB (the owner's model, marked grasp point) |

Throughout, both reference lines stayed exact: step-for-step timing, compiled files byte-for-byte.

**Open for later phases:**
- crossing / overlapping transfers aren't detected (Phase 7 overlap checks)
- buffers move queued units in steps, not as continuous accumulation
- merges carry one unit type (no two-input assembly)
- the rule-6 wording in Claude.md (`lib/basics/**`, the IR keywords `composite` / `genericMachine`) waits for the owner

**Next:** Phase 7, the deterministic reviewer. All Claude.md §7.3 checks, run from a CLI and the API, with clear messages:
- schema; types and ops in the catalog; op ↔ machine
- footprint overlaps (including the crossing transfers above); ports and flow types along edges
- reach of robots and gantries; cycle time against the takt target
- compiled files import and build headless

I'll propose how to split it before starting.

## Phase 7: Deterministic reviewer

Phase 6 approved by the owner moving on (2026-11-24: "next").

**Split** (proposed 2026-11-24; started on 7.1 under the "don't wait" rule):

| Step | Content |
|---|---|
| 7.1 | Reviewer core: findings `{ check, severity, path, message, hint }`; schema, catalog, ops (every station on its own), graph, placeholders, takt target, op ↔ machine support; CLI `npm run review` |
| 7.2 | Geometry: footprint overlaps within a station, between stations, transfers crossing stations or each other; mount rules so machines meant to sit over a conveyor aren't flagged; no false positives on the three example lines |
| 7.3 | Edges and reach: port directions and flow types statically along each edge; robot and gantry reach against the points their ops aim at |
| 7.4 | Compiled files imported and built headless; the first `/api/review` route (a small Vite dev plugin) |

### Step 7.1: reviewer core (approved)

**Result first:** `npm run review` reviews factory.json files and lists **every** problem it can find, each with its check, its path in the file, a clear message and, where it helps, a hint. Exit code 1 if any file has an error; `--json` for machines (the Builder in Phase 8).
- **The three example lines:** printer and lubricant clean; bottling ok with its two placeholders as warnings
- **On broken copies of the bottling line** (tests), for example:
  - `✗ [ops] stations[1].process[0]: station "cap": process › op #1 (move): machine "capper".lower must stay in [0, 0.25], got 0.9`, hint `capper.lower reaches [0, 0.25]: aim inside it, or give the machine a longer stroke / reach`
  - `✗ [catalog] stations[1].equipment[0].type: unknown component type "warpBelt"`, hint: see the catalog, or build it as a composite, or stand in a genericMachine
  - `! [takt] line.taktTarget: takt 10.48 s misses the target 5 s: the bottleneck is station "…"`, hint: shorten its steps by …, or run it as N parallel copies (`parallel: N`)

**How it differs from `checkFactory`** (which stops at the first problem, often with the path "(compile)"):
- **schema:** all issues at once, with paths
- **catalog:** each equipment type, its params, shell, product, transport type and op name checked on its own, at its exact path. Zod issues are shown as "field: message", not raw JSON.
- **ops:** **every station planned on its own**, so two bad stations give two errors. The plan's "process › op #1 › case "reject" › op #2" is turned into the JSON path `stations[i].process[0].cases.reject[1]`.
- **graph:** the whole line (edges, ports, layout) once the stations are fine, at `(line)` when it names no field
- **placeholder:** genericMachine stand-ins (warnings)
- **takt:** against the new optional `line.taktTarget`. A miss is a warning (the line still plays) naming the bottleneck, with how much to shorten it or how many parallel copies would make it; a met target is a note.
- **opSupport:** an op that needs its machine to declare it (`fill`, `cap`) on a machine that doesn't, a warning

**Changed**
- `agents/reviewer/deterministic.js`: `review(registry, factory)` → `{ ok, findings, counts, timing? }`; `formatFindings`; `stationOps` (every op of a station with its path: decide cases, indexing index / exit / work); `opPathFromMessage`
- `scripts/review.mjs` (`npm run review [files…] [--json]`; from PowerShell call `node` directly)
- `spec/factory.schema.js`: `line.taktTarget` (optional, seconds per unit); `spec/factory.schema.json` regenerated
- Tests `tests/agents/reviewer.test.js` (8):
  - the example lines (printer and lubricant without findings)
  - schema (two issues at once)
  - catalog (four problems, four paths, hint, readable params message)
  - ops (two stations, two errors, one inside a decide case, the range hint)
  - graph (a loop at `(line)`)
  - takt (miss with bottleneck and copies; met as a note; a miss is not an error)
  - opSupport (`fill` on a composite)
  - helpers (paths from messages, indexing ops walked, the formatted summary)

**My mistakes this step (fixed before the results above):**
- passing `beltHeight: undefined` overrode the default belt height (NaN footprints, 2 false errors on the printer line)
- I walked the indexing station's `work` as an object; it is a list of `{ at, ops }` (the lubricant line failed)

**Results**
- `npm test`: 55 files, **2036 tests passed**
- `npm run review`: bottling ok (2 warnings), lubricant ok, printer ok

**Next:** step 7.2, geometry:
- footprints (placed and turned) overlapping within a station or between stations
- transfer conveyors crossing stations or each other (the crossing seen in step 6.6's dev line)

Mount rules keep the deliberate overlaps quiet: a tunnel or portal over its conveyor, a tool on its machine, a sensor on a belt frame. The three example lines must come out clean without exceptions written for them.

### Step 7.2: geometry, clashes between equipment, stations and transfers (approved)

Step 7.1 approved by the owner moving on (2026-11-24: "continue working, phase 7 step 7.2").

**Result first:** `npm run review` now builds every line headless and tests the solid parts of every two pieces of equipment against each other: within a station, between stations, and the transfer conveyors.

| Line | Geometry findings |
|---|---|
| bottling | none |
| lubricant | 1 warning: `canTransfer`'s `pusherB` stand and `packing`'s case rack step beam (65 mm to clear, between two stations) |
| printer | 17 warnings, all real clips the reference already had (it still plays: no errors) |

A transfer running through equipment or another transfer is an **error**. Two machines going into each other is a **warning** with both ids, the two parts and how far one must move, e.g.
`! [geometry] stations[1].equipment[1]: station "st2": "sign" (stationSign) and "presenter" (workTable) overlap (Sign post × Table top, 240 mm to clear)`

**Why meshes, not footprints (a change from the plan):** a footprint is an envelope (a fence's whole run, a portal gantry's span over its belt, a robot's working area). Tested as boxes, the footprints on the three example lines overlap **about 300 times**, nearly all on purpose. The meshes are what is really there. Each mesh is an oriented box (its geometry's bounds in its own frame). Two parts clash when they would have to move more than 2 cm apart to clear each other (separating-axis test), so parts that only touch are fine. This is the "Box3 in Node" of Claude.md §7.3.

**Overlaps that are meant**, told apart by the data, never by a component's name (rule 6):
- `tool` parts ride on a robot: not tested here (reach comes in 7.3)
- `overConveyor` / `besideConveyor` parts may overlap any conveyor or transport (a tunnel round its belt, a lift inside its conveyor, a diverter)
- `surface` parts may overlap the component under their origin (a tote on its table, guide rails on a belt)
- two components meet where one's in / out port lies on the other (an erector putting cases onto the carton line, a case source's chute over the belt tail)
- a transfer meets the machines of the two ports its edge joins, and the transfers that share an end with it (a fan-in)

No exceptions for the example lines: with these rules, bottling went from 6 hits to 0 and lubricant from 17 to 1.

**The 17 printer-line clips:** I checked the deepest ones in the existing screenshots and they are really there. The two white sign posts go through the ST2 presenter table next to the feeder bowls (`screenshots/printer-st2.png`), and the ST3 gantry post stands inside the tester cabinet (`printer-st3-test.png`). They come from the reference positions (shell furniture: sign, fence, lifts; and the stations' own equipment). Fixing them means moving things away from the reference, so the pixel comparison and the byte-for-byte compiled files would change. **I left them for you to decide** (see the question below).

**Paths** point into factory.json: equipment at `stations[i].equipment[j]` (a shell's furniture at `stations[i].shell`), a parallel copy's equipment at the station written once, and a repeated edge at the edge written once.

**Changed**
- `agents/reviewer/geometry.js` (new): `solidsOf` (visible meshes as oriented boxes; carried products left out), `penetration` (separating-axis distance to clear), `deepestClash`, `lineComponents`, `geometryFindings`, `reviewGeometry` (builds the line headless from the expanded factory, maps paths). A line that doesn't build headless is an error. If a GLB model isn't loaded, that's a note, not an error.
- `agents/reviewer/deterministic.js`: the `geometry` check after the graph check; `review(registry, data, { geometry: false })` skips it (the fast checks only)
- `scripts/review.mjs`: preloads the GLB models (the ABB in the lubricant line) before reviewing
- Tests:
  - `tests/agents/reviewer-geometry.test.js` (8):
    - penetration: touching, apart, a post through a table top, turned boxes whose bounds overlap but which don't touch
    - the example lines
    - the printer line's clips as warnings, at the station's own equipment
    - two cappers in one place
    - a clash in a parallel station pointing at the station written once
    - a cabinet under the reject transfer: an error at `graph.edges[3]`
    - `geometry: false`
  - `tests/agents/reviewer.test.js`: the step-7.1 checks run with `geometry: false`; new test: an unloaded model gives a note

**Not covered yet**
- crossing transfers that share no end are detected by the same code (transfer × transfer gives an error), but no test builds one: the layout doesn't produce one from the example graphs
- moving parts are checked in their home pose only (a gantry's travel, a pusher's stroke). Sweeping their motion ranges belongs with reach in 7.3.
- converging transfers in a fan-in overlap near their shared end. That's allowed, but it is how the layout draws a merge, not a modelled merge.

**Results**
- `npm test`: 56 files, **2045 tests passed**
- `npm run review` (~6 s for the three lines): bottling ok (2 placeholder warnings), lubricant ok (1 geometry warning), printer ok (17 geometry warnings)

**Question for you:** fix the 17 printer-line clips (move the sign, fence and the clashing equipment a few cm to tens of cm, then re-record the screenshots against the reference), or keep the line as a faithful copy of the reference and let the reviewer report them?

**Next:** step 7.3, edges and reach: port directions and flow types checked statically along each edge; robot and gantry reach against the points their ops aim at (and, from this step, their motion sweep).

### Step 7.3: edges and reach (approved)

Step 7.2 approved by the owner moving on (2026-11-24: "onto the next step"). The question about the 17 printer-line clips went unanswered, so they stay as in the reference and the reviewer reports them as warnings (the default I gave).

**Result first:** two new checks. With them, every check in Claude.md §7.3 runs except "compiled files import and build headless" (7.4).

**`edges`** (static; each edge checked against the ports it joins, all problems at once):
- ports exist (`station "cap" has no port "side"`, hint: its ports)
- runs output → input (`"canTransfer.output" is an output, not an input`)
- the same flow type at both ends (`"canTransfer.output" gives batch but "palletizing.input" takes case`, hint: a station between them that turns batch into case)
- the edge's own `carries`; the transport carries it (`transport "beltConveyor" carries batch, not case`)

Each finding sits at its field (`graph.edges[2].transport.type`). Before, only `Line.js` checked these, while building the line, and it stopped at the first one. The whole-line graph check now runs only once the edges are fine.

**`play`** (reach): the line plays its run headless, with fixed 0.05 s steps.

Why play: named ops aim robots and gantries at points worked out only when their step starts (a part's seat, a screw hole, a pallet slot). The dry plan checks every value an op writes, but not those. I looked for a static way and there isn't one: the points depend on where the product stands at that moment.
- **a station in ALARM** is an error at the op it came from. For example, with the ST2 gantry moved 1.5 m away:
  `✗ [play] stations[1].process[1]: station "st2" stopped in ALARM at 61.1 s of the run (unit 2 of 8 released): step "Moving to Z motor assy": machine "gantry" cannot reach x = 1.88 (range [-0.75, 0.75])`
  hint: `move the machine closer to it (equipment position), or pick one with a longer x (reaches [-0.75, 0.75])`.
  The op is found from the step label: an op's own `label`, or a named op's `name` (named ops label their steps from it).
- **a run that does not finish** within 2 × the estimate + 120 s is an error naming the stations still holding units; **units lost** is an error
- **a run that finishes** is a note: `played a run of 10: every unit left the line after 140.3 s (estimated 148.6 s)`

All three example lines play to the end with no alarm:

| Line | Units | Played | Estimate |
|---|---|---|---|
| bottling | 10 | 140.3 s | 148.6 s |
| lubricant | 27 | 964.7 s | 911.5 s |
| printer | 8 | 771.4 s | 813.5 s |

**Changed**
- `agents/reviewer/deterministic.js`: `edgeFindings` and the `edges` check; the `play` check; `review(…, { geometry, play })` (each `false` skips it)
- `agents/reviewer/play.js` (new): `reviewPlay`, `opOfStep`
- `scripts/review.mjs`: `--no-play` (the full review of the three examples takes about 33 s, 6 s without playing)
- Tests:
  - `tests/agents/reviewer-run.test.js` (6):
    - four edge problems at once, each at its field
    - an unknown port with the ports listed
    - the examples without edge findings
    - the bottling run as a note
    - the moved gantry: no dry-plan error, an ALARM error at `stations[1].process[1]`
    - a run cut short: an error naming where units are held
  - `reviewer.test.js` and `reviewer-geometry.test.js` skip playing (each check has its own file); the unloaded-model test expects a note from both geometry and play

**Not covered**
- The run-not-finished test cuts the time limit short. I have no example of a real stall that passes every earlier check, because the graph and edge checks catch the usual causes first.
- Moving parts are checked for reach (where they go), not for clashes along the way. Sampling the geometry while the line plays would multiply the review time, so I left it out.
- Mapping a failed step to its op uses the step label. A named op without a `name`, whose steps carry their own labels, points at the station instead.

**Results**
- `npm test`: 57 files, **2051 tests passed**
- `npm run review`: bottling ok (2 placeholder warnings, run played), lubricant ok (1 geometry warning, run played), printer ok (17 geometry warnings, run played)

**Next:** step 7.4, compiled files (`generated/<line>/`) imported and built headless, and the first `/api/review` route (a small Vite dev plugin).

### Step 7.3b: the reviewer's warnings fixed on the example lines (approved)

Step 7.3 approved; the owner asked to "fix any warnings" (2026-11-24). That also answers the 7.2 question about the printer-line clips: fix them.

**Result first:** `npm run review` shows printer **0 warnings** (was 17) and lubricant **0 warnings** (was 1). Both still play their runs to the end in exactly the same times (771.4 s and 964.7 s). The timing tables still match the reference step for step.

The bottling line keeps its **2 placeholder warnings** (rework bench, case packer). Those are deliberate: step 6.8 built that line to show a line running with `genericMachine` stand-ins, and Claude.md §6.6.5 says the reviewer reports them. See the question below.

**What moved** (factory.json only; no component, shell or code changed):

| Station | Clash | Fix |
|---|---|---|
| printer ST1 | fence and sign posts through the flow rack | `minZ` −2.35 → −2.7 (fence and sign behind the rack) |
| | input lift column through the frame nest | frame nest 4 cm back (its pick light with it) |
| | tote table and part cradle tops overlapping | cradle 6 cm left |
| ST2 | fence and sign post through the presenter table | `minZ` −1.5 → −1.8 |
| | gantry post through the presenter table | table 0.42 m deep instead of 0.5 (the feeders stay in place) |
| ST3 | gantry post inside the tester cabinet | tester x −1.2 → −1.37 |
| ST4 | dock cylinder through the enclosure's rear panel | dock 18 cm back, stroke 0.37 → 0.46, docking to 0.456 instead of 0.366: the same contact point on the unit, same 0.55 s |
| | dock cable inside the equipment rack | rack x −0.3 → −0.48 |
| ST5 | fence through the reject lane's end | `minZ` −2.35 → −2.5 |
| | HMI through the scanner post | `panelX` −1.8 |
| ST6 | sign panel through the gantry's bridge beam; fence through its posts | `minZ` −3 → −3.5 |
| | output lift carriage against a gantry post | gantry 8 cm along +X |
| | carton line's rollers through the foam table's legs | foam table 0.5 m long at x 0.76 |
| | carton line's legs through the pallet | pallet and dispatch bay 12 cm back (z −2.27); gantry `spanZ` 2.55 → 2.75 so it still reaches the far slots |
| lubricant packing | can transfer's pusher stand through the case rack's beams | case rack 6 cm back (z −0.81) |

**The reviewer checked my fixes:** the play check caught two reach errors I introduced on the way, and I fixed both before the results above.
- the foam table first ended up 1 cm beyond the ST6 gantry's x reach (`cannot reach x = 0.71 (range [-0.7, 0.7])`)
- the pallet moved back put its far slots outside the gantry's z reach (`cannot reach z = -1.375`): hence the longer `spanZ`

**Visual comparison with the reference** (re-rendered with `npm run visual`, both lines): the picture moved away from the reference on purpose. The diff images show the red at the moved fences, signs and fixtures.
- printer: close-ups 5.2–8.6 % (were 3.5–4.4 %), line views 3.7 %, wide views 2.3 %
- lubricant: can-transfer views 8.0–8.1 % (were 6.2–6.4 %), station 2 9.0 % (was 8.3–8.4 %); the others unchanged
- limits raised to keep about one point of headroom, as before: printer close-up 9.5 %, line 4.5 %, wide 3 %; lubricant can transfer 9 %, station 2 10 %
- both write-ups (`benchmarks/results/*-visual.md`) list the fixes as a new known difference with the old and new numbers

**Changed**
- `spec/examples/printer-line.factory.json`, `spec/examples/lubricant-line.factory.json`; `generated/printer-line/st1–st6.js`, `generated/lubricant-line/packing.js` (recompiled)
- goldens and results: `tests/golden/lines/{printer,lubricant}-line/`, `benchmarks/results/*-visual.{json,md}`, `benchmarks/results/visual/`; limits in `benchmarks/expected/*-visual-limits.js`
- `tests/spec/printer-line.test.js`: the docked plug value (0.456) and the pallet's z (−2.27), with the reason
- `tests/agents/reviewer-geometry.test.js`: the three example lines clean. The sign-through-table case is now built by putting ST2 back as in the reference.

**Results**
- `npm test`: 57 files, **2051 tests passed**
- `npm run review`: printer ok, 0 warnings; lubricant ok, 0 warnings; bottling ok, 2 placeholder warnings

**Question for you:** should the bottling line's two placeholders become composites (a bench from a table frame; a case packer from a portal, axes and a gripper)? That clears its last warnings, but the examples would then have no placeholder line left, and placeholders are only tested on broken copies.

**Next:** step 7.4, compiled files imported and built headless, and the first `/api/review` route.

### Step 7.4: compiled files built headless, `/api/review` (approved)

Step 7.3b approved; the owner said to keep the bottling placeholders (2026-11-24: "no dont, continue next step").

**Result first:** every check in Claude.md §7.3's deterministic list now runs, from the CLI (`npm run review`) and from the API (`/api/review` on the dev server).

**`compiled`** (async, in the new `reviewAll`):
- the factory.json is compiled in memory and the files are written to `generated/_review/<line>-<hash>/` (git-ignored, removed after each check). That folder is one level deeper, so the copy is compiled with lib at `../../../lib`, as drafts are; the hash keeps two versions apart in the module cache.
- `line.js` is imported and `createLine()` builds the line headless
- the result is compared with the line built from the IR: same layout, same timing, every named object in the same place and shown or hidden alike. A difference is an error saying where (e.g. `scene object #473: …`).
- when the factory.json has compiled files on disk, a stale folder is a warning naming the files (`npm run compile`)
- results: printer 7 files, 2156 named objects; lubricant 5 files, 2120; bottling 7 files, 1052; all the same line as the IR, none stale

**A real compiler difference the check found:** the compiled bottling line built its stations in flow order (… pack, rework), the IR in the factory's order (… rework, pack). Positions were the same, but `Line` updates stations in list order, so the two could play differently. Only the printer line had been compared before (in `emit.test.js`), and there the two orders are the same. Fixed: `line.js` exports `stations` in the factory's order; the header table stays in flow order for readers. Recompiled. The printer and lubricant files change only in that comment line.

**`/api/review`** (`server/reviewApi.js`, a Vite dev plugin; no separate backend):
- `GET /api/review?file=spec/examples/x.factory.json`, or `POST /api/review` with `{ "factory": … }`
- options `play`, `geometry`, `compiled` (default on; `0` / `false` turns one off)
- answers `{ ok, counts, findings, takt, file? }`: 200 also when the line has errors (the review worked); 400 bad request (no factory, not JSON, a path outside the project, not a `.factory.json`); 404 missing file; 405 other methods; 413 body over 2 MB; 500 if the reviewer itself fails
- reviews run one at a time; the catalog, models and reviewer load once through the server's SSR module graph
- tried live on the dev server: the printer line, everything included, came back ok with 0 warnings in 39 s (the first call also loads the catalog and models); a broken POST lists its schema errors; `?file=../x.factory.json` gets 400. The app still loads normally (screenshot of the setup page).

**Changed**
- `agents/reviewer/compiled.js` (new): `reviewCompiled`, `sceneOf`, `firstDifference`
- `agents/reviewer/deterministic.js`: `reviewAll(registry, data, { compiled, root, importModule, source, …review options })`
- `compiler/emit.js`: `stations` in the factory's order; `generated/*/line.js` recompiled
- `server/reviewApi.js` (new): `handleReview`, `reviewApi()`; `vite.config.js` registers it
- `scripts/review.mjs`: uses `reviewAll` (imports through Vite SSR), `--no-compiled`
- `.gitignore`: `generated/_review/`
- Tests:
  - `tests/agents/reviewer-compiled.test.js` (6):
    - the three examples' files build the same line, and no folder is left behind
    - stale files on disk named
    - files that don't import / don't build: errors
    - a station moved in the built line: an error at that scene object
    - a refused factory.json is not compiled
    - `firstDifference`
  - `tests/server/review-api.test.js` (5): GET, POST with errors, seven bad requests, a failing reviewer, the plugin mounts only in dev

**Results**
- `npm test`: 59 files, **2062 tests passed**
- `npm run review`: printer ok (0 warnings), lubricant ok (0 warnings), bottling ok (2 placeholder warnings); every line plays and its compiled files build

## Phase 7 status: done

The deterministic reviewer of Claude.md §7.3 is complete:

| Check | What |
|---|---|
| schema, catalog | every issue at its path, all at once |
| ops | every station planned on its own; values in range |
| edges | ports exist, output → input, flow types, the edge's carries, the transport |
| graph | the whole line: layout, loops, one connected line |
| geometry | the line built headless, parts that go into each other (mesh boxes, mount and port rules for what is meant) |
| play | the run played headless: reach of targets worked out at run time, alarms, stalls |
| takt | against `line.taktTarget`, with the bottleneck and what would help |
| placeholder, opSupport | stand-ins, ops on machines not made for them |
| compiled | the files import, build headless and are the IR's line; none stale |

It runs from `npm run review` and `/api/review`. Findings are `{ check, severity, path, message, hint }`, the form the Builder (Phase 8) will read.

**Open:**
- moving parts are checked for reach, not for clashes along their path
- a real stall that passes every earlier check has no example

**Next:** Phase 8, the LLM layer and the Builder. It starts with a decision from Claude.md §13: which OpenAI model(s) to use and the budget caps. I'll propose the split of Phase 8 and ask that first.

## Phase 8: LLM layer and Builder

Phase 7 approved by the owner moving on (2026-11-24: "ok next").

**Decisions** (Claude.md §13, asked 2026-11-24):
- default model **gpt-5.4-nano** for every agent ($0.20 input / $1.25 output per 1M tokens, from OpenAI's announcement). Its cached-input price isn't in the announcement: **$0.02 assumed** (OpenAI's usual 10 %), to be checked on the pricing page.
- strong model **off** (`LLM_MODEL_STRONG=gpt-5.4-mini` set for later, `LLM_STRONG_ENABLED=false`)
- caps **$0.50 per session, $4.50 total** (the Claude.md defaults)
- reasoning effort `low` and 4000 max output tokens per call (new `.env` settings; reasoning tokens are billed as output)
- estimate: about $0.004 per Builder call and about $0.12 per line on nano (about 35 lines on the $4.50)

**Split** (proposed 2026-11-24; started on 8.1 under the "don't wait" rule):

| Step | Content |
|---|---|
| 8.1 | `agents/llm.js`: client, budget guard, response cache, mock mode, ledger; `/api/llm/status`; the setup page's chips from it |
| 8.2 | `lib/catalog.js`: registry → `catalog.json` for the agents, under ~4k tokens (measured) |
| 8.3 | Builder schemas: one Structured Outputs schema per phase (layout → machines → process), strict-mode compatible |
| 8.4 | `agents/builder.js`: one station at a time, each phase reviewed, failures sent back (2 retries), drafts in `generated/_draft/<line>/`; mock mode |
| 8.5 | Approval UI on the twin page: draft by dynamic import, change diff, approve / reject with a comment |
| 8.6 | First live calls (with your OK first): one station of a brief, recorded as mock fixtures |

### Step 8.1: the LLM layer (approved)

**Result first:** `agents/llm.js` is the one door for model calls. In mock mode (the default, and in every test) nothing goes over the network. Live, every call:
- **Structured Outputs** through the Responses API: `text.format = json_schema` with `strict: true`, the answer parsed as JSON. Agents get JSON back, never free text.
- **response cache:** key = sha256 of the model, effort, max tokens, schema name, schema and messages. A repeated call costs $0. Live answers go to `.agent-cache/responses/` (git-ignored); `record(key)` copies one into `agents/fixtures/responses/` (committed), where mock mode finds it.
- **budget guard:** before sending, the worst case (prompt tokens estimated at 3 characters each, at the input price, plus `LLM_MAX_OUTPUT_TOKENS` at the output price) must fit under both the session cap and the total cap. Otherwise the call is refused and nothing is sent:
  `budget: this call could cost up to $0.0050, and $4.4980 of the $4.50 total cap is spent`
- **ledger** `.agent-cache/usage.json`: total, per session, and every call (agent, model, schema, tokens, cached tokens, cost). Written before the answer is used, so a call that fails after it was paid for is still counted; it survives restarts.
- **mock mode:** a call nobody recorded is an error naming its key: `mock mode: no recorded answer for this builder call (count, key 3f…)`
- **the key:** read from env only and handed to the SDK. Errors have it replaced by `***`; it is never in the ledger, the cache or the status (tested with a 401 message containing it).
- the strong model only when `LLM_STRONG_ENABLED=true`; an answer cut short (`status: incomplete`) is an error (and still in the ledger); `store: false` (OpenAI doesn't keep the conversation)

**`/api/llm/status`** (`server/llmApi.js`, dev plugin): `{ mode, keyFound, models, caps, spent, remaining, byAgent, calls, session }`; one session per dev-server start. The **setup page** fills its chips from it:
- "OpenAI **mock**", with a tooltip saying whether the key was found (amber in live mode without a key)
- "**$4.50** left", with a tooltip giving total and session spend against the caps
- each agent's model (gpt-5.4-nano) and spend
- the runs-on and model selects are read-only now, since both are set in `.env`; the lede says so

Live check: dev server, the status API answered (no `sk-` anywhere in it), and a screenshot of the setup page. The first screenshot showed "4.50 left" without the dollar sign: my shell had eaten the `$`. Fixed with a small `usd()` helper; the second screenshot is right.

**Changed**
- dependency `openai` 7.63.0 (pre-approved in Claude.md §5); 0 audit issues
- `agents/llm.js` (new): `createLlm`, `llmConfig`, `costOf`, `cacheKey`, `estimateTokens`, `LlmError`
- `server/llmApi.js` (new): `serverLlm`, `handleLlmStatus`, `llmApi()`; `vite.config.js` registers it
- `app/pages/setup/SetupPage.js`, `app/styles/setup.css` (`.chip--warn`)
- `.env`: the model names and prices above, `LLM_REASONING_EFFORT`, `LLM_MAX_OUTPUT_TOKENS` (the key line untouched; the temporary copy I made while editing was deleted)
- `tests/agents/llm.test.js` (11): config and missing settings; cost; mock (unrecorded error, recorded free, no request sent); live with a fake client (request shape, cost in the ledger, cache hit free); ledger across sessions; both caps refuse before sending; strong only when enabled; cut-off answer; the key never leaks; record → mock replay; the status route

**Results**
- `npm test`: 60 files, **2073 tests passed**
- no live call made yet; nothing spent (`.agent-cache/usage.json` doesn't exist yet)

**Please check:** gpt-5.4-nano's **cached-input** price on OpenAI's pricing page (I assumed $0.02 per 1M). The total is $4.50 of your $5 so the last $0.50 stays as a margin against rounding in my estimates.

**Next:** step 8.2, `catalog.json`: what the agents see of the library, measured against the ~4k-token target.

### Step 8.2: the catalog the agents see (approved)

Step 8.1 approved by the owner moving on (2026-11-24: "next").

**Result first:** `lib/catalog.js` builds the agents' view of the library from the registry alone (no component named: the rule-6 test scans it). It has two levels, because a full catalog (77 components with 297 parameters, 32 ops, 6 products) is about **15k tokens**, nearly 4 times the ~4k target:

| Level | What | Size |
|---|---|---|
| `catalogIndex` → `agents/catalog.json` (`npm run catalog`) | every component, op, product and shell on one line; always in the prompt's stable first part | **≈3865 tokens** (conservative: compact JSON ÷ 3) |
| `catalogDetail(registry, { types, ops })` | the full contract of what one station uses: params with ranges and defaults, ports with places, motions with ranges, anchors; every op arg (required marked), its machine-op need; unknown names listed, not thrown | the 3 biggest components + 5 ops < 4000 tokens |

This fits the Builder's three phases: **layout** picks types from the index; **machines** and **process** get the detail of those types and ops in the variable part of the prompt.

Index lines, for example:
- `capper [overConveyor] 1.9×2.1×2.8 m · ports work(batch) head1(unit) … · ops cap — Servo screw capper in a guarded portal over a belt…`
- `beltConveyor 4×0.6×1.1 m · ports input(in) output(out) [unit] — Flat-belt conveyor for loose units`
- `cap(machine, item?, units?, turns?, …) [machine with op cap] — Screw caps onto the product`
- `printer · stages empty → kitted → framed → wired → tested → inspected · 14 parts · facts verdict(PASS|REJECT) — Open-frame 3D printer`

**To get under 4k:**
- `label`, `state` and `status` are on all 32 ops. The args every op takes are worked out from the registry and said once in the legend.
- each op line shows every required arg and the first three optional ones (then "…")
- summaries are cut to their first clause, at most 56 characters (ops 60), at a word
- mount only when not `floor`; sizes to 0.1 m

The index has a `version` (a hash of its content), so a change to it during a session would be visible: the prompt cache depends on it staying the same.

**Changed**
- `lib/catalog.js` (new): `catalogIndex`, `catalogDetail`, `catalogTokens`, `shortSummary`
- `scripts/catalog.mjs` (new), `npm run catalog`; `agents/catalog.json` (generated, committed like `spec/factory.schema.json`)
- `tests/agents/catalog.test.js` (9):
  - under 4000 tokens and the file current
  - every component, op, product and shell once
  - component lines (mount, size, ports, ops)
  - op lines (required args; shared args in the legend)
  - deterministic with a version
  - short summaries
  - detail matches the schemas for every component
  - op detail and unknown names
  - a station's worth of detail stays small

**Results**
- `npm test`: 61 files, **2082 tests passed**
- no UI in this step (nothing to screenshot); no LLM call

**Note:** the token counts are my conservative estimate (characters ÷ 3), not OpenAI's tokenizer: a tokenizer would be a new dependency. The real counts will be in the ledger (`inputTokens`) from the first live call in 8.6, and I'll compare them then.

**Next:** step 8.3, the Builder's schemas: one Structured Outputs schema per phase (layout → machines → process), from the IR's zod, made to fit OpenAI's strict mode.

### Step 8.3a: strict schemas for the Builder's three phases (approved)

Step 8.2 approved by the owner (2026-11-24: "ok"). I split step 8.3:
- **8.3a** (this one): the strict-mode converter and the three phase schemas
- **8.3b** (next): the deterministic placer that turns the layout phase's placement hints into positions

**Result first:** the Builder's answers are typed as exactly as the library allows, built per call from the registry and the station so far:

| Phase | The model answers | Typed by |
|---|---|---|
| layout (`layoutSchema`) | station id / code / title, shell (with its params) or null, machines as `{ id, type, why, place, at, on? }`, the conveyor, the ops the process will use | `type`: enum of the 77 catalog types; `place`: one of 8 placement hints (line, overLine, besideLine, rear, front, upstream, downstream, onTop); `at`: input / work / output / whole. **No coordinates.** |
| machines (`machinesSchema`) | one property per machine id: its params | that component's own params schema (each type defined once, every machine a reference) |
| process (`processSchema`) | intake (or null: the default), process, output (or null), inputStage | each op its own args schema; only the ops the layout chose; `machine` / `conveyor` args limited to the station's ids; ops inside a decision use the same op union (recursive) |

**The converter** (`agents/strict.js`): OpenAI's strict mode takes a subset of JSON Schema, and the IR uses what it lacks (about 30 maps and unions across the op and IR schemas). `toStrict(z.toJSONSchema(…))` gives `{ schema, decode, encode }`. Changes, each undone by `decode`:
- every property required, the optional ones "it or null" (nulls dropped, so zod defaults apply)
- maps (`z.record`) as `[{ key, value }]` lists; tuples as fixed-length arrays
- unknown values (`z.unknown()`: a composite's part params, routine args) as "string, number, switch or short list"
- `default`, `minLength` / `maxLength`, `propertyNames` dropped (zod still checks them after decoding); `allOf` / `not` / `if` refused (none in the project)
- `decode` picks a union's branch by its fixed (`const`) fields, e.g. an op by its `op` name
- `checkStrict(schema)` checks strict mode's rules and OpenAI's limits (5000 properties, depth 10, 1000 enum values); every node must have a type
- `encode` is the reverse (IR → answer form), so examples can be put in front of the model in answer form

**Proof on the example lines:** for every station of the three lines, the machines and process schemas are strict-valid, and every param set and every intake / process / output list goes IR → answer form → IR **unchanged**. The decoded params still pass each component's schema.

**Sizes** (conservative ÷3): layout schema ≈1.7k tokens; machines 0.8k–2.7k (printer ST1, 28 machines: 5.5k before each type was defined once); process 1.6k–8.5k (printer ST6, 9 ops). If OpenAI bills the schema as input, that's at most about $0.0017 per call on nano. The ledger will show the real figure in 8.6.

**Changed**
- `agents/strict.js` (new): `toStrict`, `checkStrict`, `ANY_VALUE`, `STRICT_LIMITS`
- `agents/builder/schemas.js` (new): `layoutSchema`, `machinesSchema`, `processSchema`, `PLACES`, `ALONG`
- `tests/agents/builder-schemas.test.js` (9):
  - converter rules, decode / encode, refusals, `checkStrict`'s messages
  - layout schema: strict, catalog types, hints, no coordinates, decoding
  - machines and process schemas for every example station: strict, ids limited, round trip
  - nested ops, unknown op
  - limits

**Scope:** the process phase covers single-unit stations (intake / process / output / inputStage). Indexing stations, batches, stacks, supplies, sensors and pipe connections stay hand-written for now. They are the lubricant line's specialities; the Builder's first target is printer- and bottling-like stations.

**Results**
- `npm test`: 62 files, **2091 tests passed**
- no LLM call, no UI in this step

**Next:** step 8.3b, `lib/station/place.js`: placement hints → station-local positions, from the machines' footprints (deterministic, checked by the geometry reviewer).

### Step 8.3b: placing machines from hints (approved)

Step 8.3a approved by the owner (2026-11-24: "ok").

**Result first:** `lib/station/place.js` turns the layout phase's words into station-local positions. The model never writes a coordinate; the placer works from the machines' ports and real parts (rule 6: nothing named).

| Hint | Placed |
|---|---|
| `line` | the station conveyor at the origin |
| `overLine` at input / work / output / whole | a machine with a work port puts it on the conveyor's; any other its origin on the centre line (how components over a conveyor are built) |
| `besideLine` (side equipment / walkway) | against the conveyor's edge; `turned`: rotated (exactly π/2) to run away from the line, its start at the edge (a reject lane) |
| `rear` / `front` | clear of the conveyor by 0.3 m and of everything already there |
| `upstream` / `downstream` | its out / in port meets the conveyor's input / output port |
| `onTop` (on: id) | on that machine's top, centred |

Machines sharing a place and an `at` stand side by side along X (0.15 m apart), centred there. `side` (equipment / walkway) is new in the layout schema, for `besideLine`.

**Real parts, not footprints:** my first version kept machines clear of footprints. Rebuilding printer ST2 from hints put the presenter table **behind the fence** (z −2.13; hand-built −1.05), because the gantry's footprint is the portal's whole span. That's the step-7.2 lesson again: footprints are envelopes. Now beside / rear / front machines step outward 5 cm at a time until their real parts clear what is placed (the same mesh boxes and 2 cm tolerance as the reviewer; a machine built to sit at a conveyor may overlap conveyors, as in the reviewer). `solidsOf`, `penetration` and `deepestClash` moved to **`lib/core/solids.js`**, shared by the placer and the reviewer.

**A note when the cell is too shallow:** a rear / front machine that only fits behind something running the station's length (a fence) is placed there with a note for the Builder: `"rack" only fits behind "fence" (guardFence), which runs along the station: make the cell deeper on that side or pick a smaller machine`.

**Rebuilt from hints alone, then reviewed:**
- **bottling line:** every machine exactly where it was hand-placed, except the reject lane, which steps 0.5 m clear of the camera frame's column. No clash; the run of 10 plays to the end in the same time (140.3 s).
- **printer ST2–ST5**, inside their shells:
  - presenter z −1.02 (hand: −1.05), inside the gantry's span
  - harness board and tester in front of the fence
  - ST4's rack, asked for at the work place behind the dock, gets the note above
  - no clash; the run of 8 plays to the end (771.6 s)

**Changed**
- `lib/station/place.js` (new): `placeStation`, `PlacementError`, `GAP`, `SIDE_GAP`, `STEP`
- `lib/core/solids.js` (new, moved from `agents/reviewer/geometry.js`, which re-exports it)
- `agents/builder/schemas.js`: `side` for `besideLine`
- `tests/station/place.test.js` (7):
  - overLine (work port / origin)
  - rear and front (gap, side by side, centring)
  - besideLine (both sides, turned exactly)
  - upstream / downstream ports meet; onTop
  - six refusals with reasons
  - the bottling line and printer ST2–ST5 rebuilt from hints and reviewed

**Results**
- `npm test`: 63 files, **2098 tests passed**
- no LLM call, no UI in this step

**Limits:** no turns other than `turned` (a monitor angled toward the walkway stays square); onTop of an onTop machine isn't supported; printer ST1's 28 kitting fixtures (totes in a pattern on a table) were not rebuilt from hints: the hint vocabulary can't express a tote layout.

**Next:** step 8.4, `agents/builder.js`: one station at a time through the three phases in mock mode, each phase decoded, placed, checked by the deterministic reviewer, failures sent back (2 retries), drafts written to `generated/_draft/<line>/`.

### Step 8.4: the Builder agent (approved)

Step 8.3b approved by the owner (2026-11-24: "ok").

**Result first:** `agents/builder/builder.js` builds one planned station at a time: `buildStation({ line, product, stations, plan })` → `{ ok, station, factory, notes, attempts, cost, findings }`. Per station:
1. **layout** (model): station name, shell or none, machines by catalog type with placement hints, conveyor, extra ports (new in the schema: e.g. `reject`), ops. Checked in code: unique ids, not clashing with the shell's or other stations', conveyor and port machines exist, `onTop` has its `on`.
2. **machines** (model): params; each checked against its component (`componentSpec`).
3. **placement** (no model): `placeStation` with the shell's furniture as obstacles.
4. **process** (model): intake / process / output / inputStage.
5. **review:** the line so far (this station chained to the previous one, output → input, over the plan's transport) through the deterministic reviewer. Errors block, and so do geometry warnings (clashes). Once it passes, the run is played once (reach).

A refusal goes back to **the phase it belongs to**:
- a param → machines
- a clash, an equipment or shell problem, or a hint the placer can't place → layout
- anything else (ops, graph, play) → process

The findings go back as a FEEDBACK section: `Your machines answer was refused. Fix these and keep the rest: - equipment[0].params (belt): …`. At most **2 retries per station**; then `ok: false` with the findings and what there is, for you. LLM-layer errors (budget, mock without a recording) are thrown, not retried: they need you.

**Prompts** (`agents/prompts/builder.md` + the catalog): every call starts with the same bytes (instructions, then `CATALOG` with the index, ≈4.6k tokens, the part OpenAI can cache); the variable part follows: `PHASE …`, then LINE / PRODUCT (stages, facts) / PREVIOUS / IDS / PLAN / LAYOUT / STATION / DETAIL (only the chosen types and ops) / FEEDBACK. Measured for the capping station (conservative ÷3):

| Call | Shared start | Own part | Schema | Answer |
|---|---|---|---|---|
| layout | 4636 | 170 | 2088 | 116 |
| machines | 4636 | 1086 | 1328 | 323 |
| process | 4636 | 1882 | 3094 | 589 |

On gpt-5.4-nano that's about **$0.007–0.01 per station** (reasoning tokens included roughly), about $0.05 for a 6-station line without retries, below my 8.1 estimate.

**Drafts:** `writeDraft(factory)` writes `factory.json` and its compiled files to `generated/_draft/<line>/` (lib at `../../../lib`), ready for the app to import (8.5).

**Tested with a scripted model** whose answers are made by the schemas' own `encode()` from the bottling line's capping station, so they are exactly strict-mode answers:
- three calls build the station the hand-written line has: the same machines, params, places (placed from hints), intake / process / output; reviewed, and a run of 4 played to the end
- the prompts' shared start identical in every call; each phase's own sections
- a belt length of 99: refused in code, back to machines with the reason, fixed
- a motion value of 99: the reviewer's `ops` finding sent to the process phase, fixed
- `onTop` of an unknown machine: the placer's error sent to the layout phase, fixed
- wrong three times: handed back with `ok: false` after 2 retries, no further calls
- the real LLM layer in mock mode with nothing recorded: the mock error reaches the caller
- a draft written: factory.json, fill1.js, fill2.js, cap.js, line.js

**Changed**
- `agents/builder/builder.js` (new): `createBuilder` (`buildStation`, `writeDraft`, `assemble`, `factoryWith`), `phaseOf`, `BuilderError`
- `agents/prompts/builder.md` (new): the Builder's standing instructions
- `agents/builder/schemas.js`: extra station `ports` in the layout schema
- `tests/agents/builder.test.js` (9)

**Results**
- `npm test`: 64 files, **2107 tests passed**
- no live call yet (all tests scripted or mock); no UI in this step

**Not yet:** the station plan is a small object (`{ title, does, steps }`); Phase 9's Spec agent will write plan.md and these come from it. Drafts per phase (layout-only preview) and the diffs come with the approval UI in 8.5.

**Next:** step 8.5, approval on the twin page: a draft loaded by dynamic import, the change shown as a diff, approve / reject with a comment (a reject goes back to the Builder as FEEDBACK).

### Step 8.5: approval on the twin page (approved)

Step 8.4 approved by the owner moving on (2026-11-24: "continue working, phase 8 step 8.5").

**Result first:** the twin page (`#/twin`, no demo or line asked for) now has the **Builder panel**. Each station is built in three gates: **layout → machines → process**. At each gate:
- the draft is compiled into its own folder and loaded into the 3D view by dynamic import
- the panel shows the change as **JSON Patch ops on factory.json** (against the last approved state), the reviewer's findings, placement notes, refusals sent back to the model, and the cost
- **Approve** accepts it and builds the next gate
- **Reject…** asks for a comment and sends it back to that phase with the previous answer, then rebuilds

**Rehearsal (no live call yet):** with nothing recorded (that's 8.6), mock mode can't answer a Builder call. So the panel offers **"Rehearse: bottling"**: a scripted model whose answers are the hand-written bottling stations (fill, cap, inspect, pack), encoded by the Builder's own schemas, plus placement hints. Everything else is real: the Builder, the placer, the reviewer, the compiler and the play. It costs $0, and it's labelled "Rehearsal · scripted · $0" in the panel. It is **not** mock mode: mock replays recorded live answers, while a rehearsal makes them from hand-written data. A rehearsal can't read a rejection comment (it replays the same answer), and the reject form says so.

Checked in the browser (dev server, the same API calls the panel makes; screenshots in `screenshots/builder-*.png`):
- empty state; the layout, machines and process drafts of filling and capping
- one rejection ("Make the belt longer") → the machines phase rebuilt (rev 3), the comment in the history
- 11 more approvals → all 4 stations approved; the line plays (fill → cap → inspect → pack)
- the camera frames the line in the space left of the panel, and re-frames only when a station is added (between phases the owner's view stays)

**What each gate shows** (the bottling rehearsal):

| Gate | Diff | Draft |
|---|---|---|
| layout | `+ stations › fill` (the whole station, folded) and, from the 2nd station, `+ graph › edges › [n]` | machines at **default params**, placed from the hints, no process yet (units just ride through); clashes listed, not refused (the params may change them) |
| machines | `+/~ stations › fill › equipment › belt › params › length` … | real params, placed again; a clash is refused **before** the process call is paid for (sent back to layout) |
| process | `+ stations › cap › process › [0]` … `intake`, `output`, `inputStage` | full review + one played run (the play finding is shown) |

**Changed**
- `agents/diff.js` (new): `diffJson` (RFC 6902), `applyPatch` (add / remove / replace / test, `-`), `labelPath` (array items by `id`: `stations › cap › equipment › belt`), `describeDiff`, `jsonEqual`, `valueAt`. Kept generic, ready for the Editor's patches (Phase 10).
- `agents/builder/builder.js`:
  - `advance(job, build, { stopAfter })` runs a build on to the next gate; `buildStation` is now `advance` with no stop (same behaviour, the 8.4 tests unchanged)
  - `newBuild()`; `rejectGate(build, phase, comment)`: the owner's comment as FEEDBACK, a fresh retry allowance
  - a retry prompt now also carries **PREVIOUS ANSWER** (the model was told "keep the rest" without seeing it)
  - the machines phase reviews geometry before the process call
  - `factoryOf(job, stations)`; `writeDraft(factory, { rev })` writes `generated/_draft/<line>/r<rev>/` and returns its `url`
- `agents/builder/session.js` (new): `createBuildSession`: `next` / `approve` / `reject` / `view`, plain-JSON state, the diff base, a history log
- `agents/builder/rehearsal.js` (new), `agents/builder/rehearsals/bottling.json` (new): `loadRehearsal`, `scriptedBuilderLlm`, `stationAnswers`, `opsUsed`
- `server/builderApi.js` (new): `GET /api/builder`; `POST /api/builder/start | approve | reject | next | reset`
  - one request at a time
  - LLM-layer refusals → 409 with `code` (budget, mock)
  - the session kept in `.agent-cache/builder/session.json` (survives a dev-server restart)
  - the approved line written to `generated/_draft/<line>/approved.factory.json`
  - old draft revisions pruned (last 6 kept)
- `vite.config.js`: `builderApi()`; the watcher ignores `generated/_draft/` and `.agent-cache/`. Each revision has new URLs, so the browser never reuses an older draft's station files, and a draft written while the page is open triggers no reload.
- `app/pages/twin/BuilderPanel.js` (new), `app/styles/builder.css` (new, imported in `app/main.js`)
- `app/pages/twin/TwinPage.js`: the panel; drafts loaded and swapped (frame hooks unhooked); `frameLine`
- `app/pages/twin/compiledLines.js`: `loadDraftLine(url)` (dynamic import, only `/generated/_draft/…/line.js` URLs)
- tests (18 new):
  - `tests/agents/diff.test.js` (7): ops and order, escaping, round trips between the three example lines, `applyPatch` errors, labels
  - `tests/agents/session.test.js` (7): the rehearsal answers; one gate per phase with each diff applying exactly; the whole plan (12 gates, 4 stations, drafts on disk, run played); reject carries the comment and the previous answer; refusals; a failing gate can't be approved; a saved state goes on
  - `tests/agents/builder-api.test.js` (4): routes and bad requests; start → approve → reject → reset with drafts pruned and the approved line saved; restart restores; a real run in mock mode → 409 `mock`, the session kept

**Results**
- `npm test`: 67 files, **2125 tests passed**
- no live call, nothing spent

**Limits**
- The approved line lives in `generated/_draft/<line>/approved.factory.json` (git-ignored) and the session file. Where an approved `factory.json` should go for good (e.g. `lines/<line>.factory.json`) is open; the Editor's version history (Phase 10) will need it.
- Linear lines only: each station is chained output → input. A reject port is built (inspect's reject lane) but not wired to anything yet.
- A real run is started only through the API (`POST /api/builder/start { line, product, plan }`). The panel's start button comes with plan.md in Phase 9.
- The rehearsal's filling station is single (the hand-written line runs it as two parallel copies; the layout schema has no `parallel` yet).

**Next:** step 8.6, the first live calls (with your OK first): one station of a brief through the three gates on gpt-5.4-nano, recorded as mock fixtures, and the real token counts compared with my estimates.

### Step 8.6: the first live calls (approved)

Step 8.5 approved by the owner (2026-11-24: "ok do the next step").

**Result first:** the Builder built the first station of a new line on **gpt-5.4-nano**, with nothing hand-written before it, through the three gates. Every check passed and the run plays. Total spend **$0.00634** (5 billed calls; ledger `.agent-cache/usage.json`); **$4.4937 of the $4.50 cap left**.

- **Job** (`agents/fixtures/jobs/juice-fill.json`): "Apple juice bottling", parametric glass bottle, plan item "Filling: fills each empty glass bottle with apple juice through a nozzle lowered into its neck", five steps.
- **The model's station:** `filling` (ST1 "Bottle filling"), a `beltConveyor` plus the catalog **`filler`** (`overLine` at `work`), no shell, process `fill "Filling bottles"`. Played: a run of 6, every unit out after 120.9 s (estimated 122.6 s). Screenshot: `screenshots/builder-live-process.png`.
- **Layout needed 2 refusals** (each sent back with the reason, as designed):
  1. it chose the `assemblyCell` shell with `walkwayZ` 0.9 against `maxZ` 1.2 (the shell wants 0.2 m between them)
  2. it then nudged walkwayZ to 1.0 but named a conveyor `stationConveyor` that doesn't exist (the shell's is `line`)
  3. third answer: no shell, its own belt (accepted). Machines and process passed first time.
- **Recorded:** the 5 answers are in `agents/fixtures/responses/` (no key in them, checked). Mock mode replays them:
  - in a test (`tests/agents/builder-live.test.js`: 3 gates, 5 mock answers, 0 live)
  - in the panel: POST the job's `line`, `product` and `plan` to `/api/builder/start`. Replayed in the browser for $0, identical result.

**The live call found three bugs the offline tests could not:**
1. **OpenAI wants a `type` beside every `const`** (and enum). The first request was refused with a 400 before the model ran, so nothing was billed. `toStrict` now adds the type (`integer` for whole numbers, a list for mixed enums), and `checkStrict` reports a bare const or enum. A test walks the real layout and process schemas for any left.
2. **A shell whose params break its own cross-field rule crashed the Builder** (a RegistryError from `expandShell`) instead of being refused. It is now a layout refusal: `shell.params (assemblyCell): … walkwayZ must be at least 0.2 m inside maxZ`.
3. **`/api/builder` kept its first module load forever**, so after an edit it ran stale agent code until a restart. Modules are now fetched per request from Vite's SSR graph (cached, fresh after an edit).

**Real tokens against my estimates:**

| Call | Input (billed) | Cached | Output (incl. reasoning) | My estimate (÷3) | Cost |
|---|---|---|---|---|---|
| layout #1 | 5694 | 0 | 549 | 6951 | $0.00183 |
| layout #2 | 5875 | 4864 | 289 | 7161 | $0.00066 |
| layout #3 | 5882 | 4864 | 412 | 7164 | $0.00082 |
| machines | 5593 | 0 | 172 | 6483 | $0.00133 |
| process | 6182 | 0 | 374 | 7285 | $0.00170 |

- **Estimates run about 20 % high** (as intended: the budget guard errs on the safe side).
- **Prompt caching works only within a phase.** A retry of the same phase got 4864 of ~5880 input tokens cached; the first machines and process calls got none. My reading: OpenAI puts the response schema ahead of the messages, so a new phase's schema breaks the shared prefix. Worth about $0.001 per station; not worth restructuring for now.
- **Cost per station:** ≈ $0.005 with no retries, $0.006 with two. A 6-station line ≈ **$0.03–0.04** (my 8.4 estimate was $0.05), so about 110 lines fit in what's left.
- **Speed:** 3–5 s per call.

**Quality, honestly:** the station works but is plain. A 4-head lubricant filler stands over a single bottle (oversized for one unit), the input stage is a generic "processed", and the plan's nozzle steps sit inside the named `fill` op rather than being written out. A reviewer critique (Phase 11) or a fuller plan (Phase 9) is where such choices get questioned.

**Changed**
- `agents/strict.js`: types beside const and enum; `checkStrict` reports them
- `agents/builder/builder.js`: shell param errors refused, not thrown
- `server/builderApi.js`: modules per request (GLB models still once per registry)
- `scripts/builder-live.mjs` (new), `npm run builder:live`:
  - one plan item, live, through the three gates
  - per call: tokens and cached tokens against the estimate, cost and time
  - writes a draft and records the answers as fixtures
  - an answered call is free on a rerun (cache)
- `agents/fixtures/jobs/juice-fill.json`, `agents/fixtures/responses/*.json` (5, new, committed: what mock mode replays)
- tests:
  - `tests/agents/builder-live.test.js` (new): the replay
  - `tests/agents/builder-schemas.test.js`: + const / enum types

**Results**
- `npm test`: 68 files, **2127 tests passed**
- spent $0.00634 (one aborted 400 request, not billed)

**Note for later:** the replay test is tied to the exact prompt. A change to the catalog, the Builder's instructions or its schemas changes the cache keys, so the test then fails with a mock-mode error naming the key. Re-recording costs about $0.005 (`npm run builder:live`).

## Phase 8 status: done

The LLM layer (budget guard, cache, mock mode, ledger, status in the UI), the agents' catalog, strict schemas for the three phases, the placer, the Builder with retries, the approval UI with diffs, and a first live station recorded for mock replay. Next phase: **Phase 9, the Spec agent and the SDD flow** (chat drawer, guided questions, templates, `.md` upload, constitution / brief / plan with approval). Its plan.md feeds the Builder's start button.

## Phase 9: Spec agent and SDD flow

Phase 8 approved by the owner moving on (2026-11-24: "ok next continue working").

**Design** (Claude.md rules 1 and 3):
- The Spec agent answers in **JSON** (Structured Outputs), never free markdown. The three `.md` documents are **rendered from that JSON by templates**, and the Builder reads the plan JSON directly, so no markdown is parsed back.
- **constitution.md** is fixed rules, rendered from `lib/core/conventions.js` with **no model call**.
- An uploaded `.md`, a template or the guided answers are all just owner text for the Spec agent.

**Split** (proposed 2026-11-24, done under the "don't wait" rule):

| Step | Content |
|---|---|
| 9.1 | Brief and plan schemas (strict), checks in code, markdown templates, plan → Builder job |
| 9.2 | The Spec agent: brief (with follow-up questions), plan, retries on refusals |
| 9.3 | Spec session, `/api/spec`, approved documents saved to `sdd/<line>/` |
| 9.4 | Setup page: chat / guided / template / `.md` upload, document review, Build → Builder |
| 9.5 | First live Spec calls (asks the owner first), recorded for mock replay |

### Step 9.1: the SDD documents as data (approved)

- `agents/spec/schemas.js`:
  - `briefSchema`: id, title, product (name, description, model: a catalog product or a parametric shape, each typed by its own params; `serial` is never asked), `targetPerHour`, `runSize`, steps (name, does), quality, constraints, assumptions, questions (topic, question, why)
  - `planSchema`: transport (catalog conveyors with in and out ports and a length: agvCart, beltConveyor, gravityChute, palletConveyor, rollerConveyor, turntableTransfer), stations (id, code, title, does, steps, `seconds` budget, `covers` brief steps, `machines` hint), notes
  - Sizes (÷3): brief ≈3.2k tokens (mostly the catalog products' params), plan ≈0.5k
- `spec/sdd/checks.js`:
  - `taktOf`, `productOf`
  - `checkBrief`: camelCase id, title ≤ 60, product params against the product's own schema, unique step names
  - `checkPlan`: every station within the takt, every brief step covered and no unknown ones, unique ids, machine hints in the catalog
  - `jobFromSdd` (the Builder session's `{ line, product, plan }`)
- `spec/sdd/render.js`: `renderConstitution`, `renderBrief` (product, takt, steps table, open questions), `renderPlan` (line graph, stations table, each station's steps, takt budget with shares)
- `tests/spec/sdd.test.js` (9), `tests/spec/fixtures.js` (a small juice brief and plan)

### Step 9.2: the Spec agent (approved)

- `agents/spec/spec.js`, `createSpec({ registry, llm })`:
  - `draftBrief({ conversation, previous, feedback })` and `draftPlan({ brief, previous, feedback })`
  - each answer checked in code and refused back with its problems and the previous answer (at most 2 retries), then `ok: false` with the problems
  - the plan is asked of the **strong** model, which the LLM layer only uses if `LLM_STRONG_ENABLED` (off now, so nano)
- `agents/prompts/spec.md`: write down what the owner said; a sensible value where they gave none, listed as an assumption; at most 3 questions that change the plan; a straight line; every brief step covered by exact name; every budget within the takt. The stable start is instructions + catalog, like the Builder's.
- The prompt's variable part:
  - brief: `CONVERSATION` (who said what; an uploaded text over 12,000 characters is cut, with a note)
  - plan: `BRIEF` (without its questions), `TAKT`, `STEP NAMES`
  - both: `PREVIOUS ANSWER` and `FEEDBACK` on a retry or a rejection
- `tests/agents/spec.test.js` (9, scripted model)

### Step 9.3: the Spec session and `/api/spec` (approved)

- `agents/spec/session.js`:
  - constitution drafted at once; owner messages (re)draft the brief; the agent's questions are added to the conversation, so the owner's answers follow them
  - approving the brief drafts the plan; a new brief resets the plan
  - reject with a comment for the brief or plan (the constitution can't be redrafted: it comes from code)
  - `retry` after an LLM error; `job` once all three are approved
- `server/specApi.js`:
  - `GET /api/spec` (session and templates); `POST message | approve | reject | retry | reset`
  - LLM refusals → 409 with `code`
  - session in `.agent-cache/spec/session.json`
  - **approved** documents written to `sdd/<line id>/` (`constitution.md`, `factory-brief.md`, `plan.md`, `brief.json`, `plan.json`); drafts stay in the session
- `spec/sdd/templates/`: juice bottling, desktop 3D printer assembly, face cream jars (written the way an owner would describe a line)
- `tests/agents/spec-session.test.js` (6): the full flow with files; reject rules; refusals; retry after an error; the API with templates, documents on disk, restart, reset; mock mode → 409

### Step 9.4: the setup page's Spec steps (approved)

- `app/pages/setup/specSteps.js` (new), mounted into steps 2–4 of `SetupPage.js`:
  - **Brief:** the four methods are live:
    - chat: a thread, with the agent's questions as bubbles
    - guided: product, size, rate per hour / shift / day, steps one per line, quality, constraints, sent as one message
    - template: cards from `spec/sdd/templates/`
    - upload: `.md` / `.txt` up to 400 KB, previewed first
    - a status card shows the draft, line, rate, takt, cost and the open questions ("answer in the chat, or approve the brief with its assumptions")
  - **Documents:**
    - each document with its status (Waiting / Draft to review / Approved / Failed its checks), draft number, refusals and cost
    - the first one waiting for review is opened, rendered as markdown, with Approve and Reject… (comment)
    - "Draft the plan again" after an error
  - **Build:** the approved line (stations, budgets, takt, transport) and **Build the line**, which hands `job` to `/api/builder/start` and opens the twin. A refusal there (e.g. mock mode without a recording) is shown on the page, not hidden behind the jump.
- `app/ui/markdown.js` (new): a small markdown renderer (headings, lists, tables, bold / italic / code), **everything escaped first**
- `app/styles/spec.css` (new)
- `tests/app/markdown.test.js` (3): the marks, escaping (no `<img>` or `<script>` gets through), the three documents render with nothing left raw

**Checked in the browser:** no live call is allowed yet, so I seeded the session with the test fixtures' scripted answers (marked as a check, not recorded as fixtures). Screenshots:
- `spec-brief.png`: the chat with the agent's two questions and the brief card
- `spec-docs.png`: constitution open
- `spec-plan.png`: brief approved, plan open
- `spec-build.png`: all approved

The constitution and plan were approved through the API. "Build the line"'s call reached the Builder, which mock mode refused with its reason, as expected. Afterwards I reset both sessions and **deleted the `sdd/juiceLine/` files the check had written** (fixture data, not yours).

**Fixed on the way:**
- `num()` in the templates kept trailing zeros ("0.90 m")
- the documents step always opened the brief; it now opens the next document waiting for review
- an old dev server of mine (started during 8.5) kept port 5173 after I stopped its parent processes, so a later restart silently didn't happen; stopped and restarted cleanly

**Results**
- `npm test`: 72 files, **2154 tests passed** (+27)
- no live call; nothing spent in Phase 9

**Limits**
- Straight lines only (the plan has no branches or parallel stations; the Builder chains stations too).
- No GLB product from the Spec flow (it needs a file upload).
- Owners can't edit a document's text directly, only reject it with a comment: there is no markdown → JSON parsing, by design.
- `sdd/<line>/` is committed source (not git-ignored); tell me if you'd rather keep it out of git.

**Next:** step 9.5, the first live Spec calls (with your OK): the juice-bottling template through brief → plan on gpt-5.4-nano (my estimate about $0.002–0.004), recorded as fixtures, and the brief and plan quality reported honestly.

### Step 9.5: the first live Spec calls (approved)

Steps 9.1–9.4 approved by the owner ("ok i allow", 2026-11-24, also the OK for these live calls).

**Result first:** the juice-bottling template went through the real Spec session on **gpt-5.4-nano**: brief → (approved with its assumptions) → plan. Both passed the checks; the plan hands the Builder a 4-station job. **$0.0055** for 3 billed calls; the ledger total is now **$0.0118**, so **$4.4882 of the $4.50 cap is left**.

| Call | Input (billed) | Cached | Output (incl. reasoning) | My estimate (÷3) | Cost | Time |
|---|---|---|---|---|---|---|
| brief #1 | 6332 | 0 | 679 | 8269 | $0.00212 | 8.7 s |
| brief #2 (retry) | 7021 | 5888 | 722 | 9275 | $0.00125 | 8.0 s |
| plan | 5071 | 0 | 903 | 6043 | $0.00214 | 6.2 s |

- Over my $0.002–0.004 estimate because of the one retry. Without it, ≈ $0.004 for brief + plan.
- Estimates ~25 % high again; caching only within a retry of the same call, as with the Builder.

**What the model wrote** (rendered documents in `.agent-cache/spec-live/juice-bottling/`, not in `sdd/`, since they are not your approvals):
- **Brief:** faithful to the template:
  - line `appleJuiceBottling`; a parametric glass bottle at 90 × 90 × 260 mm with a red cap
  - 240/h (takt 15 s); steps Fill / Cap / Label / Inspect
  - the constraints as given; four assumptions listed
- **Three questions, all relevant:**
  - cycle times for capping and labelling
  - where rejects are diverted
  - whether bottles arrive clean, with caps fed separately
- **One refusal fixed:** its first label text was 25 characters (limit 24); it came back with the path and reason and was shortened.
- **Plan:** ST1 Filling (6 s), ST2 Capping (6 s), ST3 Labelling (4 s), ST4 Vision inspection + reject (8 s), on `beltConveyor`. Each station has 6–7 concrete steps. Machine hints are **all real catalog types** (filler, supplyTank, photoEye, capper, labelApplicator, labelHead, visionScanner, sidePusher).

**Quality, honestly:**
- **Filling's 6 s budget is too tight:** the template says 6 s of filling alone, before nozzle down/up and transfers. Code can't catch this (it checks budgets against the takt, not against the steps). The Builder's played run will show the real time; Phase 11's critique is where it should be flagged.
- **No bottle will ever be rejected:** the brief leaves the product's `rejectEvery` at its default 0, even though the owner described rejects. A check for that (rejects described ⇒ `rejectEvery` > 0) is a small follow-up.
- One irrelevant assumption ("8 h shift basis", although the rate was already per hour).

**Recorded and replayed:**
- the 3 answers are in `agents/fixtures/responses/` (no key in them)
- `tests/agents/spec-live.test.js` replays the whole flow in mock mode: 3 mock answers, 0 live, $0
- in the browser, the setup page replayed it from the template (`screenshots/spec-live-brief.png`, `spec-live-plan.png`); afterwards the session was reset and the `sdd/appleJuiceBottling/` files my API approval wrote were deleted

**Changed**
- `scripts/spec-live.mjs` (new), `npm run spec:live`:
  - a template through the real session, live
  - per call: tokens against the estimate, cost and time
  - the rendered documents written to `.agent-cache/spec-live/<template>/`; answers recorded as fixtures
  - writes nothing to `sdd/`
- `agents/fixtures/responses/*.json` (3 new)
- `tests/agents/spec-live.test.js` (new)

**Results**
- `npm test`: 73 files, **2155 tests passed**
- spent $0.0055 in this step

**Note:** like the Builder's replay test, this one is tied to the exact prompt, template and schemas. A change there fails it with a mock-mode error naming the key; re-recording costs about $0.005.

## Phase 9 status: done

The Spec agent (brief with follow-up questions, plan), the SDD documents rendered from its JSON, the constitution from code, approval with comments on the setup page, approved documents in `sdd/<line>/`, and the plan handed to the Builder. Next phase: **Phase 10, the Editor agent** (natural-language edits as JSON Patch on factory.json, review, partial recompile, hot reload, version history and undo).

## Phase 10: Editor agent

Phase 9 approved by the owner moving on (2026-11-24: "ok next").

**Split** (proposed 2026-11-24, done under the "don't wait" rule):

| Step | Content |
|---|---|
| 10.1 | Line store: `lines/<id>/factory.json` with a version per change, compiled to `generated/<folder>/`; the Builder saves finished lines there; the reject warning from 9.5 |
| 10.2 | Editor agent: request → JSON Patch, checked by applying it, the IR schema and the reviewer; refusals back |
| 10.3 | `/api/lines`: propose → apply / discard, undo, copy an example to edit |
| 10.4 | Twin page: edit mode with the Editor panel, history and undo; saved lines and "Save the line" in the Builder panel |
| 10.5 | First live Editor calls (asks the owner first) |

### Step 10.1: the line store (approved)

**Decision (the open point from 8.5):** a line's factory.json lives in **`lines/<id>/factory.json`** (committed source, rule 2), with **`lines/<id>/versions/v0001.json`** per change (`{ version, time, by, message, request?, patch, factory }`: the RFC 6902 patch from the previous version, for display, plus the full factory, for undo). Tell me if you'd rather keep the versions out of git.

- `server/lineStore.js`: `createLineStore` (`list`, `load`, `save`, `create`, `history`, `version`, `undo`, `recompile`) and `projectLineStore`:
  - validated by the IR schema
  - compiled into `generated/<folder>/` after every save; `writeCompiled` rewrites **only the files whose text changed**, so Vite reloads only those
- **Undo** saves the previous version again as a new version (`by: 'undo'`): the history only grows, and an undo can itself be undone.
- **Guards:**
  - a line's id can't change
  - **an example line's id is reserved**: `generated/printer-line` and its siblings are the visual reference, so an example is edited as a copy under a new id
  - "nothing changed" isn't a version
  - a refused save writes nothing
- `POST /api/builder/save` (`{ id? }`): a finished build becomes `lines/<id>/` version 1 (`by: builder`, "built by the Builder: 4 stations (rehearsal)").
- **The reject warning (from 9.5)** is a **warning shown to the owner, not a refusal**:
  - `briefWarnings` notices that the brief describes rejects while the product's every-Nth-fails setting is 0 or unset
  - it's shown in factory-brief.md under "Checks" and on the brief and document cards
  - why not a refusal: the recorded live brief would then need a retry nobody recorded, i.e. a paid re-record. The owner rejects the brief with a comment instead.
- Tests:
  - `tests/server/lineStore.test.js` (3): versions, patches, partial recompile (2 of 7 files for a run-size + title change), undo twice; refusals; no compiler
  - `tests/spec/sdd.test.js` (+1): warnings
  - `tests/agents/builder-api.test.js` (+1): save

### Step 10.2: the Editor agent (approved)

- `agents/editor/schemas.js`: `factoryPatch`: summary, ops `{ op: add | remove | replace, path, valueJson }`, questions. Strict mode can't type "any JSON value", so each value comes as JSON text and is parsed in code.
- `agents/editor/editor.js`, `createEditor({ registry, llm })`:
  - `propose({ factory, request, feedback })` → `{ ok, summary, ops, factory, diff, findings, questions, attempts, cost, problems }`; nothing is saved here
  - the prompt: instructions and catalog (stable), then REQUEST, LINE (the whole factory.json), TIMING (each station's cycle time and the bottleneck), DETAIL
  - DETAIL covers only the stations the request names by id, code or title, as whole words; none named → all
- **Checks before anything is shown:**
  1. fixed paths (`/line/id`, `/version`, the whole document) refused
  2. values must be JSON; add / replace need one
  3. the patch must apply (`PatchError`: a path that isn't there)
  4. the IR schema
  5. the deterministic reviewer: **only findings the patch brings in count against it** (a line's existing warnings don't block an edit); clashes block
  6. then the run is played

  A refusal goes back with the problems and the previous answer (at most 2 retries).
- `agents/prompts/editor.md`:
  - the smallest patch; nothing the owner didn't ask for
  - JSON Pointers counted from 0; ranges from DETAIL
  - "faster" → the seconds of the ops that take the time
  - ask instead of guessing
- `tests/agents/editor.test.js` (7):
  - strict schema
  - a request → patch → applied, reviewed, played; diff and prompt sections; only the named station's detail
  - questions
  - a motion out of range refused by the reviewer and fixed
  - six code refusals (fixed path, not JSON, missing value, missing path, invalid id, nothing at all)
  - the owner's comment; station targeting

### Step 10.3: `/api/lines` (approved)

- `server/linesApi.js`:
  - `GET /api/lines` (lines and examples); `POST /api/lines/import` (an example copied under a new id)
  - `GET /api/lines/<id>` (line, folder, history, pending)
  - `POST …/propose` (`{ request }`, kept as pending, not saved)
  - `POST …/apply` (a new version, recompiled)
  - `POST …/discard` (`{ comment? }`: with a comment, the Editor tries again with it)
  - `POST …/undo`
- **A stale patch is refused:** if the line changed since the proposal, apply answers 409 "propose it again". Undo drops a pending patch.
- Pending patches are kept in `.agent-cache/editor/<id>.json`; LLM refusals → 409 with `code`.
- `tests/agents/lines-api.test.js` (3): import → propose → apply → undo with compiled files; stale patch, discard with a comment, questions can't be applied; bad requests and mock mode → 409

### Step 10.4: the twin page's Editor (approved)

- **`#/twin?edit=<id>`:** the stored line's compiled files (`generated/<folder>/line.js`, from the glob, or by plain dynamic import for a line saved after the page loaded) playing in the 3D view, with the **Editor panel** (`app/pages/twin/EditorPanel.js`):
  - the request box
  - the proposal: summary, the request, the version it's based on, cost, questions, refusals, the reviewer's findings on the changed line, the diff (the same rows as the Builder's)
  - Apply / Discard… (optional comment)
  - the history (who, what, how many ops) and **Undo version N**
- **The Builder panel:**
  - **"Save the line"** when a build is finished (→ `lines/<id>/`, opens edit mode)
  - a **"Saved lines"** list with links to edit mode
  - **"Copy to edit"** (example + new id)
- Checked in the browser (no live call: a pending patch was seeded from the scripted test model, as a check):
  - `editor-empty.png`: a copied bottling line playing, the request box, history v1
  - `editor-pending.png`: "Filling takes 5 s instead of 6, and Capping is renamed Screw capping", 2 ops with old → new values, the played run
  - `editor-applied.png`: version 2 in the history, Undo
  - `builder-saved-lines.png`
  - Apply rewrote **4 of the 7 compiled files** (`fill1.js`, `fill2.js`, `cap.js`, `line.js`).
- **Not observed:** the hot reload in an open browser (Vite reloading the page when the compiled files change). Each screenshot loads a fresh page, so I saw the result, not the reload itself.
- Afterwards I deleted my check data (`lines/bottlingEdit/`, `generated/bottling-edit/`, the pending file).

**Results**
- `npm test`: 76 files, **2170 tests passed** (+15)
- no live call; nothing spent in Phase 10

**Limits**
- The Editor sees the whole factory.json (the printer line is ≈15k tokens, about $0.003 per call on nano). Fine within the budget; a larger line would need the LINE section cut down to the named stations.
- Array edits by index: an insertion in the middle of a list shows as a run of replaced items in the diff (correct, but not as readable as it could be).
- The station targeting is by words. A request naming no station sends every station's detail; a one-letter station code (the bottling line's "C") can be matched by accident.

**Next:** step 10.5, the first live Editor calls (with your OK): two or three requests on a copy of the bottling line (a timing change, a rename, one that should make it ask), about $0.002–0.004 each on nano, recorded for mock replay, with the quality reported.

### Step 10.5: the first live Editor calls (approved)

Steps 10.1–10.4 approved by the owner ("ok continue i allow you", 2026-11-24, also the OK for these live calls).

**Result first:** three requests on a copy of the bottling line (`bottlingEdit`, made exactly as "Copy to edit" makes it), each proposed on version 1, on **gpt-5.4-nano**. **All three right on the first answer, no refusals.** $0.0043 in total; the ledger total is now **$0.0161** (**$4.4839 of the $4.50 cap left**).

| Request | The Editor's answer | Input (cached) | Output | Est. | Cost |
|---|---|---|---|---|---|
| "Make Filling 1 second faster." | one replace: `stations › fill › process › [2] › seconds` 6 → 5; checked and played (run of 10 in 139.3 s) | 7915 (0) | 119 | 9061 | $0.00173 |
| "Rename the Inspection station to Vision check and give it the code V." | two replaces: title "Inspection" → "Vision check", code "Q" → "V"; nothing else touched | 8071 (3840) | 140 | 9197 | $0.00110 |
| "Make it better." | **no patch**; 4 questions: what "better" means (throughput / quality / flow), whether to shorten the bottleneck station `pack`, the reject rate (`rejectEvery` 4), whether rework should loop back to inspection | 9105 (3840) | 259 | 10478 | $0.00145 |

**Quality, honestly:**
- The patches are minimal and exactly on target. The model picked the right op index for "Filling" from the LINE alone.
- The questions are specific to this line, using its real numbers and station names.
- One small inaccuracy in a question: it calls the `pack` station's 4 s op its cycle time, but TIMING shows 10.48 s with the transfers. Harmless in a question; worth a sharper TIMING description later.
- Real input ≈ 8–9k tokens (the bottling line itself ≈ 2.3k), about **$0.0011–0.0017 per edit**. The printer line would be roughly twice that.
- The shared prefix (instructions + catalog, 3840 tokens) was cached from the second call on, unlike the Builder's and Spec's calls.

**Recorded and replayed:**
- the 3 answers are in `agents/fixtures/responses/`; `tests/agents/editor-live.test.js` replays them (3 mock answers, 0 live)
- in the app, the copy + propose replayed for $0 (`screenshots/editor-live-pending.png`: the rename diff; `editor-live-questions.png`: the four questions with only Discard offered)
- afterwards I deleted the check copy (`lines/bottlingEdit/`, `generated/bottling-edit/`, the pending file)

**Changed**
- `scripts/editor-live.mjs` (new), `npm run editor:live`: the job's requests proposed live (never applied), tokens / cost / time per call, answers recorded
- `agents/fixtures/jobs/editor-bottling.json` (new), `agents/fixtures/responses/*.json` (3 new)
- `tests/agents/editor-live.test.js` (new)

**Results**
- `npm test`: 77 files, **2171 tests passed**
- spent $0.0043 in this step

## Phase 10 status: done

Lines stored with a version per change, compiled after each save (only changed files rewritten), the Builder's finished lines saved there, the Editor agent (request → checked JSON Patch, or questions), apply / discard / undo from the twin page, and three live edits recorded for replay.

**Spend so far:** $0.0161 of the $4.50 cap (Builder $0.0063, Spec $0.0055, Editor $0.0043).

Next phase: **Phase 11, LLM critique, SimPy and KPIs**: the Reviewer's critique pass (a short text summary of the line checked against the brief, only after the deterministic checks pass), the SimPy emitter from `timing.js`, running SimPy and feeding its event trace into a KPI overlay, and the zip download. One decision from Claude.md §13 comes up there: **how the SimPy event traces and KPIs connect to your teammates' parts (format, interface)**.

## Phase 11: LLM critique, SimPy and KPIs

Phase 10 approved by the owner moving on (2026-11-24).

**Decisions** (Claude.md §13, asked 2026-11-24): the SimPy output goes to the teammates as **my recommended format**: `trace.jsonl` (one event per line) plus `kpis.json`, in `simpy/<line>/`, documented in `simpy/FORMAT.md`; available **both** as files and over HTTP; the **default KPIs** (throughput, takt achieved, utilisation per station, WIP, lead time, reject rate).

| Step | Content |
|---|---|
| 11.1 | SimPy emitter from the timing table, per unit; runner; `simpy/FORMAT.md` |
| 11.2 | `/api/simpy` (run, KPIs, trace) |
| 11.3 | KPI overlay on the twin page (live 3D numbers next to the SimPy KPIs) |
| 11.4 | Zip download; the Reviewer's LLM critique (summary text against the brief, after the checks pass) |
| 11.5 | First live critique call (asks the owner first) |

### Steps 11.1–11.2: the SimPy model and its API (approved)

**Result first:** every line gets a SimPy model generated from its factory.json, and it agrees with the 3D twin's own played run:

| Line | SimPy makespan | Twin, played | Difference | Rejects |
|---|---|---|---|---|
| bottling (parallel copies, reject branch to rework, a buffer of 3) | 140.2 s | 140.3 s | 0.1 % | 2 (serials 4, 8) |
| printer (rejects parked on ST5's lane) | 772.1 s | 771.4 s | 0.1 % | 2 (serials 5, 8) |
| lubricant (indexing station, batches / cases / pallets) | 911.0 s | 964.7 s | **5.6 % short** | 0 |

- **How** (`compiler/simpy.js`):
  - `simData` plans **each unit with its own facts**, in serial order: the product's (a quality verdict by serial) and the bay facts the twin keeps per station (`<port>Slot`: units sent to a slotted port so far, in turn)
  - so every unit has each station's real cycle time and the port it leaves by: a reject takes the reject branch's time and leaves by the reject port, exactly as the twin plays it
  - `emitSimPy` writes `model.py`: a **fixed Python template with the data embedded** (rule 1). Stations hold one unit; transfers hold their capacity, first in first out; whoever can't hand over re-checks every 0.25 s, as the twin does. Nothing random.
- **Bugs found on the way**, by comparing with the twin:
  1. my first model let a station hold one unit while the next waited in its slot (two per station)
  2. the printer's rejects decide on a second fact (`rejectSlot`), which the plan didn't get, so no unit was ever rejected
  3. a unit left on a stack (the palletiser's pallet) first counted as a reject (all 27 lubricant cases). Now only an exit by another port is a reject; a stack is a normal end.
- **The lubricant gap** is real and documented in FORMAT.md: its indexing and batch stations hold several units at once, which the unit-by-unit model doesn't capture yet.
- `compiler/timing.js`: each station row now also has `exit` and `stacked`.
- `server/simpyRun.js`: `writeModel` (`simpy/<folder>/model.py`), `runModel` (Python from `PYTHON` or `python`; clear errors for no Python / no simpy / a failed model), `readResults`.
- `scripts/simpy.mjs`, `npm run simpy`: every example (or `--line <id>`), the KPIs next to the twin's estimate.
- `server/simpyApi.js`:
  - `POST /api/simpy/run { line | example }`
  - `GET /api/simpy/<folder>/kpis.json`
  - `GET /api/simpy/<folder>/trace.jsonl?since=<t>` (NDJSON)
- `simpy/FORMAT.md`: files, every event and its fields, every KPI, the HTTP routes, the model and its agreement with the twin. For your teammates.
- Run outputs (`trace.jsonl`, `kpis.json`) are git-ignored; `model.py` is generated like `generated/`. The dev server's watcher ignores `simpy/`.
- `tests/compiler/simpy.test.js` (6; the runs skip when Python or simpy is missing):
  - per-unit data and rejects; the printer's slot fact; the template
  - bottling and printer within **0.5 %** of the twin's played run, the trace's format and order, every unit released and leaving once, the KPIs consistent
  - the lubricant line within 10 %
  - the API

### Step 11.3: the KPI overlay (approved)

- `app/pages/twin/KpiOverlay.js`, bottom left on the twin page (edit mode and compiled lines; never in golden screenshots or frozen `?t` views):
  - **3D twin, live:** sim time, units out, units in the line, rate so far
  - **SimPy model:** throughput, takt achieved against planned, lead time (mean, range), WIP (mean, max), the run's makespan and good units, rejects, a utilisation bar per station, the planned bottleneck, links to the trace and kpis.json
  - **Run SimPy** runs it on demand; the last results are shown when the page opens; it folds away
- Screenshots: `kpi-printer.png` (ST3 at 78 % is the bottleneck), `phase11-edit.png`.

### Step 11.4: zip download and the Reviewer's critique (approved)

- **Zip** (`server/lineZip.js`, `GET /api/lines/<id>/zip`, a ".zip" link in the Editor panel; dependency `fflate` 0.8.3, pre-approved in §5, 0 audit issues): `factory.json`, `history.json`, `generated/*.js`, `simpy/model.py` + the last `kpis.json` / `trace.jsonl` + `FORMAT.md`, `sdd/*` when the line came from the Spec flow, and a README saying what each is. Deterministic for a fixed time. A copied bottling line's zip: 21.5 KB.
- **Critique** (`agents/reviewer/critique.js`, `agents/prompts/critic.md`):
  - **only after the deterministic checks pass** (rule 3; with errors it answers "fix those first" and makes no call)
  - the model reads a **short text summary** of the line (`lineSummary`: line, timing and bottleneck, per station its machines, op count and work labels, the flow, the SimPy KPIs, the checks' warnings; **no code**, rule 7) next to the approved brief (`sdd/<id>/brief.json`, when there is one)
  - it answers `{ verdict: fits | concerns | misfit, summary, issues: [{ severity, station, issue, request }] }`; a station it names that the line hasn't got becomes "the whole line"
  - each issue's `request` is a plain-words change the **Editor** can carry out: in the panel, one click proposes it (and you still apply or discard)
- `POST /api/lines/<id>/critique`: kept in `.agent-cache/critique/<id>.json` with the version it read; shown as stale once the line changes.
- **Not done from §7.3:** the critique's failures don't go back to the **Builder** automatically yet. They go to you, and through the Editor, as requests.
- Tests: `tests/server/lineZip.test.js` (2), `tests/agents/critique.test.js` (3).

**Results**
- `npm test`: 80 files, **2182 tests passed** (+11)
- no live call in steps 11.1–11.4; nothing spent
- check data (a copied line, its SimPy run) deleted afterwards

**Limits**
- The lubricant line's batch stations (above).
- The KPI card covers the left end of a long line on the twin page; it folds away, and the camera doesn't yet leave room for it.
- The zip's Three.js files import the project's `lib/`, so they run inside the project, not on their own (the README says so).

**Next:** step 11.5, the first live critique call (with your OK): the critic on a copy of the bottling line with its SimPy KPIs (about $0.002 on nano), recorded for replay, and its advice judged honestly.

### Step 11.5: the first live critique (approved)

Steps 11.1–11.4 approved by the owner ("ok continue", 2026-11-24, also the OK for this live call).

**Result first:** the Reviewer on gpt-5.4-nano, reading a copy of the bottling line, its SimPy KPIs and a brief that deliberately asks for more than the line does (300/h, a Label step the line hasn't got). Verdict **concerns**, with 5 issues. Two calls: $0.00195 and $0.00137; the ledger total is now **$0.0195** (**$4.4805 of the $4.50 cap left**).

**The first answer exposed two of my bugs** (hence a second call):
1. **My throughput KPI was misleading for a short run.** "205 good units/h" was good units over the whole 140 s makespan, filling the empty line included, and the model read it as missing 300/h by a third. At the achieved takt of 9.75 s the line holds 369 units/h, about **295 good/h**.
   - New KPI `steadyPerHour` (3600 / takt achieved × the good share), in kpis.json, FORMAT.md, the overlay ("Throughput, steady 295/h, 205/h over this run") and the critic's summary (both figures, labelled).
2. **Every issue's station was lost:** the model names stations by code ("P"), and my mapping only knew ids. It now maps id, code or title.

**The re-recorded answer:**

| Severity | Issue | Judged |
|---|---|---|
| high | Rework is a placeholder; reworked bottles don't return to the flow | right (the placeholder warning, and rework's output leads nowhere) |
| high | Case packing is a placeholder | right |
| medium | 295 good/h against the 300/h target, no margin; pack is the bottleneck | right, with the fixed KPI |
| medium | No Label station though the brief has a Label step | right (the planted miss) |
| medium | Food grade isn't reflected in the machine choices | not actionable: the catalog has no food-grade setting |

**Weak points:**
- Its summary first says the line "implements Fill → Cap → Label → Inspect → Pack", then lists the missing Label station.
- It calls 344/h "including the empty-line transient", but 344/h is the planned rate.
- It still leaves the station field empty.
- Its requests are long, and two need things the Editor can't do (a new station, catalog choices beyond a param change).

The advice is useful for a person; as automatic input to the Builder it would need the summary contradiction checked in code.

**Recorded and replayed:**
- the answer is in `agents/fixtures/responses/` (the first, superseded recording deleted)
- the line, brief and KPIs are kept in `agents/fixtures/jobs/critic-bottling.json`
- `tests/agents/critic-live.test.js` replays it
- in the app: a copy of the line + its own SimPy run + the brief in `sdd/bottlingEdit/` → the critique replayed for $0 (`screenshots/critique.png`); check data deleted afterwards

**Changed**
- `compiler/simpy.js` (`steadyPerHour`), `simpy/FORMAT.md`, `app/pages/twin/KpiOverlay.js`, `scripts/simpy.mjs`
- `agents/reviewer/critique.js`: station by id / code / title; the summary's simulation line with both throughputs
- `scripts/critic-live.mjs` (new), `agents/fixtures/jobs/critic-bottling.json` (new), `tests/agents/critic-live.test.js` (new)

**Results**
- `npm test`: 81 files, **2183 tests passed**
- spent $0.0033 in this step

## Phase 11 status: done

SimPy models from the IR, agreeing with the 3D twin within 0.1 % on the bottling and printer lines (lubricant 5.6 % short, documented); the trace and KPI files and HTTP routes for the teammates (`simpy/FORMAT.md`); the KPI overlay; the zip download; the Reviewer's critique after the deterministic checks, with Editor-ready requests.

**Spend so far:** $0.0195 of the $4.50 cap (Builder $0.0063, Spec $0.0055, Editor $0.0043, Reviewer $0.0033).

Next phase: **Phase 12, benchmarks** (Claude.md §10): 10–15 briefs from different industries in `benchmarks/briefs/`; 5 used to tune the library, 5 held out; the DIN 8580 / VDI 2860 / DIN 8593 coverage table in `benchmarks/coverage.md`; metrics (share of named / composite / placeholder parts, first-pass reviewer success, edit success, cost and time per line, a visual rating of screenshots). This is the phase that spends most of the budget: each brief through Spec → Builder → Reviewer is about $0.04–0.06 on nano, so 10 briefs ≈ $0.5.

## Phase 12: Benchmarks

Phase 11 approved by the owner moving on (2026-11-24: "continue as you prefer", also for the Phase 12 plan and its budget of about $0.5).

### Step 12.1: coverage table and briefs (done)

- **`benchmarks/coverage.map.json`**: every catalog component (77) and op (32) mapped to **DIN 8580** (main groups 1–6), **DIN 8593** (joining 4.1–4.9) and **VDI 2860** (store, change quantity, move, secure, check). Station furniture and timing ops are marked as no process.
- `scripts/coverage.mjs` / `scripts/coverage-lib.js`, `npm run coverage`:
  - checks the map against the registry (unmapped, stale, unknown codes)
  - writes **`benchmarks/coverage.md`**, where a process is covered by **named** parts, by **basic** blocks only (a composite), or not at all (a placeholder)
- **Result:** 11 of 20 processes named, 5 basic only, 4 none:
  - **none:** primary shaping (DIN 8580 1), joining by primary shaping (4.4: potting), **soldering** (4.7), **textile joining** (4.9)
  - **basic only:** separating / cutting (3), coating (5), changing properties (6), welding (4.6), riveting (4.5)
- **10 briefs** in `benchmarks/briefs/` (`index.json`), written as owners would describe them:
  - tuning set: water bottling, lotion filling, PCB assembly, battery modules, car-door sub-assembly
  - held-out set: sliced bread packing, tablet blisters, furniture panel cutting, t-shirt folding, coffee capsules (deliberately including the gaps: cutting, sealing, soldering-free but folding / textile)
- `tests/scripts/coverage.test.js` (3)

### Step 12.2: the benchmark runner and five tuning rounds (done, results honest)

- **`agents/benchmark.js`** `runBrief`, the whole pipeline without a person:
  - Spec brief, auto-approved with its assumptions → plan → Builder station by station
  - the whole-line review with a played run → SimPy → the standard edit ("Make the slowest station about 10 percent faster.") → the critique
  - metrics per brief; `summarize` for the §10 metrics
- **`scripts/benchmark.mjs`**, `npm run benchmark -- --set tuning|heldOut [--live]`:
  - records every live answer as a fixture (a run replays for $0)
  - writes `benchmarks/results/runs/*.json`, `lines/*.factory.json` and `benchmark.md`
- `tests/agents/benchmark.test.js` (3): the whole pipeline with a scripted model; an LLM refusal stops the run with its reason; the summary.
- **Five live tuning rounds** (`benchmarks/results/tuning-log.md`), $0.264 plus $0.016 of re-recordings. After each, the generic causes were fixed (12 fixes, none brief-specific):
  - **library:** ops declare what they need: `needs.motions` (operate: state + progress; pick-and-place: x, y, z, yaw), `needs.valueMotion` (toolOn), `needs.product` (installPart / driveScrew: parts; routeCable: cables)
  - **Builder schemas:**
    - a shell's geometry no longer set by agents (labels and colour only)
    - `item` args typed to the station's items
    - each op offered only the machines that can drive it
    - ops needing product features only for products that have them
  - **Builder code:**
    - the layout told what each shell provides
    - conveyor repairs (the shell's, the station's only one, or a new one of the line's transport)
    - titles shortened
    - the station id from the plan
    - edge transport chosen by the goods passed
    - **every listed op checked at the layout phase against the station's machines**, the refusal naming catalog types that can do it
  - **LLM layer:** an answer cut off at the output limit is retried once with twice the limit (mock replays the longer one)
  - **runner:** stage labels
- **Result after round 5: no tuning line completes unaided.**
  - The first station built on up to 4 of 5 lines (round 3); the stations stop in the **process phase** on op semantics (which machine an op drives, motion names and value types, a decision's branches).
  - The answers vary a lot between runs, so each round surfaces new failure kinds.
  - **The Spec agent was reliable** (every brief and plan passed its checks, ≈ $0.004 per brief).
- The Builder's replay fixture (8.6) was re-recorded twice as the schemas changed; it now passes first time (tank, filler, nozzle).

**Results**
- `npm test`: 83 files, **2190 tests passed**
- **spend:** Phase 12 $0.276; total $0.2955 of the $4.50 cap (Builder $0.260, Spec $0.028, Editor $0.004, Reviewer $0.003)

**Open (needs the owner's decision):** how to go on with the Builder's reliability before the held-out run (below in the report).

### Step 12.3: mini round, held-out run, findings (done)

Asked 2026-11-25 how to go on; the owner chose **gpt-5.4-mini for the Builder** and 4 retries per station for a tuning round, then the held-out set once.

- **`LLM_STRONG_AGENTS`** (new, `agents/llm.js`): agents that always use the strong model (here only the Builder, for the benchmark run via `--strong builder`); `LLM_STRONG_ENABLED` for plan.md stays off; strong prices required when used; tested. `.env` untouched.
- `scripts/benchmark.mjs`: `--strong <agents>`, `--retries <n>`; each run records the models and retries used.
- **Mini round** ($0.170): the same two first stations built as on nano, no more. **The stronger model was not the answer.** It exposed two defects in my code, now fixed:
  - the pallet transfer chosen by goods got default params (its carrier length didn't fit): it now carries the station's carriers
  - goods continuity between stations is told to the layout phase and refused there
- **Held-out set** (nano, 4 retries, run once, $0.096): **5 / 5 briefs and plans valid; 4 of 31 stations built (3 first time); no line complete**.
- **`benchmarks/results/findings.md`:**
  - what worked: the Spec agent reliable, the deterministic layer catching every mistake
  - what failed: the Builder's process phase on op semantics, goods, composites and length
  - what that means: assisted, not autonomous
  - what would help: per-machine process templates as data, a per-machine op vocabulary, deterministic process defaults
- `benchmarks/results/benchmark.md` (both sets) and `tuning-log.md` (all seven runs).

**Results**
- `npm test`: 83 files, **2191 tests passed**
- **spend:** Phase 12 $0.542; **total $0.5614 of the $4.50 cap**

## Phase 12 status: done (measured; the results are weak for the Builder and say so)

All 12 phases of Claude.md are now built. The benchmark shows the system works as an **assisted** builder (approved documents reliably; the Builder needs the owner's corrections for most stations) rather than an autonomous one.

**Next, the owner's call:** the step most likely to make lines complete unaided is **per-machine process templates** (each named component ships its standard process as data, so the model picks and parameterizes instead of composing ops). It is library work beyond Claude.md's phases.
