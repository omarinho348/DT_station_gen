// The printer product's own data, from the reference PrinterLineDefinition.js. Line-wide
// conventions (belt height, ports, conveyor) live in lib/core/conventions.js; only what belongs
// to the product (carrier, kit tray, size, build stages, quality rule) is here. Metres.

export const CARRIER = {
  length: 1.2,
  width: 0.62,
  thickness: 0.03,
  /** Printer build zone and kit tray centres along the carrier (carrier-local X). */
  buildX: -0.31,
  trayX: 0.29,
  /** Wear strips under the plate run on the pallet conveyor's strands (strand centre lines). */
  strandZ: 0.24,
};

export const TRAY = { length: 0.6, width: 0.6, height: 0.045, floor: 0.012 };

/** Overall size incl. PSU, mainboard box and LCD (an open-frame i3-style printer). */
export const PRINTER_SIZE = { width: 0.55, depth: 0.44, height: 0.48 };

/** Build stages in line order (ST1 kits, ST2 frames, ST3 wires, ST4 tests, ST5 inspects). */
export const PRODUCT_STAGES = Object.freeze(['empty', 'kitted', 'framed', 'wired', 'tested', 'inspected']);

/** QA limit on bed flatness (mm): ST5 rejects above it. */
export const QA = { flatnessLimit: 0.12 };

/**
 * Deterministic test results (Claude.md rule 5): bed flatness (mm, from ST4's mesh probing) and
 * test-cube dimensional error (mm) are a function of the serial number only.
 */
export function qualityFor(serial) {
  const flatness = 0.04 + ((serial * 37) % 11) / 100;
  const dimError = 0.02 + ((serial * 13) % 7) / 100;
  return { flatness: Number(flatness.toFixed(2)), dimError: Number(dimError.toFixed(2)) };
}

/** ST5's verdict for a serial: rejected when the bed is not flat enough. */
export const verdictFor = (serial) => (qualityFor(serial).flatness > QA.flatnessLimit ? 'REJECT' : 'PASS');

export const serialLabel = (serial) => `P1-${String(serial).padStart(4, '0')}`;
