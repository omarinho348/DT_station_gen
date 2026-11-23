import { z } from 'zod';
import { defineOp } from '../../registry.js';
import { lerp, smoother } from '../../core/motion.js';
import { common, id } from '../args.js';
import { checkRoutine } from '../routines.js';

// A top-flap case closer folds and presses a case standing under it. Port of the reference
// CasePackingCycle.planClosing (after the case has been indexed in):
//
//   tuckers lower behind the end flaps → push the end flaps in → tuckers retract → plate tamps the
//   end flaps → side folders push the side flaps in → folders retract → plate presses the top shut
//
// The machine's roles (metres, measured from the case): `tuckerOut` / `folderOut` beyond the end /
// side walls (negative = over the case), `tuckerUp` above the end-flap hinge, `plateUp` above the
// side-flap hinge. The case's role: routine `foldUnder`, told where the tools are; it works out how
// far its flaps lean in (its own flap geometry). Tools park outside the open flaps afterwards.
const TIMING = { tuckersLower: 0.4, foldEnds: 0.9, tuckersRetract: 0.6, tampEnds: 0.7, foldSides: 0.9, foldersRetract: 0.4, pressSeal: 1.2 };
const LABELS = {
  tuckersLower: 'Closer: tuckers lowering', foldEnds: 'Closer: folding end flaps', tuckersRetract: 'Closer: tuckers retracting',
  tampEnds: 'Closer: tamping end flaps', foldSides: 'Closer: folding side flaps', foldersRetract: 'Closer: side folders retracting',
  pressSeal: 'Closer: pressing case closed',
};
const TOOLS = { parkOut: 0.12, pushIn: 0.1, parkUp: 0.27, foldUp: 0.15, plateParkUp: 0.3, barRadius: 0.012 };
const MOTIONS = ['tuckerOut', 'tuckerUp', 'folderOut', 'plateUp'];

defineOp({
  op: 'closeCase',
  summary: 'Top-flap case closer: fold the end flaps (tuckers), tamp them, fold the side flaps (folders), press the top shut; tools park clear afterwards.',
  args: z.object({
    machine: id,
    item: id.default('product').describe('The case under the closer'),
    timing: z.object(Object.fromEntries(Object.entries(TIMING).map(([k, v]) => [k, z.number().min(0.01).max(30).default(v)]))).default(TIMING),
    tools: z.object({
      parkOut: z.number().default(TOOLS.parkOut).describe('Tools park this far beyond the walls (m)'),
      pushIn: z.number().min(0).default(TOOLS.pushIn).describe('Bars push this far in over the case (m)'),
      parkUp: z.number().default(TOOLS.parkUp).describe('Tuckers park this high above the end-flap hinge (m)'),
      foldUp: z.number().default(TOOLS.foldUp).describe('Bars fold at this height above the hinge (m)'),
      plateParkUp: z.number().default(TOOLS.plateParkUp).describe('Plate parks this high above the side-flap hinge (m)'),
      barRadius: z.number().min(0).max(0.1).default(TOOLS.barRadius).describe('Tucker and folder bar radius (m)'),
    }).default(TOOLS),
    labels: z.object(Object.fromEntries(Object.entries(LABELS).map(([k, v]) => [k, z.string().min(1).max(80).default(v)]))).default(LABELS),
    ...common,
  }),
  expand(cycle, a) {
    const m = a.machine;
    const k = a.tools;
    for (const motion of MOTIONS) cycle.motionSpec(m, motion);
    cycle.checkValue(m, 'tuckerOut', k.parkOut);
    cycle.checkValue(m, 'tuckerOut', -k.pushIn);
    cycle.checkValue(m, 'folderOut', k.parkOut);
    cycle.checkValue(m, 'folderOut', -k.pushIn);
    cycle.checkValue(m, 'tuckerUp', k.parkUp);
    cycle.checkValue(m, 'tuckerUp', k.foldUp);
    cycle.checkValue(m, 'plateUp', k.plateParkUp);
    cycle.checkValue(m, 'plateUp', 0);
    checkRoutine(cycle, a.item, 'foldUnder', { flaps: 'minor', angle: 0 });

    const drive = (values) => { for (const [motion, v] of Object.entries(values)) cycle.drive(m, motion, v); };
    const fold = (flaps, how) => cycle.productItem(a.item).routine('foldUnder', { flaps, ...how }).update(1, 0);
    const bar = (out) => ({ bar: { out, up: k.foldUp, radius: k.barRadius } });
    // Plate travel: down, hold for `hold` of the step, back up (reference `tamp`).
    const tamp = (progress, hold) => {
      const down = (1 - hold) / 2;
      const s = progress < down ? smoother(progress / down) : 1 - smoother((progress - down - hold) / down);
      return lerp(k.plateParkUp, 0, s);
    };
    const state = a.state ?? cycle.workState;
    const step = (key, update, extra = {}) => cycle.queue(state, a.labels[key], a.timing[key], key === 'tuckersLower' ? (a.status ?? {}) : {}, { onUpdate: update, ...extra });

    step('tuckersLower', (p) => drive({ tuckerOut: k.parkOut, tuckerUp: lerp(k.parkUp, k.foldUp, smoother(p)) }));
    step('foldEnds', (p) => {
      const out = lerp(k.parkOut, -k.pushIn, smoother(p));
      drive({ tuckerOut: out, tuckerUp: k.foldUp });
      fold('minor', bar(out));
    });
    step('tuckersRetract', (p) => drive({
      tuckerOut: lerp(-k.pushIn, k.parkOut, smoother((p - 0.4) / 0.6)),
      tuckerUp: lerp(k.foldUp, k.parkUp, smoother(p / 0.5)),
    }));
    step('tampEnds', (p) => {
      const up = tamp(p, 0.15);
      drive({ plateUp: up });
      fold('minor', { plate: up });
    });
    step('foldSides', (p) => {
      const out = lerp(k.parkOut, -k.pushIn, smoother(p));
      drive({ folderOut: out });
      fold('major', bar(out));
    });
    step('foldersRetract', (p) => drive({ folderOut: lerp(-k.pushIn, k.parkOut, smoother(p)) }));
    step('pressSeal', (p) => {
      const up = tamp(p, 0.35);
      drive({ plateUp: up });
      fold('major', { plate: up });
      fold('minor', { plate: up });
    }, {
      onEnd: () => {
        drive({ tuckerOut: k.parkOut, tuckerUp: k.parkUp, folderOut: k.parkOut, plateUp: k.plateParkUp });
        fold('minor', { angle: 0 });
        fold('major', { angle: 0 });
      },
    });
    cycle.plan(m, 'tuckerOut', k.parkOut);
    cycle.plan(m, 'tuckerUp', k.parkUp);
    cycle.plan(m, 'folderOut', k.parkOut);
    cycle.plan(m, 'plateUp', k.plateParkUp);
  },
});
