/**
 * v10 gaits (GRANDPLAN v10 §4, V10-D3): every creature moves with the gait of its body plan, and the
 * step cycle follows the DISTANCE it has travelled, not the clock — so a creature that stops has
 * no step motion. The crowd's vertex shader (apps/web/src/city/crowd.ts) holds a GLSL copy of
 * `patrolDistance` and `patrolSteps`; keep the two in step.
 */

export const GAITS = ['hop', 'waddle', 'trot', 'slither', 'float'] as const;
export type Gait = (typeof GAITS)[number];

/** a street resident patrols with clamp(PATROL_K · sin t): it walks, pauses at each end, walks back */
export const PATROL_K = 1.45;
/** the angle where the clamped patrol reaches its end and pauses */
const EDGE = Math.asin(1 / PATROL_K);

/**
 * How far the patrol has gone by angle t, in units of its amplitude: the total variation of
 * clamp(K · sin t). One full cycle (2π) is 4 units; the pauses add nothing.
 */
export function patrolDistance(t: number): number {
  const TAU = Math.PI * 2;
  const k = Math.floor(t / TAU);
  const a = t - k * TAU;
  const u = Math.max(-1, Math.min(1, PATROL_K * Math.sin(a)));
  let d: number;
  if (a < EDGE) d = u;
  else if (a < Math.PI - EDGE) d = 1;
  else if (a < Math.PI + EDGE) d = 2 - u;
  else if (a < TAU - EDGE) d = 3;
  else d = 4 + u;
  return 4 * k + d;
}

/**
 * Whole steps per patrol leg (end to end = 2 amplitudes), so a leg always ends on a landing.
 * `stride` is the gait's step length in the same units as the amplitude.
 */
export const legSteps = (amplitude: number, stride: number) =>
  Math.max(1, Math.round((2 * amplitude) / Math.max(1e-6, stride)));

/** The step phase of a patrolling resident: an integer exactly at each pause (feet down). */
export const patrolSteps = (t: number, amplitude: number, stride: number) =>
  ((patrolDistance(t) - 1) * legSteps(amplitude, stride)) / 2;

/** step length as a share of the creature's height, per gait */
export const STRIDE: Record<Gait, number> = {
  hop: 0.9,
  waddle: 0.55,
  trot: 0.6,
  slither: 0.7,
  float: 0.8,
};

/** v10 (V10-D5): a player stands a little bigger with standing (the V7-D6 merit bands) */
export const standingStep = (merit: number) => (merit >= 60 ? 1.12 : merit >= 35 ? 1.06 : 1);
