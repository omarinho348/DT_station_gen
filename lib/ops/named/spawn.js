import { z } from 'zod';
import { defineOp, paramFields } from '../../registry.js';
import { smoother } from '../../core/motion.js';
import { wrapValue, UNKNOWN } from '../OpCycle.js';
import { common, id, seconds, stateOf } from '../args.js';
import { vec3 } from '../sequences.js';

// The station makes items during its process: a carton erected and conveyed to the packing spot,
// top foam put out on its magazine. Each is a catalog product built at a machine place when the
// step starts; with `to`, it is carried there while the step runs (smooth) and the conveyor's
// surfaces scroll with it. Params may take unit facts: a value "{serial}" (the whole string) is
// replaced by the fact's value, "{label}" inside a text is filled in. The station keeps every item
// it makes (until it is cleared: a dispatched stack, a reset).
const place = z.object({ machine: id, port: id, offset: vec3.default([0, 0, 0]) }).strict();
const made = z.object({
  item: id.describe('Name the new item goes by in this cycle'),
  product: z.object({ type: id, params: z.record(z.string(), z.unknown()).default({}) }),
  at: place.describe('Where it appears'),
  to: place.optional().describe('Where it is carried to during the step'),
  conveyor: id.optional().describe('Conveyor whose surfaces scroll as it is carried'),
});

defineOp({
  op: 'spawn',
  summary: 'Make items during the process (cartons, foam, labels…) from the product catalog at machine places, optionally conveyed during the step.',
  args: z.object({
    items: z.array(made).min(1).max(4),
    seconds: seconds(60).default(0),
    ...common,
  }),
  expand(cycle, a) {
    const plans = a.items.map((m) => {
      cycle.declareSpawn(m.item, m.product.type);
      cycle.portPosition(m.at.machine, m.at.port);
      if (m.to) cycle.portPosition(m.to.machine, m.to.port);
      if (m.conveyor && !m.to) cycle.fail(`item "${m.item}": "conveyor" needs "to"`);
      // Params check with fact placeholders (the real values are only known when it plays).
      const schema = cycle.registry.getProduct(m.product.type).params;
      const kinds = Object.fromEntries(paramFields(schema).map((f) => [f.key, f.kind]));
      const check = schema.safeParse(fillParams(m.product.params, () => UNKNOWN, kinds));
      if (!check.success) cycle.fail(`item "${m.item}" (${m.product.type}): ${check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      let belts = [];
      let distance = 0;
      if (m.to && m.conveyor) {
        const d = cycle.portPoint(m.to).sub(cycle.portPoint(m.at));
        distance = Math.hypot(d.x, d.z);
        const sign = d.dot(cycle.axisOf(m.conveyor)) >= 0 ? 1 : -1;
        belts = Object.entries(cycle.specOf(m.conveyor).motions ?? {}).filter(([, spec]) => spec.travel).map(([motion, spec]) => ({ motion, spec, sign }));
        for (const b of belts) {
          const planned = cycle.planned(m.conveyor, b.motion);
          if (typeof planned === 'number') cycle.plan(m.conveyor, b.motion, wrapValue(planned + amount(b, distance), b.spec.range));
        }
      }
      return { m, belts, distance };
    });

    let live = [];
    cycle.queue(stateOf(cycle, a), a.label ?? `Making ${a.items.map((m) => m.item).join(', ')}`, a.seconds, a.status, {
      onStart: () => {
        live = plans.map(({ m, belts, distance }) => {
          const params = fillParams(m.product.params, (name) => cycle.fact(name));
          const unit = cycle.registry.buildProduct(m.product.type, params, cycle.ctx);
          unit.root.userData.dispose = () => unit.dispose();
          const parent = cycle.machine(m.at.machine).root.parent;
          parent.updateWorldMatrix(true, false);
          const p0 = parent.worldToLocal(cycle.portPoint(m.at));
          const p1 = m.to ? parent.worldToLocal(cycle.portPoint(m.to)) : p0;
          unit.root.position.copy(p0);
          parent.add(unit.root);
          cycle.spawnItem(m.item, unit);
          return { m, unit, p0, p1, belts, distance, previous: 0 };
        });
      },
      onUpdate: (progress) => {
        for (const l of live) {
          if (!l.m.to) continue;
          const t = smoother(progress);
          l.unit.root.position.lerpVectors(l.p0, l.p1, t);
          for (const b of l.belts) {
            const step = amount(b, l.distance * (t - l.previous));
            cycle.drive(l.m.conveyor, b.motion, cycle.machine(l.m.conveyor).state[b.motion] + step);
          }
          l.previous = t;
        }
      },
    });
    for (const { m } of plans) {
      const p = m.to ?? m.at;
      cycle.locate(m.item, { machine: p.machine, port: p.port, ...(p.offset.some((v) => v !== 0) ? { offset: p.offset } : {}) });
    }
  },
});

/** Range units a surface motion advances for `metres` of travel (signed by the direction). */
function amount(b, metres) {
  return ((b.sign * metres) / b.spec.travel) * (b.spec.range[1] - b.spec.range[0]);
}

/** Params with unit facts filled in: "{name}" alone → the fact's value; inside a text → its text. */
function fillParams(params, fact, kinds = {}) {
  const out = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'string') { out[key] = value; continue; }
    const whole = /^\{([a-zA-Z][a-zA-Z0-9]*)\}$/.exec(value);
    if (whole) {
      const v = fact(whole[1]);
      // Before it plays: a placeholder of the param's kind, for the checks.
      out[key] = v === UNKNOWN ? (kinds[key] === 'string' ? 'X' : 1) : v;
      continue;
    }
    out[key] = value.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (_, name) => {
      const v = fact(name);
      return v === UNKNOWN ? 'X' : String(v);
    });
  }
  return out;
}

