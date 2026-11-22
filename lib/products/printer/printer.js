// The assembled printer: every part in its kit / assembled / carried pose, its own axes (ST4),
// fasteners, belt, cable harness (laid live through the clips), test print, LCD and QC sticker.
// Ported from the reference PrinterModel.js (createPrinter). Printer space (see parts.js).
import * as THREE from 'three';
import { addMesh, group } from '../../core/primitives.js';
import { liveCanvasTexture, textLabel } from '../../core/textures.js';
import { PRODUCT_STAGES } from './definition.js';
import {
  cableRoute,
  PART_POSES, PART_ORDER, PRINTER_AXES, BOARD_SOCKETS, DOWN, CABLES, CABLE_SEGMENTS, CABLE_RADIAL,
  buildPart, cached, partGrasp, partPose, placeByGrasp, rotationFor,
} from './parts.js';

const HALF_PI = Math.PI / 2;

// ---- Printer -----------------------------------------------------------------------------------

const LABELS = {};
function qcTexture(pass) {
  const key = pass ? 'pass' : 'fail';
  LABELS[key] ||= textLabel({
    width: 256,
    height: 160,
    background: pass ? '#2f9a4a' : '#c8231d',
    color: '#ffffff',
    lines: [{ text: pass ? 'QC PASS' : 'REJECT', size: 56, y: 0.4 }, { text: pass ? 'ST5 vision' : 'Bed flatness', size: 26, y: 0.76, bold: false }],
  });
  return LABELS[key];
}

function drawDisplay(context, width, height, lines) {
  context.fillStyle = '#123a5c';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#d9f1ff';
  context.font = 'bold 22px monospace';
  lines.forEach((line, index) => context.fillText(line, 10, 30 + index * 28));
}

/** Catenary-like sag: a lowered midpoint between two free points, never below the carrier. */
function sagged(points, slack) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (slack[i - 1]) {
      const length = a.distanceTo(b);
      const mid = a.clone().lerp(b, 0.5);
      mid.y = Math.max(0.006, mid.y - Math.min(0.35 * length, 0.07));
      out.push(mid);
    }
    out.push(b);
  }
  return out;
}

export function createPrinter(materials) {
  const root = group(null, 'Printer');
  const parts = {};
  Object.keys(PART_POSES).forEach((name) => {
    const object = buildPart(name, materials);
    root.add(object);
    parts[name] = { object, grasp: partGrasp(name), mode: 'hidden' };
  });

  const bedSheet = parts.Bed.object.getObjectByName('Build sheet').material;
  const heater = parts.PrintHead.object.getObjectByName('Heater block').material;
  const screen = parts.Display.object.getObjectByName('Screen');
  const probePin = parts.PrintHead.object.getObjectByName('Probe pin');
  const carriage = parts.XGantry.object.getObjectByName('Carriage');
  const belt = { free: parts.BaseFrame.object.getObjectByName('Belt tied off'), engaged: parts.BaseFrame.object.getObjectByName('Belt engaged') };
  const harnessCoils = [0, 1, 2, 3].map((index) => parts.Harness.object.getObjectByName(`Harness coil ${index + 1}`));

  // Test print: a 40 mm calibration cube on the build sheet that grows layer by layer (ST4).
  const testPrint = addMesh(parts.Bed.object, new THREE.BoxGeometry(0.04, 0.04, 0.04).translate(0, 0.02, 0), materials.filament, 'Test cube', [0, 0.0195, 0.0]);
  testPrint.visible = false;

  // First-layer purge line along the front edge of the sheet (ST4 prints it before the cube).
  const purge = addMesh(parts.Bed.object, new THREE.BoxGeometry(0.18, 0.0006, 0.0018).translate(0.09, 0.0003, 0), materials.filament, 'Purge line', [-0.09, 0.0195, 0.06], { castShadow: false });
  purge.visible = false;
  const hotendFan = parts.PrintHead.object.getObjectByName('Hotend fan');

  // QC sticker on the right upright's front face (ST5); offset so it never z-fights.
  const qcLabel = addMesh(parts.Upright_R.object, new THREE.PlaneGeometry(0.03, 0.05), new THREE.MeshStandardMaterial({ roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), 'QC label', [0, 0.12, 0.0205], { castShadow: false });
  qcLabel.visible = false;

  const axes = { head: 0, bed: 0, nozzle: PRINTER_AXES.nozzleRest };

  // Cables: tube + connector at each end; attached cables also have a rest coil.
  const cables = CABLES.map((definition) => {
    const material = materials.cable[definition.color];
    const mesh = addMesh(root, new THREE.BufferGeometry(), material, `Cable ${definition.name}`);
    mesh.castShadow = false;
    const connectorA = addMesh(root, cached('connector', () => new THREE.BoxGeometry(0.012, 0.007, 0.006)), materials.guide, `Connector A ${definition.name}`);
    const connectorB = addMesh(root, cached('connector', () => new THREE.BoxGeometry(0.012, 0.007, 0.006)), materials.guide, `Connector B ${definition.name}`);
    let coil = null;
    if (definition.kind === 'attached') {
      coil = addMesh(root, cached('restCoil', () => new THREE.TorusGeometry(0.022, 0.003, 6, 24).rotateX(HALF_PI)), material, `Coil ${definition.name}`);
    }
    return { definition, mesh, connectorA, connectorB, coil, state: { mode: 'hidden', grip: null, passed: 0, reveal: 1 } };
  });

  const resolve = (point) => {
    if (Array.isArray(point)) return new THREE.Vector3(...point);
    const part = parts[point.part].object;
    return new THREE.Vector3(...point.at).applyQuaternion(part.quaternion).add(part.position);
  };
  const coilPoint = (cable) => {
    const { definition } = cable;
    if (definition.kind === 'loose') return harnessCoils[definition.coil].position.clone().add(parts.Harness.object.position).add(new THREE.Vector3(0.012, 0.004, 0.016));
    return resolve(definition.rest).add(new THREE.Vector3(0, 0.003, 0));
  };
  const boardSocket = (cable) => resolve({ part: 'ElectronicsBox', at: new THREE.Vector3(...BOARD_SOCKETS[cable.definition.b]).sub(partPose('ElectronicsBox', 'asm').at).toArray() });

  let display = null; // { live, material }, made on first use
  let displayKey = '';

  const printer = {
    root,
    parts,
    axes,
    cables,
    testPrint,

    setPart(name, mode) {
      const part = parts[name];
      part.mode = mode;
      part.object.visible = mode !== 'hidden';
      if (mode === 'hidden') return;
      const pose = partPose(name, mode);
      part.object.position.copy(pose.at);
      part.object.quaternion.copy(rotationFor(pose.yaw, pose.swing));
      if (mode === 'asm') printer.applyAxes();
      printer.refreshCables();
    },

    /** Printer-space point the gripper holds when the part is in `mode` pose. */
    graspAt(name, mode) {
      const pose = partPose(name, mode);
      return parts[name].grasp.clone().applyQuaternion(rotationFor(pose.yaw, pose.swing)).add(pose.at);
    },

    /** Moves a part (being carried) so its grasp point is at `point` (printer space). */
    carry(name, point, yaw, swing) {
      const part = parts[name];
      part.mode = 'carried';
      part.object.visible = true;
      placeByGrasp(part.object, part.grasp, point, yaw, swing);
    },

    // ---- Fasteners and belts --------------------------------------------------------------

    setScrew(id, driven) {
      const [name, index] = id.split(':');
      parts[name].object.userData.screws[Number(index)].visible = driven;
    },

    setPartScrews(name, driven) {
      parts[name].object.userData.screws.forEach((head) => { head.visible = driven; });
    },

    /** Y belt: tied off at the rear (false) or looped round the Y motor pulley (true). */
    setBeltEngaged(engaged) {
      belt.free.visible = !engaged;
      belt.engaged.visible = engaged;
    },

    // ---- Axes -------------------------------------------------------------------------------

    /** Moves the printer's own axes: print head X, bed Y (along Z) and nozzle height. */
    setAxes({ head = axes.head, bed = axes.bed, nozzle = axes.nozzle } = {}) {
      axes.head = head;
      axes.bed = bed;
      axes.nozzle = nozzle;
      printer.applyAxes();
    },

    applyAxes() {
      const lift = axes.nozzle - PRINTER_AXES.nozzleRest;
      const place = (name, dx, dy, dz) => {
        if (parts[name].mode !== 'asm') return;
        const pose = partPose(name, 'asm');
        parts[name].object.position.set(pose.at.x + dx, pose.at.y + dy, pose.at.z + dz);
      };
      place('Bed', 0, 0, axes.bed);
      place('XGantry', 0, lift, 0);
      place('PrintHead', axes.head, lift, 0);
      carriage.position.x = axes.head;
      // T8 lead screw: 8 mm per turn; it turns as the gantry climbs.
      if (parts.LeadScrew.mode === 'asm') parts.LeadScrew.object.rotation.y = (lift / 0.008) * Math.PI * 2;
      printer.refreshCables(true);
    },

    /** Bed probe pin, 0 = stowed, 1 = deployed. */
    setProbe(deployed) {
      probePin.position.y = -0.012 * deployed;
    },

    // ---- Cables -----------------------------------------------------------------------------

    /** Socket position (printer space) of cable end A and its insertion direction. */
    socketA(index) {
      const { a } = cables[index].definition;
      return { point: resolve(a), dir: new THREE.Vector3(...(a.dir || DOWN)) };
    },

    socketB(index) {
      return { point: boardSocket(cables[index]), dir: new THREE.Vector3(...DOWN) };
    },

    coilPoint(index) {
      return coilPoint(cables[index]);
    },

    clipPoints(index) {
      return cables[index].definition.clips.map(resolve);
    },

    /**
     * Cable route with every part in its assembled pose and the axes at rest (for planning a
     * station's moves before the parts are installed): socket A, coil, clips, socket B.
     */
    cableRoute(index) {
      return cableRoute(index);
    },

    /**
     * Cable state:
     *   stowed    – loose: coiled in the harness bag; attached: coiled at its rest place
     *   carryA    – loose: end A in the gripper (`grip`), the rest still coiled
     *   pluggedA  – loose: end A plugged at the device, the rest still coiled
     *   routing   – end B in the gripper; cable laid from A through `passed` clips to the gripper
     *   done      – plugged at both ends, laid in all clips
     */
    setCable(index, patch) {
      Object.assign(cables[index].state, patch);
      printer.buildCable(cables[index]);
    },

    buildCable(cable) {
      const { definition, state, mesh, connectorA, connectorB, coil } = cable;
      const visible = state.mode !== 'hidden';
      const loose = definition.kind === 'loose';
      mesh.visible = false;
      connectorA.visible = false;
      connectorB.visible = false;
      if (coil) coil.visible = false;
      if (loose) harnessCoils[definition.coil].visible = parts.Harness.mode !== 'hidden' && (state.mode === 'hidden' || state.mode === 'stowed');
      if (!visible) return;
      const coilAt = coilPoint(cable);
      const a = resolve(definition.a);
      let points = null;
      let slack = [];
      let atA = a;
      let atB = null;
      switch (state.mode) {
        case 'stowed':
          if (loose) return;
          points = [a, coilAt];
          slack = [true];
          atB = coilAt;
          coil.visible = true;
          coil.position.copy(coilAt);
          break;
        case 'carryA':
          harnessCoils[definition.coil].visible = true;
          points = [coilAt, state.grip.clone()];
          slack = [true];
          atA = state.grip;
          atB = coilAt;
          break;
        case 'pluggedA':
          harnessCoils[definition.coil].visible = true;
          points = [a, coilAt];
          slack = [true];
          atB = coilAt;
          break;
        case 'routing': {
          const clips = definition.clips.slice(0, state.passed).map(resolve);
          points = [a, ...clips, state.grip.clone()];
          slack = points.slice(1).map((_, i) => i === 0 || i === points.length - 2);
          atB = state.grip;
          break;
        }
        case 'done': {
          const clips = definition.clips.map(resolve);
          atB = boardSocket(cable);
          points = [a, ...clips, atB];
          slack = points.slice(1).map((_, i) => i === 0);
          break;
        }
        default:
          return;
      }
      const curvePoints = sagged(points, slack);
      // Remove near-duplicates (a degenerate curve can't be sampled).
      const clean = curvePoints.filter((point, i) => i === 0 || point.distanceTo(curvePoints[i - 1]) > 1e-4);
      if (clean.length >= 2) {
        mesh.geometry.dispose();
        mesh.geometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(clean, false, 'centripetal'), CABLE_SEGMENTS, 0.0026, CABLE_RADIAL, false);
        mesh.visible = true;
      }
      connectorA.visible = true;
      connectorA.position.copy(atA);
      if (atB) {
        connectorB.visible = true;
        connectorB.position.copy(atB);
      }
    },

    /** Rebuilds cables (all, or only those that touch a moving part while axes move). */
    refreshCables(movingOnly = false) {
      cables.forEach((cable) => {
        if (cable.state.mode === 'hidden') {
          // Hide its tube, plugs and rest coil too. (The reference skipped hidden cables here, so
          // their plugs and coils were left visible at the printer origin until first routed.)
          cable.mesh.visible = false;
          cable.connectorA.visible = false;
          cable.connectorB.visible = false;
          if (cable.coil) cable.coil.visible = false;
          if (cable.definition.kind === 'loose') harnessCoils[cable.definition.coil].visible = parts.Harness.mode !== 'hidden';
          return;
        }
        if (movingOnly && !cable.touchesMoving) return;
        printer.buildCable(cable);
      });
    },

    // ---- Test / QC state ----------------------------------------------------------------------

    /** Hotend and bed heat glow, 0 = cold, 1 = at temperature. */
    setHeat(level) {
      heater.emissive.setRGB(1, 0.25, 0.05);
      heater.emissiveIntensity = level * 1.6;
      bedSheet.emissive.setRGB(0.9, 0.35, 0.08);
      bedSheet.emissiveIntensity = level * 0.35;
    },

    /** LCD content: an array of text lines, or null for off. */
    setDisplay(lines) {
      const key = lines ? lines.join('|') : '';
      if (key === displayKey) return;
      displayKey = key;
      if (!lines) {
        screen.material = materials.screenOff;
        return;
      }
      if (!display) {
        const live = liveCanvasTexture(256, 160, { fallback: [18, 58, 92, 255] });
        const material = new THREE.MeshBasicMaterial({ map: live.texture, toneMapped: false });
        material.name = 'printer lcd';
        display = { live, material };
      }
      display.live.redraw((context, w, h) => drawDisplay(context, w, h, lines));
      screen.material = display.material;
    },

    setPurge(progress) {
      purge.visible = progress > 0;
      purge.scale.x = Math.max(progress, 0.001);
    },

    /** Turns the hotend fan (radians). */
    spinFan(angle) {
      hotendFan.rotation.y = angle;
    },

    setTestPrint(progress) {
      testPrint.visible = progress > 0;
      testPrint.scale.y = Math.max(progress, 0.001);
    },

    /** true = green QC PASS sticker, false = red REJECT tag, null = none. */
    setQcLabel(pass) {
      qcLabel.visible = pass !== null;
      if (pass === null) return;
      qcLabel.material.map = qcTexture(pass);
      qcLabel.material.needsUpdate = true;
    },

    applyStage(stage) {
      const level = PRODUCT_STAGES.indexOf(stage);
      Object.keys(parts).forEach((name) => {
        printer.setPart(name, 'hidden');
        printer.setPartScrews(name, false);
      });
      cables.forEach((cable) => { cable.state = { mode: 'hidden', grip: null, passed: 0 }; });
      printer.setBeltEngaged(false);
      axes.head = 0;
      axes.bed = 0;
      axes.nozzle = PRINTER_AXES.nozzleRest;
      if (level >= 1) {
        printer.setPart('BaseFrame', 'asm');
        PART_ORDER.ST1.slice(1).forEach((name) => printer.setPart(name, 'kit'));
        cables.forEach((cable) => { if (cable.definition.kind === 'loose') cable.state.mode = 'stowed'; });
      }
      if (level >= 2) {
        PART_ORDER.ST2.forEach((name) => {
          printer.setPart(name, 'asm');
          printer.setPartScrews(name, true);
        });
        printer.setBeltEngaged(true);
        // The heated bed's own cable comes with the bed; it lies coiled behind the printer.
        cables.forEach((cable) => { if (cable.definition.a.part === 'Bed') cable.state.mode = 'stowed'; });
      }
      if (level >= 3) {
        PART_ORDER.ST3.forEach((name) => {
          printer.setPart(name, 'asm');
          printer.setPartScrews(name, true);
        });
        cables.forEach((cable) => { cable.state.mode = 'done'; });
      }
      printer.refreshCables();
      printer.setProbe(0);
      printer.setTestPrint(level >= 4 ? 1 : 0);
      printer.setPurge(level >= 4 ? 1 : 0);
      printer.setHeat(0);
      printer.setDisplay(level >= 4 ? ['READY', 'Test print OK'] : null);
      printer.setQcLabel(level >= 5 ? true : null);
    },

    /** Once the attached cables' devices are installed (ST3), their coils appear at rest. */
    stowAttachedCable(index) {
      printer.setCable(index, { mode: 'stowed' });
    },

    dispose() {
      cables.forEach((cable) => cable.mesh.geometry.dispose());
      bedSheet.dispose();
      heater.dispose();
      display?.live.texture.dispose();
      display?.material.dispose();
      qcLabel.material.dispose();
    },
  };
  cables.forEach((cable) => {
    const { definition } = cable;
    const all = [definition.a, ...definition.clips];
    cable.touchesMoving = all.some((point) => !Array.isArray(point) && ['Bed', 'XGantry', 'PrintHead'].includes(point.part));
  });
  root.userData.printer = printer;
  return printer;
}
