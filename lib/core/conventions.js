// Line conventions shared by every station (from the reference PrinterLineDefinition.js).
// These become the defaults of constitution.md; a factory.json may override line-wide values.
// Metres and seconds. Station-local frame: product flows +X, conveyor centre line at z = 0,
// operator walkway on +Z, equipment and fencing on −Z.

export const CONVENTIONS = Object.freeze({
  units: 'm',
  flow: '+X',
  walkwaySide: '+Z',
  equipmentSide: '-Z',
  /** Top of the conveyor belt, where products and carriers ride. */
  beltHeight: 0.85,
  /** Carrier centre X at the station's ports. */
  ports: Object.freeze({ input: -1.6, work: 0, output: 1.6 }),
  /** Station conveyor ends (local X). */
  conveyor: Object.freeze({ start: -2.2, end: 2.2, speed: 0.45, ramp: 0.35 }),
  /** Lift units move carriers between the line and the return line below. */
  lift: Object.freeze({ drop: 0.5, duration: 0.9 }),
  /** Gap between neighbouring stations' conveyors, filled by a transfer conveyor. */
  transferLength: 1.2,
  /** Station slab half-length along X. */
  slabHalfLength: 2.35,
  /** Simulation speed choices. */
  speeds: Object.freeze([1, 2, 10]),
});

/** The values every component build() receives in its context unless a line overrides them. */
export const DEFAULT_BUILD_CONTEXT = Object.freeze({
  beltHeight: CONVENTIONS.beltHeight,
});
