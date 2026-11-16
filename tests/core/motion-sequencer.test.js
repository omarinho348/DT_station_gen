import { describe, it, expect } from 'vitest';
import { smoother, clamp01, lerp, trapezoidDuration, trapezoidTravel } from '../../lib/core/motion.js';
import { StepSequencer } from '../../lib/core/StepSequencer.js';

describe('motion profiles', () => {
  it('smoother eases 0→1, symmetric, clamped', () => {
    expect(smoother(0)).toBe(0);
    expect(smoother(1)).toBe(1);
    expect(smoother(0.5)).toBeCloseTo(0.5, 12);
    expect(smoother(-3)).toBe(0);
    expect(smoother(7)).toBe(1);
    expect(smoother(0.25) + smoother(0.75)).toBeCloseTo(1, 12);
    expect(clamp01(1.5)).toBe(1);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
  });

  it('trapezoid duration is distance / speed + ramp, for either direction', () => {
    expect(trapezoidDuration(1.6, 0.4, 0.4)).toBeCloseTo(4.4, 12);
    expect(trapezoidDuration(-1.6, 0.4, 0.4)).toBeCloseTo(4.4, 12);
  });

  it('trapezoid travel starts at 0, ends exactly at the distance and never goes backwards', () => {
    for (const distance of [1.6, -1.6, 3.2, 0.05, -0.05]) {
      const total = trapezoidDuration(distance, 0.4, 0.4);
      expect(trapezoidTravel(0, distance, 0.4, 0.4)).toBeCloseTo(0, 12);
      expect(trapezoidTravel(total, distance, 0.4, 0.4)).toBeCloseTo(distance, 12);
      let last = 0;
      for (let i = 0; i <= 200; i += 1) {
        const s = Math.abs(trapezoidTravel((i / 200) * total, distance, 0.4, 0.4));
        expect(s).toBeGreaterThanOrEqual(last - 1e-12);
        expect(s).toBeLessThanOrEqual(Math.abs(distance) + 1e-12);
        last = s;
      }
    }
  });

  it('cruises at the given speed and is halfway at half time', () => {
    const [d, v, r] = [1.6, 0.4, 0.4];
    const total = trapezoidDuration(d, v, r);
    const dt = 1e-4;
    const mid = total / 2;
    expect((trapezoidTravel(mid + dt, d, v, r) - trapezoidTravel(mid, d, v, r)) / dt).toBeCloseTo(v, 6);
    expect(trapezoidTravel(mid, d, v, r)).toBeCloseTo(d / 2, 12);
  });

  it('starts and stops without a velocity jump, including very short moves', () => {
    for (const d of [1.6, 0.05]) {
      const total = trapezoidDuration(d, 0.4, 0.4);
      const dt = 1e-3;
      expect(trapezoidTravel(dt, d, 0.4, 0.4) / dt).toBeLessThan(0.01);
      expect((d - trapezoidTravel(total - dt, d, 0.4, 0.4)) / dt).toBeLessThan(0.01);
    }
  });

  it('a zero-length move stays put', () => {
    expect(trapezoidTravel(0.1, 0, 0.4, 0.4)).toBe(0);
  });
});

describe('StepSequencer', () => {
  function recorder() {
    const log = [];
    const seq = new StepSequencer({ onStepStart: (step) => log.push(`start:${step.label}`) });
    const add = (label, duration) =>
      seq.queue('S', label, duration, {}, {
        onStart: () => log.push(`onStart:${label}`),
        onUpdate: (p, prev) => log.push(`update:${label}:${prev.toFixed(2)}→${p.toFixed(2)}`),
        onEnd: () => log.push(`end:${label}`),
      });
    return { log, seq, add };
  }

  it('runs callbacks in order with progress and previous progress', () => {
    const { log, seq, add } = recorder();
    add('a', 1);
    seq.advance(0.25);
    seq.advance(0.75);
    expect(log).toEqual(['start:a', 'onStart:a', 'update:a:0.00→0.25', 'update:a:0.25→1.00', 'end:a']);
    expect(seq.active).toBeNull();
  });

  it('one big time slice completes several steps without skipping callbacks (10× speed)', () => {
    const { log, seq, add } = recorder();
    add('a', 0.2);
    add('b', 0.3);
    add('c', 1);
    seq.advance(1);
    expect(log.filter((l) => l.startsWith('end:'))).toEqual(['end:a', 'end:b']);
    expect(log.at(-1)).toBe('update:c:0.00→0.50');
    expect(seq.active.label).toBe('c');
  });

  it('zero-duration steps fire start, update(1) and end', () => {
    const { log, seq, add } = recorder();
    add('instant', 0);
    add('next', 1);
    seq.advance(0.1);
    expect(log.slice(0, 4)).toEqual(['start:instant', 'onStart:instant', 'update:instant:0.00→1.00', 'end:instant']);
    expect(seq.active.label).toBe('next');
  });

  it('asks plan() for more when the queue runs dry, and idles if it adds nothing', () => {
    let plans = 0;
    const seq = new StepSequencer({
      plan: () => {
        plans += 1;
        if (plans <= 2) seq.queue('S', `planned ${plans}`, 1);
      },
    });
    seq.advance(2.5);
    expect(plans).toBe(3);
    expect(seq.active).toBeNull();
    seq.advance(1); // nothing queued: must not throw or spin
    expect(plans).toBe(4);
  });

  it('applies total time exactly across steps', () => {
    const seq = new StepSequencer();
    let ended = 0;
    for (let i = 0; i < 10; i += 1) seq.queue('S', `s${i}`, 0.1, {}, { onEnd: () => (ended += 1) });
    for (let i = 0; i < 100; i += 1) seq.advance(0.01);
    expect(ended).toBe(10);
  });

  it('clear() drops queued and active steps', () => {
    const { seq, add } = recorder();
    add('a', 1);
    add('b', 1);
    seq.advance(0.5);
    seq.clear();
    expect(seq.active).toBeNull();
    expect(seq.steps).toHaveLength(0);
  });
});
