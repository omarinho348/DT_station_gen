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

### Step 3: `cartesianGantry`, `fingerGripper`, `screwdriver` (done, awaiting approval)

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

**Next:** Phase 2, step 4: `scara` robot (the same tool interface, two-link IK). Code already in `Robots.js`; no new files needed.
