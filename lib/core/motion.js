// Motion profiles shared by ops, station cycles and the timing calculator.
// Pure maths: no three.js, no state. Units: metres and seconds.

export function clamp01(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Quintic ease: zero velocity and acceleration at both ends (smooth start/stop). */
export function smoother(t) {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/** Shortest signed angle from a to b (radians, in −π…π). */
export function angleDelta(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Interpolates two tool poses { x, y, z, yaw } (t already eased by the caller); yaw turns the
 * short way round. From the reference Robots.lerpTool.
 */
export function lerpPose(from, to, t) {
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    z: lerp(from.z, to.z, t),
    yaw: from.yaw + angleDelta(from.yaw, to.yaw) * t,
  };
}

/**
 * Trapezoid move: accelerate for `ramp` seconds, cruise at `speed`, decelerate for `ramp` seconds,
 * covering exactly `distance`. Duration is distance / speed + ramp (same profile as the reference lines).
 */
export function trapezoidDuration(distance, speed, ramp) {
  return Math.abs(distance) / speed + ramp;
}

/** Signed distance travelled at time `t` (0 … trapezoidDuration) of a trapezoid move. */
export function trapezoidTravel(t, distance, speed, ramp) {
  const sign = Math.sign(distance);
  const d = Math.abs(distance);
  if (d === 0) return 0;
  const total = d / speed + ramp;
  if (ramp <= 0) return sign * Math.min(Math.max(t, 0) * speed, d); // no ramp: constant speed (a roller belt)
  // A move too short to reach cruise speed has no room for two full ramps. The reference formula
  // would arrive early and stop abruptly; ease over the same duration instead.
  if (d / speed < ramp) return sign * d * smoother(t / total);
  const a = speed / ramp;
  let s;
  if (t <= ramp) s = 0.5 * a * Math.max(t, 0) ** 2;
  else if (t >= total - ramp) s = d - 0.5 * a * Math.max(total - t, 0) ** 2;
  else s = 0.5 * speed * ramp + speed * (t - ramp);
  return sign * Math.min(s, d);
}

/**
 * Belt travel at time `t` after a start from rest: accelerate to `speed` over `ramp` seconds, then
 * run on. Units riding it accumulate against stops (smoothMin). Reference CasePackingCycle.js.
 */
export function rampedTravel(t, speed, ramp) {
  const time = Math.max(t, 0);
  if (time < ramp) return 0.5 * (speed / ramp) * time * time;
  return 0.5 * speed * ramp + speed * (time - ramp);
}

/** Time a belt started from rest needs to run `travel` metres (inverse of rampedTravel). */
export function rampedDuration(travel, speed, ramp) {
  if (travel <= 0.5 * speed * ramp) return Math.sqrt((2 * Math.max(travel, 0) * ramp) / speed);
  return ramp + (travel - 0.5 * speed * ramp) / speed;
}

/** Belt travel `progress` (0…1) of the way through a stop from `speed` over `ramp` seconds. */
export function stoppingTravel(progress, speed, ramp) {
  const t = clamp01(progress) * ramp;
  return speed * t - 0.5 * (speed / ramp) * t * t;
}

/**
 * Polynomial smooth minimum: equals min(a, b) once |a − b| ≥ k, C1-smooth in between, so a unit
 * carried by a running belt eases into its stop over the last `k` metres. Reference CasePackingCycle.js.
 */
export function smoothMin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
