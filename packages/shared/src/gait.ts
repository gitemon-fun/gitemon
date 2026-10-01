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

/**
 * v18 (V18-D3): the one walk every 3D creature shares — a toy walked across a table. No skeleton: the whole
 * body lifts on each step, squashes a little as it lands, rocks from side to side (a new side each step) and
 * leans into travel. Only the 3D bodies use it; sprites keep their species gait (GAITS is unchanged).
 */
export const TOY = 'toy' as const;
/**
 * step length of the toy walk as a share of the creature's (sprite) height — build 08: short steps, so the
 * leg swing that matches it stays small and the feet seem to grip the ground
 */
export const STRIDE_TOY = 0.22;

export interface GaitPose {
  /** how far it rises off the ground (world units) */
  lift: number;
  /** squash and stretch across and up */
  sx: number;
  sy: number;
  /** a roll from foot to foot (radians), a lean into the way it walks (shear per unit height), a sway */
  roll: number;
  lean: number;
  sway: number;
}

/**
 * v16 (V16-D1): one moment of a gait, on the CPU — the same maths as `gaitPose` in the crowd's vertex
 * shader (apps/web/src/city/crowd.ts), so a pixel-block creature moves in step with the sprites.
 * `steps` = the step phase (integer = feet down), `moving` 0…1, `size` = its height in world units,
 * `time` in seconds and `phase` its per-creature offset (only the float bob uses them).
 */
export function gaitPose(
  gait: Gait | typeof TOY,
  steps: number,
  moving: number,
  size: number,
  time = 0,
  phase = 0,
): GaitPose {
  const f = steps - Math.floor(steps);
  const m = moving;
  const p: GaitPose = { lift: 0, sx: 1, sy: 1, roll: 0, lean: 0, sway: 0 };
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  if (gait === 'hop') {
    const air = Math.sin(Math.PI * f);
    const land = 1 - smooth(0, 0.2, Math.min(f, 1 - f));
    p.lift = m * air * 0.22 * size;
    p.sy = 1 + m * (0.07 * air - 0.14 * land);
    p.sx = 1 + m * (0.12 * land - 0.04 * air);
    p.lean = 0.03 * m;
  } else if (gait === 'waddle') {
    p.roll = m * 0.15 * Math.sin(Math.PI * steps);
    p.lift = m * Math.abs(Math.sin(Math.PI * steps)) * 0.04 * size;
  } else if (gait === 'trot') {
    p.lift = m * Math.abs(Math.sin(2 * Math.PI * steps)) * 0.05 * size;
    p.lean = 0.07 * m;
  } else if (gait === 'slither') {
    p.sway = m * 0.07;
    p.sx = 1 + 0.05 * m * Math.sin(2 * Math.PI * steps);
  } else if (gait === TOY) {
    const air = Math.sin(Math.PI * f);
    const land = 1 - smooth(0, 0.15, Math.min(f, 1 - f));
    p.lift = m * air * 0.08 * size;
    p.sy = 1 + m * (0.04 * air - 0.08 * land);
    p.sx = 1 + m * (0.06 * land - 0.02 * air);
    p.roll = m * 0.09 * Math.sin(Math.PI * steps);
    p.lean = 0.06 * m;
  } else {
    p.lift = 0.25 * size + Math.sin(time * 2.2 + phase * 5) * 0.05 * size;
    p.lean = 0.1 * m;
  }
  return p;
}
