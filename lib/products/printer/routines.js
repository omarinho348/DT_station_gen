// What the printer does by itself under test (its firmware): the ST4 sequence pieces of the
// reference CalibrationCycle, as product routines. A station plays one per timed step
// (`runRoutine`); each returns status values for the HMI / test monitor as it goes.
import { z } from 'zod';
import { smoother } from '../../core/motion.js';
import { PRINTER_AXES } from './parts.js';
import { QA, qualityFor } from './definition.js';

const lerp = (a, b, t) => a + (b - a) * t;
const num = z.number();
const temps = z.object({ hotend: num.default(215), bed: num.default(60), ambient: num.default(24) });

/** Deterministic 3 × 3 bed mesh (µm) whose peak-to-valley equals the unit's flatness (reference meshFor). */
export function meshFor(serial, flatness) {
  const raw = Array.from({ length: 9 }, (_, index) => Math.sin(serial * 1.7 + index * 2.3) + 0.4 * Math.cos(serial + index));
  const min = Math.min(...raw);
  const max = Math.max(...raw);
  const span = flatness * 1000;
  return raw.map((value) => Math.round(((value - min) / (max - min || 1)) * span - span / 2));
}

export const ROUTINES = {
  display: { summary: 'Show text on the printer LCD ({label}, {serial}, {flatness} filled in).', args: z.object({ lines: z.array(z.string().max(24)).max(4) }) },
  resetTest: { summary: 'Clear the previous unit\'s test values from the status.', args: z.object({}) },
  axes: { summary: 'Move the printer\'s own axes (head X, bed Y, nozzle height, m) with a smooth ease.', args: z.object({ head: num.optional(), bed: num.optional(), nozzle: num.optional() }) },
  fanSpin: { summary: 'Spin the hotend fan up.', args: z.object({ rate: num.default(80) }) },
  beltTest: { summary: 'Belt tension check: short pluck moves on X then Y, belt frequencies read back.', args: z.object({ x: num, y: num }) },
  resonanceTest: { summary: 'Input-shaper sweep: X then Y shaken with rising frequency.', args: z.object({ x: num, y: num }) },
  probe: { summary: 'Deploy (to 1) or stow (to 0) the bed probe pin.', args: z.object({ to: z.union([z.literal(0), z.literal(1)]), reportFlatness: z.boolean().default(false) }) },
  probeDip: { summary: 'Touch the bed with the probe at one mesh point; the point is recorded.', args: z.object({ index: z.number().int().min(0).max(8), height: num.default(0.012), depth: num.default(0.012) }) },
  heat: { summary: 'Heat hotend and bed to temperature (LCD and status show the temperatures).', args: temps },
  purge: { summary: 'Print the purge line along the front edge.', args: z.object({ from: num, to: num, bed: num, nozzle: num }) },
  printCube: { summary: 'Print the calibration cube: the nozzle traces each layer\'s square perimeter and steps up.', args: z.object({ layers: z.number().int().min(1).max(200), layerHeight: num, side: num }) },
  cool: { summary: 'Cool down after the print.', args: temps },
  record: { summary: 'Record the unit\'s measured results (deterministic per serial) on the unit.', args: z.object({}) },
  readRecord: { summary: 'Read the unit\'s test record (RFID): its measured flatness and cube error.', args: z.object({}) },
  qcLabel: { summary: 'The QC label applied: green PASS sticker or red REJECT tag.', args: z.object({ verdict: z.enum(['PASS', 'REJECT']) }) },
};

/**
 * Routine handlers for one printer unit. `unit`: { serial, label, markTested() }.
 * Each routine(args) → { start?(), update?(progress, previous) → status?, end?() → status? }.
 */
export function createRoutines(printer, unit) {
  let fanAngle = 0;
  const quality = () => qualityFor(unit.serial);
  const fill = (text) => text
    .replace('{label}', unit.label)
    .replace('{serial}', String(unit.serial))
    .replace('{flatness}', quality().flatness.toFixed(2));
  const tempStatus = (hotend, bed) => ({ hotend, bed, temps: `${Math.round(hotend)} / ${Math.round(bed)} °C` });

  return {
    display: ({ lines }) => ({ start: () => printer.setDisplay(lines.map(fill)) }),

    resetTest: () => ({
      end: () => ({ mesh: Array(9).fill(null), probed: 0, print: 0, printPercent: 0, flatness: '—', dimError: '—', result: '—', belts: '—', resonance: '—' }),
    }),

    axes: (to) => {
      let from;
      return {
        start: () => { from = { ...printer.axes }; },
        update: (p) => {
          const t = smoother(p);
          printer.setAxes({ head: lerp(from.head, to.head ?? from.head, t), bed: lerp(from.bed, to.bed ?? from.bed, t), nozzle: lerp(from.nozzle, to.nozzle ?? from.nozzle, t) });
        },
      };
    },

    fanSpin: ({ rate }) => ({
      update: (p, previous) => {
        fanAngle += (p - previous) * rate;
        printer.spinFan(fanAngle);
      },
    }),

    beltTest: ({ x, y }) => ({
      update: (p) => {
        const pluck = Math.sin(p * Math.PI * 10) * 0.012 * (1 - p);
        printer.setAxes(p < 0.5 ? { head: pluck, bed: 0 } : { head: 0, bed: pluck });
      },
      end: () => ({ belts: `X ${x} Hz · Y ${y} Hz` }),
    }),

    resonanceTest: ({ x, y }) => ({
      update: (p) => {
        const local = (p % 0.5) * 2;
        const shake = Math.sin(local * local * Math.PI * 60) * 0.004;
        printer.setAxes(p < 0.5 ? { head: shake, bed: 0 } : { head: 0, bed: shake });
      },
      end: () => {
        printer.setAxes({ head: 0, bed: 0 });
        return { resonance: `X ${x} Hz · Y ${y} Hz` };
      },
    }),

    probe: ({ to, reportFlatness }) => ({
      update: (p) => printer.setProbe(to === 1 ? smoother(p) : 1 - smoother(p)),
      end: () => (reportFlatness ? { flatness: `${quality().flatness.toFixed(2)} mm` } : undefined),
    }),

    probeDip: ({ index, height, depth }) => ({
      update: (p) => printer.setAxes({ nozzle: height + depth * (1 - Math.sin(p * Math.PI)) }),
      end: () => {
        const mesh = meshFor(unit.serial, quality().flatness);
        return { mesh: mesh.map((value, i) => (i <= index ? value : null)), probed: index + 1 };
      },
    }),

    heat: ({ hotend, bed, ambient }) => ({
      update: (p) => {
        const t = 1 - (1 - p) ** 2;
        printer.setHeat(t);
        const h = lerp(ambient, hotend, t);
        const b = lerp(ambient, bed, t);
        printer.setDisplay([`E ${Math.round(h)}/${hotend}C`, `B ${Math.round(b)}/${bed}C`]);
        return tempStatus(h, b);
      },
    }),

    purge: ({ from, to, bed, nozzle }) => ({
      update: (p) => {
        printer.setAxes({ head: lerp(from, to, p), bed, nozzle });
        printer.setPurge(p);
      },
    }),

    printCube: ({ layers, layerHeight, side }) => {
      const half = side / 2;
      const corners = [[-half, -half], [half, -half], [half, half], [-half, half]];
      const perimeter = (u) => {
        const edge = Math.floor(u * 4) % 4;
        const f = u * 4 - Math.floor(u * 4);
        const [ax, az] = corners[edge];
        const [bx, bz] = corners[(edge + 1) % 4];
        return [lerp(ax, bx, f), lerp(az, bz, f)];
      };
      return {
        update: (p, previous) => {
          const done = p * layers;
          const layer = Math.min(Math.floor(done), layers - 1);
          const [x, z2] = perimeter(done - Math.floor(done));
          printer.setAxes({ head: x, bed: -z2, nozzle: (layer + 1) * layerHeight + 0.0004 });
          printer.setTestPrint(p);
          fanAngle += (p - previous) * 400;
          printer.spinFan(fanAngle);
          return { print: p, printPercent: Math.round(p * 100) };
        },
      };
    },

    cool: ({ hotend, bed, ambient }) => ({
      update: (p) => {
        const t = 1 - p;
        printer.setHeat(t * t);
        return tempStatus(lerp(ambient + 40, hotend, t), lerp(ambient + 10, bed, t));
      },
    }),

    readRecord: () => {
      const record = () => ({ flatness: `${quality().flatness.toFixed(2)} mm`, dimError: `${quality().dimError.toFixed(2)} mm` });
      return { update: record, end: record };
    },

    qcLabel: ({ verdict }) => ({ start: () => printer.setQcLabel(verdict === 'PASS') }),

    record: () => ({
      end: () => {
        const q = quality();
        unit.markTested();
        printer.setDisplay(['TEST DONE', `Flat ${q.flatness.toFixed(2)}mm`]);
        return { dimError: `${q.dimError.toFixed(2)} mm`, result: q.flatness > QA.flatnessLimit ? 'OUT OF SPEC' : 'IN SPEC' };
      },
    }),
  };
}

/** Axis targets the ST4 data refers to (homing ends, rest height, probe offset). */
export const AXES = PRINTER_AXES;
