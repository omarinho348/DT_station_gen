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

**Next:** Phase 3: ops, station and line runtime. First step: basic ops (`move, rotate, grip, release, toolOn, transform, transfer, wait, decide`) on `defineOp`, with durations from the trapezoid / quintic profiles, and `PickPlace.js` / `AssemblyCycle.js` (already here) as the reference for the named ops.
