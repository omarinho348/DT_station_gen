// The `printer` product: an open-frame 3D printer on its work carrier with the kit tray. One unit
// keeps its identity (the same Object3D) from kitting (ST1) to the dispatch pallet (ST6).
// Ported from the reference PrinterModel.js (createProductFactory).
import * as THREE from 'three';
import { z } from 'zod';
import { defineProduct } from '../../registry.js';
import { CARRIER, PRODUCT_STAGES, qualityFor, serialLabel, verdictFor } from './definition.js';
import { printerMaterials } from './materials.js';
import { DOCK_PORT, PART_POSES, createPartCopy, partPose, partScrews, rotationFor, screwPoint } from './parts.js';
import { createPrinter } from './printer.js';
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
    root.add(printer.root);
    let stage = PRODUCT_STAGES[0];
    const at = (level) => PRODUCT_STAGES.indexOf(stage) >= PRODUCT_STAGES.indexOf(level);

    return {
      root,
      setStage(next) {
        stage = next;
        printer.applyStage(next);
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
        quality: () => (at('tested') ? qualityFor(serial) : null),
        /** ST5's verdict, once inspected. */
        verdict: () => (at('inspected') ? verdictFor(serial) : null),
        /** A free-standing copy of a part, for supermarket locations (ST1). */
        partCopy: (name) => createPartCopy(name, m),
      },
      dispose() {
        root.getObjectByName('Serial plate').material.map?.dispose();
        printer.dispose();
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
