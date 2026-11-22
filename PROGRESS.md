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
