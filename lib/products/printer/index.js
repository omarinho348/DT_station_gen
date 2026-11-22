// The `printer` product: an open-frame 3D printer on its work carrier with the kit tray. One unit
// keeps its identity (the same Object3D) from kitting (ST1) to the dispatch pallet (ST6).
// Ported from the reference PrinterModel.js (createProductFactory).
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';
import { CARRIER, PRODUCT_STAGES, TRAY, qualityFor, serialLabel, verdictFor } from './definition.js';
import { printerMaterials } from './materials.js';
import { CABLE_NAMES, DOCK_PORT, PART_POSES, cableRoute, createPartCopy, partGrasp, partPose, partScrews, rotationFor, screwPoint } from './parts.js';

/** Cables that come attached to a part and lie coiled behind the printer once it is fitted. */
const ATTACHED_CABLES = { bedCable: 'Heated bed', powerCable: 'Power', hotendCable: 'Hotend' };
import { createPrinter } from './printer.js';
import { ROUTINES, createRoutines } from './routines.js';
import { createCarrier, createKitTray, SHARED_PRODUCT_MATERIALS } from './carrier.js';

const PRINTER_ORIGIN = [CARRIER.buildX, CARRIER.thickness, 0];

defineProduct({
  type: 'printer',
  summary: 'Open-frame 3D printer (i3 style) assembled on a work carrier from a kit tray: 14 parts, harness, test print, QC label.',
  params: z.object({
    serial: z.number().int().min(1).max(9999).default(1).describe('Serial number'),
  }),
  stages: [...PRODUCT_STAGES],
  refs: ['printerOrigin', 'trayCentre', 'dockPort'],
  parts: Object.keys(PART_POSES),
  // Visual details the stations switch mid-process (a stage change resets them).
  features: {
    yBelt: { values: ['loose', 'engaged'] },
    ...Object.fromEntries(Object.keys(ATTACHED_CABLES).map((key) => [key, { values: ['hidden', 'stowed'] }])),
  },
  // Its own test firmware (ST4): homing, probing, heating, printing…
  routines: ROUTINES,
  // ST6 lifts the printer itself off its carrier into a carton.
  payloads: ['printer'],
  // ST5 decides on it: the bed is flat enough or not (deterministic per serial).
  facts: { verdict: { values: ['PASS', 'REJECT'] } },
  // The harness: routes in the carrier frame (printer space + PRINTER_ORIGIN).
  cables: [...CABLE_NAMES],
  cableRoute(name) {
    const at = new THREE.Vector3(...PRINTER_ORIGIN);
    const r = cableRoute(CABLE_NAMES.indexOf(name));
    return { kind: r.kind, a: { point: r.a.point.add(at), dir: r.a.dir }, coil: r.coil.add(at), clips: r.clips.map((c) => c.add(at)), b: { point: r.b.point.add(at), dir: r.b.dir, socket: r.b.socket } };
  },
  // A free-standing part for a supermarket location, resting as it lies in `mode` (kit tray /
  // assembled; the base frame has no kit pose and rests as assembled, on its locators).
  copy({ part, mode, materials: shared }) {
    const pose = PART_POSES[part][mode] ? mode : 'asm';
    const { at, yaw, swing } = partPose(part, pose);
    const root = new THREE.Group();
    root.name = `Part copy ${part}`;
    const inner = createPartCopy(part, printerMaterials(shared));
    inner.quaternion.copy(rotationFor(yaw, swing));
    inner.position.y = pose === 'kit' ? at.y - TRAY.floor : at.y;
    root.add(inner);
    const grasp = partGrasp(part).applyQuaternion(inner.quaternion).add(inner.position);
    inner.updateMatrix();
    return { object: root, grasp: { point: grasp, yaw }, partFrame: inner.matrix.clone() };
  },
  build({ params, materials: shared }) {
    const m = printerMaterials(shared);
    const { serial } = params;
    const root = createCarrier(m, serial);
    root.name = `Product ${serialLabel(serial)}`;
    const kitTray = createKitTray(m);
    kitTray.position.set(CARRIER.trayX, CARRIER.thickness, 0);
    root.add(kitTray);
    const printer = createPrinter(m);
    printer.root.position.set(...PRINTER_ORIGIN);
    printer.root.userData.dispose = () => printer.dispose();
    root.add(printer.root);
    let stage = PRODUCT_STAGES[0];
    let tested = false; // results recorded by a test station (ST4) without a stage change
    const at = (level) => PRODUCT_STAGES.indexOf(stage) >= PRODUCT_STAGES.indexOf(level);

    return {
      root,
      setStage(next) {
        stage = next;
        printer.applyStage(next);
      },
      facts: { verdict: () => verdictFor(serial) },
      payloads: { printer: printer.root },
      routines: createRoutines(printer, { serial, label: serialLabel(serial), markTested: () => { tested = true; } }),
      harness: {
        setCable(name, { mode, grip = null, passed = 0 }) {
          printer.setCable(CABLE_NAMES.indexOf(name), { mode, grip: grip ? grip.clone().sub(new THREE.Vector3(...PRINTER_ORIGIN)) : null, passed });
        },
      },
      features: {
        yBelt: (value) => printer.setBeltEngaged(value === 'engaged'),
        ...Object.fromEntries(Object.entries(ATTACHED_CABLES).map(([key, cable]) => [key, (value) => {
          const index = CABLE_NAMES.indexOf(cable);
          if (value === 'stowed') printer.stowAttachedCable(index);
          else printer.setCable(index, { mode: 'hidden' });
        }])),
      },
      refs: {
        printerOrigin: () => root.position.clone().set(...PRINTER_ORIGIN),
        trayCentre: () => root.position.clone().set(CARRIER.trayX, CARRIER.thickness, 0),
        dockPort: () => root.position.clone().set(...PRINTER_ORIGIN).add(DOCK_PORT),
      },
      // Generic assembly interface (registry ASSEMBLY_API), product frame. The printer's own
      // space starts at PRINTER_ORIGIN on the carrier.
      assembly: {
        origin: () => new THREE.Vector3(...PRINTER_ORIGIN),
        grip: (name, mode) => ({
          point: printer.graspAt(name, mode).add(new THREE.Vector3(...PRINTER_ORIGIN)),
          yaw: partPose(name, mode).yaw,
        }),
        pose: (name, mode) => {
          const { at, yaw, swing } = partPose(name, mode);
          return new THREE.Matrix4().compose(at.add(new THREE.Vector3(...PRINTER_ORIGIN)), rotationFor(yaw, swing), new THREE.Vector3(1, 1, 1));
        },
        object: (name) => printer.parts[name].object,
        setPart: (name, mode) => {
          if (mode !== 'carried') return printer.setPart(name, mode);
          // Carried by a gripper: visible, and no longer driven by the printer's own axes.
          printer.parts[name].mode = 'carried';
          printer.parts[name].object.visible = true;
          return undefined;
        },
        screws: (name) => partScrews(name),
        screwSeat: (id) => screwPoint(id).add(new THREE.Vector3(...PRINTER_ORIGIN)),
        setScrew: (id, driven) => printer.setScrew(id, driven),
      },
      api: {
        serial,
        label: serialLabel(serial),
        printer,
        kitTray,
        /** ST4's measured results, once tested (deterministic per serial). */
        quality: () => (at('tested') || tested ? qualityFor(serial) : null),
        /** ST5's verdict, once inspected. */
        verdict: () => (at('inspected') ? verdictFor(serial) : null),
        /** A free-standing copy of a part, for supermarket locations (ST1). */
        partCopy: (name) => createPartCopy(name, m),
      },
      dispose() {
        root.getObjectByName('Serial plate').material.map?.dispose();
        // Taken off the carrier (packed in a carton): its new holder frees it, not the carrier.
        let ownsPrinter = false;
        root.traverse((o) => { if (o === printer.root) ownsPrinter = true; });
        if (ownsPrinter) printer.dispose();
        const keep = new Set([
          ...Object.values(shared),
          ...Object.values(m.own),
          ...SHARED_PRODUCT_MATERIALS(),
        ]);
        root.traverse((o) => {
          if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
          for (const material of [o.material].flat()) if (material && !keep.has(material)) material.dispose();
        });
      },
    };
  },
});
